export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
}

function tryParseJSON(text) {
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = clean.indexOf('{')
  if (start === -1) throw new Error('No JSON object found')

  // brace-counting لإيجاد نهاية الـ JSON بدقة
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i]
    if (esc)               { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"')        { inStr = !inStr; continue }
    if (inStr)             continue
    if (ch === '{')        depth++
    if (ch === '}')        { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('Unmatched braces in JSON')

  const jsonStr = clean.slice(start, end + 1)
  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    const fixed = jsonStr
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1')
    JSON.parse(fixed) // throws with position if still broken
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = (process.env.CLAUDE_API_KEY || '').replace(/^﻿/, '').trim()
  if (!apiKey) {
    return res.status(500).json({ error: 'CLAUDE_API_KEY not configured on server' })
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify(req.body),
    })

    const data = await upstream.json()
    const rawText = data?.content?.[0]?.text || ''

    // تحقق من صحة JSON في النص قبل الإرسال — يكشف المشكلة مبكراً
    try {
      tryParseJSON(rawText)
    } catch (parseError) {
      return res.status(200).json({
        error: 'JSON_PARSE_ERROR',
        rawText: rawText.substring(0, 1000),
        parseError: parseError.message,
      })
    }

    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
