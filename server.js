'use strict';
/*
 * RAWAA first-party gateway for iPhone Safari.
 * No Postgres password is stored here. The Neon Data API validates JWTs and RLS.
 * Same-origin session cookies avoid ITP blocking third-party Neon Auth cookies.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');
const root=__dirname;
const AUTH=process.env.NEON_AUTH_BASE_URL||'';
const DATA=process.env.NEON_DATA_API_URL||'';
const PUBLIC_ORIGIN=process.env.RAWAA_PUBLIC_ORIGIN||'';
const port=Number(process.env.PORT||3000);
const files=new Set(['cloud.html','index.html','work.html','cloud-sync.js','staff.js','staff.css','daily-batch.js','weekly-report.js','work-vault.js','service-worker.js','manifest.webmanifest','icon.svg']);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const AUTH_PATHS=new Set(['/get-session','/sign-in/email','/sign-out','/forget-password','/reset-password','/send-verification-email','/verify-email','/email-otp/send-verification-otp','/email-otp/verify-email']);
const OTP_PATHS=new Set(['/email-otp/send-verification-otp','/email-otp/verify-email']);
const getUrl=(x)=>{try{const u=new URL(x);return u.protocol==='https:'?u:null;}catch{return null;}};
function bad(res,status,message){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:message}));}
function secure(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()');}
function cleanCookie(cookie){
  // A third-party cookie becomes a secure, HTTP-only first-party session cookie.
  // Keep the value untouched, but eliminate upstream host/path, SameSite=None,
  // and Partitioned attributes that are harmful for same-origin Safari access.
  const parts=cookie.split(';').map(x=>x.trim()).filter(Boolean);
  const first=parts.shift();
  if(!first||!first.includes('='))return null;
  const attributes=parts.filter(a=>!/^(domain|path|samesite|partitioned)(=|$)/i.test(a));
  if(!attributes.some(a=>/^secure$/i.test(a)))attributes.push('Secure');
  if(!attributes.some(a=>/^httponly$/i.test(a)))attributes.push('HttpOnly');
  attributes.push('Path=/auth','SameSite=Lax');
  return [first,...attributes].join('; ');
}
async function readBody(req){
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>4500000){const error=new Error('too large');error.status=413;throw error;}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function makeHandler(options={}){
  const authBase=getUrl(options.authBase||AUTH);
  const dataBase=getUrl(options.dataBase||DATA);
  const allowedOrigin=options.publicOrigin||PUBLIC_ORIGIN;
  const upstreamFetch=options.fetch||fetch;
  return async(req,res)=>{
    secure(res);
    const requestUrl=new URL(req.url,'https://rawaa.invalid');
    const {pathname,search}=requestUrl;
    if(pathname==='/health'){
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify({status:'ok',firstPartyAuth:!!authBase&&!!dataBase,firstPartySignUpClosed:true}));
      return;
    }
    const auth=pathname.startsWith('/auth/');
    const data=pathname.startsWith('/data/');
    if(auth||data){
      const base=auth?authBase:dataBase;
      if(!base)return bad(res,503,'لم تكتمل تهيئة السحابة الآمنة.');
      if(!['GET','POST','PATCH'].includes(req.method))return bad(res,405,'طريقة الطلب غير مدعومة.');
      const endpoint=pathname.slice(auth?'/auth'.length:'/data'.length);
      if(auth&&endpoint==='/sign-up/email')return bad(res,403,'تم إغلاق إنشاء حسابات جديدة من واجهة RAWAA الآمنة. استخدم حساب المدير الموجود أو استعادة كلمة المرور.');
      if(auth&&!AUTH_PATHS.has(endpoint))return bad(res,404,'مسار الدخول غير متاح.');
      // Verification codes must be tied to a real signed-in Neon user,
      // not merely a client-supplied cookie string or different email.
      if(auth&&OTP_PATHS.has(endpoint)&&!String(req.headers.cookie||'').includes('__Secure-neonauth.session_token='))return bad(res,401,'سجّل الدخول بحساب المدير قبل تأكيد البريد.');
      if(data&&endpoint!=='/rawaa_cloud_workspace_v1')return bad(res,403,'هذا المورد غير متاح.');
      // Cookies are used only for Neon Auth. Neon Data API receives an access
      // token and enforces owner_id=user ID via RLS.
      const headers={Accept:'application/json'};
      if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
      if(auth){
        if(req.headers.cookie)headers.Cookie=req.headers.cookie;
        if(req.headers.origin&&(!allowedOrigin||req.headers.origin===allowedOrigin))headers.Origin=req.headers.origin;
        if(req.headers['user-agent'])headers['User-Agent']=req.headers['user-agent'];
      }else{
        const bearer=req.headers.authorization||'';
        if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return bad(res,401,'يجب تسجيل الدخول.');
        headers.Authorization=bearer;
        if(req.headers.prefer)headers.Prefer=req.headers.prefer;
      }
      let body;
      if(req.method!=='GET')try{body=await readBody(req);}catch(error){return bad(res,error.status||400,'تعذر قراءة الطلب.');}
      if(auth&&OTP_PATHS.has(endpoint)){
        if(req.method!=='POST'||!body)return bad(res,405,'رمز التحقق يتطلب طلب POST.');
        let requested;
        try{requested=JSON.parse(body.toString('utf8'));}
        catch{return bad(res,400,'تعذر قراءة بيانات رمز التحقق.');}
        if(!requested||typeof requested.email!=='string'||requested.email.length>320)
          return bad(res,400,'عنوان البريد غير صالح.');
        if(endpoint==='/email-otp/send-verification-otp'&&requested.type!=='email-verification')
          return bad(res,403,'يمكن طلب رموز تأكيد البريد فقط من داخل حساب RAWAA.');
        let session;
        try{
          const sessionUrl=new URL(authBase.toString().replace(/\/$/,'')+'/get-session');
          const verify=await upstreamFetch(sessionUrl.toString(),{
            method:'GET',headers:{Accept:'application/json',Cookie:String(req.headers.cookie||''),
              'User-Agent':String(req.headers['user-agent']||'RAWAA')},
            redirect:'manual',signal:AbortSignal.timeout(10000)
          });
          if(!verify.ok)return bad(res,401,'انتهت جلسة الدخول. سجّل الدخول مجددًا قبل تأكيد البريد.');
          session=await verify.json();
        }catch{return bad(res,503,'تعذر التحقق من جلسة المدير حاليًا. أعد المحاولة عند استقرار الإنترنت.');}
        const signedInEmail=String(session?.user?.email||'').trim().toLowerCase();
        if(!session?.session||!session?.user?.id||!signedInEmail)
          return bad(res,401,'لا توجد جلسة مدير صالحة لتأكيد البريد.');
        if(requested.email.trim().toLowerCase()!==signedInEmail)
          return bad(res,403,'لا يمكن استخدام جلسة مدير RAWAA لإرسال أو فحص رمز يخص بريدًا آخر.');
      }
      const url=new URL(base.toString().replace(/\/$/,'')+endpoint+search);
      try{
        const response=await upstreamFetch(url.toString(),{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});
        const type=response.headers.get('content-type');
        res.statusCode=response.status;
        if(type)res.setHeader('Content-Type',type);
        const jwt=response.headers.get('set-auth-jwt');
        if(jwt)res.setHeader('Set-Auth-Jwt',jwt);
        if(auth){
          const incoming=response.headers.getSetCookie?response.headers.getSetCookie():[];
          const cookies=incoming.map(cleanCookie).filter(Boolean);
          if(cookies.length)res.setHeader('Set-Cookie',cookies);
        }
        if(response.status>=300&&response.status<400)return bad(res,403,'تعذر إكمال إعادة التوجيه.');
        const bytes=Buffer.from(await response.arrayBuffer());
        res.end(bytes);
      }catch(error){return bad(res,502,'تعذر الوصول إلى خدمة الدخول. أعد المحاولة.');}
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return bad(res,405,'طريقة الطلب غير متاحة.');
    const file=pathname==='/'?'cloud.html':pathname.substring(1);
    if(!files.has(file))return bad(res,404,'الملف غير موجود.');
    fs.readFile(path.join(root,file),(error,content)=>{
      if(error)return bad(res,404,'الملف غير موجود.');
      res.statusCode=200;
      res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
      if(file==='cloud.html'){
        // Static Render version remains untouched; only secure Node service
        // activates first-party URLs for the existing Neon JS client.
        content=Buffer.from(content.toString().replace('<head>','<head><script>window.RAWAA_FIRST_PARTY_AUTH=true;</script>'));
      }
      res.end(req.method==='HEAD'?undefined:content);
    });
  };
}
if(require.main===module){
  if(!getUrl(AUTH)||!getUrl(DATA)){console.error('Neon auth/data URLs must be configured as HTTPS.');process.exit(1);}
  http.createServer(makeHandler()).listen(port,'0.0.0.0',()=>console.log('RAWAA first-party service ready on port',port));
}
module.exports={makeHandler,cleanCookie};
