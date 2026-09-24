# 変更を加えるとき

Node.js 20以降を使います。依存パッケージのインストールは不要です。

1. `src/` や対象のHTML/CSSを編集します。
2. JavaScriptの機能ソースを変えた場合は `npm run build` で `extension/content.js` を更新します。
3. `npm run check` を実行します。
4. 表示を変えた場合は、Edge / Chromeのテスト用環境で実際の表示も確認します。

生成済みの `extension/content.js` もリポジトリに含めます。辞書の再生成方法と第三者ライセンスは [vendor/README.md](../extension/vendor/README.md) を参照してください。

不具合報告には拡張機能とブラウザーのバージョン、再現手順、期待した動作と実際の動作を書いてください。バックアップ全文や認証トークンは添付しないでください。
