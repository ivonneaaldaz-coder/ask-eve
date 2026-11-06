# Ask Eve

A standalone, interactive AI-powered CV for Ivonne Aldaz. Originated inside [Ivonne LAB](https://lab.ivonnealdaz.com), which remains unchanged.

## Experience
- **Future:** minimal, editorial, technology-focused design (default).
- **OS 95:** nostalgic desktop-inspired skin.
- Switch skins mid-chat without losing the conversation.
- Three-step, dismissible onboarding.
- Optional, muted-by-default interface sounds and read-aloud responses.
- Browser speech recognition for dictating a question, when supported.
- Suggested questions, session reset, and responsive layout.

## Intelligence
The `api/chat.js` endpoint is adapted from the LAB's existing Claude-based backend. Knowledge inputs are `resume.md`, `eve-context.md`, and `voice.md`. This is **context-grounded prompting, not fine-tuning or a trained custom model**. Existing LAB-specific context is preserved for parity and should be separately tailored before public launch.

## Deployment
Create a separate Vercel project for this repository. Set **ANTHROPIC_API_KEY** as a server-side environment variable. Optionally set **EVE_LOG_WEBHOOK_URL** to log questions/responses to an approved destination. If not set, conversation logging is disabled. Never commit secrets.

The site is a static `index.html` plus a serverless `api/chat.js`. No build step required.

Recommended domain: `ask.ivonnealdaz.com`. Do not connect a production domain until tested.

## Review before public launch
- Add durable IP/session rate limits via Vercel WAF, Upstash, or equivalent. Browser-provided session limits alone do not protect API budgets.
- Audit and slim LAB-specific knowledge/instructions.
- Review privacy disclosure and opt-in logging policy (existing onboarding notes logging is conditional).
- Verify responsive layouts, keyboard navigation, reduced-motion behavior, and voice recognition in target browsers.
- Copy the `ANTHROPIC_API_KEY` securely into this project's Vercel configuration. Do not reuse the old LAB project's deployment.
- Set up preview deployment, test live Claude requests and error handling, then configure custom domain.
- Keep the original LAB Ask Eve untouched; adding a link from LAB to this version can be a later, separately reviewed change.

## Dev branch
`feat/standalone-experience` contains the initial independent version. No changes are made to the LAB repository.
