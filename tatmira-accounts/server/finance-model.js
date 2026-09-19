// The offline accounting engine is reused ONLY as a pure calculation library.
// Authentication, grants, filtering, files and persistence belong to this server.
import { createInitialState, reduce, ownerDashboard, customerSummary, openItems, statement } from '../../tatmira-demo/src/lib/ledger.js';
import { OWNER_ID } from '../../tatmira-demo/src/lib/permissions.js';

export const UPLOAD = { sale: 'upload_sale', payment: 'upload_payment', purchase: 'upload_expense' };
export const ACTION_GRANT = {
  CUSTOMER_ADD: 'manage_customers', CUSTOMER_UPDATE: 'manage_customers', CUSTOMER_ARCHIVE: 'manage_customers',
  DOC_UPDATE_FIELDS: 'review', DOC_APPROVE: 'review', DOC_REJECT: 'review', CREDIT_APPLY: 'review',
  TAX_SETTING_SAVE: 'owner', LAB_UPDATE: 'owner', ACCOUNT_SAVE: 'owner', ACCOUNT_ARCHIVE: 'owner',
  GROUP_SAVE: 'owner', GROUP_ARCHIVE: 'owner', CATEGORY_SAVE: 'owner', CATEGORY_ARCHIVE: 'owner',
};
export function allowed(actor, grant) {
  return !!actor?.active && (actor.role === 'owner' || (grant !== 'owner' && actor.grants?.includes(grant)));
}
export function canCommand(actor, command) {
  const grant = command?.type === 'DOC_ADD'
    ? (Object.hasOwn(UPLOAD, command.kind) ? UPLOAD[command.kind] : null)
    : (Object.hasOwn(ACTION_GRANT, command?.type) ? ACTION_GRANT[command.type] : null);
  return !!grant && allowed(actor, grant);
}
export function emptyLedger(name) {
  const seed = createInitialState();
  return { ...seed, lab: { ...seed.lab, name }, customers: [], employees: [], counters: {} };
}
function invalid(code = 'INVALID_REQUEST', message = 'راجع الحقول المطلوبة') {
  return { code, error: message };
}
const string = (value, max = 200) => typeof value === 'string' && value.length <= max;
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const keys = (source, names) => Object.fromEntries(names.filter(k => Object.hasOwn(source, k)).map(k => [k, source[k]]));
function fieldsFor(kind, fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw invalid();
  const fieldsKeys = kind === 'sale' ? ['customerId', 'number', 'date', 'lines'] : kind === 'payment'
    ? ['customerId', 'date', 'amount', 'accountId', 'reference', 'allocations']
    : ['payee', 'number', 'date', 'accountId', 'lines'];
  const f = keys(fields, fieldsKeys);
  for (const k of ['customerId', 'number', 'accountId', 'reference', 'payee']) if (k in f && !string(f[k])) throw invalid();
  if ('date' in f && !date(f.date)) throw invalid('DATE_REQUIRED', 'اختر تاريخًا صحيحًا');
  if ('amount' in f && !money(f.amount)) throw invalid();
  if ('lines' in f) {
    if (!Array.isArray(f.lines) || f.lines.length > 100) throw invalid();
    f.lines = f.lines.map(line => {
      if (!line || !string(line.desc, 500)) throw invalid();
      if (kind === 'sale') {
        if (!Number.isFinite(line.qty) || line.qty < 0 || line.qty > 1_000_000 || !money(line.price) || !Number.isSafeInteger(Math.round(line.qty * line.price))) throw invalid();
        return keys(line, ['desc', 'qty', 'price']);
      }
      if (!money(line.net) || !money(line.vat) || !string(line.categoryId)) throw invalid();
      return keys(line, ['desc', 'categoryId', 'net', 'vat']);
    });
  }
  if ('allocations' in f) f.allocations = allocations(f.allocations);
  return f;
}
function allocations(value) {
  if (!Array.isArray(value) || value.length > 200) throw invalid();
  return value.map(a => {
    if (!a || !string(a.target) || !money(a.amount)) throw invalid();
    return keys(a, ['target', 'amount']);
  });
}
export function executeCommand(state, actor, input, { requestId, file, now = new Date().toISOString() }) {
  if (!canCommand(actor, input)) return { state, ...invalid('FORBIDDEN', 'لا تملك صلاحية هذا الإجراء') };
  try {
    const action = keys(input, ['type', 'id', 'name', 'whatsapp', 'archived', 'kind', 'groupId', 'mode', 'rateBps', 'vatNumber', 'effectiveFrom', 'customerId', 'confirmDuplicate']);
    for (const key of ['id', 'name', 'whatsapp', 'groupId', 'vatNumber', 'customerId']) if (key in action && !string(action[key])) throw invalid();
    if ('archived' in action && typeof action.archived !== 'boolean') throw invalid();
    if ('confirmDuplicate' in action && typeof action.confirmDuplicate !== 'boolean') throw invalid();
    if (action.type === 'TAX_SETTING_SAVE' && (!date(action.effectiveFrom) || !Number.isInteger(action.rateBps))) throw invalid();
    if (action.type === 'LAB_UPDATE') {
      action.patch = keys(input.patch || {}, ['name', 'city', 'phone', 'crNumber', 'customerLabel']);
      if (Object.values(action.patch).some(v => !string(v))) throw invalid();
    }
    if (action.type === 'CREDIT_APPLY') action.allocations = allocations(input.allocations);
    const doc = state.documents.find(d => d.id === action.id);
    if (['DOC_UPDATE_FIELDS', 'DOC_APPROVE', 'DOC_REJECT'].includes(action.type) && (!doc || doc.status !== 'pending')) throw invalid('NOT_PENDING', 'المستند غير موجود أو تمت مراجعته');
    if (action.type === 'DOC_UPDATE_FIELDS') action.fields = fieldsFor(doc.kind, input.fields);
    if (action.type === 'DOC_ADD') {
      if (!file) throw invalid('FILE_REQUIRED', 'اختر ملف المستند');
      // Never generate sample lines/amounts or trust client file paths, actors or timestamps.
      const customerId = string(input.customerId) ? input.customerId : '';
      if (action.kind !== 'purchase' && !state.customers.some(c => c.id === customerId && !c.archived)) throw invalid('CUSTOMER_REQUIRED', 'اختر العميل');
      const fields = action.kind === 'sale' ? { customerId, number: '', date: now.slice(0, 10), lines: [] }
        : action.kind === 'payment' ? { customerId, date: now.slice(0, 10), amount: 0, accountId: '', reference: '', allocations: [] }
        : { payee: '', number: '', date: now.slice(0, 10), accountId: '', lines: [] };
      const document = { id: requestId, kind: action.kind, uploadedBy: actor.id, uploaderName: actor.name, uploadedAt: now,
        status: 'pending', sample: false, file, fields };
      return { state: { ...state, documents: [document, ...state.documents] }, documentId: requestId };
    }
    if (action.type === 'CUSTOMER_ADD' || action.type === 'CREDIT_APPLY') action.id = requestId;
    if (['ACCOUNT_SAVE', 'GROUP_SAVE', 'CATEGORY_SAVE'].includes(action.type) && !action.id) action.id = requestId;
    // Authorization above is authoritative; the local engine's role simulation is not used as a security boundary.
    const internal = { ...state, employees: [{ id: OWNER_ID, role: 'owner', active: true, docKinds: Object.keys(UPLOAD) }] };
    const result = reduce(internal, { ...action, actorId: OWNER_ID, today: now.slice(0, 10), at: now });
    if (result.error) return { ...result, state };
    const next = { ...result.state, employees: [] };
    if (['DOC_APPROVE', 'DOC_REJECT'].includes(action.type)) next.documents = next.documents.map(d => d.id === action.id ? { ...d, reviewedBy: actor.id, reviewerName: actor.name } : d);
    // Prevent unsafe aggregate integers, even when individually valid lines were supplied.
    function safeNumbers(value) {
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw invalid();
      if (value && typeof value === 'object') Object.values(value).forEach(safeNumbers);
    }
    safeNumbers(next);
    safeNumbers(ownerDashboard(next));
    return { state: next, documentId: action.id || null };
  } catch (e) { return { state, ...invalid(e.code, e.error) }; }
}
export function visibleDocument(actor, doc) {
  return doc.uploadedBy === actor.id || allowed(actor, 'review') || (allowed(actor, 'view_reports') && doc.status === 'approved');
}
export function projectLedger(state, actor) {
  const review = allowed(actor, 'review'), reports = allowed(actor, 'view_reports');
  const financialDetails = actor.role === 'owner' || review || reports;
  const customerAccess = review || reports || allowed(actor, 'manage_customers') || allowed(actor, 'upload_sale') || allowed(actor, 'upload_payment');
  const documents = state.documents.filter(d => visibleDocument(actor, d)).map(d => {
    const projectedFile = { ...keys(d.file, ['name', 'type', 'size']), documentId: d.id };
    if (financialDetails) {
      const { file, ...details } = d;
      return { ...details, file: projectedFile };
    }
    // Upload-only employees can follow status and reopen their original file,
    // but extracted accounting data remains private after review.
    return {
      ...keys(d, ['id', 'kind', 'uploadedBy', 'uploadedAt', 'status']),
      fields: keys(d.fields || {}, ['customerId']),
      file: projectedFile,
    };
  });
  const reportAccounts = state.accounts.map(a => keys(a, ['id', 'name', 'kind', 'archived']));
  const reportCategories = state.categories.map(c => keys(c, ['id', 'name', 'groupId', 'archived']));
  const reportGroups = state.expenseGroups.map(g => keys(g, ['id', 'name', 'kind', 'archived']));
  const reportTaxSettings = state.taxSettings.map(s => keys(s, ['id', 'mode', 'rateBps', 'effectiveFrom']));
  return {
    lab: state.lab,
    documents,
    customers: customerAccess ? state.customers.map(c => keys(c, financialDetails
      ? ['id', 'name', 'whatsapp', 'archived', 'openingBalance', 'openingDate']
      : ['id', 'name', 'whatsapp', 'archived'])) : [],
    accounts: review || actor.role === 'owner' ? state.accounts : reports ? reportAccounts : [],
    categories: review || actor.role === 'owner' ? state.categories : reports ? reportCategories : [],
    expenseGroups: review || actor.role === 'owner' ? state.expenseGroups : reports ? reportGroups : [],
    taxSettings: review || actor.role === 'owner' ? state.taxSettings : reports ? reportTaxSettings : [],
    ...(financialDetails ? {
      invoices: state.invoices,
      payments: state.payments,
      purchases: state.purchases,
      creditApplications: state.creditApplications || [],
      counters: state.counters || {},
    } : {}),
    ...(review ? { openItems: Object.fromEntries(state.customers.map(c => [c.id, openItems(state, c.id)])) } : {}),
    ...(reports ? { dashboard: ownerDashboard(state), customerBalances: state.customers.map(c => ({ id: c.id, name: c.name, ...customerSummary(state, c.id) })),
      statements: Object.fromEntries(state.customers.map(c => [c.id, statement(state, c.id)])) } : {}),
  };
}
