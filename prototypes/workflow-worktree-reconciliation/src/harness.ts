import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import {
  type ActivityEvidence,
  ChildMessage,
  type ExecutorAdmissionContact,
  fixture,
  type ChildMessage as ChildMessageType,
  type ControlledGitCall,
  type DecisionEvidence,
  type ProposalObservation,
  type WorktreeDecision,
  type WorktreeScenario
} from "./contracts.ts"
import {
  changeFactsDuringDowntime,
  initializeControlledWorld,
  loadActivityEvidence,
  loadDecisionEvidence,
  loadExecutorAdmissionContacts,
  loadGitCalls,
  loadProposalObservations
} from "./controlled-world.ts"
import { inspectDurableInventory, type DurableInventory } from "./inventory.ts"
import { loadJournalRecords } from "./journal.ts"

interface RunningChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly messages: AsyncIterable<ChildMessageType>
  readonly stderr: ReadonlyArray<string>
}

const childPath = join(dirname(fileURLToPath(import.meta.url)), "child.ts")
const watchdogMilliseconds = 12_000

const startChild = (
  scenario: WorktreeScenario,
  publicationMode: "Publish" | "Suppress",
  workspace: string,
  processInstance: string
): RunningChild => {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    childPath,
    "--run-id",
    fixture.runId,
    "--scenario",
    scenario,
    "--publication",
    publicationMode,
    "--process-instance",
    processInstance,
    "--workspace",
    workspace
  ])
  const stderr: Array<string> = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => stderr.push(chunk))
  const lines = createInterface({ input: child.stdout })
  const messages = (async function* (): AsyncIterable<ChildMessageType> {
    for await (const line of lines) {
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch (cause: unknown) {
        throw new Error(`workflow-worktree child wrote non-protocol stdout: ${line}`, { cause })
      }
      yield Schema.decodeUnknownSync(ChildMessage)(decoded)
    }
  })()
  return { child, messages, stderr }
}

export interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

const childExit = (running: RunningChild): Promise<ChildExit> =>
  new Promise((resolve, reject) => {
    running.child.once("error", reject)
    running.child.once("exit", (code, signal) => resolve({ code, signal }))
  })

interface FirstProcessObservation {
  readonly executionIds: Array<string>
  readonly messages: Array<ChildMessageType>
}

const observeUntil = async (
  running: RunningChild,
  expected: "Fault" | "Complete" | "Suppressed",
  observation: FirstProcessObservation
): Promise<void> => {
  for await (const message of running.messages) {
    observation.messages.push(message)
    if (message._tag === "ProtocolFailure") throw new Error(message.detail)
    if (message._tag === "ChildReady") {
      if (
        message.runId !== fixture.runId ||
        message.operationId !== fixture.operationId ||
        message.attemptId !== fixture.attemptId ||
        message.plannedBaseSha !== fixture.baseSha ||
        message.branch !== fixture.branch ||
        message.worktree !== fixture.worktree ||
        message.activityName !== fixture.activityName
      ) {
        throw new Error("child changed an immutable Workflow/worktree identity")
      }
      observation.executionIds.push(message.executionId)
    }
    if (message._tag === "FaultReached" && expected === "Fault") return
    if (message._tag === "Completed" && expected === "Complete") return
    if (message._tag === "PublicationSuppressed" && expected === "Suppressed") return
  }
  throw new Error(`child exited before ${expected}: ${running.stderr.join("")}`)
}

export interface WorkflowReconciliationResult {
  readonly activityEvidence: ReadonlyArray<ActivityEvidence>
  readonly childMessages: ReadonlyArray<ChildMessageType>
  readonly decisionEvidence: ReadonlyArray<DecisionEvidence>
  readonly executorContacts: ReadonlyArray<ExecutorAdmissionContact>
  readonly executionIds: ReadonlyArray<string>
  readonly firstExit: ChildExit
  readonly gitCalls: ReadonlyArray<ControlledGitCall>
  readonly inventory: DurableInventory
  readonly journalRecords: Awaited<ReturnType<typeof loadJournalRecords>>
  readonly journalEventTags: ReadonlyArray<string>
  readonly physicalWorktreeCreated: boolean
  readonly proposalObservations: ReadonlyArray<ProposalObservation>
  readonly scenario: WorktreeScenario
  readonly stderr: ReadonlyArray<string>
  readonly secondExit: ChildExit
  readonly terminalDecision: WorktreeDecision | undefined
}

