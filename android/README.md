# メールトーク Android

Web版 v0.45 を Android の Trusted Web Activity (TWA) でアプリ化するベータ版です。

- アプリ名: メールトーク
- applicationId: jp.chaatu.mailtalk
- Android 8.0 (API 26) 以上
- Web: https://chaatu-283.github.io/mail-talk-app/
- Googleログインとの相性を優先し、埋め込みWebViewではなくTWA/Custom Tabs方式です。
- PDF、写真、JWW/DXF等の添付操作はWeb版をそのまま利用します。
- 縦横回転は固定せず、図面確認時の横向きにも対応します。

## デザイン
赤を主アクセントにした「メール＋会話吹き出し」アイコンと起動画面です。
Web側のLINE風/Gmail風/かわいい系/ダークテーマはそのまま利用できます。

## GitHub Actions
Actions の **Build Android APK** を実行すると MailTalk-debug-apk が生成されます。

完全なTWA表示には Digital Asset Links が必要です。
GitHub Pages がプロジェクトサイトのため、assetlinks.json は
https://chaatu-283.github.io/.well-known/assetlinks.json
に置く必要があります。
