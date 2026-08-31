# GitHub 公開手順

## 初回公開

1. GitHubで新しい空のリポジトリを作成します。推奨名は `ytm-lyrics-sync` です。
2. このフォルダでGitの名前とメールアドレスを設定します。

   ```powershell
   git config user.name "あなたの名前"
   git config user.email "あなたのメールアドレス"
   ```

3. 初回コミットとGitHubへの送信を行います。

   ```powershell
   git add .
   git commit -m "Initial release v1.9.6"
   git remote add origin https://github.com/あなたのユーザー名/ytm-lyrics-sync.git
   git push -u origin main
   ```

## リリースの作成

1. GitHubのリポジトリ画面で「Releases」→「Draft a new release」を開きます。
2. タグを `v1.9.6`、タイトルを `v1.9.6` にします。
3. `release/ytm-lyrics-sync-v1_9_6.zip` を添付します。
4. リリースノートには主な変更点と、古い拡張機能を無効化する案内を記載します。

ZIPはソース管理に含めず、GitHub Releasesの添付ファイルとして配布します。
