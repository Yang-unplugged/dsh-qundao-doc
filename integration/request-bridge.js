// Respect the carrier selected by DSH (desktop may not use the page's HTTP origin).
const hostWindow=window.parent;
const hostTransport=hostWindow.__DSH_TRANSPORT__;
const hostFetch=typeof hostTransport?.fetch==='function'
 ? hostTransport.fetch.bind(hostTransport)
 : hostWindow.fetch.bind(hostWindow);
window.fetch=async(input,options={})=>{
 const path=typeof input==='string'?input:input.url;
 if(!path.startsWith('/api/'))throw new Error('Unsupported local resource');
 const body=options.body?JSON.parse(options.body):undefined;
 return hostFetch('api/qundao-doc.act',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({path,method:options.method||'GET',body})
 });
};
