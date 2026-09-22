import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { currentSourceContentDigest, currentSourceInputDigest } from "./gate-run-identity.mjs"
import {
  atomicRecord,
  digest,
  inheritedCustody,
  newIdentity,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { gateRecoveryPath, readGateRecovery, withGateRecoveryLock } from "./gate-recovery.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const separator = process.argv.indexOf("--")
const options = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator)
const command = separator === -1 ? [] : process.argv.slice(separator + 1)
const failedRunId = options.shift()
const option = (name) => options.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const question = option("question")
const alternatives = option("alternatives")
  ?.split("|")
  .map((value) => value.trim())
  .filter(Boolean)
const observation = option("observation")
const expectedOutcome = option("expect")
const supportedAlternativeIndex = Number(option("supports")) - 1
const validExpectedOutcome =
  expectedOutcome === "passed" ||
  expectedOutcome === "failed" ||
  expectedOutcome === "timed-out" ||
  /^exit:\d+$/u.test(expectedOutcome ?? "")
if (
  failedRunId === undefined ||
  command.length === 0 ||
  typeof question !== "string" ||
  question.trim() === "" ||
  alternatives === undefined ||
  alternatives.length < 2 ||
  typeof observation !== "string" ||
  observation.trim() === "" ||
  !validExpectedOutcome ||
  !Number.isInteger(supportedAlternativeIndex) ||
  supportedAlternativeIndex < 0 ||
  supportedAlternativeIndex >= alternatives.length
)
  throw new Error(
    "Usage: pnpm gate:diagnose <failed-run-id> --question=<question> --alternatives='<a> | <b>' --observation=<distinguishing-observation> --expect=passed|failed|timed-out|exit:<code> --supports=<alternative-number> -- <focused-command>"
  )

const broadNames = new Set([
  "check:all",
  "check:baseline",
  "check:ci:quality",
  "check:quint",
  "check:preflight",
  "test:coverage"
])
if (
  command.some((argument) => broadNames.has(argument)) ||
  command.some((argument) => /run-quality-gate/u.test(argument))
)
  throw new Error("Gate recovery diagnosis must be focused; broad qualification commands are not permitted")

const location = repositoryLocation()
const custody = inheritedCustody()
if (custody === undefined || custody.run.worktree !== location.worktree)
  throw new Error("Run gate diagnosis through the admitted pnpm gate:diagnose entry point")
const actionId = newIdentity()
const actionSourceInputDigest = currentSourceInputDigest(location.worktree)
const planFingerprint = digest(JSON.stringify({ command, sourceInputDigest: actionSourceInputDigest }))
withGateRecoveryLock(location, () => {
  const record = readGateRecovery(location)
  if (record === undefined || record.failedRunId !== failedRunId)
    throw new Error(`No matching gate obstruction for run ${failedRunId}`)
  if (!["diagnosis-required", "repair-required"].includes(record.state))
    throw new Error(`Gate obstruction is ${record.state}, not ready for diagnosis`)
  if (record.diagnosisAttempts.some((attempt) => attempt.planFingerprint === planFingerprint))
    throw new Error("This diagnostic experiment already ran; change its executable intervention")
  atomicRecord(gateRecoveryPath(location), {
    ...record,
    state: "diagnosis-running",
    diagnosisRunId: custody.run.runId,
    nextAction: "observe-focused-diagnosis",
    diagnosisAttempts: [
      ...record.diagnosisAttempts,
      {
        actionId,
        planFingerprint,
        question,
        alternatives,
        observation,
        expectedOutcome,
        supportedAlternative: alternatives[supportedAlternativeIndex],
        command,
        sourceInputDigest: actionSourceInputDigest,
        sourceContentDigest: currentSourceContentDigest(location.worktree),
        startedAt: wallClockTimestamp(),
        outcome: "UNPROVEN"
      }
    ]
  })
})

let result
let failure
try {
  result = await runBoundedCommand({
    executable: command[0],
    args: command.slice(1),
    captureOutput: true,
    environment: { ...process.env, DALPH_GATE_RECOVERY_MODE: "diagnosis" },
    name: "focused gate diagnosis",
    relayParentSignals: true,
    timeoutMilliseconds: Number(process.env.DALPH_GATE_DIAGNOSIS_TIMEOUT_MILLISECONDS ?? 10 * 60 * 1000)
  })
} catch (error) {
  failure = error
}
const actualOutcome = failure?.quintCommandResult ?? (result?.exitCode === 0 ? "passed" : `exit:${result?.exitCode}`)
const expectationMatched =
  expectedOutcome === actualOutcome ||
  (expectedOutcome === "failed" && actualOutcome !== "passed" && actualOutcome !== "timed-out")
const output = result?.output ?? failure?.output ?? ""
const logDirectory = join(location.custodyRoot, "recovery", "logs")
mkdirSync(logDirectory, { recursive: true })
const logPath = join(logDirectory, `${actionId}.log`)
writeFileSync(logPath, output)
withGateRecoveryLock(location, () => {
  const record = readGateRecovery(location)
  if (record?.state !== "diagnosis-running" || record.diagnosisAttempts.at(-1)?.actionId !== actionId)
    throw new Error("Gate diagnosis ownership changed before observation")
  const finished = {
    ...record.diagnosisAttempts.at(-1),
    finishedAt: wallClockTimestamp(),
    outcome: expectationMatched ? "observed" : "inconclusive",
    actualOutcome,
    exitCode: result?.exitCode ?? failure?.exitCode ?? null,
    log: { path: logPath, sha256: digest(output), bytes: Buffer.byteLength(output) }
  }
  atomicRecord(gateRecoveryPath(location), {
    ...record,
    state: expectationMatched ? "repair-required" : "diagnosis-required",
    diagnosisRunId: undefined,
    nextAction: expectationMatched ? "repair-observed-cause" : "change-diagnostic-experiment",
    diagnosisAttempts: [...record.diagnosisAttempts.slice(0, -1), finished]
  })
})
if (!expectationMatched) {
  console.error(`Focused diagnosis expected ${expectedOutcome}, observed ${actualOutcome}`)
  process.exitCode = 1
} else {
  console.error(
    `[gate-recovery] diagnosis observed ${actualOutcome} supporting alternative ${supportedAlternativeIndex + 1}; repair and run pnpm gate:verify-repair ${failedRunId}`
  )
}
