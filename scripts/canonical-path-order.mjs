/** Locale-independent UTF-16 code-unit ordering for reproducible repository path evidence. */
export const compareCanonicalPaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/** Deduplicate repository paths and put them in the one canonical evidence order. */
export const canonicalPaths = (paths) => [...new Set(paths)].toSorted(compareCanonicalPaths)
