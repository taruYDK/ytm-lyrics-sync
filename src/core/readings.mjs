// English readings are Japanese approximations of dictionary phonemes, not IPA.
export function englishPhonesToKana(phonemes) {
  const phones = String(phonemes || '').trim().split(/\s+/).map(p => p.replace(/[012]$/, ''));
  const vowels = {AA:['a',''],AE:['a',''],AH:['a',''],AO:['o',''],AW:['a','ウ'],AY:['a','イ'],EH:['e',''],ER:['a','ー'],EY:['e','イ'],IH:['i',''],IY:['i','ー'],OW:['o','ウ'],OY:['o','イ'],UH:['u',''],UW:['u','ー']};
  const rows = {
    '':['ア','イ','ウ','エ','オ'],B:['バ','ビ','ブ','ベ','ボ'],CH:['チャ','チ','チュ','チェ','チョ'],D:['ダ','ディ','ドゥ','デ','ド'],
    DH:['ザ','ジ','ズ','ゼ','ゾ'],F:['ファ','フィ','フ','フェ','フォ'],G:['ガ','ギ','グ','ゲ','ゴ'],HH:['ハ','ヒ','フ','ヘ','ホ'],
    JH:['ジャ','ジ','ジュ','ジェ','ジョ'],K:['カ','キ','ク','ケ','コ'],L:['ラ','リ','ル','レ','ロ'],M:['マ','ミ','ム','メ','モ'],N:['ナ','ニ','ヌ','ネ','ノ'],
    P:['パ','ピ','プ','ペ','ポ'],R:['ラ','リ','ル','レ','ロ'],S:['サ','スィ','ス','セ','ソ'],SH:['シャ','シ','シュ','シェ','ショ'],
    T:['タ','ティ','トゥ','テ','ト'],TH:['サ','シ','ス','セ','ソ'],V:['ヴァ','ヴィ','ヴ','ヴェ','ヴォ'],W:['ワ','ウィ','ウ','ウェ','ウォ'],
    Y:['ヤ','イ','ユ','イェ','ヨ'],Z:['ザ','ズィ','ズ','ゼ','ゾ'],ZH:['ジャ','ジ','ジュ','ジェ','ジョ']
  };
  const codas = {B:'ブ',CH:'チ',D:'ド',DH:'ズ',F:'フ',G:'グ',HH:'',JH:'ジ',K:'ク',L:'ル',M:'ム',N:'ン',NG:'ング',P:'プ',R:'ー',S:'ス',SH:'シュ',T:'ト',TH:'ス',V:'ヴ',W:'ウ',Y:'イ',Z:'ズ',ZH:'ジュ'};
  let out='';
  for(let i=0;i<phones.length;i++) {
    const phone=phones[i];
    if (phone==='N' && phones[i+1]==='G' && !vowels[phones[i+2]]) {out+='ング';i++;continue;}
    if (rows[phone] && phones[i+1]==='Y' && vowels[phones[i+2]] && ['B','P','M','K','G','N','HH','R','L'].includes(phone)) {
      const [v,tail]=vowels[phones[i+2]];const small={a:'ャ',i:'ィ',u:'ュ',e:'ェ',o:'ョ'};
      out+=rows[phone][1]+small[v]+tail;i+=2;continue;
    }
    if (rows[phone] && vowels[phones[i+1]]) {
      const [v,tail]=vowels[phones[++i]];out+=rows[phone]['aiueo'.indexOf(v)]+tail;continue;
    }
    if (vowels[phone]) {const [v,tail]=vowels[phone];out+=rows['']['aiueo'.indexOf(v)]+tail;}
    else if (Object.prototype.hasOwnProperty.call(codas,phone)) out+=codas[phone];
    else return ''; // Never guess unknown phone codes.
  }
  return out.replace(/ーー+/g,'ー');
}

export function toReadingHiragana(text) {
  return String(text || '').replace(/[ァ-ヶ]/g, char=>String.fromCharCode(char.charCodeAt(0)-0x60));
}

export function japaneseReadingRanges(text, tokens) {
  const ranges=[];let cursor=0;
  for(const token of tokens) {
    const surface=String(token.surface_form || '');
    if(!surface)continue;
    const start=text.indexOf(surface,cursor);if(start<0)continue;cursor=start+surface.length;
    if(!/[\p{Script=Han}々〆ヶ]/u.test(surface) || !token.reading || token.reading==='*')continue;
    let base=surface, reading=toReadingHiragana(token.reading), offset=start;
    // Keep matching kana outside ruby, e.g. 歩く -> 歩(ある)く.
    while(base && reading && /^[ぁ-ゖァ-ヶー]/u.test(base) && toReadingHiragana(base[0])===reading[0]) {base=base.slice(1);reading=reading.slice(1);offset++;}
    while(base && reading && /[ぁ-ゖァ-ヶー]$/u.test(base) && toReadingHiragana(base.at(-1))===reading.at(-1)) {base=base.slice(0,-1);reading=reading.slice(0,-1);}
    if(base && reading)ranges.push({start:offset,end:offset+base.length,reading});
  }
  return ranges;
}

