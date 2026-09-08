import { acceptedFreshTaskAdmissionQuintGateCommandKeys } from "./quint-gate-fresh-task-command-oracle.mjs"
import { acceptedLegacyQuintGateCommandKeys } from "./quint-gate-legacy-command-oracle.mjs"

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
const commandKey = ({ kind, name }) => `${kind}\u0000${name}`
const firstPostFreshTaskCommandKey = "typecheck\u0000Run cancellation model typecheck"
const freshTaskInsertionIndex = acceptedLegacyQuintGateCommandKeys.indexOf(firstPostFreshTaskCommandKey)

if (freshTaskInsertionIndex < 0) throw new Error("accepted legacy Quint oracle lacks the post-#315 boundary")

const acceptedQuintGateCommandKeys = Object.freeze([
  ...acceptedLegacyQuintGateCommandKeys.slice(0, freshTaskInsertionIndex),
  ...acceptedFreshTaskAdmissionQuintGateCommandKeys,
  ...acceptedLegacyQuintGateCommandKeys.slice(freshTaskInsertionIndex)
])

/** Compare the retained pre-#315 commands with the independently accepted order. */
export const assertAcceptedLegacyQuintGateCommands = (manifest) => {
  const retained = manifest.filter(({ name }) => !name.startsWith("fresh-task admission")).map(commandKey)
  const mismatch = retained.findIndex((key, index) => key !== acceptedLegacyQuintGateCommandKeys[index])
  if (retained.length === acceptedLegacyQuintGateCommandKeys.length && mismatch < 0) return

  const index = mismatch < 0 ? Math.min(retained.length, acceptedLegacyQuintGateCommandKeys.length) : mismatch
  throw new Error(
    `accepted legacy Quint command mismatch at ${index}: expected ${String(acceptedLegacyQuintGateCommandKeys[index])}, received ${String(retained[index])}`
  )
}

/** Compare every command with independent pre-#315 and #315 literal oracles. */
export const assertAcceptedQuintGateCommands = (manifest) => {
  const received = manifest.map(commandKey)
  const mismatch = received.findIndex((key, index) => key !== acceptedQuintGateCommandKeys[index])
  if (received.length === acceptedQuintGateCommandKeys.length && mismatch < 0) return

  const index = mismatch < 0 ? Math.min(received.length, acceptedQuintGateCommandKeys.length) : mismatch
  throw new Error(
    `accepted Quint command mismatch at ${index}: expected ${String(acceptedQuintGateCommandKeys[index])}, received ${String(received[index])}`
  )
}

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
  assertAcceptedQuintGateCommands(manifest)
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
