import fs from'node:fs';import vm from'node:vm';import assert from'node:assert/strict';
const source=fs.readFileSync(new URL('./request-bridge.js',import.meta.url),'utf8');
for(const mode of ['web','desktop']){
 const calls=[];const response={ok:true};let parent;
 const transport={fetch(url,options){assert.equal(this,transport);calls.push({url,options});return response}};
 parent={fetch(url,options){assert.equal(this,parent);assert.equal(mode,'web','desktop must not call global fetch');calls.push({url,options});return response},...(mode==='desktop'?{__DSH_TRANSPORT__:transport}:{})};
 const window={parent};vm.runInNewContext(source,{window});
 assert.equal(await window.fetch('/api/documents',{method:'POST',body:JSON.stringify({title:'中文'})}),response);
 assert.equal(calls[0].url,'api/qundao-doc.act');assert.deepEqual(JSON.parse(calls[0].options.body),{path:'/api/documents',method:'POST',body:{title:'中文'}});
 await assert.rejects(window.fetch('https://example.com/'),/Unsupported/);assert.equal(calls.length,1);
}
console.log('Web fallback and desktop carrier routing pass; desktop never uses page global fetch.');
