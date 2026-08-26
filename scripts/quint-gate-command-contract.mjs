export const quintGateExpectedCommandCounts = Object.freeze({
  total: 92,
  typecheck: 13,
  test: 40,
  "sampled-run": 20,
  verify: 19
})

const commandKinds = Object.freeze(["typecheck", "test", "sampled-run", "verify"])

const countManifestCommands = (manifest) => {
  const counts = Object.fromEntries(commandKinds.map((kind) => [kind, 0]))
  for (const command of manifest) {
    if (commandKinds.includes(command.kind)) counts[command.kind] += 1
  }
  return { total: manifest.length, ...counts }
}

/**
 * Keep the selected command count independent from the manifest and the
 * execution path. Both representations must retain the accepted 92-command
 * phase contract even when an omission changes them together.
 */
export const assertQuintGateCommandContract = ({ executed, manifest }) => {
  const manifestCounts = countManifestCommands(manifest)
  const mismatches = []
  for (const key of ["total", ...commandKinds]) {
    const expected = quintGateExpectedCommandCounts[key]
    if (manifestCounts[key] !== expected) {
      mismatches.push(`manifest ${key}=${manifestCounts[key]}; expected ${expected}`)
    }
    if (executed[key] !== expected) {
      mismatches.push(`executed ${key}=${executed[key]}; expected ${expected}`)
    }
  }
  if (mismatches.length > 0) throw new Error(`Quint gate command contract mismatch: ${mismatches.join(", ")}`)
}
