package com.papercompanion.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 测试版安装壳：网页和 API 均由电脑提供，本 APK 不存数据库或密钥。 */
public final class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFiles;
    private LinearLayout setup;
    private EditText address;
    private String trustedHost;
    private int trustedPort;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        showSetup();
    }

    private void showSetup() {
        if (webView != null) { webView.destroy(); webView = null; }
        trustedHost = null;
        trustedPort = -1;
        setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(24 * getResources().getDisplayMetrics().density);
        setup.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText("纸书智伴 · 测试版\n\n请先在电脑启动 mobile-tablet，再用 Tailscale Serve 分享其 5174 端口。手机也须连接同一 Tailscale 网络。数据仍保存在电脑的 MongoDB。\n\n请输入完整 HTTPS 地址（例如 https://电脑名.网络名.ts.net:8443/）：");
        title.setTextSize(17);
        setup.addView(title);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("https://电脑名.网络名.ts.net:8443/");
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(getPreferences(0).getString("server", ""));
        setup.addView(address);
        Button open = new Button(this);
        open.setText("连接移动版");
        open.setOnClickListener(v -> connect(address.getText().toString()));
        setup.addView(open);
        setContentView(setup);
    }

    private void connect(String value) {
        Uri uri;
        try { uri = Uri.parse(value.trim()); }
        catch (Exception e) { toast("地址格式不正确"); return; }
        // 只允许 Tailnet 的 HTTPS 主机，不接受账号、任意端口、路径或 HTTP。
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
            !host.toLowerCase(java.util.Locale.ROOT).endsWith(".ts.net") ||
            host.indexOf('.') < 1 || (uri.getPort() != -1 && uri.getPort() != 443 && uri.getPort() != 8443 && uri.getPort() != 10000) ||
            uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
            !(uri.getPath() == null || uri.getPath().isEmpty() || "/".equals(uri.getPath()))) {
            toast("请输入 Tailscale Serve 提供的 https://…ts.net/ 地址");
            return;
        }
        trustedHost = host;
        trustedPort = uri.getPort();
        String server = "https://" + host + (uri.getPort() == -1 ? "" : ":" + uri.getPort()) + "/";
        getPreferences(0).edit().putString("server", server).apply();
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        webView.getSettings().setAllowContentAccess(true); // Android 文件选择器的临时 URI
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) toast("连接失败：请确认电脑服务、Tailscale 和分享地址");
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if ("https".equalsIgnoreCase(target.getScheme()) && trustedHost.equalsIgnoreCase(target.getHost()) && target.getPort() == trustedPort) return false;
                if (request.isForMainFrame() && ("https".equalsIgnoreCase(target.getScheme()) || "http".equalsIgnoreCase(target.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, target)); } catch (ActivityNotFoundException ignored) { toast("无法打开外部链接"); }
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                toast("HTTPS 证书无效，请检查电脑的 Tailscale Serve");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try { startActivityForResult(params.createIntent(), FILE_REQUEST); }
                catch (Exception e) { pendingFiles.onReceiveValue(null); pendingFiles = null; toast("无法打开系统文件选择器"); }
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl(server);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else if (webView != null) showSetup();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
}






