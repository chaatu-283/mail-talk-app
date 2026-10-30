package jp.chaatu.mailtalk;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.IntentSender;
import android.content.ClipData;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.util.Base64;
import android.widget.Toast;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String START_URL = "https://chaatu-283.github.io/mail-talk-app/";
    private static final int REQ_AUTH = 9401;
    private static final int REQ_FILE = 9402;
    private static final int REQ_SAVE_ATTACHMENT = 9403;
    private final ExecutorService attachmentWorker = Executors.newSingleThreadExecutor();
    private File pendingSave;

    private WebView webView;
    private AuthorizationClient authorizationClient;
    private String pendingAuthId;
    private boolean pendingAuthInteractive = true;
    private volatile boolean foreground;
    private ValueCallback<Uri[]> fileCallback;
    private OnBackInvokedCallback backCallback;
    private boolean backPending;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(247,249,252));
        getWindow().setNavigationBarColor(Color.BLACK);

        authorizationClient = Identity.getAuthorizationClient(this);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        // Resize the WebView itself; padding on WebView does not reliably inset fixed HTML UI.
        FrameLayout root = new FrameLayout(this);
        root.addView(webView);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars =
                        insets.getInsets(WindowInsets.Type.systemBars()
                                | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                        insets.getSystemWindowInsetLeft(),
                        insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(),
                        insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        root.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleAndroidBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new NativeBridge(), "MailTalkAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("https".equals(u.getScheme()) && "chaatu-283.github.io".equalsIgnoreCase(u.getHost())
                        && u.getPath() != null && u.getPath().startsWith("/mail-talk-app/")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", (dialog, which) -> result.confirm())
                        .setNegativeButton("キャンセル", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                Intent intent;
                try {
                    intent = fileChooserParams.createIntent();
                } catch (Exception e) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(intent, REQ_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        if (savedInstanceState == null) webView.loadUrl(START_URL);
        else webView.restoreState(savedInstanceState);
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void exportAttachment(String name, String mime, String base64, boolean saveOnly) {
            if (base64 == null || base64.length() > 35 * 1024 * 1024) {
                attachmentNotice("添付が大きすぎるため渡せません（最大25MB）。");
                return;
            }
            attachmentWorker.execute(() -> {
                try {
                    String filename = name == null ? "attachment" : name.replace('/', '_').replace('\\', '_').replace('\0', '_');
                    if (filename.isEmpty() || filename.equals(".") || filename.equals("..")) filename = "attachment";
                    File dir = new File(getCacheDir(), "shared-attachments/" + UUID.randomUUID());
                    if (!dir.mkdirs()) throw new java.io.IOException("Cannot create attachment directory");
                    File file = new File(dir, filename);
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    if (bytes.length > 25 * 1024 * 1024) throw new java.io.IOException("Attachment exceeds 25MB");
                    try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                    String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                    runOnUiThread(() -> openAttachmentFile(file, type, saveOnly));
                } catch (Exception e) { attachmentNotice("添付を渡せませんでした: " + safeMessage(e)); }
            });
        }

        @JavascriptInterface
        public void authorize(String scopeText, String requestId) {
            runOnUiThread(() -> startGoogleAuthorization(scopeText, requestId, true));
        }

        @JavascriptInterface
        public void authorizeSilently(String scopeText, String requestId) {
            runOnUiThread(() -> startGoogleAuthorization(scopeText, requestId, false));
        }

        @JavascriptInterface
        public boolean isForeground() {
            return foreground;
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }
    }

    private void attachmentNotice(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private void openAttachmentFile(File file, String mime, boolean saveOnly) {
        if (isFinishing() || isDestroyed()) return;
        if (!saveOnly) {
            Uri uri = new Uri.Builder().scheme("content").authority(getPackageName() + ".attachments")
                    .appendPath(file.getParentFile().getName()).appendPath(file.getName()).build();
            Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            open.setClipData(ClipData.newRawUri(file.getName(), uri));
            try { startActivity(open); return; }
            catch (ActivityNotFoundException e) { attachmentNotice("対応アプリがありません。元の名前で保存できます。"); }
        }
        if (pendingSave != null) { attachmentNotice("先に保存画面を閉じてください。"); return; }
        pendingSave = file;
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime).putExtra(Intent.EXTRA_TITLE, file.getName());
        try { startActivityForResult(save, REQ_SAVE_ATTACHMENT); }
        catch (ActivityNotFoundException e) { pendingSave = null; attachmentNotice("保存アプリを開けません。"); }
    }

    private void startGoogleAuthorization(String scopeText, String requestId, boolean interactive) {
        if (!interactive && !foreground) {
            rejectAuth(requestId, "自動同期を一時停止しました");
            return;
        }
        if (pendingAuthId != null) {
            rejectAuth(requestId, "Google認証を処理中です");
            return;
        }
        pendingAuthId = requestId;
        pendingAuthInteractive = interactive;

        List<Scope> scopes = new ArrayList<>();
        if (scopeText != null) {
            for (String raw : scopeText.trim().split("[\\s,]+")) {
                if (!raw.isEmpty()) scopes.add(new Scope(raw));
            }
        }
        if (scopes.isEmpty()) {
            rejectAuth(requestId, "Gmail権限が指定されていません");
            pendingAuthId = null;
            return;
        }

        AuthorizationRequest request = AuthorizationRequest.builder()
                .setRequestedScopes(scopes)
                .build();

        authorizationClient.authorize(request)
                .addOnSuccessListener(this::handleAuthorizationResult)
                .addOnFailureListener(e -> {
                    String id = pendingAuthId;
                    pendingAuthId = null;
                    rejectAuth(id, "Google認証エラー: " + describeError(e));
                });
    }

    private void handleAuthorizationResult(AuthorizationResult result) {
        if (result.hasResolution()) {
            if (!pendingAuthInteractive) {
                String id = pendingAuthId;
                pendingAuthId = null;
                rejectAuth(id, "同期ボタンからGmailに再接続してください");
                return;
            }
            PendingIntent p = result.getPendingIntent();
            if (p == null) {
                String id = pendingAuthId;
                pendingAuthId = null;
                rejectAuth(id, "Google認証画面を開けませんでした");
                return;
            }
            try {
                startIntentSenderForResult(
                        p.getIntentSender(), REQ_AUTH, null, 0, 0, 0);
            } catch (IntentSender.SendIntentException e) {
                String id = pendingAuthId;
                pendingAuthId = null;
                rejectAuth(id, "Google認証画面を開始できませんでした");
            }
            return;
        }
        deliverToken(result);
    }

    private void deliverToken(AuthorizationResult result) {
        String id = pendingAuthId;
        pendingAuthId = null;
        String accessToken = result.getAccessToken();
        if (accessToken == null || accessToken.isEmpty()) {
            rejectAuth(id, "Googleのアクセストークンを取得できませんでした");
            return;
        }
        long expiresAt = System.currentTimeMillis() + 50L * 60L * 1000L;
        String js = "window.__mailTalkNativeAuthResolve(" +
                JSONObject.quote(id == null ? "" : id) + "," +
                JSONObject.quote(accessToken) + "," + expiresAt + ")";
        webView.evaluateJavascript(js, null);
    }

    private void rejectAuth(String id, String message) {
        if (webView == null) return;
        String js = "window.__mailTalkNativeAuthReject(" +
                JSONObject.quote(id == null ? "" : id) + "," +
                JSONObject.quote(message == null ? "認証に失敗しました" : message) + ")";
        webView.evaluateJavascript(js, null);
    }

    private String safeMessage(Exception e) {
        String m = e.getMessage();
        return (m == null || m.trim().isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    private String describeError(Exception e) {
        if (e instanceof ApiException) {
            ApiException a = (ApiException)e;
            String msg = a.getStatusMessage();
            if (msg == null || msg.trim().isEmpty()) msg = safeMessage(a);
            return "code=" + a.getStatusCode() + " / " + msg;
        }
        return e.getClass().getSimpleName() + " / " + safeMessage(e);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SAVE_ATTACHMENT) {
            File file = pendingSave;
            pendingSave = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && file != null) {
                Uri destination = data.getData();
                attachmentWorker.execute(() -> {
                    try (FileInputStream input = new FileInputStream(file);
                         OutputStream output = getContentResolver().openOutputStream(destination)) {
                        if (output == null) throw new java.io.IOException("Cannot open destination");
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        attachmentNotice("保存しました: " + file.getName());
                    } catch (Exception e) { attachmentNotice("保存できません: " + safeMessage(e)); }
                });
            }
            return;
        }

        if (requestCode == REQ_AUTH) {
            String id = pendingAuthId;
            if (data != null) {
                try {
                    AuthorizationResult result =
                            authorizationClient.getAuthorizationResultFromIntent(data);
                    deliverToken(result);
                    return;
                } catch (ApiException e) {
                    pendingAuthId = null;
                    rejectAuth(id,
                            "Google認証失敗: result=" + resultCode +
                            " / code=" + e.getStatusCode() +
                            " / " + (e.getStatusMessage() == null ? safeMessage(e) : e.getStatusMessage()));
                    return;
                }
            }
            pendingAuthId = null;
            rejectAuth(id,
                    "Google認証失敗: result=" + resultCode +
                    " / data=null。Android OAuth登録またはGoogle Play開発者サービスを確認してください。");
            return;
        }

        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileCallback.onReceiveValue(uris);
                fileCallback = null;
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        if (webView != null) webView.evaluateJavascript(
                "window.__mailTalkOnResume && window.__mailTalkOnResume()", null);
    }

    @Override
    protected void onPause() {
        foreground = false;
        if (webView != null) webView.evaluateJavascript(
                "window.__mailTalkOnPause && window.__mailTalkOnPause()", null);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        handleAndroidBack();
    }

    private void handleAndroidBack() {
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        if (backPending) return;
        backPending = true;
        webView.evaluateJavascript(
                "(window.__mailTalkHandleAndroidBack ? window.__mailTalkHandleAndroidBack() : false)",
                value -> {
                    backPending = false;
                    if (!"true".equals(value)) {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onDestroy() {
        attachmentWorker.shutdown();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (webView != null) {
            webView.removeJavascriptInterface("MailTalkAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
