// Retired contact capture endpoint. Visitors now contact Ivonne via mailto.
// Keep this route inactive so old clients cannot continue writing personal data.
export default function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  return res.status(410).json({error:'Contact forms have been retired. Please email hello@ivonnealdaz.com.'})
}
