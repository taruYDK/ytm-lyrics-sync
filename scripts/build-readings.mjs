import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {englishPhonesToKana} from '../src/core/readings.mjs';
const dict=Object.create(null);
for(const line of gunzipSync(fs.readFileSync(new URL('./data/cmudict.dict.gz',import.meta.url))).toString('utf8').split(/\r?\n/)){
 const match=line.match(/^([a-z]+(?:'[a-z]+)*)\s+([^#]+)/);if(!match||dict[match[1]])continue;
 const reading=englishPhonesToKana(match[2]);if(reading)dict[match[1]]=reading;
}
// Familiar Japanese approximations for frequent lyric words and contractions.
Object.assign(dict,{a:'ア',i:'アイ',you:'ユー',your:'ユア',the:'ザ',love:'ラブ',hello:'ハロー',world:'ワールド',beautiful:'ビューティフル',baby:'ベイビー',girl:'ガール',girls:'ガールズ',boy:'ボーイ',boys:'ボーイズ',heart:'ハート',my:'マイ',me:'ミー',we:'ウィー',our:'アワー',are:'アー',is:'イズ',am:'アム',and:'アンド',of:'オブ',to:'トゥー',for:'フォー',with:'ウィズ',this:'ディス',that:'ザット',there:'ゼア',their:'ゼア',they:'ゼイ',it:'イット',its:'イッツ',in:'イン',on:'オン',all:'オール',night:'ナイト',light:'ライト',right:'ライト',dream:'ドリーム',dreams:'ドリームズ',music:'ミュージック',forever:'フォーエバー',together:'トゥゲザー',never:'ネバー',ever:'エバー',every:'エヴリー',everybody:'エヴリバディ',want:'ウォント',wanna:'ワナ',gonna:'ガナ',gotta:'ガタ',yeah:'イェー',oh:'オー',one:'ワン',two:'トゥー',three:'スリー',four:'フォー',five:'ファイブ',seven:'セヴン',heaven:'ヘヴン',would:'ウッド',could:'クッド',should:'シュッド',dance:'ダンス',dancing:'ダンシング',time:'タイム',tonight:'トゥナイト',shine:'シャイン',smile:'スマイル',rain:'レイン',again:'アゲイン',away:'アウェイ',always:'オールウェイズ',feel:'フィール',feeling:'フィーリング',free:'フリー',freedom:'フリーダム',"i'm":'アイム',"you're":'ユア',"we're":'ウィア',"don't":'ドント',"can't":'キャント',"won't":'ウォント',"it's":'イッツ',"i'll":'アイル',"i've":'アイヴ',"let's":'レッツ'});
fs.writeFileSync(new URL('../extension/vendor/readings/english.json',import.meta.url),JSON.stringify(dict));
console.log('English entries:',Object.keys(dict).length);
