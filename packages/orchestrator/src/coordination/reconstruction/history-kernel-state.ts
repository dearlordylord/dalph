import { HashMap, HashSet, Option } from "effect"
import type { AttemptId, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import type { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import type { IntegrationFinalityHistoryIndexes } from "../../workflow/protocols/integration-finality/history.js"
import type { TaskTrackerReconfirmationIndex } from "../../workflow/task-tracker-facts/reconfirmation.js"
import { WorkflowJournalHistoryIdentityIssue, WorkflowJournalHistorySemanticIssue, type WorkflowJournalHistoryIssue } from "./history-result.js"

/** Process-local immutable semantic fold facts, never persisted external authority. */
export interface FoldIndexes extends IntegrationHistoryIndexes {
  readonly abandonedExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly integrationFinalityHistory: IntegrationFinalityHistoryIndexes
  readonly attemptChoiceSubjects: HashSet.HashSet<string>
  readonly latestControlDirectionOrdinal: number
  readonly executorCommandOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorCommandCountsSinceSafeSuspension: HashMap.HashMap<string, number>
  readonly executorCommandProjectionOrdinals: HashMap.HashMap<string, number>
  readonly executorReportOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorStateObservationOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorResponsibilitiesBegan: HashMap.HashMap<AttemptId, { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }>
  readonly plans: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly gitReadIntents: HashMap.HashMap<OperationId, Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }>>
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

export const identityIssue = (issues: Array<WorkflowJournalHistoryIssue>, runId: RunId, position: JournalPosition, detail: string): void => {
  issues.push(new WorkflowJournalHistoryIdentityIssue({ detail, position, runId }))
}

export const semanticIssue = (issues: Array<WorkflowJournalHistoryIssue> | Array<WorkflowJournalHistorySemanticIssue>, runId: RunId, position: JournalPosition, detail: string): void => {
  issues.push(new WorkflowJournalHistorySemanticIssue({ detail, position, runId }))
}
