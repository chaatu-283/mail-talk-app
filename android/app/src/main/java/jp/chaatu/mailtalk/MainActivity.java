package jp.chaatu.mailtalk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

public class MainActivity extends Activity {
    private static final Uri START_URL = Uri.parse("https://chaatu-283.github.io/mail-talk-app/");
    private boolean firstResume = true;
    private boolean browserLaunched = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (firstResume) {
            firstResume = false;
            new Handler(Looper.getMainLooper()).postDelayed(this::openMailTalk, 80);
        } else if (browserLaunched) {
            finish();
        }
    }

    private void openMailTalk() {
        try {
            CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
            builder.setShowTitle(false);
            builder.setUrlBarHidingEnabled(true);
            builder.setToolbarColor(0xFFF21818);
            builder.setNavigationBarColor(0xFF000000);

            CustomTabsIntent customTabs = builder.build();
            String browserPackage = CustomTabsClient.getPackageName(this, null);
            if (browserPackage != null) {
                customTabs.intent.setPackage(browserPackage);
            }
            browserLaunched = true;
            customTabs.launchUrl(this, START_URL);
        } catch (ActivityNotFoundException | SecurityException e) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, START_URL);
            fallback.addCategory(Intent.CATEGORY_BROWSABLE);
            browserLaunched = true;
            startActivity(fallback);
        }
    }
}
