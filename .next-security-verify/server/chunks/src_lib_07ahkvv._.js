module.exports=[17403,e=>{"use strict";var t=e.i(51631);let i={register:{max:5,windowMs:9e5},verifyCode:{max:10,windowMs:9e5},verifyRequest:{max:5,windowMs:9e5},forgotPassword:{max:5,windowMs:9e5},resetPassword:{max:10,windowMs:9e5}},r=new Map,o=null;e.s(["checkRateLimit",0,function(e,n){!o&&(o=setInterval(()=>{let e=Date.now();for(let[t,o]of r){let n=i[t.split(":")[0]];n&&e-o.windowStart>n.windowMs&&r.delete(t)}},6e5)).unref&&o.unref();let s=i[e];if(!s)return{allowed:!0,retryAfterSec:0};let a=`${e}:${n}`,d=Date.now(),l=r.get(a);if((!l||d-l.windowStart>s.windowMs)&&(l={count:0,windowStart:d}),l.count++,r.set(a,l),l.count>s.max){let i=Math.ceil((l.windowStart+s.windowMs-d)/1e3);return t.logger.warn(`[rate-limit] ${e} blocked for IP ${n} (${l.count}/${s.max} in window)`),{allowed:!1,retryAfterSec:i}}return{allowed:!0,retryAfterSec:0}},"getClientIp",0,function(e){let t=e.headers.get("x-forwarded-for");return t?.split(",")[0]?.trim()||e.headers.get("x-real-ip")||"unknown"}])},98194,e=>{"use strict";var t=e.i(46245),i=e.i(51631);let r=()=>(process.env.RESEND_API_KEY||i.logger.warn("[Resend] RESEND_API_KEY environment variable is not defined."),new t.Resend(process.env.RESEND_API_KEY)),o=()=>{let e=process.env.RESEND_FROM_EMAIL||"onboarding@resend.dev";return e.includes("@resend.dev")?e:`SSH Monitor <${e}>`};async function n({to:e,code:t}){let i=r(),s=o(),a=`
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background-color: #0b0f19; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1, #06b6d4); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; text-align: center;">
          <span style="font-size: 32px; vertical-align: middle; line-height: 1;">✉️</span>
        </div>
        <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 0 0 8px;">Confirm Your Email</h1>
        <p style="color: #94a3b8; font-size: 14px; margin: 0;">SSH Monitor Security</p>
      </div>
      <div style="background: #1e293b; border-radius: 16px; padding: 32px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 16px;">Your email verification code is:</p>
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin: 0 0 16px; border: 1px solid #334155;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">${t}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          This code will expire in <strong style="color: #f59e0b;">15 minutes</strong>. If you did not create an account, please ignore this email.
        </p>
      </div>
    </div>
  `;return await i.emails.send({from:s,to:e,subject:"✉️ Confirm Your Email Address — SSH Monitor",html:a})}async function s({to:e,code:t}){let i=r(),n=o(),a=`
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background-color: #0b0f19; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f43f5e, #8b5cf6); border-radius: 16px; margin: 0 auto 16px; line-height: 64px; text-align: center;">
          <span style="font-size: 32px; vertical-align: middle; line-height: 1;">🔑</span>
        </div>
        <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 0 0 8px;">Reset Password</h1>
        <p style="color: #94a3b8; font-size: 14px; margin: 0;">SSH Monitor Account Recovery</p>
      </div>
      <div style="background: #1e293b; border-radius: 16px; padding: 32px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 16px;">You requested to reset your password. Use code:</p>
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin: 0 0 16px; border: 1px solid #334155;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #f43f5e; font-family: monospace;">${t}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          This code expires in <strong style="color: #f59e0b;">15 minutes</strong>. If you did not request a password reset, your account is safe.
        </p>
      </div>
    </div>
  `;return await i.emails.send({from:n,to:e,subject:"🔑 Password Reset Code — SSH Monitor",html:a})}e.s(["sendPasswordResetEmail",0,s,"sendVerificationEmail",0,n])}];

//# sourceMappingURL=src_lib_07ahkvv._.js.map