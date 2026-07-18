export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
}

function tryParseJSON(text) {
  // تنظيف: BOM + control characters + markdown fences
  const cleaned = text
    .replace(/^﻿/, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()

  // محاولة parse مباشر أولاً
  try { return JSON.parse(cleaned) } catch {}

  // brace counting — يدعم { و [
  let start = cleaned.indexOf('{')
  const startArr = cleaned.indexOf('[')
  if (start === -1 || (startArr !== -1 && startArr < start)) start = startArr
  if (start === -1) throw new Error('No JSON object found')

  let depth = 0, inStr = false, esc = false

  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc)               { esc = false; continue }
    if (c === '\\' && inStr) { esc = true; continue }
    if (c === '"')           { inStr = !inStr; continue }
    if (inStr)               continue
    if (c === '{' || c === '[') depth++
    if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(slice)
        } catch (e) {
          // محاولة تصحيح شائعة
          const fixed = slice
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
          try { return JSON.parse(fixed) } catch {}
          throw new Error('JSON parse failed: ' + e.message)
        }
      }
    }
  }
  throw new Error('No JSON object found')
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
    const body = req.body
    console.log('=== API Request ===')
    console.log('model:', body?.model)
    console.log('system:', body?.system?.slice?.(0, 80))
    console.log('messages[0].content blocks:', body?.messages?.[0]?.content?.map(b => b.type))

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify(body),
    })

    console.log('=== API Response Status ===', upstream.status)
    const data = await upstream.json()
    console.log('=== Raw Response keys ===', Object.keys(data))
    console.log('stop_reason:', data?.stop_reason)
    console.log('content[0] type:', data?.content?.[0]?.type)
    console.log('text preview:', (data?.content?.[0]?.text || '').slice(0, 200))

    // كشف أخطاء Claude API (overloaded, invalid_request, etc.)
    if (data.type === 'error' || data.error) {
      console.log('=== Claude API Error ===', JSON.stringify(data.error || data))
      return res.status(200).json({
        error: 'CLAUDE_API_ERROR',
        claudeError: data.error || data,
        status: upstream.status,
      })
    }

    const rawText = Buffer.from(data?.content?.[0]?.text || '', 'utf8').toString('utf8')

    // تحقق من صحة JSON في النص قبل الإرسال — يكشف المشكلة مبكراً
    try {
      tryParseJSON(rawText)
    } catch (parseError) {
      console.log('=== Parse Error ===', parseError.message)
      console.log('rawText:', rawText.slice(0, 500))
      return res.status(200).json({
        error: 'JSON_PARSE_ERROR',
        rawText: rawText.substring(0, 1000),
        parseError: parseError.message,
      })
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.status(upstream.status).json(data)
  } catch (err) {
    console.log('=== Handler Error ===', err.message)
    res.status(500).json({ error: err.message })
  }
}
