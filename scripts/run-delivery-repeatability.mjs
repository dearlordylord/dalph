import { performance } from "node:perf_hooks"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { runBoundedCommand } from "./run-bounded-command.mjs"

export const deliveryRepeatabilityTargetTestPath =
  "packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts"
export const deliveryRepeatabilityTargetTestName = "emits the exact DS01 through DS13 delivery checkpoint table"
export const deliveryRepeatabilityTargetTestNamePattern = `^${deliveryRepeatabilityTargetTestName}$`
export const deliveryRepeatabilityExpectedOccurrenceCount = 1_010
export const deliveryRepeatabilityExpectedAcceptedOrderDigest =
  "6df6b575b41d4ea07d3ac083725cd54b0ddf29fb925936dfd7f1c85a5d90b5c8"
export const deliveryRepeatabilityModes = Object.freeze(["fresh", "warm"])
export const deliveryRepeatabilityDefaultMode = "fresh"
export const deliveryRepeatabilityDefaultIterations = 20
export const deliveryRepeatabilityWarmDefaultIterations = 20
export const deliveryRepeatabilityFreshSampleIterations = 3
export const deliveryRepeatabilityChildTimeoutMilliseconds = 45_000
export const deliveryRepeatabilityTerminationGraceMilliseconds = 5_000
export const deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds = 2_000

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
  const results = suite.assertionResults.filter(
    (result) => isRecord(result) && result.fullName === deliveryRepeatabilityTargetTestName
  )
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
    (result) => isRecord(result) && result.fullName === deliveryRepeatabilityTargetTestName
  )
  if (targetResults.length !== 1 || targetResults[0]?.status !== "passed") {
    throw new Error(`Vitest JSON report did not pass the exact target '${deliveryRepeatabilityTargetTestName}'`)
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
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest
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
  return `target '${deliveryRepeatabilityTargetTestName}' failed${positionText}: ${messageText}`
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
  deliveryRepeatabilityTargetTestPath,
  "-t",
  deliveryRepeatabilityTargetTestNamePattern,
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
    `delivery repeatability iteration ${iteration}/${iterations} PASS elapsedMs=${elapsedMilliseconds} ` +
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
    name: "delivery repeatability candidate HEAD lookup",
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
    name: "delivery repeatability candidate tree lookup",
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
 * tested without running the twenty-run delivery repeatability gate.
 */
export const runFreshDeliveryTarget = async (options = {}) => {
  const iterations = options.iterations ?? deliveryRepeatabilityDefaultIterations
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error(`delivery repeatability iterations must be a positive integer, received ${String(iterations)}`)
  }

  const childTimeoutMilliseconds = options.childTimeoutMilliseconds ?? deliveryRepeatabilityChildTimeoutMilliseconds
  if (!Number.isInteger(childTimeoutMilliseconds) || childTimeoutMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability child timeout must be a positive integer, received ${String(childTimeoutMilliseconds)}`
    )
  }
  const terminationGraceMilliseconds =
    options.terminationGraceMilliseconds ?? deliveryRepeatabilityTerminationGraceMilliseconds
  if (!Number.isInteger(terminationGraceMilliseconds) || terminationGraceMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability termination grace must be a positive integer, received ${String(terminationGraceMilliseconds)}`
    )
  }
  const processGroupAbsenceTimeoutMilliseconds =
    options.processGroupAbsenceTimeoutMilliseconds ?? deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds
  if (!Number.isInteger(processGroupAbsenceTimeoutMilliseconds) || processGroupAbsenceTimeoutMilliseconds <= 0) {
    throw new Error(
      "delivery repeatability process-group absence timeout must be a positive integer, received " +
        String(processGroupAbsenceTimeoutMilliseconds)
    )
  }
  const totalTimeoutMilliseconds =
    options.totalTimeoutMilliseconds ??
    iterations * (childTimeoutMilliseconds + terminationGraceMilliseconds + processGroupAbsenceTimeoutMilliseconds)
  if (!Number.isInteger(totalTimeoutMilliseconds) || totalTimeoutMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability total timeout must be a positive integer, received ${String(totalTimeoutMilliseconds)}`
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
    throw new Error("delivery repeatability candidate SHA resolver must be a function")
  if (typeof resolveCandidateTree !== "function")
    throw new Error("delivery repeatability candidate tree resolver must be a function")
  const invocation = pnpmInvocation(options.pnpmEntryPoint ?? process.env.npm_execpath)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dalph-delivery-repeatability-"))
  const completed = []
  let candidateSha

  const boundedTimeout = (phase) => {
    const remainingMilliseconds = deadline - now()
    const timeout = Math.min(
      childTimeoutMilliseconds,
      Math.floor(remainingMilliseconds - terminationGraceMilliseconds - processGroupAbsenceTimeoutMilliseconds)
    )
    if (timeout <= 0) throw new Error(`delivery repeatability absolute deadline expired ${phase}`)
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
      throw new Error(`delivery repeatability candidate HEAD lookup failed ${phase}: ${errorMessage(error)}`)
    }
    if (typeof resolved !== "string" || !/^[0-9a-f]{40,64}$/u.test(resolved)) {
      throw new Error(`delivery repeatability candidate HEAD lookup returned an invalid SHA: ${String(resolved)}`)
    }
    if (now() > deadline) throw new Error(`delivery repeatability absolute deadline expired ${phase}`)
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
      throw new Error(`delivery repeatability candidate tree lookup failed ${phase}: ${errorMessage(error)}`)
    }
    if (typeof resolved !== "string") {
      throw new Error(`delivery repeatability candidate tree lookup returned an invalid status: ${String(resolved)}`)
    }
    if (now() > deadline) throw new Error(`delivery repeatability absolute deadline expired ${phase}`)
    return resolved.trimEnd()
  }

  const requireCleanCandidateTree = (status, phase) => {
    if (status !== "") {
      throw new Error(`delivery repeatability candidate tree was not clean ${phase}: ${status}`)
    }
  }

  const requireSameCandidateSha = (observed, phase) => {
    if (candidateSha !== observed) {
      throw new Error(
        `delivery repeatability candidate HEAD changed ${phase}: expected ${candidateSha}, received ${observed}`
      )
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
          name: `delivery repeatability iteration ${iteration}`,
          processGroupAbsenceTimeoutMilliseconds,
          relayParentSignals: true,
          terminationGraceMilliseconds,
          timeoutMilliseconds: boundedChildTimeout
        })
      } catch (error) {
        throw new Error(`delivery repeatability iteration ${iteration} failed: ${errorMessage(error)}`)
      }
      if (!isRecord(commandResult) || ![0, 1].includes(commandResult.exitCode)) {
        throw new Error(`delivery repeatability iteration ${iteration} returned a nonzero child status`)
      }

      let reportText
      try {
        reportText = await readFile(outputFile, "utf8")
      } catch (error) {
        throw new Error(
          `delivery repeatability iteration ${iteration} result file could not be read: ${errorMessage(error)}`
        )
      }
      let report
      try {
        report = parseVitestReport(reportText)
      } catch (error) {
        throw new Error(`delivery repeatability iteration ${iteration} result was invalid: ${errorMessage(error)}`)
      }
      if (commandResult.exitCode === 1) {
        throw new Error(
          `delivery repeatability iteration ${iteration} reported an assertion failure: ${formatAssertionFailure(report)}`
        )
      }
      let record
      try {
        record = validateVitestReport(report)
      } catch (error) {
        throw new Error(`delivery repeatability iteration ${iteration} result was invalid: ${errorMessage(error)}`)
      }
      if (now() > deadline)
        throw new Error(`delivery repeatability absolute deadline expired after iteration ${iteration}`)

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
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
    candidateSha,
    elapsedMilliseconds: Number((now() - startedAt).toFixed(2)),
    iterations: completed,
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount
  }
}

const defaultCreateVitest = async (mode, options) => {
  const { createVitest } = await import("vitest/node")
  return createVitest(mode, options)
}

const testCasesIn = (task) => {
  if (!isRecord(task)) return []
  if (task.type === "test") return [task]
  if (isRecord(task.task)) return testCasesIn(task.task)
  const nestedTasks = Array.isArray(task.tasks) ? task.tasks : Array.isArray(task.children) ? task.children : undefined
  if (nestedTasks === undefined) return []
  return nestedTasks.flatMap(testCasesIn)
}

const warmTargetTest = (testModules) => {
  if (!Array.isArray(testModules) || testModules.length !== 1) return undefined
  const testCases = testModules.flatMap(testCasesIn)
  const matches = testCases.filter(
    (test) =>
      test.name === deliveryRepeatabilityTargetTestName || test.fullTestName === deliveryRepeatabilityTargetTestName
  )
  return matches.length === 1 ? matches[0] : undefined
}

const formatWarmTargetFailure = (target) => {
  const errors = target?.result?.errors
  if (!Array.isArray(errors) || errors.length === 0) return "no target failure details"
  return errors.map(errorMessage).join(" | ").replace(/\s+/gu, " ")
}

const validateWarmRunResult = (runResult) => {
  if (!isRecord(runResult)) throw new Error("warmed Vitest run returned a non-object result")
  if (!Array.isArray(runResult.unhandledErrors) || runResult.unhandledErrors.length !== 0) {
    const errors = Array.isArray(runResult.unhandledErrors) ? runResult.unhandledErrors.map(errorMessage) : []
    throw new Error(`warmed Vitest run had unhandled errors${errors.length === 0 ? "" : `: ${errors.join(" | ")}`}`)
  }
  const target = warmTargetTest(runResult.testModules)
  if (target === undefined) {
    throw new Error(`warmed Vitest run did not contain exactly one target '${deliveryRepeatabilityTargetTestName}'`)
  }
  if (!isRecord(target.result) || target.result.state !== "pass") {
    throw new Error(`warmed target '${deliveryRepeatabilityTargetTestName}' failed: ${formatWarmTargetFailure(target)}`)
  }
  return {
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount
  }
}

/**
 * Execute the target repeatedly through one persistent Vitest runner.
 *
 * The runner is deliberately configured with one non-isolated worker: this
 * measures process-local cache reuse and is not a replacement for fresh runs.
 */
export const runWarmedDeliveryTarget = async (options = {}) => {
  const iterations = options.iterations ?? deliveryRepeatabilityWarmDefaultIterations
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error(`delivery repeatability warm iterations must be a positive integer, received ${String(iterations)}`)
  }
  const childTimeoutMilliseconds =
    options.childTimeoutMilliseconds ?? deliveryRepeatabilityChildTimeoutMilliseconds
  if (!Number.isInteger(childTimeoutMilliseconds) || childTimeoutMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability warm test timeout must be a positive integer, received ${String(childTimeoutMilliseconds)}`
    )
  }
  const createVitest = options.createVitest ?? defaultCreateVitest
  if (typeof createVitest !== "function") throw new Error("delivery repeatability Vitest factory must be a function")
  if (options.beforeIteration !== undefined && typeof options.beforeIteration !== "function") {
    throw new Error("delivery repeatability warm beforeIteration must be a function")
  }
  const beforeIteration = options.beforeIteration ?? (() => undefined)
  const onIteration = options.onIteration ?? (() => undefined)
  if (typeof onIteration !== "function") throw new Error("delivery repeatability warm onIteration must be a function")

  let vitest
  try {
    vitest = await createVitest("test", {
      fileParallelism: false,
      isolate: false,
      maxWorkers: 1,
      minWorkers: 1,
      pool: "forks",
      reporters: [],
      root: process.cwd(),
      run: true,
      silent: true,
      testNamePattern: deliveryRepeatabilityTargetTestNamePattern,
      testTimeout: childTimeoutMilliseconds,
      watch: false
    })
    if (!isRecord(vitest)) throw new Error("delivery repeatability Vitest factory returned an invalid instance")
    if (
      (typeof vitest.standalone !== "function" && typeof vitest.init !== "function") ||
      typeof vitest.getRelevantTestSpecifications !== "function"
    ) {
      throw new Error("delivery repeatability Vitest instance lacks the required run API")
    }
    if (typeof vitest.runTestSpecifications !== "function" || typeof vitest.close !== "function") {
      throw new Error("delivery repeatability Vitest instance lacks the persistent-run API")
    }

    if (typeof vitest.standalone === "function") await vitest.standalone()
    else await vitest.init()
    const specifications = await vitest.getRelevantTestSpecifications([deliveryRepeatabilityTargetTestPath])
    if (!Array.isArray(specifications) || specifications.length !== 1) {
      throw new Error(
        `delivery repeatability warm target resolution expected one file, received ${String(specifications?.length)}`
      )
    }

    const completed = []
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      await beforeIteration(iteration)
      const iterationStartedAt = performance.now()
      let runResult
      try {
        runResult = await vitest.runTestSpecifications(specifications, false)
      } catch (error) {
        throw new Error(`delivery repeatability warm iteration ${iteration} failed: ${errorMessage(error)}`)
      }
      let record
      try {
        record = validateWarmRunResult(runResult)
      } catch (error) {
        throw new Error(`delivery repeatability warm iteration ${iteration} result was invalid: ${errorMessage(error)}`)
      }
      const iterationResult = {
        ...record,
        elapsedMilliseconds: Number((performance.now() - iterationStartedAt).toFixed(2)),
        iteration,
        iterations,
        mode: "warm",
        phase: "warm",
        status: "PASS"
      }
      completed.push(iterationResult)
      await onIteration(iterationResult)
    }
    return completed
  } finally {
    if (isRecord(vitest) && typeof vitest.close === "function") await vitest.close()
  }
}

