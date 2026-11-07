export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const {name,email,message='',companyWebsite=''}=req.body||{};
  if(companyWebsite)return res.status(200).json({ok:true});
  if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>180||typeof message!=='string'||message.length>1000)return res.status(400).json({error:'Please enter a valid name, email and optional note'});
  if(!process.env.EVE_LOG_WEBHOOK_URL)return res.status(503).json({error:'Contact form not configured'});
  try{
    const response=await fetch(process.env.EVE_LOG_WEBHOOK_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain'},body:JSON.stringify({timestamp:new Date().toISOString(),question:'Contact: '+name.trim()+' <'+email.trim()+'>',response:message.trim()||'(No note)',topic:'Contact',leadScore:5})});
    if(!response.ok)throw Error('Webhook returned '+response.status);
    return res.status(200).json({ok:true});
  }catch(e){console.error('Contact logging error',e.message);return res.status(502).json({error:'Unable to save the message. Please email Ivonne directly.'})}
}
// Protect this route with durable rate limiting before public launch.
