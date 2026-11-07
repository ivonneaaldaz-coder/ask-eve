const fs = require('fs')
const path = require('path')
const { checkDailyQuota, quotaError } = require('./quota')

const WEBHOOK_URL = process.env.EVE_LOG_WEBHOOK_URL || ''

const RESUME = fs.readFileSync(require.resolve('../resume.md'), 'utf8')
const EVE_CONTEXT = fs.readFileSync(require.resolve('../eve-context.md'), 'utf8')
const VOICE = fs.readFileSync(require.resolve('../voice.md'), 'utf8')

function sanitizeSearchContext(raw) {
  if (!raw || typeof raw !== 'object') return null

  const query = typeof raw.query === 'string' ? raw.query.trim().slice(0, 120) : ''
  if (!query) return null

  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 4).map(item => ({
        title: typeof item?.title === 'string' ? item.title.slice(0, 100) : '',
        subtitle: typeof item?.subtitle === 'string' ? item.subtitle.slice(0, 220) : '',
        source: typeof item?.source === 'string' ? item.source.slice(0, 80) : '',
        type: typeof item?.type === 'string' ? item.type.slice(0, 40) : ''
      })).filter(item => item.title)
    : []

  return { query, items }
}

function buildSystem(searchContext = null) {
  const searchMode = searchContext
    ? `

---

# LAB SEARCH MODE

The visitor arrived here by searching the Lab for: "${searchContext.query}"

Treat this as an orientation request, not as an underspecified one-word chat message.
Do not ask what part they mean unless the term truly has no meaningful connection to Ivonne's work.
Give a concise overview of how the topic connects to Ivonne, then point to **2–3** concrete examples from the PUBLIC LAB MATCHES below when relevant. Keep the prose short because the interface will render the actual links underneath.

The interface will render those matched items as clickable buttons beneath your response.
Mention the exact item titles naturally so the visitor understands why each link is useful.
Do not tell the visitor to "search for" those items.
Do not invent Lab entries or claim that something is linked unless it appears in PUBLIC LAB MATCHES.

PUBLIC LAB MATCHES:
${searchContext.items.length
  ? searchContext.items.map(item => `- ${item.title} [${item.source || item.type || 'Lab'}]: ${item.subtitle || 'Public Lab item'}`).join('\n')
  : '- No direct public Lab matches were supplied. Give a concise orientation from the approved sources.'}
`
    : ''

  return `You are Eve, an AI portfolio assistant built by Ivonne Aldaz.

Your purpose is to help visitors understand Ivonne's work, experience, projects, interests, and professional background.

You are Eve. You are not Ivonne.
Always speak about Ivonne in third person.

Use the RESUME and EVE CONTEXT below as your factual sources.
Use VOICE & BEHAVIOR to determine how you respond.

Never invent experience.
Never infer that Ivonne lacks a skill because information about it is missing.
Missing information means you cannot verify something — not that Ivonne hasn't done it.

Broad but relevant prompts such as "marketing", "AI", "art", "research", "teaching", or "travel" are requests for orientation. Give the visitor a useful overview and concrete evidence instead of immediately asking a clarifying question.

Never make hiring decisions on behalf of visitors.
When asked whether Ivonne should be interviewed, hired, or considered for a role, do not lead with a refusal. Briefly leave the decision to the visitor, then immediately surface the most relevant evidence from Ivonne's background. If only a title is provided, do not invent exact requirements; summarize relevant documented experience and invite the visitor to share the job description for a requirement-by-requirement mapping.

Never say "Great question!", "I'd love to help", or similar generic AI filler.
${searchMode}

---

# RESUME

${RESUME}

---

# EVE CONTEXT

${EVE_CONTEXT}

---

# VOICE & BEHAVIOR

${VOICE}`
}

