const assetCache=new Map();
window.dshResolveAssetURL=async function(path){
 if(!/^\/api\/assets\/[0-9a-f]{64}$/.test(path))throw Error('Invalid asset URL');
 let entry=assetCache.get(path);
 if(!entry){entry={refs:0,url:null};entry.promise=(async()=>{const r=await fetch(path);if(!r.ok)throw Error('Asset unavailable');const j=await r.json();const bytes=Uint8Array.from(atob(j.dataBase64),c=>c.charCodeAt(0));entry.url=URL.createObjectURL(new Blob([bytes],{type:j.asset.mime}));return entry.url})();assetCache.set(path,entry)}
 entry.refs++;try{return await entry.promise}catch(error){entry.refs--;if(!entry.refs)assetCache.delete(path);throw error}
};
window.dshReleaseAssetURL=function(path,url){const entry=assetCache.get(path);if(!entry||entry.url!==url)return;entry.refs=Math.max(0,entry.refs-1);if(!entry.refs){URL.revokeObjectURL(url);assetCache.delete(path)}};
window.addEventListener('pagehide',()=>{for(const entry of assetCache.values())entry.promise.then(u=>URL.revokeObjectURL(u)).catch(()=>{});assetCache.clear()});

