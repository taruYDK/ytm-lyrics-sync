# 同梱辞書・ライブラリー

- kuromoji.js 0.1.2: https://github.com/takuyaa/kuromoji.js （Apache-2.0）。LICENSE-2.0.txtとNOTICE.mdに日本語辞書IPADICのライセンスも収録。
- 公式npmのブラウザー用ビルドとdictを同梱。変更点：辞書URLの結合4か所をpath.joinからURLの単純結合へ変更し、chrome-extension://の二重スラッシュが消えないようにした。JSコードの動的取得は行わない。
- ブラウザービルド内のasync、doublearray、zlibjsのライセンスもkuromojiフォルダーに同梱。Node由来のshimの著作権表示はJS内に保持。
- CMUdict: https://github.com/cmusphinx/cmudict （再配布条件はreadings/LICENSE.txt）。取得日2026-09-21。原文SHA-256: 81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22。
- readings/cmudict.dict.gzが原文。english.jsonは発音記号から本拡張独自の近似カタカナへ変換し、頻出語の読みを補正した派生データ。複数発音がある語は代表の1つを使用。未知語は表示しない。
- 英語辞書再生成：node scripts/build-readings.mjs。変換処理はsrc/core/readings.mjs。

辞書とコードは拡張フォルダー内からのみ読み込み、歌詞本文を送信しない。
