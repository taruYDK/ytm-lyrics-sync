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
2. タグとタイトルを新しいバージョン（例: `v1.9.7`）にします。
3. 対応するZIP（例: `release/ytm-lyrics-sync-v1_9_7.zip`）を添付します。
4. リリースノートには主な変更点と、拡張機能を削除せず同じフォルダへ上書きして再読み込みする案内を記載します。

`manifest.json` の `key` はv1.9.7以降で変更しないでください。変更すると拡張機能IDが変わり、保存領域が別になります。

ZIPはソース管理に含めず、GitHub Releasesの添付ファイルとして配布します。
