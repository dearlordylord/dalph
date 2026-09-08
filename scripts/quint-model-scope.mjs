const modelGovernedPatterns = [
  /^specs\//u,
  /\.qnt$/u,
  /^scripts\/quint-[^/]+\.mjs$/u,
  /^scripts\/check-quint-models\.mjs$/u,
  /^scripts\/application-exit-model-registry\.mjs$/u,
  /^packages\/[^/]+\/test\/conformance\//u,
  /\.mbt\.test\.ts$/u
]

/**
 * The model gate proves the Quint specifications and their conformance adapters. A change that touches neither cannot
 * move a verdict, so the development-loop command reports the governed paths it found and runs the gate only for them.
 * Candidate and hosted verification run the gate unconditionally.
 */
export const modelGovernedChanges = ({ changedFiles }) =>
  [...new Set(changedFiles.filter((file) => modelGovernedPatterns.some((pattern) => pattern.test(file))))].toSorted(
    (left, right) => left.localeCompare(right)
  )
