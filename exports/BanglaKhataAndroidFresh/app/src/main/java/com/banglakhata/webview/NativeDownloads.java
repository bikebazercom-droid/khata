package com.banglakhata.webview;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Same-origin main-frame bridge. All stream and DownloadManager IO is serialized off the UI thread. */
@android.annotation.SuppressLint("ApplySharedPref") // Durable recovery journal; commits run only on the IO executor.
final class NativeDownloads {
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final int CHUNK_BYTES = 48 * 1024;
    private final MainActivity activity;
    private final WebView webView;
    private final Uri site = Uri.parse(BuildConfig.WEB_APP_URL);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean messageBusy = new AtomicBoolean();
    private final SharedPreferences prefs;
    private final DownloadManager manager;
    private final ArrayDeque<PermissionJob> permissionQueue = new ArrayDeque<>();
    private final ActivityResultLauncher<String> permission;
    private boolean permissionRequested;
    private volatile boolean closed;
    private volatile int generation;
    private String script;
    private boolean documentStart;
    private boolean bridge;
    private Transfer active; // IO thread only
    private final Set<Long> showing = new HashSet<>(); // main thread only

    private static final class PermissionJob {
        final Runnable success, failure;
        PermissionJob(Runnable success, Runnable failure) { this.success = success; this.failure = failure; }
    }
    private static final class Transfer {
        String id, name, mime, mode, text;
        long size, written, touched;
        int generation;
        Uri uri;
        File file;
        OutputStream stream;
    }
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { checkCompleted(); }
    };
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (closed) return;
            io.execute(() -> {
                if (active != null && System.currentTimeMillis() - active.touched > 120000) {
                    discard(); toast("File transfer timed out. Please retry.");
                }
            });
            main.postDelayed(this, 30000);
        }
    };

    NativeDownloads(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        prefs = activity.getSharedPreferences("native-downloads", Context.MODE_PRIVATE);
        manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        permission = activity.registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            permissionRequested = false;
            while (!permissionQueue.isEmpty()) {
                PermissionJob job = permissionQueue.removeFirst();
                if (!closed && granted) job.success.run(); else job.failure.run();
            }
        });
    }

    void install() {
        io.execute(this::recoverPartials);
        ContextCompat.registerReceiver(activity, receiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
        main.postDelayed(watchdog, 30000);
        bridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        if (bridge) {
            try (InputStream in = activity.getAssets().open("native-downloads.js")) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] bytes = new byte[4096];
                int n;
                while ((n = in.read(bytes)) != -1) buffer.write(bytes, 0, n);
                script = buffer.toString(StandardCharsets.UTF_8.name());
            } catch (Exception e) {
                bridge = false;
                toast("Native PDF bridge could not load: " + e.getMessage());
            }
        }
        if (bridge && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            String origin = "https://" + site.getEncodedAuthority();
            Set<String> origins = Collections.singleton(origin);
            WebViewCompat.addWebMessageListener(webView, "BKDownloads", origins,
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (!isMainFrame || !sameOrigin(sourceOrigin) || !sameOrigin(Uri.parse(
                                view.getUrl() == null ? "" : view.getUrl())) || closed) return;
                        receive(message.getData(), reply);
                    });
            documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
                WebViewCompat.addDocumentStartJavaScript(webView, script, origins);
        }
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (url == null) return;
            Uri uri = Uri.parse(url);
            if ("blob".equalsIgnoreCase(uri.getScheme())) {
                toast("Generated file was not captured. Update Android System WebView, reload, and retry.");
                return; // DownloadManager never receives blob: URLs.
            }
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null) {
                toast("Only secure HTTPS downloads are supported."); return;
            }
            if (!sameOrigin(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) {
                toast("Return to BanglaKhata before downloading."); return;
            }
            String safeMime = mime(mime);
            String name = name(URLUtil.guessFileName(url, disposition, safeMime), safeMime);
            // Capture cookies on UI thread for precisely the requested URL, not arbitrary app credentials.
            String cookie = CookieManager.getInstance().getCookie(url);
            withStorage(() -> io.execute(() -> enqueue(uri, userAgent, cookie, name, safeMime)),
                    () -> toast("Storage permission denied. File was not downloaded."));
        });
    }

    private boolean sameOrigin(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && site.getHost() != null
                && site.getHost().equalsIgnoreCase(uri.getHost())
                && effectivePort(site) == effectivePort(uri) && uri.getUserInfo() == null;
    }
    private static int effectivePort(Uri uri) { return uri.getPort() == -1 ? 443 : uri.getPort(); }

    void onPageFinished(String url) {
        if (!sameOrigin(Uri.parse(url))) return;
        if (bridge && !documentStart) {
            webView.evaluateJavascript(script, null);
            toast("Update Android System WebView for reliable PDF downloads. Compatibility mode is active.");
        } else if (!bridge) {
            toast("Update Android System WebView to enable generated PDF downloads and sharing.");
        }
    }

    void onNavigation() {
        generation++;
        while (!permissionQueue.isEmpty()) permissionQueue.removeFirst().failure.run();
        if (!closed) io.execute(this::discard);
    }

    private void withStorage(Runnable success, Runnable failure) {
        if (closed) { failure.run(); return; }
        if (Build.VERSION.SDK_INT >= 29 || ContextCompat.checkSelfPermission(activity,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            success.run(); return;
        }
        if (permissionQueue.size() >= 4) { failure.run(); return; }
        permissionQueue.add(new PermissionJob(success, failure));
        if (!permissionRequested) {
            permissionRequested = true;
            permission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
    }

    private void receive(String raw, JavaScriptReplyProxy reply) {
        JSONObject request;
        try {
            if (raw == null || raw.length() > 70000) throw new Exception("Message exceeds 70 KB.");
            request = new JSONObject(raw);
            if (!request.optString("token").matches("[0-9]{1,12}")) throw new Exception("Invalid request token.");
        } catch (Exception e) { toast("Invalid native download message."); return; }
        String token = request.optString("token");
        if (!messageBusy.compareAndSet(false, true)) {
            respond(reply, token, false, "Another file operation is pending."); return;
        }
        int epoch = generation;
        Runnable work = () -> {
            if (closed) { messageBusy.set(false); return; }
            io.execute(() -> {
                try {
                    if (epoch != generation) throw new Exception("Page changed. Please retry.");
                    handle(request, epoch);
                    respond(reply, token, true, "");
                } catch (Exception e) {
                    discard();
                    String error = e.getMessage() == null ? "Could not save file." : e.getMessage();
                    toast(error);
                    respond(reply, token, false, error);
                } finally { messageBusy.set(false); }
            });
        };
        if ("begin".equals(request.optString("op")) && !"share".equals(request.optString("mode"))) {
            withStorage(work, () -> {
                messageBusy.set(false);
                respond(reply, token, false, "Storage permission denied or page changed. File was not saved.");
            });
        } else work.run();
    }

    private void respond(JavaScriptReplyProxy reply, String token, boolean ok, String error) {
        main.post(() -> {
            if (closed) return;
            try {
                JSONObject response = new JSONObject();
                response.put("token", token).put("ok", ok).put("error", error);
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
                    reply.postMessage(response.toString());
            } catch (Exception ignored) { /* Page may have been destroyed. */ }
        });
    }

    private void handle(JSONObject request, int epoch) throws Exception {
        String op = request.getString("op"), id = request.optString("id");
        if (!id.matches("bk-[A-Za-z0-9-]{1,80}")) throw new Exception("Invalid transfer ID.");
        if ("begin".equals(op)) {
            if (active != null) throw new Exception("Another file is still being saved.");
            long size = request.getLong("size");
            if (size <= 0 || size > MAX_BYTES) throw new Exception("File must be between 1 byte and 64 MiB.");
            String mode = request.getString("mode");
            if (!"share".equals(mode) && !"download".equals(mode)) throw new Exception("Invalid file action.");
            Transfer t = new Transfer();
            t.id = id; t.size = size; t.mode = mode; t.generation = epoch;
            t.mime = mime(request.optString("mime")); t.name = name(request.optString("name"), t.mime);
            t.text = request.optString("text");
            if (t.text.length() > 4000) throw new Exception("Share text is too long.");
            active = t;
            t.touched = System.currentTimeMillis();
            open(t);
            toast("share".equals(mode) ? "Preparing file to share…" : "Download started…");
            return;
        }
        if ("cancel".equals(op)) {
            if (active != null && active.id.equals(id)) discard();
            return;
        }
        Transfer t = active;
        if (t == null || !t.id.equals(id) || t.generation != epoch) throw new Exception("Transfer expired. Please retry.");
        t.touched = System.currentTimeMillis();
        if ("chunk".equals(op)) {
            if (request.getLong("offset") != t.written) throw new Exception("File chunk is out of order.");
            String encoded = request.getString("data");
            if (encoded.length() > 65536 || !encoded.matches("[A-Za-z0-9+/]*={0,2}"))
                throw new Exception("Invalid file chunk.");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > CHUNK_BYTES || t.written + bytes.length > t.size)
                throw new Exception("File exceeded its declared size or chunk limit.");
            t.stream.write(bytes);
            t.written += bytes.length;
        } else if ("end".equals(op)) {
            if (t.written != t.size) throw new Exception("Incomplete file. Nothing was saved.");
            t.stream.flush(); t.stream.close(); t.stream = null;
            if (closed || generation != epoch) throw new Exception("Page closed before save completed.");
            if (Build.VERSION.SDK_INT >= 29 && "download".equals(t.mode)) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                if (activity.getContentResolver().update(t.uri, values, null, null) != 1)
                    throw new Exception("Could not publish file in Downloads.");
            } else {
                File destination = new File(t.file.getParentFile(), unique(t.name));
                if (!t.file.renameTo(destination)) throw new Exception("Could not finish saving file.");
                t.file = destination;
                t.uri = FileProvider.getUriForFile(activity, BuildConfig.APPLICATION_ID + ".files", destination);
            }
            prefs.edit().remove("partialUri").remove("partialFile").commit();
            active = null;
            main.post(() -> {
                if (closed) return;
                if ("share".equals(t.mode)) share(t.uri, t.mime, t.text);
                else { toast("Saved to Downloads/BanglaKhata"); completed(t.uri, t.mime, t.name); }
            });
        } else throw new Exception("Unknown file operation.");
    }

    private void open(Transfer t) throws Exception {
        if ("download".equals(t.mode) && Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, t.name);
            values.put(MediaStore.Downloads.MIME_TYPE, t.mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BanglaKhata");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            t.uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (t.uri == null) throw new Exception("Cannot create file in Downloads.");
            prefs.edit().putString("partialUri", t.uri.toString()).commit();
            t.stream = activity.getContentResolver().openOutputStream(t.uri, "w");
            if (t.stream == null) throw new Exception("Cannot open Downloads file.");
        } else {
            File directory = "share".equals(t.mode) ? new File(activity.getCacheDir(), "shared-reports")
                    : new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BanglaKhata");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create Downloads directory.");
            t.file = new File(directory, UUID.randomUUID() + ".part");
            prefs.edit().putString("partialFile", t.file.getAbsolutePath()).commit();
            t.stream = new FileOutputStream(t.file);
        }
    }

    private void discard() {
        Transfer t = active;
        active = null;
        if (t != null) {
            try { if (t.stream != null) t.stream.close(); } catch (Exception ignored) {}
            try {
                if (t.uri != null && Build.VERSION.SDK_INT >= 29 && "download".equals(t.mode))
                    activity.getContentResolver().delete(t.uri, null, null);
                else if (t.file != null && t.file.exists() && !t.file.delete())
                    toast("Could not remove an incomplete file. Check Downloads/BanglaKhata.");
            } catch (Exception e) { toast("Could not clean incomplete download: " + e.getMessage()); }
            prefs.edit().remove("partialUri").remove("partialFile").commit();
        }
    }

    private void recoverPartials() {
        String uri = prefs.getString("partialUri", null), path = prefs.getString("partialFile", null);
        try {
            if (uri != null) activity.getContentResolver().delete(Uri.parse(uri), null, null);
            if (path != null) {
                File file = new File(path);
                if (file.exists() && !file.delete()) throw new Exception("Cannot remove " + file.getName());
            }
            prefs.edit().remove("partialUri").remove("partialFile").commit();
        } catch (Exception e) { toast("Incomplete download cleanup failed: " + e.getMessage()); }
        File[] old = new File(activity.getCacheDir(), "shared-reports").listFiles();
        if (old != null) for (File file : old) {
            if (file.lastModified() < System.currentTimeMillis() - 24 * 60 * 60 * 1000L && !file.delete())
                toast("Could not clear an expired share file.");
        }
    }

    private void enqueue(Uri uri, String agent, String cookie, String name, String mime) {
        try {
            if (closed) return;
            DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setTitle(name).setMimeType(mime)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "BanglaKhata/" + unique(name));
            if (agent != null && !agent.contains("\r") && !agent.contains("\n")) request.addRequestHeader("User-Agent", agent);
            if (cookie != null && !cookie.contains("\r") && !cookie.contains("\n")) request.addRequestHeader("Cookie", cookie);
            long id = manager.enqueue(request);
            Set<String> ids = new HashSet<>(prefs.getStringSet("downloads", Collections.emptySet()));
            ids.add(Long.toString(id));
            prefs.edit().putStringSet("downloads", ids).commit();
            toast("Download started…");
        } catch (Exception e) { toast("Download could not start: " + e.getMessage()); }
    }

    void checkCompleted() {
        if (closed) return;
        io.execute(() -> {
            Set<String> ids = new HashSet<>(prefs.getStringSet("downloads", Collections.emptySet()));
            for (String value : ids) {
                long id;
                try { id = Long.parseLong(value); } catch (NumberFormatException e) { continue; }
                try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                    if (cursor == null || !cursor.moveToFirst()) { forget(id); continue; }
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_FAILED) {
                        int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        forget(id); toast("Download failed (Android reason " + reason + "). Please retry.");
                    } else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        Uri uri = manager.getUriForDownloadedFile(id);
                        String mime = mime(manager.getMimeTypeForDownloadedFile(id));
                        String title = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
                        main.post(() -> {
                            if (closed || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)
                                    || !showing.add(id)) return;
                            if (uri != null) completed(uri, mime, title);
                            else toast("Downloaded file is no longer available.");
                            io.execute(() -> forget(id));
                        });
                    }
                } catch (Exception e) { toast("Cannot check download: " + e.getMessage()); }
            }
        });
    }

    private void forget(long id) {
        Set<String> ids = new HashSet<>(prefs.getStringSet("downloads", Collections.emptySet()));
        ids.remove(Long.toString(id));
        prefs.edit().putStringSet("downloads", ids).commit();
    }
    private void completed(Uri uri, String mime, String name) {
        if (closed || activity.isFinishing()) return;
        new AlertDialog.Builder(activity).setTitle("Download complete").setMessage(name)
                .setPositiveButton("Open", (dialog, which) -> launch(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime), uri))
                .setNeutralButton("Share", (dialog, which) -> share(uri, mime, ""))
                .setNegativeButton("Done", null).show();
    }
    private void share(Uri uri, String mime, String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
        if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        launch(send, uri);
    }
    private void launch(Intent intent, Uri uri) {
        try {
            intent.setClipData(ClipData.newRawUri("BanglaKhata file", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, Intent.ACTION_SEND.equals(intent.getAction()) ? "Share file" : "Open file");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(chooser);
        } catch (Exception e) { toast("No compatible app could open this file. Install a PDF viewer or sharing app."); }
    }
    private static String mime(String input) {
        String value = input == null ? "" : input.split(";")[0].trim().toLowerCase(Locale.ROOT);
        return value.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+") && value.length() <= 120
                ? value : "application/octet-stream";
    }
    private static String name(String input, String mime) {
        String value = input == null ? "" : input.replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|\\u202A-\\u202E\\u2066-\\u2069]", "_")
                .replaceAll("^\\.+", "").trim();
        if (value.length() > 100) value = value.substring(0, 100);
        // Bengali and other Unicode names can exceed filesystem byte limits well before 100 characters.
        while (value.getBytes(StandardCharsets.UTF_8).length > 180)
            value = value.substring(0, value.offsetByCodePoints(value.length(), -1));
        if (value.isEmpty()) value = "BanglaKhata-report";
        String extension = "application/pdf".equals(mime) ? ".pdf" : "image/png".equals(mime) ? ".png"
                : "image/jpeg".equals(mime) ? ".jpg" : "";
        if (!extension.isEmpty() && !value.toLowerCase(Locale.ROOT).endsWith(extension)) value += extension;
        return value;
    }
    private static String unique(String name) {
        int dot = name.lastIndexOf('.');
        String suffix = "-" + UUID.randomUUID().toString().substring(0, 8);
        return dot > 0 ? name.substring(0, dot) + suffix + name.substring(dot) : name + suffix;
    }
    private void toast(String message) {
        main.post(() -> { if (!closed) Toast.makeText(activity, message, Toast.LENGTH_LONG).show(); });
    }
    void close() {
        closed = true; generation++;
        main.removeCallbacks(watchdog);
        permissionQueue.clear();
        activity.unregisterReceiver(receiver);
        io.execute(this::discard);
        io.shutdown();
    }
}