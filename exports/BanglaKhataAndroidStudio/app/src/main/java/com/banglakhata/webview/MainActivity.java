package com.banglakhata.webview;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.File;
import java.io.IOException;

public final class MainActivity extends ComponentActivity {
    private WebView webView;
    private View errorPanel;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingCameraUri;
    private File pendingCameraFile;
    private OnBackPressedCallback backCallback;
    private NativeDownloads downloads;

    private final ActivityResultLauncher<Intent> filePicker =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileCallback != null) {
                    Uri[] selected = WebChromeClient.FileChooserParams.parseResult(
                            result.getResultCode(), result.getData());
                    boolean cameraResult = result.getResultCode() == Activity.RESULT_OK &&
                            (result.getData() == null ||
                                    (result.getData().getData() == null &&
                                            result.getData().getClipData() == null));
                    if (cameraResult && pendingCameraUri != null) {
                        selected = new Uri[] { pendingCameraUri };
                        pendingCameraUri = null;
                        pendingCameraFile = null;
                    } else {
                        discardPendingCameraCapture();
                    }
                    fileCallback.onReceiveValue(selected);
                    fileCallback = null;
                }
            });

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.web_view);
        errorPanel = findViewById(R.id.error_panel);
        progress = findViewById(R.id.loading_progress);

        // Keep form fields above the keyboard, and avoid display cutouts.
        View content = findViewById(R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
            return insets;
        });
        findViewById(R.id.retry_button).setOnClickListener(v -> {
            errorPanel.setVisibility(View.GONE);
            webView.reload();
        });
        configureWebView();
        backCallback = new OnBackPressedCallback(false) {
            @Override public void handleOnBackPressed() {
                errorPanel.setVisibility(View.GONE);
                webView.goBack();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);
        if (state == null || webView.restoreState(state) == null) {
            webView.loadUrl(BuildConfig.WEB_APP_URL);
        }
        enterFullScreen();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        downloads = new NativeDownloads(this, webView);
        downloads.install();
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                downloads.onNavigation();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                // Web navigation is handled by this WebView, not a browser app.
                if ("https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                if ("tel".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme)
                        || "sms".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, R.string.cannot_open, Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (backCallback != null) backCallback.setEnabled(view.canGoBack());
                CookieManager.getInstance().flush();
                downloads.onPageFinished(url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                                  WebResourceError error) {
                if (request.isForMainFrame()) errorPanel.setVisibility(View.VISIBLE);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent chooser = Intent.createChooser(params.createIntent(), getString(R.string.choose_file));
                    if (acceptsImages(params)) {
                        try {
                            pendingCameraFile = createCameraCaptureFile();
                            pendingCameraUri = FileProvider.getUriForFile(
                                    MainActivity.this, getPackageName() + ".files", pendingCameraFile);
                            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                                    .putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri)
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
                        } catch (IOException | IllegalArgumentException ignored) {
                            discardPendingCameraCapture();
                            // Keep the regular system file picker available if camera setup fails.
                        }
                    }
                    filePicker.launch(chooser);
                } catch (ActivityNotFoundException | IllegalArgumentException e) {
                    discardPendingCameraCapture();
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, R.string.cannot_open, Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
    }

    private boolean acceptsImages(FileChooserParams params) {
        if (params.isCaptureEnabled()) return true;
        String[] types = params.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String type : types) {
            if (type == null || type.isBlank() || "*/*".equals(type) ||
                    type.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) return true;
        }
        return false;
    }

    private File createCameraCaptureFile() throws IOException {
        File directory = new File(getCacheDir(), "camera-captures");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Could not create camera capture folder");
        }
        return File.createTempFile("ledger-photo-", ".jpg", directory);
    }

    private void discardPendingCameraCapture() {
        if (pendingCameraFile != null) pendingCameraFile.delete();
        pendingCameraFile = null;
        pendingCameraUri = null;
    }

    private void enterFullScreen() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) enterFullScreen();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (downloads != null) downloads.checkCompleted();
    }
    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }
    @Override protected void onSaveInstanceState(@NonNull Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        if (downloads != null) downloads.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        discardPendingCameraCapture();
        if (webView != null) {
            webView.stopLoading();
            ((android.view.ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
        }
        super.onDestroy();
    }
}