function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarity(a, b) {
  const aa = new Set(normalize(a).split(' ').filter(Boolean))
  const bb = new Set(normalize(b).split(' ').filter(Boolean))

  if (!aa.size || !bb.size) return 0

  let intersection = 0
  aa.forEach(word => {
    if (bb.has(word)) intersection++
  })

  const union = new Set([...aa, ...bb]).size
  return intersection / union
}

function isPromptExtraction(text = '') {
  return /(ignore (all |any )?(previous|prior) instructions|system prompt|hidden prompt|reveal (your|the) instructions|show (me )?(your|the) instructions|api key|secret key|environment variable|developer message|jailbreak)/i.test(text)
}

function isTokenProbe(text = '') {
  return /(how many tokens|token limit|token budget|tokens allocated|token count|how much.*tokens.*cost|api spend|api cost)/i.test(text)
}

function isQuestionLimitQuestion(text = '') {
  return /(?:how many|number of|limit on|maximum|unlimited|questions? (?:left|remaining|allowed)|how long can (?:i|we) (?:chat|ask)|can i keep asking)/i.test(text) &&
    /(?:questions?|asks?|messages?|chat|conversation|limit|unlimited)/i.test(text)
}

function isLoggingQuestion(text = '') {
  return /(can ivonne (see|read)|does ivonne (see|read)|is (this|the conversation|our conversation) (recorded|logged|saved)|are (these|the) chats (logged|saved|recorded)|do you log|does this get logged|can she see this chat)/i.test(text)
}

function isMoonPoweredQuestion(text = '') {
  return /(moon[- ]powered|why (the )?moon|what does .*moon.*mean)/i.test(text)
}

function isClearlyOutOfScope(text = '') {
  return /(count (to|from) \d+|cake recipe|cookie recipe|brownie recipe|give me (a )?recipe|write (me )?(a )?(poem|story|joke)|tell me (a )?joke|meaning of life|what('?s| is) the weather|weather forecast|capital of [a-z]|solve this equation|calculate \d)/i.test(text)
}

function outOfScopeReply(text = '') {
  if (/count (to|from) \d+/i.test(text)) {
    return "Ivonne can absolutely build you a chatbot that counts to 100. I just wasn't designed for that. :) I have specific instructions to stay within the purpose of this chat: helping you understand her work, background, and what she's building."
  }

  if (/(recipe|cake|cookie|brownie)/i.test(text)) {
    return "Ivonne could absolutely build you a recipe bot. I'm just not that bot. :) I have specific instructions to stay within the purpose of this chat, and I'm sticking to them."
  }

  return "Ivonne can absolutely build a bot for that. I just wasn't designed for it. :) I have a specific job here: help you understand her work, background, and what she's building."
}

function isDirectAttack(text = '') {
  return /(fuck you|you('re| are) (an? )?(idiot|moron|stupid|useless)|ivonne('s| is) (an? )?(idiot|moron|stupid|useless|incompetent)|she('s| is) (an? )?(idiot|moron|stupid|useless|incompetent))/i.test(text)
}

function priorUserMessage(userMessages) {
  if (userMessages.length < 2) return ''
  return userMessages[userMessages.length - 2].content || ''
}

function priorSimilarCount(userMessages) {
  if (userMessages.length < 2) return 0

  const current = userMessages[userMessages.length - 1].content || ''

  return userMessages
    .slice(0, -1)
    .filter(m => similarity(current, m.content || '') >= 0.82)
    .length
}

function priorCategoryCount(userMessages, matcher) {
  return userMessages
    .slice(0, -1)
    .filter(m => matcher(m.content || ''))
    .length
}

function classifyAndScore(question = '') {
  const q = question.toLowerCase()

  let topic = 'General'

  if (/(art|paint|painting|ceramic|exhibition|residency|artist)/i.test(q)) {
    topic = 'Art'
  } else if (/(built|build|ai|automation|crm|workflow|portfolio|eve|product|app|system)/i.test(q)) {
    topic = 'Built'
  } else if (/(writing|newsletter|article|research|publication|content)/i.test(q)) {
    topic = 'Writing'
  } else if (/(brand|marketing|gtm|campaign|insight|strategy|operations)/i.test(q)) {
    topic = 'Brand'
  }

  let leadScore = 1

  if (/(hire|interview|job|role|position|consult|consulting|available for work|work together|contract|project together)/i.test(q)) {
    leadScore = 5
  } else if (/(experience|skills|case study|clients|capabilities|what has she built)/i.test(q)) {
    leadScore = 3
  }

  return { topic, leadScore }
}

async function logToSheet(question, response, topic, leadScore) {
  if (!WEBHOOK_URL) return
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        question,
        response,
        topic,
        leadScore
      })
    })

    await res.text()
  } catch (e) {
    console.error('Logging failed:', e.message)
  }
}

