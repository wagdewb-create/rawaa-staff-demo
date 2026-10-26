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
     return new Response(JSON.stringify({user:good?{id:'test-user',email:'test@example.com'}:null,session:good?{id:'test-session',access_token:'placeholder-only'}:null}),
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
   const signup=await fetch(base+'/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Bad',email:'unexpected@example.com',password:'password'})});
   assert.equal(signup.status,403,'new signup blocked at first-party gateway, even with a valid request');
   assert.equal(requests.length,2,'blocked signup never reaches Neon');
   const otpBlocked=await fetch(base+'/auth/email-otp/send-verification-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',type:'email-verification'})});
   assert.equal(otpBlocked.status,401,'anonymous users must not send verification email');
   const forged=await fetch(base+'/auth/email-otp/send-verification-otp',{
     method:'POST',headers:{'Content-Type':'application/json',Cookie:'__Secure-neonauth.session_token=forged-cookie'},
     body:JSON.stringify({email:'test@example.com',type:'email-verification'})
   });
   assert.equal(forged.status,401,'cookie presence is not proof of an authenticated session');
   const mismatch=await fetch(base+'/auth/email-otp/send-verification-otp',{
     method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies.split(';')[0]},
     body:JSON.stringify({email:'another@example.com',type:'email-verification'})
   });
   assert.equal(mismatch.status,403,'OTP cannot be requested for a different manager email');
   const loginOtp=await fetch(base+'/auth/email-otp/send-verification-otp',{
     method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies.split(';')[0]},
     body:JSON.stringify({email:'test@example.com',type:'sign-in'})
   });
   assert.equal(loginOtp.status,403,'do not expose sign-in OTP via the verification-only gateway');
   const otpRequest=await fetch(base+'/auth/email-otp/send-verification-otp',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies.split(';')[0]},body:JSON.stringify({email:'test@example.com',type:'email-verification'})});
   assert.equal(otpRequest.status,200);
   const verifyRequest=await fetch(base+'/auth/email-otp/verify-email',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookies.split(';')[0]},body:JSON.stringify({email:'test@example.com',otp:'123456'})});
   assert.equal(verifyRequest.status,200);
   assert.equal(requests[2].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[3].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[4].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[5].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[6].url,'https://auth.example/neondb/auth/email-otp/send-verification-otp');
   assert.equal(requests[7].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[8].url,'https://auth.example/neondb/auth/email-otp/verify-email');
   // Safari/Better Auth may use a different cookie name after SDK upgrades.
   // Match the real upstream session, never a string-literal cookie name.
   const alternateCookie='better-auth.session_token=local-test-session';
   const alternate=await fetch(base+'/auth/email-otp/send-verification-otp',{
     method:'POST',headers:{'Content-Type':'application/json',Cookie:alternateCookie},
     body:JSON.stringify({email:'test@example.com',type:'email-verification'})
   });
   assert.equal(alternate.status,200,'valid upstream session works with non-Neon cookie name');
   assert.equal(requests[9].url,'https://auth.example/neondb/auth/get-session');
   assert.equal(requests[9].cookie,alternateCookie);
   assert.equal(requests[10].url,'https://auth.example/neondb/auth/email-otp/send-verification-otp');
   const unauthorized=await fetch(base+'/data/rawaa_cloud_workspace_v1');
   assert.equal(unauthorized.status,401);
   const forbidden=await fetch(base+'/data/neon_auth.user',{headers:{authorization:'Bearer '+'x'.repeat(40)}});
   assert.equal(forbidden.status,403);
   const jwt='sample.abcdef.signature-'+ 'x'.repeat(35);
   const authorized=await fetch(base+'/data/rawaa_cloud_workspace_v1?select=revision',{headers:{authorization:'Bearer '+jwt}});
   assert.equal(authorized.status,200);
   assert.equal(requests[11].url,'https://data.example/neondb/rest/v1/rawaa_cloud_workspace_v1?select=revision');
   assert.equal(requests[11].authorization,'Bearer '+jwt);
   const html=await fetch(base+'/cloud.html');assert.equal(html.status,200);
   assert.ok((await html.text()).includes('window.RAWAA_FIRST_PARTY_AUTH=true'));
   const health=await fetch(base+'/health');const healthInfo=await health.json();
   assert.equal(healthInfo.firstPartyAuth,true);
   assert.equal(healthInfo.firstPartySignUpClosed,true);
   console.log('PASS: first-party cookie rewrite, session-bound OTP, closed public signup, Safari auth reuse, JWT/RLS and route allowlist');
 }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});