// Vitest collects this JavaScript harness test without adding ambient types for the executable module under test.
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { expect, test } from "vitest"

import {
  deliveryRepeatabilityChildTimeoutMilliseconds,
  deliveryRepeatabilityDefaultIterations,
  deliveryRepeatabilityExpectedAcceptedOrderDigest,
  deliveryRepeatabilityExpectedOccurrenceCount,
  deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds,
  deliveryRepeatabilityTargetTestName,
  deliveryRepeatabilityTargetTestNamePattern,
  deliveryRepeatabilityTargetTestPath,
  runDeliveryRepeatability
} from "./run-delivery-repeatability.mjs"

const candidateSha = "0123456789abcdef0123456789abcdef01234567"

const acceptedReport = (targetName = deliveryRepeatabilityTargetTestName, skippedCount = 2) =>
  JSON.stringify({
    numFailedTestSuites: 0,
    numFailedTests: 0,
    numPendingTestSuites: 0,
    numPendingTests: skippedCount,
    numPassedTestSuites: 1,
    numPassedTests: 1,
    numTodoTests: 0,
    numTotalTestSuites: 1,
    numTotalTests: skippedCount + 1,
    success: true,
    testResults: [
      {
        assertionResults: [
          { fullName: targetName, status: "passed" },
          ...Array.from({ length: skippedCount }, (_, index) => ({
            fullName: `skipped-${index + 1}`,
            status: "skipped"
          }))
        ],
        status: "passed"
      }
    ]
  })

const fakeCommand = (reportText, calls) => async (options) => {
  calls.push(options)
  const outputFile = options.args[options.args.indexOf("--outputFile") + 1]
  await writeFile(outputFile, reportText)
  return { exitCode: 0, output: "fake child diagnostic\n", outputLineCount: 1 }
}

test("runs injected iterations sequentially and removes its exact result directory", async () => {
  const calls = []
  const progress = []
  const result = await runDeliveryRepeatability({
    iterations: 2,
    onIteration: (record) => progress.push(record),
    resolveCandidateTree: async () => "",
    resolveCandidateSha: async () => candidateSha,
    runCommand: fakeCommand(acceptedReport(), calls)
  })

  expect(calls).toHaveLength(2)
  expect(progress).toHaveLength(2)
  expect(progress.map(({ iteration, status }) => ({ iteration, status }))).toEqual([
    { iteration: 1, status: "PASS" },
    { iteration: 2, status: "PASS" }
  ])
  expect(result.occurrenceCount).toBe(deliveryRepeatabilityExpectedOccurrenceCount)
  expect(result.acceptedOrderDigest).toBe(deliveryRepeatabilityExpectedAcceptedOrderDigest)
  expect(result.candidateSha).toBe(candidateSha)
  expect(progress[0]?.candidateSha).toBe(candidateSha)
  expect(calls[0]?.timeoutMilliseconds).toBe(deliveryRepeatabilityChildTimeoutMilliseconds)
  expect(calls[0]?.acceptedExitCodes).toEqual([0, 1])
  expect(calls[0]?.captureOutput).toBe(true)
  expect(calls[0]?.forwardOutput).toBe(true)
  expect(calls[0]?.processGroupAbsenceTimeoutMilliseconds).toBe(
    deliveryRepeatabilityProcessGroupAbsenceTimeoutMilliseconds
  )
  expect(calls[0]?.relayParentSignals).toBe(true)
  const outputIndex = calls[0]?.args.indexOf("--outputFile")
  expect(typeof outputIndex).toBe("number")
  expect(calls[0]?.args.slice(outputIndex - 8, outputIndex)).toEqual([
    "--silent",
    "exec",
    "vitest",
    "run",
    deliveryRepeatabilityTargetTestPath,
    "-t",
    deliveryRepeatabilityTargetTestNamePattern,
    "--reporter=json"
  ])
  expect(calls[0]?.args.at(-1)).not.toBe(calls[1]?.args.at(-1))
  expect(existsSync(dirname(calls[0].args.at(-1)))).toBe(false)
})

test("stops at the first invalid child report and removes its exact result directory", async () => {
  const calls = []
  await expect(
    runDeliveryRepeatability({
      iterations: 3,
      onIteration: () => expect.fail("an invalid first report must not be recorded as a pass"),
      resolveCandidateTree: async () => "",
      resolveCandidateSha: async () => candidateSha,
      runCommand: fakeCommand(acceptedReport("wrong target"), calls)
    })
  ).rejects.toThrow(/iteration 1 result was invalid.*exact target/u)

  expect(calls).toHaveLength(1)
  expect(existsSync(dirname(calls[0].args.at(-1)))).toBe(false)
})

