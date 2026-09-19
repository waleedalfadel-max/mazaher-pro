const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = value => Number.isSafeInteger(value) && value >= 0

function employee(value) {
  return object(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && value.role === 'employee'
    && typeof value.active === 'boolean'
    && Array.isArray(value.grants)
    && Number.isSafeInteger(value.version)
    && value.version > 0
}

export function isAccountSuccess(action, result) {
  if (!object(result)) return false
  if (action === 'pin_login') return /^tm_[a-f0-9]{64}$/.test(result.token || '') && employee(result.actor) && object(result.organization)
  if (action === 'me') return object(result.actor) && typeof result.actor.id === 'string' && typeof result.actor.role === 'string' && typeof result.actor.active === 'boolean' && object(result.organization)
  if (action === 'employees') return Array.isArray(result.employees) && result.employees.every(employee)
  if (['save_employee', 'set_pin', 'set_active'].includes(action)) return employee(result.employee)
  if (action === 'logout') return result.ok === true
  return false
}

export function isFinanceSuccess(operation, payload, result) {
  if (!object(result)) return false
  if (operation === 'read') return integer(result.revision) && object(result.actor) && object(result.data)
  if (operation !== 'mutate' || result.ok !== true || !integer(result.revision) || !Object.hasOwn(result, 'documentId')) return false
  if (result.duplicate !== undefined && typeof result.duplicate !== 'boolean') return false
  if (payload?.command?.type === 'DOC_ADD') return typeof result.documentId === 'string' && result.documentId.length > 0
  return result.documentId === null || typeof result.documentId === 'string'
}

function unavailable(code, messages) {
  return Object.assign(new Error(messages[code] || 'تعذر التحقق من استجابة الخادم'), { code })
}

export async function resultOrError(response, { file = false, unavailableCode, messages = {}, validate }) {
  if (response.ok && file) return response.blob()
  let result
  try { result = await response.json() } catch { throw unavailable(unavailableCode, messages) }
  if (!response.ok) {
    if (!object(result)) throw unavailable(unavailableCode, messages)
    const error = new Error(messages[result.error] || result.message || 'تعذر إكمال العملية')
    error.code = typeof result.error === 'string' ? result.error : 'UNKNOWN_ERROR'
    throw error
  }
  if (!validate(result)) throw unavailable(unavailableCode, messages)
  return result
}
