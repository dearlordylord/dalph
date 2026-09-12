import { stripVTControlCharacters } from "node:util"

const witnessLine = /^(\w+) was witnessed in (\d+) trace\(s\) out of (\d+) explored \((\d+\.\d+)%\)$/

/** Read the exact witness identities attached to one Quint command. */
export const quintWitnessesFromCommandArgs = (args) => {
  const positions = args.flatMap((arg, position) => (arg === "--witnesses" ? [position] : []))
  if (positions.length === 0) return []
  if (positions.length > 1) throw new Error("Quint sampled command has duplicate --witnesses options")

  const start = positions[0] + 1
  const endOffset = args.slice(start).findIndex((arg) => arg.startsWith("--"))
  const end = endOffset < 0 ? args.length : start + endOffset
  return args.slice(start, end)
}

/** Require complete sampled diagnostics; zero hits do not establish unreachability. */
export const assertRequiredWitnessesObserved = (output, requiredWitnesses) => {
  if (new Set(requiredWitnesses).size !== requiredWitnesses.length) throw new Error("duplicate declared witnesses")
  const observed = new Map()
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    if (!line.includes("was witnessed")) continue
    const match = witnessLine.exec(line)
    if (match === null) throw new Error(`malformed witness output: ${line}`)
    const count = Number(match[2])
    const explored = Number(match[3])
    const percentage = Number(match[4])
    if (
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(explored) ||
      explored <= 0 ||
      count > explored ||
      Math.abs(percentage - (count / explored) * 100) > 0.005001
    ) {
      throw new Error(`malformed witness output: ${line}`)
    }
    if (observed.has(match[1])) throw new Error(`duplicate witness output: ${match[1]}`)
    observed.set(match[1], count)
  }
  const absent = requiredWitnesses.filter((witness) => !observed.has(witness))
  if (absent.length === 0) return observed
  throw new Error(`Quint sampled witness coverage failed: missing witness output: ${absent.join(", ")}`)
}

/** The collected #66 trace must actually execute; an uncollected run is not evidence. */
export const assertTaskFactReplacementTestCollected = ({ args, output }) => {
  if (
    args.filter((arg) => arg === "--main").length !== 1 ||
    args[0] !== "test" ||
    args[1] !== "specs/taskFactReconciliation_test.qnt" ||
    args[args.indexOf("--main") + 1] !== "taskFactReconciliationTest"
  ) {
    throw new Error("mandatory P2 reachability requires the exact canonical test command")
  }
  const owner = "safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test"
  const lines = stripVTControlCharacters(output)
    .split(/\r?\n/)
    .filter((line) => line.includes(owner))
  if (lines.length !== 1 || lines[0].trim() !== `ok ${owner} passed 1 test(s)`) {
    throw new Error(`mandatory P2 reachability test was not collected exactly once and passed: ${owner}`)
  }
}

/** Preserve the original validation error and the subprocess diagnostics for family rendering. */
export const validateQuintCommandOutput = ({ args, name, output }) => {
  try {
    if (args[0] === "run") return assertQuintSampledCommandWitnessesObserved({ args, name, output })
    if (name === "task-fact reconciliation deterministic tests") {
      assertTaskFactReplacementTestCollected({ args, output })
    }
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { output })
    throw error
  }
}

/** Fail one named sampled command when its declared reachability evidence is incomplete. */
export const assertQuintSampledCommandWitnessesObserved = ({ args, name, output }) => {
  const requiredWitnesses = quintWitnessesFromCommandArgs(args)
  if (requiredWitnesses.length === 0) throw new Error(`${name}: no declared --witnesses`)
  try {
    return assertRequiredWitnessesObserved(output, requiredWitnesses)
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.replace(/^Quint sampled witness coverage failed: /, "") : String(error)
    throw new Error(`${name}: ${detail}`, { cause: error })
  }
}