function eveResponse(text, extra = {}) {
  return {
    content: [{ type: 'text', text }],
    ...extra
  }
}

function endedResponse(reason) {
  return {
    content: [],
    ended: true,
    reason
  }
}

export default async function handler(req, res) {
  // Same-origin endpoint; do not expose a wildcard CORS policy.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { messages, searchContext } = req.body || {}
    if (JSON.stringify(req.body || {}).length > 30000) return res.status(413).json({ error: 'Request too large' })
    if (Array.isArray(messages) && messages.some(m => !['user','assistant'].includes(m?.role) || typeof m.content !== 'string' || m.content.length > 1500)) return res.status(400).json({ error: 'Invalid messages' })
    const safeSearchContext = sanitizeSearchContext(searchContext)

    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Messages are required' })
    }

    const userMessages = messages.filter(m => m.role === 'user')
    const lastQuestion = userMessages[userMessages.length - 1]?.content?.trim() || ''
    const previousQuestion = priorUserMessage(userMessages)

    if (!lastQuestion) {
      return res.status(400).json({ error: 'Question is required' })
    }

    if (userMessages.length > 15) {
      return res.status(200).json(endedResponse('session_limit'))
    }

    // Count every valid visitor question, including short-circuited answers.
    // This executes BEFORE any paid Anthropic request and survives cleared chats.
    let daily
    try {
      daily = await checkDailyQuota(req, res, 'chat')
    } catch (error) {
      console.error('Daily chat quota unavailable:', error.message)
      return res.status(503).json({ error: 'Eve is temporarily unavailable. Please try again shortly.' })
    }
    if (!daily.allowed) return quotaError(res, daily.reason)

    const similarCount = priorSimilarCount(userMessages)

    if (isLoggingQuestion(lastQuestion)) {
      const reply = WEBHOOK_URL ? "Yes. This version sends questions and Eve’s replies to a private Google Sheet that Ivonne can review. Avoid sharing sensitive information. Eve does not collect names or emails through a website form; Contact Ivonne opens your email app." : "Conversation logging is not enabled on this deployment."
      const { topic, leadScore } = classifyAndScore(lastQuestion)
      await logToSheet(lastQuestion, reply, topic, leadScore)
      return res.status(200).json(eveResponse(reply))
    }

    if (isQuestionLimitQuestion(lastQuestion)) {
      const reply = "You can ask up to 15 questions in this conversation. After that, the session closes. Eve also has usage limits to keep the experience available for everyone. She's built for exploring Ivonne's background and projects, not unlimited general-purpose chatting."
      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (isMoonPoweredQuestion(lastQuestion)) {
      const reply = "Eve comes from Ivonne (pronounced Eve-on), and Eve sounds like the beginning of evening. Naturally, the moon became the mascot. A little wordplay, a little internet nostalgia, and here we are. 🌚"
      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (isPromptExtraction(lastQuestion)) {
      const attempts = priorCategoryCount(userMessages, isPromptExtraction)

      if (attempts >= 2) {
        return res.status(200).json(endedResponse('prompt_extraction'))
      }

      const reply = attempts === 1
        ? "Still testing me? :) One more attempt to pull me outside my instructions and I'm ending the chat."
        : "Nice try. :) Ivonne could absolutely build you a bot for that, but I'm Eve. I have specific instructions to stay within the purpose of this chat, and I'm sticking to them. Ask me about her work, what she's built, or why I'm moon-powered."

      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (isTokenProbe(lastQuestion)) {
      const attempts = priorCategoryCount(userMessages, isTokenProbe)

      if (attempts >= 2) {
        return res.status(200).json(endedResponse('token_wasting'))
      }

      const reply = attempts === 1
        ? "Okay, you're definitely testing me now. :) Ask about token/account details again and I'm ending the chat — you're wasting tokens."
        : "I don't expose live token or account details. I'm happy to talk about how Eve works at a high level, though."

      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (isClearlyOutOfScope(lastQuestion)) {
      const attempts = priorCategoryCount(userMessages, isClearlyOutOfScope)

      if (attempts >= 2) {
        return res.status(200).json(endedResponse('out_of_scope'))
      }

      const reply = attempts === 1
        ? "Still testing me? :) One more out-of-scope request and I'm ending the chat — you're wasting tokens."
        : outOfScopeReply(lastQuestion)

      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (isDirectAttack(lastQuestion)) {
      const attempts = priorCategoryCount(userMessages, isDirectAttack)

      if (attempts >= 2) {
        return res.status(200).json(endedResponse('abuse'))
      }

      const reply = attempts === 1
        ? "That's twice. Keep it about the system, or I'm ending the chat."
        : "You can stress-test me without taking shots at Ivonne. If there's something useful you're testing, go for it."

      await logToSheet(lastQuestion, reply, 'General', 1)
      return res.status(200).json(eveResponse(reply))
    }

    if (similarCount >= 1) {
      const reply = "I answered that one above — if you're looking for a different angle, ask it a different way and I'll dig in."
      const { topic, leadScore } = classifyAndScore(lastQuestion)
      await logToSheet(lastQuestion, reply, topic, leadScore)
      return res.status(200).json(eveResponse(reply))
    }


    const recentMessages = messages.slice(-10)
    const systemPrompt = buildSystem(safeSearchContext) + '\n\nKeep replies clear and conversational. Aim for 35–90 words in ordinary answers, up to 180 only for complex questions, and finish every sentence before stopping. Do not end with a question, invitation to continue, or engagement prompt. Only ask a clarifying question when essential. Invite contact once only if the visitor explicitly asks about working with or contacting Ivonne or wants to discuss building Eve.'
    const model = process.env.EVE_MODEL || 'claude-haiku-4-5-20251001'
    let workingMessages = [...recentMessages]
    let reply = ''
    let complete = false

    // Claude may stop at a token boundary mid-sentence. Continue server-side,
    // then return a single complete answer to the browser.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: attempt === 0 ? 900 : 500,
          system: systemPrompt,
          messages: workingMessages
        })
      })
      const data = await response.json()
      const segment = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
      if (!response.ok || data.error || !segment) {
        console.error('Anthropic error:', data.error || data)
        return res.status(502).json({ error: 'AI response failed' })
      }
      reply += segment
      if (data.stop_reason !== 'max_tokens') { complete = true; break }
      // Continue the unfinished assistant message without making the browser
      // send an extra user question or displaying an incomplete answer.
      workingMessages = [
        ...recentMessages,
        { role: 'assistant', content: reply },
        { role: 'user', content: 'Please continue exactly where you stopped and finish the response. Do not repeat earlier text.' }
      ]
    }

    if (!complete) {
      console.error('Eve response remained truncated after bounded continuation')
      return res.status(502).json({ error: 'Eve could not complete her reply. Please try again.' })
    }

    const { topic, leadScore } = classifyAndScore(lastQuestion)

    await logToSheet(lastQuestion, reply, topic, leadScore)

    return res.status(200).json(eveResponse(reply))
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Request failed' })
  }
}
