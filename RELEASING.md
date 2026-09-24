# GitHubでの公開

このリポジトリは https://github.com/taruYDK/ytm-lyrics-sync を送信先に設定しています。

## ソースの更新

変更後は `npm run build` と `npm run check` を実行し、生成済みの `content.js` も含めてコミットしてください。GitHub Desktopでこのリポジトリを選び、「Push origin」でコミットを送信します。

## リリースZIP

リリースZIPはソースのコミットに含めません。利用者がGitHub Releasesへ別途添付します。バージョンは `manifest.json` と `package.json` に合わせてください（現在は `2.6.0`）。

`manifest.json` の `key` は拡張機能IDと保存領域を維持するため変更しないでください。本体のMITライセンスと `vendor/` 内の第三者ライセンスを維持してください。

