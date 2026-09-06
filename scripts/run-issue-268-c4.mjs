import { performance } from "node:perf_hooks"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { runBoundedCommand } from "./run-bounded-command.mjs"

export const issue268C4TestPath = "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
export const issue268C4TestName = "emits the exact DS01 through DS13 delivery checkpoint table"
export const issue268C4TestNamePattern = `^${issue268C4TestName}$`
export const issue268C4ExpectedOccurrenceCount = 1_014
export const issue268C4ExpectedAcceptedOrderDigest = "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d"
export const issue268C4DefaultIterations = 20
export const issue268C4ChildTimeoutMilliseconds = 45_000
export const issue268C4TerminationGraceMilliseconds = 5_000
export const issue268C4ProcessGroupAbsenceTimeoutMilliseconds = 2_000

const resultFilePrefix = "vitest-result-"

const isRecord = (value) => typeof value === "object" && value !== null

const expectedNumber = (report, field, expected) => {
  if (report[field] !== expected) {
    throw new Error(`expected ${field}=${expected}, received ${String(report[field])}`)
  }
}

const parseVitestReport = (reportText) => {
  let report
  try {
    report = JSON.parse(reportText)
  } catch (error) {
    throw new Error(`Vitest JSON report was not valid JSON: ${String(error)}`)
  }
  if (!isRecord(report)) throw new Error("Vitest JSON report was not an object")
  return report
}

const targetResult = (report) => {
  const suite = report.testResults?.[0]
  if (!isRecord(suite) || !Array.isArray(suite.assertionResults)) return undefined
  const results = suite.assertionResults.filter((result) => isRecord(result) && result.fullName === issue268C4TestName)
  return results.length === 1 ? results[0] : undefined
}

const validateVitestReport = (report) => {
  expectedNumber(report, "numTotalTestSuites", 1)
  expectedNumber(report, "numPassedTestSuites", 1)
  expectedNumber(report, "numFailedTestSuites", 0)
  expectedNumber(report, "numPendingTestSuites", 0)
  if (!Array.isArray(report.testResults) || report.testResults.length !== 1) {
    throw new Error("Vitest JSON report did not contain exactly one test suite")
  }

  const suite = report.testResults[0]
  if (!isRecord(suite) || suite.status !== "passed") {
    throw new Error("Vitest JSON report did not contain one passed test suite")
  }
  if (!Array.isArray(suite.assertionResults) || suite.assertionResults.length === 0) {
    throw new Error("Vitest JSON report did not contain any test results")
  }

  const targetResults = suite.assertionResults.filter(
    (result) => isRecord(result) && result.fullName === issue268C4TestName
  )
  if (targetResults.length !== 1 || targetResults[0]?.status !== "passed") {
    throw new Error(`Vitest JSON report did not pass the exact target '${issue268C4TestName}'`)
  }

  const otherResults = suite.assertionResults.filter((result) => result !== targetResults[0])
  if (!otherResults.every((result) => isRecord(result) && result.status === "skipped")) {
    throw new Error("Vitest JSON report contained a non-target result that was not skipped")
  }

  const skippedCount = otherResults.length
  expectedNumber(report, "numTotalTests", suite.assertionResults.length)
  expectedNumber(report, "numPassedTests", 1)
  expectedNumber(report, "numFailedTests", 0)
  expectedNumber(report, "numPendingTests", skippedCount)
  expectedNumber(report, "numTodoTests", 0)
  if (report.success !== true) throw new Error("Vitest JSON report did not have success=true")
  const failedResults = suite.assertionResults.filter((result) => isRecord(result) && result.status === "failed")
  if (failedResults.length !== 0) {
    throw new Error(
      `Vitest JSON contained ${failedResults.length} failed assertion result${failedResults.length === 1 ? "" : "s"}`
    )
  }

  return {
    occurrenceCount: issue268C4ExpectedOccurrenceCount,
    acceptedOrderDigest: issue268C4ExpectedAcceptedOrderDigest
  }
}

const formatMismatchPosition = (value) => `O${String(value).padStart(3, "0")}`