test("rejects a zero iteration request before creating a child", async () => {
  let invoked = false
  await expect(
    runDeliveryRepeatability({
      iterations: 0,
      resolveCandidateSha: async () => candidateSha,
      runCommand: async () => {
        invoked = true
        throw new Error("must not launch")
      }
    })
  ).rejects.toThrow(/iterations must be a positive integer/u)
  expect(invoked).toBe(false)
  expect(deliveryRepeatabilityDefaultIterations).toBe(20)
})

test("preserves the structured target failure and mismatch position on child exit 1", async () => {
  const calls = []
  const failingReport = JSON.stringify({
    numFailedTestSuites: 1,
    numFailedTests: 1,
    numPendingTestSuites: 0,
    numPendingTests: 2,
    numPassedTestSuites: 0,
    numPassedTests: 0,
    numTodoTests: 0,
    numTotalTestSuites: 1,
    numTotalTests: 3,
    success: false,
    testResults: [
      {
        assertionResults: [
          {
            failureMessages: ["expected O001 but received O002 at position 17"],
            fullName: deliveryRepeatabilityTargetTestName,
            status: "failed"
          },
          ...Array.from({ length: 2 }, (_, index) => ({ fullName: `skipped-${index + 1}`, status: "skipped" }))
        ],
        status: "failed"
      }
    ]
  })
  await expect(
    runDeliveryRepeatability({
      iterations: 2,
      resolveCandidateTree: async () => "",
      resolveCandidateSha: async () => candidateSha,
      runCommand: async (options) => {
        calls.push(options)
        await writeFile(options.args[options.args.indexOf("--outputFile") + 1], failingReport)
        return { exitCode: 1, output: "structured child failure\n", outputLineCount: 1 }
      }
    })
  ).rejects.toThrow(
    /iteration 1 reported an assertion failure: target 'emits the exact DS01 through DS13 delivery checkpoint table' failed firstMismatch=O017: expected O001 but received O002 at position 17/u
  )
  expect(calls).toHaveLength(1)
})

test("rejects a candidate HEAD change before the next iteration", async () => {
  const calls = []
  const candidates = [candidateSha, "fedcba9876543210fedcba9876543210fedcba98"]
  await expect(
    runDeliveryRepeatability({
      iterations: 2,
      onIteration: () => undefined,
      resolveCandidateTree: async () => "",
      resolveCandidateSha: async () => candidates.shift(),
      runCommand: fakeCommand(acceptedReport(), calls)
    })
  ).rejects.toThrow(/candidate HEAD changed before iteration 2/u)
  expect(calls).toHaveLength(1)
})

test("rejects a dirty candidate tree before the first iteration", async () => {
  const calls = []
  await expect(
    runDeliveryRepeatability({
      iterations: 2,
      resolveCandidateSha: async () => candidateSha,
      resolveCandidateTree: async () => "?? untracked.txt",
      runCommand: fakeCommand(acceptedReport(), calls)
    })
  ).rejects.toThrow(/candidate tree was not clean before iteration 1: \?\? untracked\.txt/u)
  expect(calls).toHaveLength(0)
})

test("rejects a candidate tree change before the next iteration", async () => {
  const calls = []
  const trees = ["", " M tracked.ts"]
  await expect(
    runDeliveryRepeatability({
      iterations: 2,
      onIteration: () => undefined,
      resolveCandidateSha: async () => candidateSha,
      resolveCandidateTree: async () => trees.shift(),
      runCommand: fakeCommand(acceptedReport(), calls)
    })
  ).rejects.toThrow(/candidate tree was not clean before iteration 2:  M tracked\.ts/u)
  expect(calls).toHaveLength(1)
})

test("rejects a candidate HEAD change after the final iteration", async () => {
  const calls = []
  const candidates = [candidateSha, "fedcba9876543210fedcba9876543210fedcba98"]
  await expect(
    runDeliveryRepeatability({
      iterations: 1,
      onIteration: () => undefined,
      resolveCandidateTree: async () => "",
      resolveCandidateSha: async () => candidates.shift(),
      runCommand: fakeCommand(acceptedReport(), calls)
    })
  ).rejects.toThrow(/candidate HEAD changed after final iteration/u)
  expect(calls).toHaveLength(1)
  expect(existsSync(dirname(calls[0].args.at(-1)))).toBe(false)
})
