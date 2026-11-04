// Display preferences only; never use these to authorize access or change accounting.
// Use the selected business, not the hostname: Tahseeb admin can work in it from any domain.
export const usesCompactHome = projectName => projectName?.trim() === 'تشورميك'

const isWahaDemo = projectName => projectName?.trim() === 'الواحة'
export const groupsCreditInvoices = projectName => usesCompactHome(projectName) || isWahaDemo(projectName)

// The demo shows the overview with VAT and loans, and groups purchases in the ledger.
export const usesMazaherHome = projectName => ['ديوانية مزاهر', 'مزاهر'].includes(projectName?.trim()) || isWahaDemo(projectName)
export const usesSimplifiedHome = projectName => usesCompactHome(projectName) || usesMazaherHome(projectName)
