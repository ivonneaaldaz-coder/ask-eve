// Atomic daily quotas for paid chat and text-to-speech requests.
// Anonymous signed cookies survive refresh/clear-chat; higher hashed IP and
// global ceilings limit casual cookie-reset abuse without storing raw IPs.
const crypto = require('crypto')
const WINDOW_SECONDS = 86400 // 24 hours from the first counted request
const LIMITS = {
  chat: {visitor:30, ip:240, global:1200},
  voice: {visitor:10, ip:80, global:400}
}
function keySecret() {
  const token=process.env.KV_REST_API_TOKEN
  if(!token || !process.env.KV_REST_API_URL) throw new Error('Usage database is not configured')
  return crypto.createHmac('sha256',token).update('ask-eve/quota-cookie/v1').digest()
}
function sign(value,secret) {
  return crypto.createHmac('sha256',secret).update(value).digest('hex')
}
function visitorId(req,res,secret) {
  const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('eve_visitor='))?.slice(12)
  if(value){
    const [id,signature]=value.split('.')
    if(id && /^[a-f0-9]{32}$/.test(id) && signature && /^[a-f0-9]{64}$/.test(signature)){
      const expected=sign(id,secret)
      if(crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))return id
    }
  }
  const id=crypto.randomBytes(16).toString('hex')
  res.setHeader('Set-Cookie', 'eve_visitor='+id+'.'+sign(id,secret)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000')
  return id
}
function hashValue(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('hex').slice(0,32)
}
const SCRIPT = [
'local limits={tonumber(ARGV[1]),tonumber(ARGV[2]),tonumber(ARGV[3])}',
'for i=1,3 do if tonumber(redis.call("GET",KEYS[i]) or "0")>=limits[i] then return {i,redis.call("TTL",KEYS[i])} end end',
'for i=1,3 do local v=redis.call("INCR",KEYS[i]); if v==1 then redis.call("EXPIRE",KEYS[i],86400) end end',
'return {0,0}'
].join('\n')
async function checkDailyQuota(req,res,kind){
  const limits=LIMITS[kind]
  if(!limits)throw new Error('Unrecognized quota type')
  const secret=keySecret()
  const visitor=visitorId(req,res,secret)
  // Use only platform-set proxy headers, never a query parameter or browser-provided identity.
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim()
  const ipHash=hashValue(ip,secret)
  // Each counter expires 24 hours after its first increment, not at midnight.
  // v2 isolates rolling counters from the old midnight-reset namespace.
  const prefix='ask-eve:q:rolling24:v2:'+kind+':'
  const keys=[prefix+'visitor:'+visitor,prefix+'network:'+ipHash,prefix+'overall']
  const command=['EVAL',SCRIPT,'3',...keys,String(limits.visitor),String(limits.ip),String(limits.global)]
  let response
  try{
    response=await fetch(process.env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(3500)})
  }catch(err){throw new Error('Usage-counter service unreachable: '+err.message)}
  if(!response.ok)throw new Error('Usage-counter status '+response.status)
  const data=await response.json()
  if(data.error || !Array.isArray(data.result) || !Number.isInteger(data.result[0]))throw new Error('Usage-counter rejected atomic operation')
  const [resultCode,ttlSeconds]=data.result
  return {allowed:resultCode===0, reason:['ok','visitor','network','overall'][resultCode]||'unknown', retryAfter:Number.isInteger(ttlSeconds)?Math.max(0,ttlSeconds):null}
}
function quotaError(res,reason,retryAfter){
  const personal=reason==='visitor'
  if(Number.isInteger(retryAfter)&&retryAfter>0)res.setHeader('Retry-After',String(retryAfter))
  const message=personal
    ? 'You’ve reached your 24-hour allowance. Eve will be ready again after your current window resets. 🌚'
    : 'Eve is taking a short usage break to keep access fair for everyone. Please try again later.'
  return res.status(429).json({error:message,code:personal?'daily_limit':'usage_protection'})
}
module.exports={checkDailyQuota,quotaError}
