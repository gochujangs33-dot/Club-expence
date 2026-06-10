package com.example.clubexpense

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // WebView settings
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true           // localStorage 사용 허용
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidShare")

        // Load the bundled web app from assets
        webView.loadUrl("file:///android_asset/index.html")

        // Handle back button inside WebView
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    /**
     * JS에서 navigator.share 대신 사용하는 네이티브 공유 브릿지.
     * filesJson: [{ "name": "파일명.xlsx", "mimeType": "...", "base64": "..." }, ...]
     */
    inner class WebAppInterface(private val activity: AppCompatActivity) {

        @JavascriptInterface
        fun shareFiles(filesJson: String, title: String, text: String, to: String) {
            activity.runOnUiThread {
                try {
                    val sharedDir = File(activity.cacheDir, "shared").apply { mkdirs() }
                    // 이전 공유 파일 정리
                    sharedDir.listFiles()?.forEach { it.delete() }

                    val files = JSONArray(filesJson)
                    val uris = ArrayList<android.net.Uri>()
                    var mimeType = "*/*"

                    for (i in 0 until files.length()) {
                        val obj = files.getJSONObject(i)
                        val name = obj.getString("name")
                        val type = obj.optString("mimeType", "application/octet-stream")
                        val base64Data = obj.getString("base64")

                        val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                        val outFile = File(sharedDir, name)
                        FileOutputStream(outFile).use { it.write(bytes) }

                        val uri = FileProvider.getUriForFile(
                            activity,
                            "com.example.clubexpense.fileprovider",
                            outFile
                        )
                        uris.add(uri)
                        if (i == 0) mimeType = type
                    }

                    if (uris.isEmpty()) return@runOnUiThread

                    val intent = if (uris.size == 1) {
                        Intent(Intent.ACTION_SEND).apply {
                            type = mimeType
                            putExtra(Intent.EXTRA_STREAM, uris[0])
                            clipData = android.content.ClipData.newRawUri("", uris[0])
                        }
                    } else {
                        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                            type = "*/*"
                            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                            val clip = android.content.ClipData.newRawUri("", uris[0])
                            for (j in 1 until uris.size) {
                                clip.addItem(android.content.ClipData.Item(uris[j]))
                            }
                            clipData = clip
                        }
                    }
                    intent.putExtra(Intent.EXTRA_SUBJECT, title)
                    intent.putExtra(Intent.EXTRA_TEXT, text)
                    if (to.isNotBlank()) {
                        intent.putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
                    }
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

                    val chooser = Intent.createChooser(intent, title)
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    activity.startActivity(chooser)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }
}
