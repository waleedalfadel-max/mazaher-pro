// Display preferences only; never use these to authorize access or change accounting.
// Use the selected business, not the hostname: Tahseeb admin can work in it from any domain.
export const usesCompactHome = projectName => projectName?.trim() === 'تشورميك'
