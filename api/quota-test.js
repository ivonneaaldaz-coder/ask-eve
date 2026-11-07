// Preview-only verification of the same atomic Redis quota function as Ask Eve.
// Uses a separate keyspace and a two-request limit. No AI, voice or logging calls.
const {checkDailyQuota,quotaError}=require('./quota')
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store')
  if(process.env.VERCEL_ENV!=='preview')return res.status(404).json({error:'Not found'})
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
  try{
    const result=await checkDailyQuota(req,res,'chat',{
      namespace:'ask-eve:qa:isolated:v1',
      limits:{visitor:2,ip:500,global:5000}
    })
    if(!result.allowed)return quotaError(res,result.reason)
    return res.status(200).json({ok:true,message:'Quota accepted this test request. This does not contact Claude or ElevenLabs.'})
  }catch(err){
    console.error('Isolated Redis quota QA failed:',err.message)
    return res.status(503).json({error:'Quota test unavailable.'})
  }
}
