import { canCommand, emptyLedger, executeCommand, projectLedger, visibleDocument } from './finance-model.js';
const MAX_FILE = 5 * 1024 * 1024;
const BUCKET = 'tatmira-documents';
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value || '');
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
async function cappedBody(request, max) {
  const reader = request.body?.getReader();
  if (!reader) throw { code: 'INVALID_REQUEST', status: 400 };
  let length = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw { code: 'REQUEST_TOO_LARGE', status: 413 }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}
function fileType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg', 'jpg'];
  if ([137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return ['image/png', 'png'];
  if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return ['application/pdf', 'pdf'];
  return null;
}
export function createFinanceHandler({ admin, allowedOrigins }) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
    if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    let uploadedPath = null, committed = false;
    const cleanup = async () => { if (uploadedPath && !committed) await admin.storage.from(BUCKET).remove([uploadedPath]).catch(() => {}); };
    try {
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!token) return reply(401, { error: 'AUTH_REQUIRED' });
      let owner = null, employee = null;
      if (/^tm_[a-f0-9]{64}$/.test(token)) employee = token;
      else {
        const { data, error } = await admin.auth.getUser(token);
        if (error || !data?.user?.id) return reply(401, { error: 'INVALID_SESSION' });
        owner = data.user.id;
      }
      const multipart = request.headers.get('content-type')?.startsWith('multipart/form-data;');
      const bytes = await cappedBody(request, multipart ? MAX_FILE + 65536 : 65536);
      let body, file;
      try {
        if (multipart) {
          const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
          body = JSON.parse(form.get('request')); file = form.get('file');
        } else body = JSON.parse(new TextDecoder().decode(bytes));
      } catch { return reply(400, { error: 'INVALID_REQUEST' }); }
      if (!body || !/^[a-z0-9-]{1,63}$/.test(body.tenant || '') || !['read', 'mutate', 'file'].includes(body.operation)) return reply(400, { error: 'INVALID_REQUEST' });
      const rpc = async (operation, payload = {}) => {
        const { data, error } = await admin.rpc('tatmira_finance', { p_operation: operation, p_slug: body.tenant, p_owner: owner, p_token: employee, p_payload: payload });
        if (error || !data) throw { code: 'FINANCE_UNAVAILABLE', status: 503 };
        if (data.error) throw { code: data.error, status: ['INVALID_SESSION', 'AUTH_REQUIRED'].includes(data.error) ? 401 : ['FORBIDDEN', 'OWNER_ONLY', 'TENANT_UNAVAILABLE'].includes(data.error) ? 403 : ['CONFLICT', 'REQUEST_ID_REUSED'].includes(data.error) ? 409 : 400 };
        return data;
      };
      const snapshot = await rpc('snapshot');
      const state = snapshot.state || emptyLedger(snapshot.organization.name);
      if (body.operation === 'read') return reply(200, { revision: snapshot.revision, actor: snapshot.actor, data: projectLedger(state, snapshot.actor) });
      if (body.operation === 'file') {
        const doc = state.documents.find(d => d.id === body.documentId);
        if (!doc || !visibleDocument(snapshot.actor, doc)) return reply(404, { error: 'NOT_FOUND' });
        if (!doc.file.id.startsWith(snapshot.organization.id + '/')) return reply(404, { error: 'NOT_FOUND' });
        const { data, error } = await admin.storage.from(BUCKET).download(doc.file.id);
        if (error || !data) return reply(503, { error: 'FILE_UNAVAILABLE' });
        // Re-check revocation after storage download; no long-lived public/signed file URLs.
        await rpc('snapshot');
        return new Response(data, { status: 200, headers: { ...headers, 'Content-Type': doc.file.type, 'Content-Disposition': 'attachment' } });
      }
      if (!uuid(body.requestId) || !Number.isSafeInteger(body.revision) || body.revision < 0 || !body.command || typeof body.command !== 'object') return reply(400, { error: 'INVALID_REQUEST' });
      if (!canCommand(snapshot.actor, body.command)) return reply(403, { error: 'FORBIDDEN' });
      let fileBytes, detected;
      if (body.command.type === 'DOC_ADD') {
        if (!(file instanceof Blob) || !file.size || file.size > MAX_FILE) return reply(400, { error: 'FILE_REQUIRED' });
        fileBytes = new Uint8Array(await file.arrayBuffer()); detected = fileType(fileBytes);
        if (!detected) return reply(400, { error: 'FILE_TYPE' });
      } else if (file) return reply(400, { error: 'INVALID_REQUEST' });
      const fingerprint = await hash(new TextEncoder().encode(JSON.stringify(body.command) + (fileBytes ? await hash(fileBytes) : '')));
      const receipt = await rpc('receipt', { requestId: body.requestId, fingerprint });
      if (receipt.result) return reply(200, { ...receipt.result, duplicate: true });
      if (body.revision !== snapshot.revision) return reply(409, { error: 'CONFLICT' });
      const metadata = fileBytes ? { id: `${snapshot.organization.id}/${body.requestId}/${crypto.randomUUID()}.${detected[1]}`,
        name: String(file.name || 'مستند').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180), type: detected[0], size: fileBytes.length } : null;
      const result = executeCommand(state, snapshot.actor, body.command, { requestId: body.requestId, file: metadata });
      if (result.error) return reply(400, { error: result.code, message: result.error });
      if (metadata) {
        const { error } = await admin.storage.from(BUCKET).upload(metadata.id, fileBytes, { contentType: metadata.type, upsert: false });
        if (error) return reply(503, { error: 'FILE_UNAVAILABLE' });
        uploadedPath = metadata.id;
      }
      let saved;
      try {
        saved = await rpc('commit', { requestId: body.requestId, fingerprint, revision: body.revision, command: { type: body.command.type, kind: body.command.kind }, state: result.state, documentId: result.documentId });
      } catch (e) {
        // On an ambiguous network outcome, do not delete a possibly committed attachment.
        if (e.code === 'FINANCE_UNAVAILABLE') committed = true;
        throw e;
      }
      committed = !saved.duplicate;
      await cleanup();
      return reply(200, saved);
    } catch (e) {
      await cleanup();
      return reply(e.status || 503, { error: e.code || 'FINANCE_UNAVAILABLE' });
    }
  };
}

