import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { Schema } from "effect"
import {
  DeliveryLoopChildMessage,
  type CanonicalDeliveryLoopEvent,
  type DeliveryLoopScenarioRequest,
  type DeliveryLoopScenarioResult,
  fixture
} from "./contracts.ts"
import {
  initializeOutsideWorld,
  loadDeliveryBoundaryCalls,
  loadDeliveryProposalObservations,
  loadDeliveryPublications,
  loadProviderCalls,
  moveTaskOutsideTargetDuringDowntime
} from "./controlled-world.ts"

interface RunningChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly messages: AsyncIterable<DeliveryLoopChildMessage>
  readonly stderr: ReadonlyArray<string>
}

const childPath = join(dirname(fileURLToPath(import.meta.url)), "delivery-loop-child.ts")
const recoveryLimitMilliseconds = 8_000

const startChild = (
  request: DeliveryLoopScenarioRequest,
  workspace: string,
  processInstance: string
): RunningChild => {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    childPath,
    "--adapter",
    request.adapter,
    "--action-count",
    String(request.actionCount),
    "--activity-identity-mode",
    request.activityIdentityMode ?? "ExactOperationId",
    "--publication-mode",
    request.publicationMode ?? "Publish",
    "--process-instance",
    processInstance,
    "--workspace",
    workspace
  ])
  const stderr: Array<string> = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => stderr.push(chunk))
  const lines = createInterface({ input: child.stdout })
  const messages = (async function* (): AsyncIterable<DeliveryLoopChildMessage> {
    for await (const line of lines) {
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch (cause: unknown) {
        throw new Error(`delivery-loop child wrote non-protocol stdout: ${line}`, { cause })
      }
      yield Schema.decodeUnknownSync(DeliveryLoopChildMessage)(decoded)
    }
  })()
  return { child, messages, stderr }
}

const childExit = (running: RunningChild): Promise<number | null> =>
  new Promise((resolve, reject) => {
    running.child.once("error", reject)
    running.child.once("exit", resolve)
  })

const observeUntil = async (
  running: RunningChild,
  executionIds: Set<string>,
  expected: "Fault" | "Complete"
): Promise<void> => {
  for await (const message of running.messages) {
    if (message._tag === "DeliveryLoopProtocolFailure") throw new Error(message.detail)
    if (message._tag === "DeliveryLoopChildReady") {
      if (message.plannedBaseSha !== fixture.plannedBaseSha || message.attemptIds.length !== 0) {
        throw new Error("delivery-loop child changed immutable facts or established a task attempt")
      }
      executionIds.add(message.executionId)
    }
    if (message._tag === "DeliveryLoopFaultReached" && expected === "Fault") return
    if (message._tag === "DeliveryLoopCompleted" && expected === "Complete") return
  }
  throw new Error(`delivery-loop child exited before ${expected}: ${running.stderr.join("")}`)
}

const canonicalTraceOf = (
  publications: DeliveryLoopScenarioResult["publications"],
  proposalObservations: DeliveryLoopScenarioResult["proposalObservations"],
  providerCalls: DeliveryLoopScenarioResult["providerCalls"]
): ReadonlyArray<CanonicalDeliveryLoopEvent> => {
  const acceptedByOperation = new Map(publications.map((publication) => [publication.operationId, publication]))
  const trace: Array<CanonicalDeliveryLoopEvent> = []
  if (proposalObservations.length > 0) trace.push({ _tag: "DeliveryProposalPresent" })
  for (const publication of [...acceptedByOperation.values()].toSorted((left, right) =>
    left.operationId.localeCompare(right.operationId)
  )) {
    trace.push({
      _tag: "DeliveryActionAccepted",
      acceptedOperationId: publication.acceptedOperationId,
      operationId: publication.operationId,
      target: publication.target
    })
  }
  if (proposalObservations.includes("AbsentAfterAcceptedFactPublication")) {
    trace.push({ _tag: "DeliveryProposalAbsent" })
  }
  const currentFacts = providerCalls.findLast(({ request }) => request === "GitHub.ReadCurrentTaskFacts")
  if (currentFacts?.trackerRevision !== null && currentFacts?.trackerRevision !== undefined) {
    trace.push({
      _tag: "CurrentTaskFactsObserved",
      result: currentFacts.result,
      trackerRevision: currentFacts.trackerRevision
    })
  }
  return trace
}

export const runDeliveryLoopCrashRestartScenario = async (
  request: DeliveryLoopScenarioRequest
): Promise<DeliveryLoopScenarioResult> => {
  const workspace = await mkdtemp(join(tmpdir(), "dalph-233-delivery-loop-"))
  const executionIds = new Set<string>()
  let recoveryTimedOut = false
  try {
    await initializeOutsideWorld(workspace)
    const processCount = request.actionCount + 1
    for (let ordinal = 1; ordinal <= processCount; ordinal += 1) {
      const running = startChild(request, workspace, `process-${ordinal}`)
      const exit = childExit(running)
      const expectsFault = ordinal < processCount
      const timer = setTimeout(() => {
        recoveryTimedOut = true
        running.child.kill("SIGKILL")
      }, recoveryLimitMilliseconds)
      try {
        await observeUntil(running, executionIds, expectsFault ? "Fault" : "Complete")
      } catch (cause: unknown) {
        if (!recoveryTimedOut) throw cause
      } finally {
        clearTimeout(timer)
      }
      if (expectsFault || recoveryTimedOut) running.child.kill("SIGKILL")
      const exitCode = await exit
      if (!expectsFault && !recoveryTimedOut && exitCode !== 0) {
        throw new Error(`delivery-loop successor exited ${exitCode}: ${running.stderr.join("")}`)
      }
      if (ordinal === 1 && expectsFault) await moveTaskOutsideTargetDuringDowntime(workspace)
      if (recoveryTimedOut) break
    }
    const boundaryCalls = await loadDeliveryBoundaryCalls(workspace)
    const proposalObservations = await loadDeliveryProposalObservations(workspace)
    const providerCalls = await loadProviderCalls(workspace)
    const publications = await loadDeliveryPublications(workspace)
    return {
      attemptIds: [],
      boundaryCalls,
      canonicalTrace: canonicalTraceOf(publications, proposalObservations, providerCalls),
      executionIds: [...executionIds],
      proposalObservations,
      providerCalls,
      publications,
      recoveryTimedOut
    }
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}
