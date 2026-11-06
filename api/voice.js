// Server-side ElevenLabs speech proxy. Voice identity and API key are never supplied by the client.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'aoA9zgP0GNrBJSEEchPq';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ELEVENLABS_API_KEY) return res.status(503).json({error:'Cloned voice is not configured yet'});
  const contentLength=Number(req.headers['content-length']||0);
  if(contentLength>7000) return res.status(413).json({error:'Request too large'});
  const text=req.body?.text;
  if(typeof text!=='string'||!text.trim()||text.length>3000) return res.status(400).json({error:'Text must be 1–3000 characters'});
  // Preserve original name in visible answers; apply an audio-only phonetic hint.
  const spoken=text.replace(/\*\*/g,'').replace(/\bIvonne\b/gi,'Eve-on').replace(/\s+/g,' ').trim();
  try{
    const upstream=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(VOICE_ID)+'?output_format=mp3_44100_128',{
      method:'POST',
      headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({text:spoken,model_id:'eleven_flash_v2_5',voice_settings:{stability:0.55,similarity_boost:0.82}})
    });
    if(!upstream.ok){console.error('ElevenLabs TTS failed:',upstream.status);return res.status(502).json({error:'Voice generation unavailable'})}
    const audio=Buffer.from(await upstream.arrayBuffer());
    if(audio.length>6000000)return res.status(502).json({error:'Audio response too large'});
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Content-Length',String(audio.length));
    return res.status(200).send(audio);
  }catch(err){console.error('TTS proxy failed:',err.message);return res.status(502).json({error:'Voice generation unavailable'})}
}
// Before public launch: enforce durable server-side IP/account rate limits and abuse quotas.
// Client-provided text alone is not an authorization mechanism for paid voice synthesis.
