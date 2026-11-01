// Display preferences only; never use these to authorize access or change accounting.
// Use the selected business, not the hostname: Tahseeb admin can work in it from any domain.
export const usesCompactHome = projectName => projectName?.trim() === 'تشورميك'

// Mazaher's layout must not enable Tashormik's loan hiding or invoice grouping.
export const usesMazaherHome = projectName => ['ديوانية مزاهر', 'مزاهر'].includes(projectName?.trim())
export const usesSimplifiedHome = projectName => usesCompactHome(projectName) || usesMazaherHome(projectName)