const physicalWorktreeWasCreated = async (workspace: string): Promise<boolean> =>
  stat(join(workspace, "physical-worktree-marker"))
    .then(() => true)
    .catch(() => false)

export const runWorkflowReconciliationScenario = async (input: {
  readonly publicationMode?: "Publish" | "Suppress"
  readonly scenario: WorktreeScenario
}): Promise<WorkflowReconciliationResult> => {
  const workspace = await mkdtemp(join(tmpdir(), "dalph-234-worktree-reconciliation-"))
  const publicationMode = input.publicationMode ?? "Publish"
  const observation: FirstProcessObservation = { executionIds: [], messages: [] }
  const allMessages: Array<ChildMessageType> = []
  const allStderr: Array<string> = []
  try {
    await initializeControlledWorld(workspace)
    const first = startChild(input.scenario, "Publish", workspace, "process-1")
    const firstExitPromise = childExit(first)
    const firstWatchdog = setTimeout(() => first.child.kill("SIGKILL"), watchdogMilliseconds)
    try {
      await observeUntil(first, "Fault", observation)
    } finally {
      clearTimeout(firstWatchdog)
    }
    allMessages.push(...observation.messages)
    allStderr.push(...first.stderr)
    first.child.kill("SIGKILL")
    const firstExit = await firstExitPromise

    if (input.scenario === "FactsChangedDuringDowntime" || input.scenario === "ReplayHistoricalRead") {
      await changeFactsDuringDowntime(workspace)
    }

    const second = startChild(input.scenario, publicationMode, workspace, "process-2")
    const secondExit = childExit(second)
    const secondExpected = publicationMode === "Suppress" ? "Suppressed" : "Complete"
    const secondObservation: FirstProcessObservation = { executionIds: [], messages: [] }
    const secondWatchdog = setTimeout(() => second.child.kill("SIGKILL"), watchdogMilliseconds)
    try {
      await observeUntil(second, secondExpected, secondObservation)
    } finally {
      clearTimeout(secondWatchdog)
    }
    allMessages.push(...secondObservation.messages)
    allStderr.push(...second.stderr)
    if (publicationMode === "Suppress") second.child.kill("SIGKILL")
    const secondExitInfo = await secondExit
    if (publicationMode === "Publish" && (secondExitInfo.code !== 0 || secondExitInfo.signal !== null)) {
      throw new Error(`successor child exited ${JSON.stringify(secondExitInfo)}: ${second.stderr.join("")}`)
    }
    observation.executionIds.push(...secondObservation.executionIds)

    const [
      gitCalls,
      activityEvidence,
      proposalObservations,
      decisionEvidence,
      executorContacts,
      journalRecords,
      physicalWorktreeCreated
    ] =
      await Promise.all([
        loadGitCalls(workspace),
        loadActivityEvidence(workspace),
        loadProposalObservations(workspace),
        loadDecisionEvidence(workspace),
        loadExecutorAdmissionContacts(workspace),
        loadJournalRecords(workspace),
        physicalWorktreeWasCreated(workspace)
      ])
    const inventory = await inspectDurableInventory(workspace, journalRecords)
    const terminalDecision = allMessages.findLast((message) => message._tag === "Completed")
    return {
      activityEvidence,
      childMessages: allMessages,
      decisionEvidence,
      executorContacts,
      executionIds: observation.executionIds,
      firstExit,
      gitCalls,
      inventory,
      journalRecords,
      journalEventTags: journalRecords.map(({ event }) => event._tag),
      physicalWorktreeCreated,
      proposalObservations,
      scenario: input.scenario,
      stderr: allStderr,
      secondExit: secondExitInfo,
      terminalDecision: terminalDecision?._tag === "Completed" ? terminalDecision.decision : undefined
    }
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}

export const runBlindRetryNegativeControl = (): Promise<WorkflowReconciliationResult> =>
  runWorkflowReconciliationScenario({ scenario: "BlindRetry" })

export const runHistoricalReplayNegativeControl = (): Promise<WorkflowReconciliationResult> =>
  runWorkflowReconciliationScenario({ scenario: "ReplayHistoricalRead" })
