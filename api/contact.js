// Dedicated email-only contact endpoint. Never logs contact details to Sheets.
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
  const {name,email,message='',companyWebsite=''}=req.body||{}
  if(companyWebsite)return res.status(200).json({ok:true})
  if(typeof name!=='string'||name.trim().length<2||name.length>100||
     typeof email!=='string'||email.length>180||!/^\S+@\S+\.\S+$/.test(email)||
     typeof message!=='string'||message.length>1000) {
    return res.status(400).json({error:'Please enter a valid name, email and optional note'})
  }
  // A verified sender domain and API key are necessary for automatic email delivery.
  // Without them, the UI opens a mailto draft which the visitor must send.
  if(!process.env.RESEND_API_KEY||!process.env.EVE_CONTACT_FROM)
    return res.status(503).json({error:'Direct email delivery is not yet configured'})
  try {
    const result=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:process.env.EVE_CONTACT_FROM,
        to:['hello@ivonnealdaz.com'],
        reply_to:email.trim(),
        subject:'Ask Eve inquiry from '+name.trim(),
        text:'Name: '+name.trim()+'\nEmail: '+email.trim()+'\n\n'+(message.trim()||'(No message)')+'\n\nSubmitted via Ask Eve'
      }),
      signal:AbortSignal.timeout(8000)
    })
    if(!result.ok){const details=await result.json().catch(()=>({}));console.error('Contact email provider rejected request:',result.status,String(details.name||''),String(details.message||'').slice(0,240));return res.status(502).json({error:result.status===403?'Email delivery is not authorized yet. Please email hello@ivonnealdaz.com directly.':'Unable to send your email right now. Please email hello@ivonnealdaz.com directly.'})}
    return res.status(200).json({ok:true})
  }catch(e){console.error('Contact email error:',e.message);return res.status(502).json({error:'Unable to send your email right now. Please email Ivonne directly.'})}
}
