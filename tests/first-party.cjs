/* node tests/first-party.cjs — first-party gateway regression, no real credentials */
'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {makeHandler,cleanCookie}=require('../server');
(async()=>{
 const requests=[];
 const fakeFetch=async(url,options)=>{
   requests.push({url,method:options.method,cookie:options.headers.Cookie,authorization:options.headers.Authorization,origin:options.headers.Origin});
   if(url.endsWith('/sign-in/email')){
     return new Response(JSON.stringify({user:{id:'test-user'},session:{id:'test-session'}}),{
       status:200,headers:{
         'Content-Type':'application/json',
         'Set-Cookie':'__Secure-neonauth.session_token=local-test-session; Domain=auth.example; Path=/neondb/auth; Secure; HttpOnly; SameSite=None; Partitioned'
       }
     });
   }
   if(url.endsWith('/get-session')){
     const good=options.headers.Cookie?.includes('local-test-session');
     return new Response(JSON.stringify({user:good?{id:'test-user'}:null,session:good?{id:'test-session',access_token:'placeholder-only'}:null}),
       {status:200,headers:{'Content-Type':'application/json','Set-Auth-Jwt':'test-jwt-not-a-real-credential'}});
   }
   return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
 };
 const server=http.createServer(makeHandler({authBase:'https://auth.example/neondb/auth',dataBase:'https://data.example/neondb/rest/v1',publicOrigin:'http://127.0.0.1',fetch:fakeFetch}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 try{
   assert.match(cleanCookie('__Secure-neonauth.session_token=abc; Domain=neon.example; Path=/neondb/auth; Secure; HttpOnly; SameSite=None'),/Path=\/auth; SameSite=Lax/);
   assert.ok(!cleanCookie('token=abc; Domain=neon.example; SameSite=None').includes('Domain='));
   const signin=await fetch(base+'/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1'},body:JSON.stringify({email:'test@example.com',password:'not-real'})});
   assert.equal(signin.status,200);
   const cookies=signin.headers.get('set-cookie');
   assert.ok(cookies.includes('SameSite=Lax'));
   assert.ok(cookies.includes('Path=/auth'));
   assert.ok(!cookies.includes('Domain=auth.example'));
   const session=await fetch(base+'/auth/get-session',{headers:{Cookie:cookies.split(';')[0]}});
   const data=await session.json();
   assert.equal(data.user.id,'test-user');
   assert.equal(data.session.id,'test-session');
   assert.equal(session.headers.get('set-auth-jwt'),'test-jwt-not-a-real-credential');
   assert.equal(requests[0].url,'https://auth.example/neondb/auth/sign-in/email');
   assert.equal(requests[1].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[1].cookie,cookies.split(';')[0]);
   const unauthorized=await fetch(base+'/data/rawaa_cloud_workspace_v1');
   assert.equal(unauthorized.status,401);
   const forbidden=await fetch(base+'/data/neon_auth.user',{headers:{authorization:'Bearer '+'x'.repeat(40)}});
   assert.equal(forbidden.status,403);
   const jwt='sample.abcdef.signature-'+ 'x'.repeat(35);
   const authorized=await fetch(base+'/data/rawaa_cloud_workspace_v1?select=revision',{headers:{authorization:'Bearer '+jwt}});
   assert.equal(authorized.status,200);
   assert.equal(requests[2].url,'https://data.example/neondb/rest/v1/rawaa_cloud_workspace_v1?select=revision');
   assert.equal(requests[2].authorization,'Bearer '+jwt);
   const html=await fetch(base+'/cloud.html');assert.equal(html.status,200);
   assert.ok((await html.text()).includes('window.RAWAA_FIRST_PARTY_AUTH=true'));
   const health=await fetch(base+'/health');assert.equal((await health.json()).firstPartyAuth,true);
   console.log('PASS: first-party secure cookie rewrite, Safari auth session reuse, JWT/RLS proxy, route allowlist, cloud boot flag');
 }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});