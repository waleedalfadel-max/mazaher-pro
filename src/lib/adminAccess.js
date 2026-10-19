// UI capabilities only. Every write still uses the real session and server permissions.
// A platform admin must first enter a business that the server has verified.
export const operatesBusiness = (role, projectId, viewState) =>
  role === 'superadmin' && !!projectId && viewState === 'ok'

export const canEditLedger = (role, projectId, viewState) =>
  role === 'accountant' || operatesBusiness(role, projectId, viewState)
