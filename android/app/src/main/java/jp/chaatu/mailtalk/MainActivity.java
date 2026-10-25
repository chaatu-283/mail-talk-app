package jp.chaatu.mailtalk;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.IntentSender;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
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

public class MainActivity extends Activity {
    private static final String START_URL = "https://chaatu-283.github.io/mail-talk-app/";
    private static final int REQ_AUTH = 9401;
    private static final int REQ_FILE = 9402;

    private WebView webView;
    private AuthorizationClient authorizationClient;
    private String pendingAuthId;
    private ValueCallback<Uri[]> fileCallback;

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
        setContentView(webView);

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
                if ("chaatu-283.github.io".equalsIgnoreCase(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
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
        public void authorize(String scopeText, String requestId) {
            runOnUiThread(() -> startGoogleAuthorization(scopeText, requestId));
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }
    }

    private void startGoogleAuthorization(String scopeText, String requestId) {
        if (pendingAuthId != null) {
            rejectAuth(requestId, "Google認証を処理中です");
            return;
        }
        pendingAuthId = requestId;

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
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("MailTalkAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
