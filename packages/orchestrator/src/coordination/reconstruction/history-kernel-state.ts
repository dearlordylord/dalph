import { Chunk, HashMap, HashSet, Option } from "effect"
import type { AttemptId, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import type { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import type { IntegrationFinalityHistoryIndexes } from "../../workflow/protocols/integration-finality/history.js"
import {
  makeTaskTrackerReconfirmationIndex,
  type TaskTrackerReconfirmationIndex
} from "../../workflow/task-tracker-facts/reconfirmation.js"
import {
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue,
  type WorkflowJournalHistoryIssue
} from "./history-result.js"

const SemanticFoldIndexesTypeId: unique symbol = Symbol("SemanticFoldIndexes")

/** Process-local immutable semantic fold facts, never persisted external authority. */
export interface FoldIndexes extends IntegrationHistoryIndexes {
  readonly [SemanticFoldIndexesTypeId]: true
  readonly abandonedExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly integrationFinalityHistory: IntegrationFinalityHistoryIndexes
  readonly attemptChoiceSubjects: HashSet.HashSet<string>
  /** Terminal Stop/Restart directions are independent of arbitrarily many preceding Continue choices. */
  readonly attemptStopDirections: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly attemptRestartDirections: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly latestControlDirectionOrdinal: number
  readonly executorCommandOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorCommandCountsSinceSafeSuspension: HashMap.HashMap<string, number>
  readonly executorCommandProjectionOrdinals: HashMap.HashMap<string, number>
  readonly executorReportOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorStateObservationOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorResponsibilitiesBegan: HashMap.HashMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly plans: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly gitReadIntents: HashMap.HashMap<
    OperationId,
    Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }>
  >
  readonly latestRunPolicyRevision: number | undefined
  readonly seenEventKindsByOperation: HashMap.HashMap<OperationId, HashSet.HashSet<WorkflowJournalEvent["_tag"]>>
  readonly seenKeys: HashSet.HashSet<JournalRecordKey>
  readonly seenOperationIds: HashSet.HashSet<OperationId>
  readonly terminalExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly supersededExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly unsettledExecutorCommands: HashMap.HashMap<AttemptId, number>
  readonly trackerReconfirmations: TaskTrackerReconfirmationIndex
}

export const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

export type WorkflowJournalHistoryIssueReporter<I extends WorkflowJournalHistoryIssue = WorkflowJournalHistoryIssue> = (
  issue: I
) => void

export interface WorkflowJournalHistoryIssueCollector<
  I extends WorkflowJournalHistoryIssue = WorkflowJournalHistoryIssue
> {
  readonly isEmpty: () => boolean
  readonly report: WorkflowJournalHistoryIssueReporter<I>
  readonly toReadonlyArray: () => ReadonlyArray<I>
}

/** Ordered process-local diagnostics backed by a persistent Chunk rather than a shared mutable Array. */
export const makeWorkflowJournalHistoryIssueCollector = <
  I extends WorkflowJournalHistoryIssue
>(): WorkflowJournalHistoryIssueCollector<I> => {
  let collected = Chunk.empty<I>()
  return {
    isEmpty: (): boolean => Chunk.isEmpty(collected),
    report: (issue: I): void => {
      collected = Chunk.append(collected, issue)
    },
    toReadonlyArray: (): ReadonlyArray<I> => Chunk.toReadonlyArray(collected)
  }
}

export const identityIssue = (
  report: WorkflowJournalHistoryIssueReporter<WorkflowJournalHistoryIdentityIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  report(new WorkflowJournalHistoryIdentityIssue({ detail, position, runId }))
}

export const semanticIssue = (
  report: WorkflowJournalHistoryIssueReporter<WorkflowJournalHistorySemanticIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  report(new WorkflowJournalHistorySemanticIssue({ detail, position, runId }))
}

export const emptyIndexes = (): FoldIndexes => ({
  [SemanticFoldIndexesTypeId]: true,
  acceptedExecutorResults: HashMap.empty(),
  abandonedExecutorAttempts: HashSet.empty(),
  attemptChoiceSubjects: HashSet.empty(),
  attemptStopDirections: HashMap.empty(),
  attemptRestartDirections: HashMap.empty(),
  executorCommandOrdinals: HashMap.empty(),
  executorCommandCountsSinceSafeSuspension: HashMap.empty(),
  executorCommandProjectionOrdinals: HashMap.empty(),
  executorReportOrdinals: HashMap.empty(),
  executorStateObservationOrdinals: HashMap.empty(),
  executorResponsibilitiesBegan: HashMap.empty(),
  integrationResponsibilitiesBegan: HashMap.empty(),
  integrationStarted: HashMap.empty(),
  targetLineageReadIntents: HashMap.empty(),
  targetLineageObservations: HashMap.empty(),
  integratorSessionFixed: HashMap.empty(),
  integratorSessionsByStartedAt: HashMap.empty(),
  integratorSessionsBySessionId: HashMap.empty(),
  integratorSessionsByCandidateResource: HashMap.empty(),
  integratorSuccessorSessionFixed: HashMap.empty(),
  integratorSuccessorSessionsByPredecessor: HashMap.empty(),
  integratorRunStarted: HashMap.empty(),
  integratorRunResults: HashMap.empty(),
  integratorRunCandidateGitReadIntents: HashMap.empty(),
  integratorRunCandidateGitObservations: HashMap.empty(),
  targetPromotionHistory: {
    attempts: HashMap.empty(),
    deferrals: HashMap.empty(),
    intents: HashMap.empty(),
    terminals: HashSet.empty()
  },
  integrationFinalityHistory: {
    deletionAttempts: HashMap.empty(),
    deletionIntents: HashMap.empty(),
    deletionTerminals: HashSet.empty(),
    replacementAttempts: HashMap.empty(),
    replacementIntents: HashMap.empty(),
    replacementTerminals: HashMap.empty(),
    settlements: HashSet.empty()
  },
  latestControlDirectionOrdinal: 0,
  plans: HashMap.empty(),
  gitReadIntents: HashMap.empty(),
  latestRunPolicyRevision: undefined,
  seenEventKindsByOperation: HashMap.empty(),
  seenKeys: HashSet.empty(),
  seenOperationIds: HashSet.empty(),
  terminalExecutorAttempts: HashSet.empty(),
  supersededExecutorAttempts: HashSet.empty(),
  unsettledExecutorCommands: HashMap.empty(),
  trackerReconfirmations: makeTaskTrackerReconfirmationIndex()
})