const firstMismatchPosition = (messages) => {
  const text = messages.join(" ")
  const positionMatch = text.match(/\bposition\b["']?\s*[:=]\s*(\d+)\b|\bposition\b\s+(\d+)\b/iu)
  const position = positionMatch?.[1] ?? positionMatch?.[2]
  if (position !== undefined) return formatMismatchPosition(Number(position))
  const occurrence = text.match(/\bO(\d{3,})\b/u)?.[1]
  return occurrence === undefined ? undefined : formatMismatchPosition(Number(occurrence))
}

const formatAssertionFailure = (report) => {
  const failure = targetResult(report)
  const messages = Array.isArray(failure?.failureMessages)
    ? failure.failureMessages.filter((message) => typeof message === "string")
    : []
  const position = firstMismatchPosition(messages)
  const positionText = position === undefined ? "" : ` firstMismatch=${position}`
  const messageText = messages.length === 0 ? "no target failure message" : messages.join(" | ").replace(/\s+/gu, " ")
  return `target '${issue268C4TestName}' failed${positionText}: ${messageText}`
}

const pnpmInvocation = (entryPoint) =>
  entryPoint === undefined
    ? { argsPrefix: [], executable: "pnpm" }
    : { argsPrefix: [entryPoint], executable: process.execPath }

const childArguments = (outputFile) => [
  "--silent",
  "exec",
  "vitest",
  "run",
  issue268C4TestPath,
  "-t",
  issue268C4TestNamePattern,
  "--reporter=json",
  "--outputFile",
  outputFile
]

const defaultProgressReporter = ({
  acceptedOrderDigest,
  candidateSha,
  elapsedMilliseconds,
  iteration,
  iterations,
  occurrenceCount
}) => {
  process.stdout.write(
    `C4 iteration ${iteration}/${iterations} PASS elapsedMs=${elapsedMilliseconds} ` +
      `occurrenceCount=${occurrenceCount} acceptedOrderDigest=${acceptedOrderDigest} candidateSha=${candidateSha}\n`
  )
}

const errorMessage = (error) => (error instanceof Error ? error.message : String(error))

const defaultCandidateShaResolver = async ({
  processGroupAbsenceTimeoutMilliseconds,
  terminationGraceMilliseconds,
  timeoutMilliseconds
}) => {
  const result = await runBoundedCommand({
    acceptedExitCodes: [0],
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
    captureOutput: true,
    executable: "git",
    forwardOutput: false,
    name: "Issue 268 C4 candidate HEAD lookup",
    processGroupAbsenceTimeoutMilliseconds,
    relayParentSignals: true,
    terminationGraceMilliseconds,
    timeoutMilliseconds
  })
  const candidateSha = result.output.trim()
  if (!/^[0-9a-f]{40,64}$/u.test(candidateSha)) {
    throw new Error(`git returned an invalid candidate HEAD SHA: ${candidateSha || "<empty>"}`)
  }
  return candidateSha
}

const defaultCandidateTreeResolver = async ({
  processGroupAbsenceTimeoutMilliseconds,
  terminationGraceMilliseconds,
  timeoutMilliseconds
}) => {
  const result = await runBoundedCommand({
    acceptedExitCodes: [0],
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    captureOutput: true,
    executable: "git",
    forwardOutput: false,
    name: "Issue 268 C4 candidate tree lookup",
    processGroupAbsenceTimeoutMilliseconds,
    relayParentSignals: true,
    terminationGraceMilliseconds,
    timeoutMilliseconds
  })
  return result.output.trimEnd()
}

/**
 * Runs the accepted DS01-DS13 table in fresh Vitest processes sequentially.
 * `iterations` and `runCommand` are injectable so the orchestration can be
 * tested without running the twenty-run C4 gate.
 */
export const runIssue268C4 = async (options = {}) => {
  const iterations = options.iterations ?? issue268C4DefaultIterations
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error(`issue 268 C4 iterations must be a positive integer, received ${String(iterations)}`)
  }

  const childTimeoutMilliseconds = options.childTimeoutMilliseconds ?? issue268C4ChildTimeoutMilliseconds
  if (!Number.isInteger(childTimeoutMilliseconds) || childTimeoutMilliseconds <= 0) {
    throw new Error(
      `issue 268 C4 child timeout must be a positive integer, received ${String(childTimeoutMilliseconds)}`
    )
  }
  const terminationGraceMilliseconds = options.terminationGraceMilliseconds ?? issue268C4TerminationGraceMilliseconds
  if (!Number.isInteger(terminationGraceMilliseconds) || terminationGraceMilliseconds <= 0) {
    throw new Error(
      `issue 268 C4 termination grace must be a positive integer, received ${String(terminationGraceMilliseconds)}`
    )
  }
  const processGroupAbsenceTimeoutMilliseconds =
    options.processGroupAbsenceTimeoutMilliseconds ?? issue268C4ProcessGroupAbsenceTimeoutMilliseconds
  if (!Number.isInteger(processGroupAbsenceTimeoutMilliseconds) || processGroupAbsenceTimeoutMilliseconds <= 0) {
    throw new Error(
      "issue 268 C4 process-group absence timeout must be a positive integer, received " +
        String(processGroupAbsenceTimeoutMilliseconds)
    )
  }
  const totalTimeoutMilliseconds =
    options.totalTimeoutMilliseconds ??
    iterations * (childTimeoutMilliseconds + terminationGraceMilliseconds + processGroupAbsenceTimeoutMilliseconds)
  if (!Number.isInteger(totalTimeoutMilliseconds) || totalTimeoutMilliseconds <= 0) {
    throw new Error(
      `issue 268 C4 total timeout must be a positive integer, received ${String(totalTimeoutMilliseconds)}`
    )
  }

  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  const deadline = startedAt + totalTimeoutMilliseconds
  const command = options.runCommand ?? runBoundedCommand
  const progress = options.onIteration ?? defaultProgressReporter
  const resolveCandidateSha = options.resolveCandidateSha ?? defaultCandidateShaResolver
  const resolveCandidateTree = options.resolveCandidateTree ?? defaultCandidateTreeResolver
  if (typeof resolveCandidateSha !== "function")
    throw new Error("issue 268 C4 candidate SHA resolver must be a function")
  if (typeof resolveCandidateTree !== "function")
    throw new Error("issue 268 C4 candidate tree resolver must be a function")
  const invocation = pnpmInvocation(options.pnpmEntryPoint ?? process.env.npm_execpath)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dalph-issue-268-c4-"))
  const completed = []
  let candidateSha

  const boundedTimeout = (phase) => {
    const remainingMilliseconds = deadline - now()
    const timeout = Math.min(
      childTimeoutMilliseconds,
      Math.floor(remainingMilliseconds - terminationGraceMilliseconds - processGroupAbsenceTimeoutMilliseconds)
    )
    if (timeout <= 0) throw new Error(`issue 268 C4 absolute deadline expired ${phase}`)
    return timeout
  }

  const readCandidateSha = async (phase) => {
    const timeoutMilliseconds = boundedTimeout(phase)
    let resolved
    try {
      resolved = await resolveCandidateSha({
        phase,
        processGroupAbsenceTimeoutMilliseconds,
        terminationGraceMilliseconds,
        timeoutMilliseconds
      })
    } catch (error) {
      throw new Error(`issue 268 C4 candidate HEAD lookup failed ${phase}: ${errorMessage(error)}`)
    }
    if (typeof resolved !== "string" || !/^[0-9a-f]{40,64}$/u.test(resolved)) {
      throw new Error(`issue 268 C4 candidate HEAD lookup returned an invalid SHA: ${String(resolved)}`)
    }
    if (now() > deadline) throw new Error(`issue 268 C4 absolute deadline expired ${phase}`)
    return resolved
  }

  const readCandidateTree = async (phase) => {
    const timeoutMilliseconds = boundedTimeout(phase)
    let resolved
    try {
      resolved = await resolveCandidateTree({
        phase,
        processGroupAbsenceTimeoutMilliseconds,
        terminationGraceMilliseconds,
        timeoutMilliseconds
      })
    } catch (error) {
      throw new Error(`issue 268 C4 candidate tree lookup failed ${phase}: ${errorMessage(error)}`)
    }
    if (typeof resolved !== "string") {
      throw new Error(`issue 268 C4 candidate tree lookup returned an invalid status: ${String(resolved)}`)
    }
    if (now() > deadline) throw new Error(`issue 268 C4 absolute deadline expired ${phase}`)
    return resolved.trimEnd()
  }

  const requireCleanCandidateTree = (status, phase) => {
    if (status !== "") {
      throw new Error(`issue 268 C4 candidate tree was not clean ${phase}: ${status}`)
    }
  }

  const requireSameCandidateSha = (observed, phase) => {
    if (candidateSha !== observed) {
      throw new Error(`issue 268 C4 candidate HEAD changed ${phase}: expected ${candidateSha}, received ${observed}`)
    }
  }

  try {
    candidateSha = await readCandidateSha("before iteration 1")
    const initialCandidateTree = await readCandidateTree("before iteration 1")
    requireCleanCandidateTree(initialCandidateTree, "before iteration 1")
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      if (iteration > 1) {
        const observedCandidateSha = await readCandidateSha(`before iteration ${iteration}`)
        requireSameCandidateSha(observedCandidateSha, `before iteration ${iteration}`)
        const observedCandidateTree = await readCandidateTree(`before iteration ${iteration}`)
        requireCleanCandidateTree(observedCandidateTree, `before iteration ${iteration}`)
      }
      const boundedChildTimeout = boundedTimeout(`before iteration ${iteration}`)
      const outputFile = join(temporaryDirectory, `${resultFilePrefix}${iteration}.json`)
      const iterationStartedAt = now()
      let commandResult
      try {
        commandResult = await command({
          acceptedExitCodes: [0, 1],
          args: [...invocation.argsPrefix, ...childArguments(outputFile)],
          captureOutput: true,
          executable: invocation.executable,
          forwardOutput: true,
          name: `Issue 268 C4 iteration ${iteration}`,
          processGroupAbsenceTimeoutMilliseconds,
          relayParentSignals: true,
          terminationGraceMilliseconds,
          timeoutMilliseconds: boundedChildTimeout
        })
      } catch (error) {
        throw new Error(`issue 268 C4 iteration ${iteration} failed: ${errorMessage(error)}`)
      }
      if (!isRecord(commandResult) || ![0, 1].includes(commandResult.exitCode)) {
        throw new Error(`issue 268 C4 iteration ${iteration} returned a nonzero child status`)
      }

      let reportText
      try {
        reportText = await readFile(outputFile, "utf8")
      } catch (error) {
        throw new Error(`issue 268 C4 iteration ${iteration} result file could not be read: ${errorMessage(error)}`)
      }
      let report
      try {
        report = parseVitestReport(reportText)
      } catch (error) {
        throw new Error(`issue 268 C4 iteration ${iteration} result was invalid: ${errorMessage(error)}`)
      }
      if (commandResult.exitCode === 1) {
        throw new Error(
          `issue 268 C4 iteration ${iteration} reported an assertion failure: ${formatAssertionFailure(report)}`
        )
      }
      let record
      try {
        record = validateVitestReport(report)
      } catch (error) {
        throw new Error(`issue 268 C4 iteration ${iteration} result was invalid: ${errorMessage(error)}`)
      }
      if (now() > deadline) throw new Error(`issue 268 C4 absolute deadline expired after iteration ${iteration}`)

      const iterationResult = {
        ...record,
        candidateSha,
        elapsedMilliseconds: Number((now() - iterationStartedAt).toFixed(2)),
        iteration,
        iterations,
        status: "PASS"
      }
      completed.push(iterationResult)
      progress(iterationResult)
    }
    const finalCandidateSha = await readCandidateSha("after final iteration")
    requireSameCandidateSha(finalCandidateSha, "after final iteration")
    const finalCandidateTree = await readCandidateTree("after final iteration")
    requireCleanCandidateTree(finalCandidateTree, "after final iteration")
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }

  return {
    acceptedOrderDigest: issue268C4ExpectedAcceptedOrderDigest,
    candidateSha,
    elapsedMilliseconds: Number((now() - startedAt).toFixed(2)),
    iterations: completed,
    occurrenceCount: issue268C4ExpectedOccurrenceCount
  }
}

const isMainModule = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMainModule) {
  runIssue268C4().then(
    ({ acceptedOrderDigest, candidateSha, elapsedMilliseconds, iterations, occurrenceCount }) => {
      process.stdout.write(
        `C4 complete ${iterations.length}/${issue268C4DefaultIterations} ` +
          `elapsedMs=${elapsedMilliseconds} occurrenceCount=${occurrenceCount} ` +
          `acceptedOrderDigest=${acceptedOrderDigest} candidateSha=${candidateSha}\n`
      )
    },
    (error) => {
      process.stderr.write(`issue 268 C4 failed: ${errorMessage(error)}\n`)
      process.exitCode = 1
    }
  )
}
