export function kanaToRomaji(value) {
 const hira=String(value||'').normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96));
 const rows=['あいうえお','かきくけこ','さしすせそ','たちつてと','なにぬねの','はひふへほ','まみむめも','やゆよ','らりるれろ','わを','がぎぐげご','ざじずぜぞ','だぢづでど','ばびぶべぼ','ぱぴぷぺぽ'];
 const sounds=['a i u e o','ka ki ku ke ko','sa shi su se so','ta chi tsu te to','na ni nu ne no','ha hi fu he ho','ma mi mu me mo','ya yu yo','ra ri ru re ro','wa o','ga gi gu ge go','za ji zu ze zo','da ji zu de do','ba bi bu be bo','pa pi pu pe po'];
 const map={'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゔ':'vu'};
 rows.forEach((r,i)=>[...r].forEach((c,j)=>map[c]=sounds[i].split(' ')[j]));
 const digraph={};
 for(const [c,stem] of Object.entries({'き':'ky','し':'sh','ち':'ch','に':'ny','ひ':'hy','み':'my','り':'ry','ぎ':'gy','じ':'j','び':'by','ぴ':'py'})) for(const [small,v] of [['ゃ','a'],['ゅ','u'],['ょ','o']]) digraph[c+small]=stem+v;
 Object.assign(digraph,{'ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','てぃ':'ti','でぃ':'di','うぃ':'wi','うぇ':'we','うぉ':'wo','ゔぁ':'va','ゔぃ':'vi','ゔぇ':'ve','ゔぉ':'vo'});
 let out='',geminate=false;
 for(let i=0;i<hira.length;i++) {
  const c=hira[i];if(c==='っ'){geminate=true;continue;}
  if(c==='ー'){out+=(out.match(/[aeiou](?=[^aeiou]*$)/)||[''])[0];continue;}
  if(c==='ん'){const next=digraph[hira.slice(i+1,i+3)]||map[hira[i+1]]||'';out+=/^[aeiouy]/.test(next)?"n'":'n';continue;}
  let part=digraph[hira.slice(i,i+2)];if(part)i++;else part=map[c]||c;
  if(geminate){if(/^[a-z]/.test(part)&&!/^[aeiou]/.test(part))out+=part.startsWith('ch')?'t':part[0];geminate=false;}
  out+=part;
 }
 return out;
}

export function readingTokensToRomaji(tokens) {
 return tokens.map(token=>kanaToRomaji(token.pronunciation||token.reading||token.surface_form))
  .join(' ').replace(/\s+/g,' ').replace(/\s*、\s*/g,', ').replace(/\s*。\s*/g,'. ').trim();
}
