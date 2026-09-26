const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid version');
// Validate before touching the existing distribution, including direct script invocation.
const { spawnSync } = require('node:child_process');
for (const args of [[path.join(root, 'scripts/build.cjs'), '--check'], ['--test']]) {
  const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const dist = path.join(root, 'dist');
const target = path.resolve(dist, 'ytm-lyrics-sync-v' + version.replaceAll('.', '_') + '-beta10');
if (path.dirname(target) !== dist) throw Error('Unsafe output path');
// Reject symlinks before clearing only this version's generated package.
if (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink()) throw Error('dist must not be a symlink');
if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('Package must not be a symlink');
fs.rmSync(target, {recursive: true, force: true});
fs.cpSync(path.join(root, 'extension'), target, {recursive: true});
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'));
fs.copyFileSync(path.join(root, 'docs/PRIVACY.md'), path.join(target, 'PRIVACY.md'));
fs.writeFileSync(path.join(target, 'README.md'), '# YT Music 歌詞シンクロ ベータ版 v' + version + '-beta.10' + '\n\nChrome/Edgeの拡張機能管理画面で開発者モードをONにし、このmanifest.jsonのあるフォルダーを読み込んでください。更新時は拡張機能を削除せず、既存フォルダーに上書きして再読み込みしてください。\n\n配布前に開発用リポジトリで生成物の一致確認と自動テストを実行しています。このZIPは配布用のためテストを含みません。\n\n使い方・変更履歴: https://github.com/taruYDK/ytm-lyrics-sync\n');
fs.copyFileSync(path.join(root, 'docs/MUSIC-GLASS-BETA.md'), path.join(target, 'BETA.md'));
console.log('Package ready: ' + target);
