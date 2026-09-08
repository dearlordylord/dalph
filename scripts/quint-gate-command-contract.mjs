export const quintGateExpectedCommandCounts = Object.freeze({
  total: 105,
  typecheck: 15,
  test: 46,
  "sampled-run": 23,
  verify: 21
})

export const legacyQuintGateExpectedCommandCounts = Object.freeze({
  total: 92,
  typecheck: 13,
  test: 40,
  "sampled-run": 20,
  verify: 19
})

// Both supported hosted runner architectures expose four logical processors.
// Quint partitions a seeded simulation across this value, so leaving it to
// os.cpus() changes the sampled traces while retaining the same seed.
export const quintGateSampleThreadCount = 4

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
 * execution path. Both representations must retain the freshness-corrected
 * 105-command phase contract even when an omission changes them together.
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

/** Require one explicit hosted-supported thread count on every sampled run. */
export const assertQuintGateSampleThreadContract = (args) => {
  const threadPositions = args.flatMap((arg, position) => (arg === "--n-threads" ? [position] : []))
  if (threadPositions.length === 1 && args[threadPositions[0] + 1] === String(quintGateSampleThreadCount)) return

  throw new Error(
    `Quint sampled-run thread contract mismatch: expected exactly --n-threads ${quintGateSampleThreadCount}`
  )
}

/** Materialize the sampled-run execution contract without changing command identity. */
export const withQuintGateSampleThreadContract = (args) => {
  const executionArgs = [...args, "--n-threads", String(quintGateSampleThreadCount)]
  assertQuintGateSampleThreadContract(executionArgs)
  return executionArgs
}