const defaultProgressReporterWithMode = ({
  acceptedOrderDigest,
  candidateSha,
  elapsedMilliseconds,
  iteration,
  iterations,
  mode,
  occurrenceCount,
  phase
}) => {
  process.stdout.write(
    `delivery repeatability ${phase ?? mode} iteration ${iteration}/${iterations} PASS ` +
      `elapsedMs=${elapsedMilliseconds} occurrenceCount=${occurrenceCount} ` +
      `acceptedOrderDigest=${acceptedOrderDigest} candidateSha=${candidateSha ?? "<unresolved>"}\n`
  )
}

const readMode = (arguments_) => {
  const modeArgument = arguments_.find((argument) => argument.startsWith("--mode="))
  const mode = modeArgument?.slice("--mode=".length) ?? process.env.DALPH_DELIVERY_REPEATABILITY_MODE ?? "fresh"
  if (!deliveryRepeatabilityModes.includes(mode)) {
    throw new Error(
      `delivery repeatability mode must be one of ${deliveryRepeatabilityModes.join(", ")}, received ${mode}`
    )
  }
  return mode
}

const candidateCheckOptions = (options, timeoutMilliseconds) => ({
  processGroupAbsenceTimeoutMilliseconds:
    options.processGroupAbsenceTimeoutMilliseconds ?? deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds,
  relayParentSignals: true,
  terminationGraceMilliseconds:
    options.terminationGraceMilliseconds ?? deliveryRepeatabilityTerminationGraceMilliseconds,
  timeoutMilliseconds
})

