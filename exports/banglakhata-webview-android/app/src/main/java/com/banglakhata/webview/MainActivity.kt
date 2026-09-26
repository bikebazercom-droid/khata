package com.banglakhata.webview

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingDownload: (() -> Unit)? = null

    private val homeUrl: String
        get() = BuildConfig.WEB_APP_URL

    private val homeHost: String
        get() = Uri.parse(homeUrl).host.orEmpty()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(24, 58, 107)
        window.navigationBarColor = Color.rgb(16, 28, 48)
        setContentView(R.layout.activity_main)
        webView = checkNotNull(findViewById<WebView>(R.id.web_view))
        progressBar = checkNotNull(findViewById<ProgressBar>(R.id.loading_progress))
        enterFullScreen()

        configureWebView()
        if (savedInstanceState == null) {
            webView.loadUrl(homeUrl)
        } else {
            webView.restoreState(savedInstanceState) ?: webView.loadUrl(homeUrl)
        }
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = routeUrl(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                routeUrl(Uri.parse(url))

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) showOfflinePage()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = callback
                return try {
                    val acceptTypes = params.acceptTypes
                        .filter { it.isNotBlank() }
                        .toTypedArray()
                    val picker = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = if (acceptTypes.size == 1) acceptTypes[0] else "*/*"
                        if (acceptTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes)
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    startActivityForResult(
                        Intent.createChooser(picker, getString(R.string.choose_file)),
                        REQUEST_FILE_PICKER,
                    )
                    true
                } catch (_: Exception) {
                    uploadCallback?.onReceiveValue(null)
                    uploadCallback = null
                    Toast.makeText(this@MainActivity, R.string.file_picker_unavailable, Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        webView.setDownloadListener(
            DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                queueDownload(url, userAgent, contentDisposition, mimeType)
            },
        )
    }

    private fun routeUrl(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (uri.scheme == RETRY_SCHEME) {
            webView.loadUrl(homeUrl)
            return true
        }
        // HTTPS navigation stays in this WebView, including authentication
        // redirects. Never bypass SSL errors or permit cleartext HTTP.
        if (scheme == "https") return false

        if (scheme in setOf("tel", "mailto", "sms")) {
            return openExternal(uri)
        }
        if (scheme == "http") {
            return openExternal(uri)
        }
        return true
    }

    private fun openExternal(uri: Uri): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: Exception) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            true
        }
    }

    private fun showOfflinePage() {
        val html = """
            <!doctype html><html lang="bn"><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <body style="font:16px sans-serif;text-align:center;padding:15vh 24px;color:#183a6b">
              <h2>ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না</h2>
              <p>সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</p>
              <a style="display:inline-block;padding:12px 22px;background:#183a6b;color:white;
                 border-radius:10px;text-decoration:none" href="$RETRY_SCHEME://reload">আবার চেষ্টা করুন</a>
            </body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(homeUrl, html, "text/html", "UTF-8", null)
    }

    private fun queueDownload(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || !uri.host.equals(homeHost, ignoreCase = true)) {
            Toast.makeText(this, R.string.download_blocked, Toast.LENGTH_SHORT).show()
            return
        }
        val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
            .replace(Regex("""[/\\\u0000-\u001f]"""), "_")
        val enqueue = {
            try {
                val request = DownloadManager.Request(uri)
                    .setTitle(filename)
                    .setDescription(getString(R.string.download_started))
                    .setMimeType(mimeType)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
                if (userAgent.isNotBlank()) request.addRequestHeader("User-Agent", userAgent)
                val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                manager.enqueue(request)
                Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show()
            }
        }

        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = enqueue
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQUEST_STORAGE_PERMISSION)
        } else {
            enqueue()
        }
    }

    @Deprecated("Required for Android versions before the system photo picker.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILE_PICKER) return
        uploadCallback?.onReceiveValue(
            if (resultCode == RESULT_OK) FileChooserParams.parseResult(resultCode, data) else null,
        )
        uploadCallback = null
    }

    @Deprecated("Required for Android 9 and earlier download support.")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_STORAGE_PERMISSION) return
        val download = pendingDownload
        pendingDownload = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            download?.invoke()
        } else {
            Toast.makeText(this, R.string.storage_permission_denied, Toast.LENGTH_LONG).show()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        enterFullScreen()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterFullScreen()
    }

    @Suppress("DEPRECATION")
    private fun enterFullScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        }
    }

    @Deprecated("Use Android system back navigation.")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        uploadCallback?.onReceiveValue(null)
        uploadCallback = null
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_FILE_PICKER = 7101
        private const val REQUEST_STORAGE_PERMISSION = 7102
        private const val RETRY_SCHEME = "banglakhata-retry"
    }
}