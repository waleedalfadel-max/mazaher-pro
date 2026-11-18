import { timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin } from './_supabaseAdmin.js'
import { authenticateRequest } from './_auth.js'
import { originalTextReader, storagePath } from '../server/documentText.js'

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const sent = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from('Bearer ' + secret)
  return sent.length === expected.length && timingSafeEqual(sent, expected)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const admin = getSupabaseAdmin()
  let documentId = null
  if (req.method === 'GET') {
    if (!cronAuthorized(req)) return res.status(401).end()
  } else if (req.method === 'POST') {
    const auth = await authenticateRequest(req)
    if (!auth.ok) return res.status(auth.status).end()
    documentId = req.body?.documentId
    if (typeof documentId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(documentId)) return res.status(400).end()
    const { data, error } = await admin.from('documents').select('id').eq('id', documentId)
      .eq('project_id', auth.user.projectId).eq('created_by_user_id', auth.user.appUserId).maybeSingle()
    if (error) return res.status(503).end()
    if (!data) return res.status(404).end()
  } else return res.status(405).end()

  let processed = 0, errors = 0, exhausted = false
  const reader = originalTextReader()
  const until = Date.now() + 125_000
  try {
    do {
      const { data, error } = await admin.rpc('claim_document_text', { p_document: documentId })
      if (error) throw error
      const job = data?.[0]
      if (!job) { exhausted = true; break }
      try {
        const path = storagePath(job, process.env.VITE_SUPABASE_URL)
        const { data: file, error: downloadError } = await admin.storage.from('documents').download(path)
        if (downloadError) throw downloadError
        const part = await reader.read(Buffer.from(await file.arrayBuffer()), file.type || job.file_type, job.next_page)
        const { error: writeError } = await admin.rpc('finish_document_text', {
          p_document: job.document_id, p_lease: job.lease, p_text: part.text.replaceAll('\u0000', ''), p_next: part.next,
        })
        if (writeError) throw writeError
        processed++
        if (documentId && !part.next) break
      } catch {
        errors++
        const { error: retryError } = await admin.from('document_original_text').update({
          state: job.attempts >= 4 ? 'failed' : 'retry', lease: null,
          retry_at: new Date(Date.now() + 60_000 * 2 ** Math.min(job.attempts, 6)).toISOString(),
        }).eq('document_id', job.document_id).eq('lease', job.lease)
        if (retryError) throw retryError
        if (documentId) break
      }
    } while (Date.now() < until && processed + errors < 50)
    return res.status(200).json({ processed, errors, exhausted })
  } finally { await reader.close() }
}