/**
 * Run the existing fresh-process qualification or the explicit warmed mode.
 * Warm mode always follows its warm iterations with a smaller fresh sample.
 */
export const runDeliveryRepeatability = async (options = {}) => {
  const mode = options.mode ?? deliveryRepeatabilityDefaultMode
  if (!deliveryRepeatabilityModes.includes(mode)) {
    throw new Error(
      `delivery repeatability mode must be one of ${deliveryRepeatabilityModes.join(", ")}, received ${mode}`
    )
  }
  const progress = options.onIteration ?? defaultProgressReporterWithMode
  if (typeof progress !== "function") throw new Error("delivery repeatability onIteration must be a function")
  const freshRunner = options.runFreshTarget ?? runFreshDeliveryTarget
  if (typeof freshRunner !== "function") throw new Error("delivery repeatability fresh runner must be a function")

  if (mode === "fresh") {
    const result = await freshRunner({
      ...options,
      iterations: options.iterations ?? deliveryRepeatabilityDefaultIterations,
      onIteration: (record) => progress({ ...record, mode: "fresh", phase: "fresh" })
    })
    return {
      ...result,
      mode: "fresh",
      iterations: result.iterations.map((record) => ({ ...record, mode: "fresh", phase: "fresh" }))
    }
  }

  const warmIterations = options.iterations ?? deliveryRepeatabilityWarmDefaultIterations
  if (!Number.isInteger(warmIterations) || warmIterations <= 0) {
    throw new Error(
      `delivery repeatability warm iterations must be a positive integer, received ${String(warmIterations)}`
    )
  }
  const freshSampleIterations = options.freshSampleIterations ?? deliveryRepeatabilityFreshSampleIterations
  if (!Number.isInteger(freshSampleIterations) || freshSampleIterations <= 0) {
    throw new Error(
      `delivery repeatability fresh sample iterations must be a positive integer, received ${String(freshSampleIterations)}`
    )
  }
  const childTimeoutMilliseconds =
    options.childTimeoutMilliseconds ?? deliveryRepeatabilityChildTimeoutMilliseconds
  if (!Number.isInteger(childTimeoutMilliseconds) || childTimeoutMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability child timeout must be a positive integer, received ${String(childTimeoutMilliseconds)}`
    )
  }
  const terminationGraceMilliseconds =
    options.terminationGraceMilliseconds ?? deliveryRepeatabilityTerminationGraceMilliseconds
  if (!Number.isInteger(terminationGraceMilliseconds) || terminationGraceMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability termination grace must be a positive integer, received ${String(terminationGraceMilliseconds)}`
    )
  }
  const processGroupAbsenceTimeoutMilliseconds =
    options.processGroupAbsenceTimeoutMilliseconds ?? deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds
  if (!Number.isInteger(processGroupAbsenceTimeoutMilliseconds) || processGroupAbsenceTimeoutMilliseconds <= 0) {
    throw new Error(
      "delivery repeatability process-group absence timeout must be a positive integer, received " +
        String(processGroupAbsenceTimeoutMilliseconds)
    )
  }
  const totalTimeoutMilliseconds =
    options.totalTimeoutMilliseconds ??
    (warmIterations + freshSampleIterations) *
      (childTimeoutMilliseconds + terminationGraceMilliseconds + processGroupAbsenceTimeoutMilliseconds)
  if (!Number.isInteger(totalTimeoutMilliseconds) || totalTimeoutMilliseconds <= 0) {
    throw new Error(
      `delivery repeatability total timeout must be a positive integer, received ${String(totalTimeoutMilliseconds)}`
    )
  }
  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  const deadline = startedAt + totalTimeoutMilliseconds
  const resolveCandidateSha = options.resolveCandidateSha ?? defaultCandidateShaResolver
  const resolveCandidateTree = options.resolveCandidateTree ?? defaultCandidateTreeResolver
  if (typeof resolveCandidateSha !== "function")
    throw new Error("delivery repeatability candidate SHA resolver must be a function")
  if (typeof resolveCandidateTree !== "function")
    throw new Error("delivery repeatability candidate tree resolver must be a function")
  const candidateTimeout = () => {
    const timeoutMilliseconds = Math.min(
      childTimeoutMilliseconds,
      Math.floor(deadline - now() - terminationGraceMilliseconds - processGroupAbsenceTimeoutMilliseconds)
    )
    if (timeoutMilliseconds <= 0) throw new Error("delivery repeatability absolute deadline expired")
    return timeoutMilliseconds
  }
  const readCandidateSha = async (phase) => {
    const resolved = await resolveCandidateSha({ ...candidateCheckOptions(options, candidateTimeout()), phase })
    if (typeof resolved !== "string" || !/^[0-9a-f]{40,64}$/u.test(resolved)) {
      throw new Error(`delivery repeatability candidate HEAD lookup returned an invalid SHA: ${String(resolved)}`)
    }
    return resolved
  }
  const readCandidateTree = async (phase) => {
    const resolved = await resolveCandidateTree({ ...candidateCheckOptions(options, candidateTimeout()), phase })
    if (typeof resolved !== "string") {
      throw new Error(`delivery repeatability candidate tree lookup returned an invalid status: ${String(resolved)}`)
    }
    return resolved.trimEnd()
  }

  const candidateTree = await readCandidateTree("before warm mode")
  if (candidateTree !== "")
    throw new Error(`delivery repeatability candidate tree was not clean before warm mode: ${candidateTree}`)
  const candidateSha = await readCandidateSha("before warm mode")
  const beforeIteration = async (iteration) => {
    if (iteration === 1) return
    const observedSha = await readCandidateSha(`before warm iteration ${iteration}`)
    if (observedSha !== candidateSha) {
      throw new Error(
        `delivery repeatability candidate HEAD changed before warm iteration ${iteration}: expected ${candidateSha}, received ${observedSha}`
      )
    }
    const observedTree = await readCandidateTree(`before warm iteration ${iteration}`)
    if (observedTree !== "") {
      throw new Error(
        `delivery repeatability candidate tree was not clean before warm iteration ${iteration}: ${observedTree}`
      )
    }
  }
  const warmRunner = options.runWarmTarget ?? runWarmedDeliveryTarget
  if (typeof warmRunner !== "function") throw new Error("delivery repeatability warm runner must be a function")
  const warmIterationsResult = await warmRunner({
    ...options,
    beforeIteration,
    childTimeoutMilliseconds,
    iterations: warmIterations,
    onIteration: (record) => progress({ ...record, mode: "warm", phase: "warm" })
  })
  if (!Array.isArray(warmIterationsResult) || warmIterationsResult.length !== warmIterations) {
    throw new Error(
      `delivery repeatability warm runner returned ${String(warmIterationsResult?.length)}, expected ${warmIterations}`
    )
  }
  if (now() > deadline) throw new Error("delivery repeatability absolute deadline expired after warm mode")
  const finalWarmSha = await readCandidateSha("after warm mode")
  if (finalWarmSha !== candidateSha) {
    throw new Error(
      `delivery repeatability candidate HEAD changed after warm mode: expected ${candidateSha}, received ${finalWarmSha}`
    )
  }
  const finalWarmTree = await readCandidateTree("after warm mode")
  if (finalWarmTree !== "")
    throw new Error(`delivery repeatability candidate tree was not clean after warm mode: ${finalWarmTree}`)

  const freshSampleTimeoutMilliseconds = Math.floor(deadline - now())
  if (freshSampleTimeoutMilliseconds <= 0) {
    throw new Error("delivery repeatability absolute deadline expired before fresh sample")
  }
  const freshResult = await freshRunner({
    ...options,
    childTimeoutMilliseconds,
    iterations: freshSampleIterations,
    totalTimeoutMilliseconds: freshSampleTimeoutMilliseconds,
    onIteration: (record) => progress({ ...record, mode: "fresh", phase: "fresh-sample" })
  })
  if (now() > deadline) throw new Error("delivery repeatability absolute deadline expired after fresh sample")
  const warmRecords = warmIterationsResult.map((record) => ({ ...record, candidateSha, mode: "warm", phase: "warm" }))
  const freshRecords = freshResult.iterations.map((record) => ({ ...record, mode: "fresh", phase: "fresh-sample" }))
  return {
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest,
    candidateSha,
    elapsedMilliseconds: Number((now() - startedAt).toFixed(2)),
    freshSample: {
      ...freshResult,
      iterations: freshRecords,
      mode: "fresh",
      requestedIterations: freshSampleIterations
    },
    iterations: warmRecords,
    mode: "warm",
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
    freshSampleIterationCount: freshRecords.length,
    warmIterationCount: warmRecords.length
  }
}

const isMainModule = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMainModule) {
  runDeliveryRepeatability({ mode: readMode(process.argv.slice(2)) }).then(
    ({ acceptedOrderDigest, candidateSha, elapsedMilliseconds, freshSample, iterations, mode, occurrenceCount }) => {
      process.stdout.write(
        `delivery repeatability complete mode=${mode} warmIterations=${iterations.length} ` +
          `freshSampleIterations=${freshSample?.iterations.length ?? 0} elapsedMs=${elapsedMilliseconds} ` +
          `occurrenceCount=${occurrenceCount} ` +
          `acceptedOrderDigest=${acceptedOrderDigest} candidateSha=${candidateSha}\n`
      )
    },
    (error) => {
      process.stderr.write(`delivery repeatability failed: ${errorMessage(error)}\n`)
      process.exitCode = 1
    }
  )
}
