import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../extension/',import.meta.url);
test('extension layout contains manifest resources and local page/script dependencies',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));
 const files=[...Object.values(m.icons),m.action.default_popup,m.background.service_worker,...m.content_scripts.flatMap(c=>[...(c.js||[]),...(c.css||[])]),...m.web_accessible_resources.flatMap(r=>r.resources)];
 for(const name of fs.readdirSync(root)){
  if(!/\.(html|js)$/.test(name))continue;
  const text=fs.readFileSync(new URL(name,root),'utf8');
  for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']|(?:importScripts|new Worker|chrome\.runtime\.getURL)\(["']([^"']+)["']/g)){
   const file=match[1]||match[2];if(!/^(?:https?:|#|data:)/.test(file)&&!file.includes('${'))files.push(file);
  }
 }
 for(const file of files)assert.ok(fs.existsSync(new URL(file,root)),file);
 assert.equal(m.version,JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
});
