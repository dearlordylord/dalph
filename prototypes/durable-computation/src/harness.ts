import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { Schema } from "effect"
import {
  ChildMessage,
  type FaultPoint,
  type ScenarioRequest,
  type ScenarioResult,
  fixture
} from "./contracts.ts"
import {
  initializeOutsideWorld,
  loadProviderCalls,
  moveTaskOutsideTargetDuringDowntime,
  reopenApplicationAdmission
} from "./controlled-world.ts"
import { projectCanonicalTrace } from "./semantic-trace.ts"

interface RunningChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly messages: AsyncIterable<ChildMessage>
  readonly stderr: ReadonlyArray<string>
}

export class CandidateRecoveryTimedOut extends Error {
  readonly _tag = "CandidateRecoveryTimedOut"
}

const recoveryLimitMilliseconds = 2_500

const childPath = join(dirname(fileURLToPath(import.meta.url)), "child.ts")

const startChild = (request: ScenarioRequest, workspace: string, processInstance: string): RunningChild => {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      childPath,
      "--adapter",
      request.adapter,
      "--fault-point",
      request.faultPoint,
      "--process-instance",
      processInstance,
      "--run-id",
      fixture.runId,
      "--workspace",
      workspace
    ]
  )
  const stderr: Array<string> = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => stderr.push(chunk))
  const lines = createInterface({ input: child.stdout })
  const messages = (async function* (): AsyncIterable<ChildMessage> {
    for await (const line of lines) {
      yield Schema.decodeUnknownSync(ChildMessage)(JSON.parse(line))
    }
  })()
  return { child, messages, stderr }
}

const childExit = (running: RunningChild): Promise<number | null> =>
  new Promise((resolve, reject) => {
    running.child.once("error", reject)
    running.child.once("exit", (code) => resolve(code))
  })

const waitForFault = async (running: RunningChild, expected: FaultPoint, executionIds: Set<string>): Promise<void> => {
  for await (const message of running.messages) {
    if (message._tag === "ChildReady") executionIds.add(message.runId)
    if (message._tag === "ChildProtocolFailure") throw new Error(message.detail)
    if (message._tag === "FaultReached") {
      if (message.faultPoint !== expected) throw new Error(`expected ${expected}, reached ${message.faultPoint}`)
      return
    }
  }
  throw new Error(`child exited before fault ${expected}: ${running.stderr.join("")}`)
}

const waitForCompletion = async (
  running: RunningChild,
  executionIds: Set<string>
): Promise<ScenarioResult["recoveredDecision"]> => {
  for await (const message of running.messages) {
    if (message._tag === "ChildReady") executionIds.add(message.runId)
    if (message._tag === "ChildProtocolFailure") throw new Error(message.detail)
    if (message._tag === "ExecutionFailedClosed") return "FailClosed"
    if (message._tag === "ExecutionCompleted") return message.recoveredDecision
  }
  throw new Error(`child exited before completion: ${running.stderr.join("")}`)
}

export const runCrashRestartScenario = async (request: ScenarioRequest): Promise<ScenarioResult> => {
  const workspace = await mkdtemp(join(tmpdir(), "dalph-232-ambiguity-"))
  const executionIds = new Set<string>()
  try {
    await initializeOutsideWorld(workspace)
    const first = startChild(request, workspace, "process-1")
    const firstExit = childExit(first)
    await waitForFault(first, request.faultPoint, executionIds)
    first.child.kill("SIGKILL")
    await firstExit
    if (request.faultPoint === "AfterCleanCheckpoint") {
      await moveTaskOutsideTargetDuringDowntime(workspace)
    }
    if (request.faultPoint === "AfterExitCutoff") {
      await reopenApplicationAdmission(workspace)
    }

    const restartRequest: ScenarioRequest =
      request.faultPoint === "WithIncompatibleExecutionCode"
        ? { ...request, adapter: "effect-workflow-v2" }
        : request
    const second = startChild(restartRequest, workspace, "process-2")
    const secondExit = childExit(second)
    let recoveryTimedOut = false
    const recoveryTimer = setTimeout(() => {
      recoveryTimedOut = true
      second.child.kill("SIGKILL")
    }, recoveryLimitMilliseconds)
    const recoveredDecision = await waitForCompletion(second, executionIds).catch((cause: unknown) => {
      if (recoveryTimedOut) {
        throw new CandidateRecoveryTimedOut(
          `candidate made no recoverable progress within ${recoveryLimitMilliseconds}ms after restart`
        )
      }
      throw cause
    })
    clearTimeout(recoveryTimer)
    const exitCode = await secondExit
    if (exitCode !== 0) throw new Error(`successor child exited ${exitCode}: ${second.stderr.join("")}`)

    const providerCalls = await loadProviderCalls(workspace)
    return {
      canonicalTrace: projectCanonicalTrace(workspace, request.adapter, providerCalls, recoveredDecision),
      executionIds: [...executionIds],
      providerCalls,
      recoveredDecision
    }
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}
