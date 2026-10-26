'use strict';
/*
 * RAWAA 1.17 same-origin gateway.
 * Auth and Data API are managed by Neon. This gateway keeps auth cookies
 * first-party on iOS Safari and never holds Postgres credentials.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');
const root=__dirname;
const authBase=process.env.NEON_AUTH_BASE_URL;
const dataBase=process.env.NEON_DATA_API_URL;
const port=Number(process.env.PORT||3000);
const allowed=new Set(['index.html','work.html','cloud.html','staff.js','staff.css','daily-batch.js','weekly-report.js','service-worker.js','work-vault.js','cloud-workspace.js','manifest.webmanifest','icon.svg','favicon.ico']);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
const buckets=new Map();
function rateLimited(req){
  const address=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const key=String(address).slice(0,100),now=Date.now(),b=buckets.get(key);
  if(!b||now-b.time>60_000){buckets.set(key,{time:now,count:1});return false;}
  return ++b.count>150;
}
function securityHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains');
}
function respond(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:body}));}
async function proxy(req,res,base,endpoint,kind){
  if(!base){respond(res,503,'الخدمة السحابية غير مُهيَّأة بعد.');return;}
  if(!['GET','POST','PATCH'].includes(req.method)){respond(res,405,'طريقة الطلب غير مدعومة.');return;}
  if(kind==='data'&&!['GET','POST','PATCH'].includes(req.method)){respond(res,405,'غير مسموح.');return;}
  if(kind==='data'&&!endpoint.startsWith('/rawaa_cloud_workspace_v1')){respond(res,403,'المورد غير مسموح.');return;}
  if(kind==='auth'&&!['/sign-up/email','/sign-in/email','/get-session','/sign-out','/forget-password','/reset-password'].some(p=>endpoint.split('?')[0]===p)){respond(res,404,'المسار غير متاح.');return;}
  const upstream=new URL(base.replace(/\/+$/,'')+endpoint);
  if(upstream.protocol!=='https:'){respond(res,503,'اتصال Neon يجب أن يكون مشفرًا.');return;}
  const headers={'Accept':'application/json'};
  if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
  if(kind==='auth'){
    if(req.headers.cookie)headers.Cookie=req.headers.cookie;
    if(req.headers.origin)headers.Origin=req.headers.origin;
    headers['X-Forwarded-Proto']='https';
  }else{
    const bearer=req.headers.authorization||'';
    if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer)){respond(res,401,'يجب تسجيل الدخول أولًا.');return;}
    headers.Authorization=bearer;
    if(req.headers.prefer)headers.Prefer=req.headers.prefer;
  }
  let body;
  if(req.method!=='GET'){
    const chunks=[];let total=0;
    try{for await(const part of req){total+=part.length;if(total>5*1024*1024){respond(res,413,'حجم السجلات تجاوز الحد المسموح.');return;}chunks.push(part);}body=Buffer.concat(chunks);}
    catch{respond(res,400,'تعذر قراءة الطلب.');return;}
  }
  try{
    const result=await fetch(upstream,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});
    res.statusCode=result.status;
    const contentType=result.headers.get('content-type')||'application/json';
    res.setHeader('Content-Type',contentType);
    const token=result.headers.get('set-auth-jwt');if(token)res.setHeader('Set-Auth-Jwt',token);
    if(kind==='auth'){
      const cookies=result.headers.getSetCookie?result.headers.getSetCookie():[];
      if(cookies.length)res.setHeader('Set-Cookie',cookies.map(c=>c.replace(/;\s*Domain=[^;]+/ig,'').replace(/;\s*Path=[^;]*/ig,'; Path=/auth/')));
    }
    // Do not relay arbitrary redirects from auth upstream to unrelated domains.
    if(result.status>=300&&result.status<400){res.statusCode=403;res.end(JSON.stringify({error:'إعادة توجيه غير متوقعة'}));return;}
    const bytes=Buffer.from(await result.arrayBuffer());
    res.end(bytes);
  }catch(error){respond(res,502,'تعذر الاتصال بخادم RAWAA السحابي. حاول مجددًا.');}
}
http.createServer(async(req,res)=>{
  securityHeaders(res);
  if(rateLimited(req)){respond(res,429,'طلبات كثيرة؛ حاول مرة أخرى بعد دقيقة.');return;}
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',cloudConfigured:!!authBase&&!!dataBase}));return;}
  if(url.pathname.startsWith('/auth/')){await proxy(req,res,authBase,url.pathname.slice('/auth'.length)+url.search,'auth');return;}
  if(url.pathname.startsWith('/data/')){await proxy(req,res,dataBase,url.pathname.slice('/data'.length)+url.search,'data');return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){respond(res,405,'غير مسموح.');return;}
  let filename=url.pathname==='/'?'cloud.html':url.pathname.slice(1);
  if(!allowed.has(filename)){respond(res,404,'الملف غير موجود.');return;}
  fs.readFile(path.join(root,filename),(error,data)=>{
    if(error){respond(res,404,'الملف غير موجود.');return;}
    res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');
    res.statusCode=200;res.end(req.method==='HEAD'?undefined:data);
  });
}).listen(port,'0.0.0.0',()=>console.log('RAWAA Cloud listening on port',port));