export function englishReadingRanges(text, dictionary) {
  const ranges=[];
  for(const match of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    const key=match[0].toLowerCase().replaceAll('’', "'");
    const reading=Object.prototype.hasOwnProperty.call(dictionary,key) ? dictionary[key] : '';
    if(typeof reading==='string' && reading)ranges.push({start:match.index,end:match.index+match[0].length,reading});
  }
  return ranges;
}

// Project a reading onto a timed fragment without altering the fragment or timing.
export function readingPartsForFragment(text, offset, ranges) {
  const parts=[];let cursor=0;
  for(const range of ranges) {
    const start=Math.max(offset,range.start),end=Math.min(offset+text.length,range.end);
    if(start>=end)continue;
    const localStart=start-offset,localEnd=end-offset;
    if(localStart>cursor)parts.push({text:text.slice(cursor,localStart),reading:''});
    const mora=range.reading.match(/.[ぁぃぅぇぉゃゅょァィゥェォャュョ]?/gu)||[];
    const from=Math.floor((start-range.start)*mora.length/(range.end-range.start));
    const to=Math.floor((end-range.start)*mora.length/(range.end-range.start));
    parts.push({text:text.slice(localStart,localEnd),reading:mora.slice(from,to).join('')});cursor=localEnd;
  }
  if(cursor<text.length)parts.push({text:text.slice(cursor),reading:''});
  return parts;
}
export function mergeManualReadings(text, automatic, entries, ja = true, en = true, lineIndex = undefined, occurrence = undefined) {
  const manual = (Array.isArray(entries) ? entries : []).filter(r => r && r.text === text && (r.occurrence !== undefined ? r.occurrence === occurrence : r.lineIndex === undefined || r.lineIndex === lineIndex) &&
    Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= text.length &&
    typeof r.reading === 'string' && r.reading.length <= 1000 &&
    ((r.start === 0 && r.end === text.length && r.lineIndex !== undefined) ? (ja || en) : /[\p{Script=Han}々〆ヶ]/u.test(text.slice(r.start, r.end)) ? ja : en));
  const selected = [];
  for (const range of manual) {
    for (let i = selected.length - 1; i >= 0; i--) {
      if (selected[i].start < range.end && selected[i].end > range.start) selected.splice(i, 1);
    }
    selected.push(range);
  }
  return [...automatic.filter(a => !selected.some(m => m.start < a.end && m.end > a.start)), ...selected]
    .sort((a, b) => a.start - b.start);
}

// Keep line editing simple, but align its ruby to the written words at display time.
export function layoutManualLineReadings(text, ranges, ja = true, en = true, automatic = []) {
  return ranges.flatMap(range => {
    if (range.lineIndex === undefined || range.start !== 0 || range.end !== text.length || !range.reading) return [range];
    const tokens = Array.from(text.matchAll(/[\p{Script=Han}々〆ヶ]+|[A-Za-z]+(?:['’][A-Za-z]+)*|[^\p{Script=Han}々〆ヶA-Za-z]+/gu), m => ({text:m[0],start:m.index,end:m.index+m[0].length,variable:/[\p{Script=Han}々〆ヶA-Za-z]/u.test(m[0])}));
    const normalized = toReadingHiragana(range.reading);
    const failed = new Set(); let budget = 10000;
    function align(index, offset) {
      if (--budget < 0) return null;
      if (index === tokens.length) return offset === normalized.length ? [] : null;
      const key = index + ':' + offset; if (failed.has(key)) return null;
      const token = tokens[index];
      if (!token.variable) {
        const anchor = toReadingHiragana(token.text);
        if (normalized.startsWith(anchor, offset)) {
          const rest = align(index + 1, offset + anchor.length);
          if (rest) return rest;
        }
      } else {
        // Literal unknown English and dictionary matches provide boundaries before adjacent kanji.
        const known = automatic.find(r => r.start === token.start && r.end === token.end)?.reading;
        const hints = [token.text, known].filter(Boolean);
        for (const hint of hints) {
          if (normalized.startsWith(toReadingHiragana(hint), offset)) {
            const end = offset + hint.length, rest = align(index + 1, end);
            if (rest) return [{start:token.start,end:token.end,reading:range.reading.slice(offset,end)},...rest];
          }
        }
        const last = index === tokens.length - 1;
        for (let end = last ? normalized.length : offset + 1; end <= normalized.length; end++) {
          const rest = align(index + 1, end);
          if (rest) return [{start:token.start,end:token.end,reading:range.reading.slice(offset,end)},...rest];
        }
      }
      failed.add(key); return null;
    }
    const aligned = tokens.length < 150 ? align(0, 0) : null;
    if (aligned) return aligned;
    // Unmatched kana/spacing must not produce one centered ruby across the line.
    // Preserve the complete entered reading, distributing by original character length.
    const mora = range.reading.match(/.[ぁぃぅぇぉゃゅょァィゥェォャュョ]?/gu) || [];
    return Array.from(text).map((char, i, chars) => ({
      start: chars.slice(0,i).join('').length, end: chars.slice(0,i+1).join('').length,
      reading: mora.slice(Math.floor(i*mora.length/chars.length),Math.floor((i+1)*mora.length/chars.length)).join(''),
    }));
  }).map(r => ({...r, reading: r.reading === text.slice(r.start,r.end) ? '' : r.reading}))
    .filter(r => /[\p{Script=Han}々〆ヶぁ-ゖァ-ヶ]/u.test(text.slice(r.start,r.end)) ? ja : en);
}
