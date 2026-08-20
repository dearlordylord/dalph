import { open, readFile, rename } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"
import {
  ActivityEvidence,
  ControlledGitCall,
  ControlledWorld,
  ControlledWorktreeObservation,
  DecisionEvidence,
  ExecutorAdmissionContact,
  fixture,
  plannedAttempt,
  ProposalObservation,
  type WorktreeDecision,
  type WorktreeProcessInstance
} from "./contracts.ts"

const outsideWorldPath = (workspace: string): string => join(workspace, "controlled-git-world.json")
const gitLedgerPath = (workspace: string): string => join(workspace, "controlled-git-calls.ndjson")
const activityLedgerPath = (workspace: string): string => join(workspace, "activity-evidence.ndjson")
const proposalLedgerPath = (workspace: string): string => join(workspace, "proposal-observations.ndjson")
const decisionLedgerPath = (workspace: string): string => join(workspace, "decision-evidence.ndjson")
const executorAdmissionLedgerPath = (workspace: string): string => join(workspace, "executor-admission-contacts.ndjson")

const writeDurably = async (path: string, contents: string): Promise<void> => {
  const temporaryPath = `${path}.${process.pid}.tmp`
  const file = await open(temporaryPath, "w")
  try {
    await file.writeFile(contents, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporaryPath, path)
}

const readLines = async <A>(path: string, decode: (input: unknown) => A): Promise<ReadonlyArray<A>> => {
  const contents = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  })
  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => decode(JSON.parse(line)))
}

const appendLine = async (path: string, value: unknown): Promise<void> => {
  const file = await open(path, "a")
  try {
    await file.appendFile(`${JSON.stringify(value)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
}

export const initializeControlledWorld = async (workspace: string): Promise<void> => {
  await writeDurably(
    outsideWorldPath(workspace),
    `${JSON.stringify(
      ControlledWorld.make({
        observation: ControlledWorktreeObservation.cases.PlannedWorktreeAbsent.make({}),
        plannedAttempt,
        schemaVersion: 1
      })
    )}\n`
  )
  await writeDurably(executorAdmissionLedgerPath(workspace), "")
}

export const readControlledWorld = async (workspace: string): Promise<ControlledWorld> =>
  Schema.decodeUnknownSync(ControlledWorld)(JSON.parse(await readFile(outsideWorldPath(workspace), "utf8")))

const readGitCalls = async (workspace: string): Promise<ReadonlyArray<ControlledGitCall>> =>
  readLines(gitLedgerPath(workspace), Schema.decodeUnknownSync(ControlledGitCall))

export const loadGitCalls = readGitCalls
export const loadActivityEvidence = (workspace: string): Promise<ReadonlyArray<ActivityEvidence>> =>
  readLines(activityLedgerPath(workspace), Schema.decodeUnknownSync(ActivityEvidence))
export const loadProposalObservations = (workspace: string): Promise<ReadonlyArray<ProposalObservation>> =>
  readLines(proposalLedgerPath(workspace), Schema.decodeUnknownSync(ProposalObservation))
export const loadDecisionEvidence = (workspace: string): Promise<ReadonlyArray<DecisionEvidence>> =>
  readLines(decisionLedgerPath(workspace), Schema.decodeUnknownSync(DecisionEvidence))
export const loadExecutorAdmissionContacts = (workspace: string): Promise<ReadonlyArray<ExecutorAdmissionContact>> =>
  readLines(executorAdmissionLedgerPath(workspace), Schema.decodeUnknownSync(ExecutorAdmissionContact))

/** The controlled boundary identity carried into each fake Git observation. */
export interface BoundaryContext {
  readonly operationId: typeof fixture.operationId
  readonly processInstance: WorktreeProcessInstance
  readonly workspace: string
}

const assertFixtureAttempt = (world: ControlledWorld): void => {
  if (
    world.plannedAttempt.attemptId !== fixture.attemptId ||
    world.plannedAttempt.baseSha !== fixture.baseSha ||
    world.plannedAttempt.branch !== fixture.branch ||
    world.plannedAttempt.runId !== fixture.runId ||
    world.plannedAttempt.taskId !== fixture.taskId ||
    world.plannedAttempt.worktree !== fixture.worktree
  ) {
    throw new Error("controlled Git world changed the immutable planned attempt")
  }
}

const resultTagOf = (
  observation: ControlledWorktreeObservation
): "PlannedWorktreeAbsent" | "PlannedWorktreeContradictory" | "PlannedWorktreeReady" => observation._tag

export const readPlannedWorktree = async (
  context: BoundaryContext
): Promise<ControlledWorktreeObservation> => {
  const world = await readControlledWorld(context.workspace)
  assertFixtureAttempt(world)
  const observation = world.observation
  await appendLine(
    gitLedgerPath(context.workspace),
    ControlledGitCall.make({
      _tag: "ReadPlannedWorktree",
      attemptId: fixture.attemptId,
      baseSha: fixture.baseSha,
      branch: fixture.branch,
      operationId: context.operationId,
      processInstance: context.processInstance,
      result: resultTagOf(observation),
      runId: fixture.runId,
      worktree: fixture.worktree
    })
  )
  return observation
}

export const createPlannedWorktree = async (
  context: BoundaryContext,
  afterApplied?: () => Promise<void>
): Promise<void> => {
  const world = await readControlledWorld(context.workspace)
  assertFixtureAttempt(world)
  const ready = ControlledWorktreeObservation.cases.PlannedWorktreeReady.make({
    baseSha: fixture.baseSha,
    branch: fixture.branch,
    headSha: fixture.baseSha,
    worktree: fixture.worktree
  })
  await writeDurably(
    outsideWorldPath(context.workspace),
    `${JSON.stringify(ControlledWorld.make({ ...world, observation: ready }))}\n`
  )
  await appendLine(
    gitLedgerPath(context.workspace),
    ControlledGitCall.make({
      _tag: "CreatePlannedWorktree",
      applied: true,
      attemptId: fixture.attemptId,
      baseSha: fixture.baseSha,
      branch: fixture.branch,
      operationId: context.operationId,
      processInstance: context.processInstance,
      runId: fixture.runId,
      worktree: fixture.worktree
    })
  )
  if (afterApplied !== undefined) await afterApplied()
}

export const changeFactsDuringDowntime = async (workspace: string): Promise<void> => {
  const world = await readControlledWorld(workspace)
  await writeDurably(
    outsideWorldPath(workspace),
    `${JSON.stringify(
      ControlledWorld.make({
        ...world,
        observation: ControlledWorktreeObservation.cases.PlannedWorktreeAbsent.make({})
      })
    )}\n`
  )
}

export const recordActivityResultAvailable = async (
  workspace: string,
  processInstance: WorktreeProcessInstance,
  executionId: string
): Promise<void> =>
  appendLine(
    activityLedgerPath(workspace),
    ActivityEvidence.make({
      _tag: "ActivityResultAvailable",
      activityName: fixture.activityName,
      attemptId: fixture.attemptId,
      baseSha: fixture.baseSha,
      branch: fixture.branch,
      executionId,
      headSha: fixture.baseSha,
      operationId: fixture.operationId,
      processInstance,
      runId: fixture.runId,
      worktree: fixture.worktree
    })
  )

export const recordProposalObservation = async (
  workspace: string,
  observation: ProposalObservation
): Promise<void> => appendLine(proposalLedgerPath(workspace), observation)

export const recordDecisionEvidence = async (
  workspace: string,
  processInstance: WorktreeProcessInstance,
  decision: WorktreeDecision,
  source: "ControlledGitFreshRead" | "ReplayedWorkflowResult",
  executorAdmissions: number
): Promise<void> =>
  appendLine(
    decisionLedgerPath(workspace),
    DecisionEvidence.make({
      decision,
      executorAdmissions,
      operationId: fixture.operationId,
      processInstance,
      runId: fixture.runId,
      source
    })
  )

/** Records an actual contact only if a future prototype branch crosses the executor boundary. */
export const recordExecutorAdmissionContact = async (
  workspace: string,
  contact: ExecutorAdmissionContact
): Promise<void> => appendLine(executorAdmissionLedgerPath(workspace), contact)

export const setControlledObservation = async (
  workspace: string,
  observation: ControlledWorktreeObservation
): Promise<void> => {
  const world = await readControlledWorld(workspace)
  assertFixtureAttempt(world)
  await writeDurably(outsideWorldPath(workspace), `${JSON.stringify(ControlledWorld.make({ ...world, observation }))}\n`)
}
