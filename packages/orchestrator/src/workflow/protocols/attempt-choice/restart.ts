import {
  type GitCommitSha,
  plannedAttemptExecutorCorrelation,
  type IntegrationTarget,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect } from "effect"
import { type PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { isExactTaskClaim, type ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { type TaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { plannedAttemptReplacedRecordKey } from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { WorkflowInterpreter } from "../../interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { type PlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit,
  withPlannedAttemptProtocolPermit
} from "../planned-attempt-executor-work/protocol-controller.js"
import {
  OperationIdAllocator,
  PlannedTaskAttemptOrdinal,
  PlannedTaskAttemptPlanner
} from "../task-attempt-planning/plan.js"
import type { AttemptChoiceRequestId, AttemptChoiceSubject } from "./events.js"
import {
  AttemptRestartAuthorityContradiction,
  AttemptRestartChoiceContradiction,
  exactAppliedRestart,
  nextRestartReadOperationId,
  proofFor,
  recordedReplacement,
  type RestartApplicationRecord,
  terminalOrSafeRestartQuiescence
} from "./restart-authority.js"
import { PlannedAttemptReplacedEvent, PlannedAttemptReplacementWitness } from "./replacement-events.js"

export {
  AttemptRestartAuthorityContradiction,
  type AttemptRestartAdvanceResult,
  AttemptRestartChoiceContradiction,
  type AttemptRestartPendingReason,
  type AttemptRestartRejectedReason
} from "./restart-authority.js"

const lastRecordOffset = -1

interface RestartBasis {
  readonly application: RestartApplicationRecord
  readonly quiescenceEvidence: PlannedAttemptExecutorEvidence
}

interface RestartPrepared extends RestartBasis {
  readonly _tag: "RestartPrepared"
}

interface RestartGraphFacts extends RestartBasis {
  readonly _tag: "RestartGraphFacts"
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
}

interface RestartTaskFacts extends RestartBasis {
  readonly _tag: "RestartTaskFacts"
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly specification: TaskWorkSpecification
  readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
}

interface RestartClaimFacts extends RestartBasis {
  readonly _tag: "RestartClaimFacts"
  readonly claimOperation: ReturnType<typeof makeTaskClaimObservationOperation>
  readonly expectedClaim: ActiveTaskClaim
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly specification: TaskWorkSpecification
  readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
}

interface RestartAuthorityFacts extends RestartBasis {
  readonly _tag: "RestartAuthorityFacts"
  readonly claimOperation: ReturnType<typeof makeTaskClaimObservationOperation>
  readonly expectedClaim: ActiveTaskClaim
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly oldWorktreeProof: PlannedWorktreeReady
  readonly specification: TaskWorkSpecification
  readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
  readonly worktreeOperation: ReturnType<typeof makeTaskWorktreeObservationOperation>
}

const prepareAttemptRestart = Effect.fn("AttemptRestart.prepare")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const existing = recordedReplacement(records, subject)
  if (existing?.event._tag === "PlannedAttemptReplaced") {
    return { _tag: "PlannedAttemptReplacementRecorded" as const, replacement: existing }
  }
  const application = exactAppliedRestart(records, requestId, subject)
  if (application === undefined) return yield* new AttemptRestartChoiceContradiction({ requestId, subject })
  const quiescence = yield* terminalOrSafeRestartQuiescence(records, application, subject, permit)
  if (quiescence._tag === "Pending") {
    return { _tag: "AttemptRestartPending" as const, reason: quiescence.reason }
  }
  if (quiescence._tag === "Rejected") {
    return { _tag: "AttemptRestartRejected" as const, reason: quiescence.reason }
  }
  if (quiescence._tag !== "Proof") {
    return yield* new AttemptRestartAuthorityContradiction({
      detail: "executor reconciliation did not publish exact replacement quiescence",
      requestId,
      subject
    })
  }
  return { _tag: "RestartPrepared" as const, application, quiescenceEvidence: quiescence.evidence }
})

const readRestartGraph = Effect.fn("AttemptRestart.readGraph")(function* (
  prepared: RestartPrepared,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") {
    return yield* new AttemptRestartAuthorityContradiction({ detail: "Run target is missing", requestId, subject })
  }
  const graphOperation = makeTrackerGraphObservationOperation(
    nextRestartReadOperationId(
      records,
      requestId,
      "graph",
      records.at(lastRecordOffset)?.position ?? prepared.application.position
    ),
    began.event.target,
    [],
    [subject.plannedAttempt.taskId]
  )
  const graph = yield* interpreter.readTrackerGraph(graphOperation)
  if (!graph.eligibleTasks().some(({ id }) => id === subject.plannedAttempt.taskId)) {
    return { _tag: "AttemptRestartPending" as const, reason: "TaskNotEligible" as const }
  }
  return { ...prepared, _tag: "RestartGraphFacts" as const, graphOperation }
})

const readRestartTaskFacts = Effect.fn("AttemptRestart.readTaskFacts")(function* (
  facts: RestartGraphFacts,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    nextRestartReadOperationId(
      records,
      requestId,
      "specification",
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    facts.graphOperation.target,
    subject.plannedAttempt.taskId,
    [facts.graphOperation.operationId]
  )
  const specification = yield* interpreter.readTaskWorkSpecification(specificationOperation)
  if (specification.fingerprint !== subject.observedTaskRevision) {
    return { _tag: "AttemptRestartRejected" as const, reason: "NewFingerprintChoiceRequired" as const }
  }
  return { ...facts, _tag: "RestartTaskFacts" as const, specification, specificationOperation }
})

const readRestartClaim = Effect.fn("AttemptRestart.readClaim")(function* (
  facts: RestartTaskFacts,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const claimOperation = makeTaskClaimObservationOperation(
    nextRestartReadOperationId(
      records,
      requestId,
      "claim",
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    facts.graphOperation.target,
    subject.plannedAttempt.taskId,
    [facts.graphOperation.operationId, facts.specificationOperation.operationId]
  )
  const claim = yield* interpreter.readTaskClaim(claimOperation)
  if (claim._tag === "TaskClaimObservationUnreadable") {
    return { _tag: "AttemptRestartPending" as const, reason: "ClaimUnreadable" as const }
  }
  const expectedClaim = authorizedClaimForAttempt(
    yield* journal.read(subject.plannedAttempt.runId),
    subject.plannedAttempt
  )?.claim
  if (expectedClaim === undefined) {
    return yield* new AttemptRestartAuthorityContradiction({
      detail: "P1 claim authority is missing",
      requestId,
      subject
    })
  }
  if (claim.observation._tag === "UnclaimedTask") {
    return { _tag: "AttemptRestartPending" as const, reason: "ClaimAbsent" as const }
  }
  if (!isExactTaskClaim(claim.observation, expectedClaim)) {
    return { _tag: "AttemptRestartPending" as const, reason: "ClaimForeign" as const }
  }
  return { ...facts, _tag: "RestartClaimFacts" as const, claimOperation, expectedClaim }
})

const readRestartWorktree = Effect.fn("AttemptRestart.readWorktree")(function* (
  facts: RestartClaimFacts,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: nextRestartReadOperationId(
      records,
      requestId,
      "worktree",
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    plannedAttempt: subject.plannedAttempt,
    predecessorOperationIds: [
      facts.graphOperation.operationId,
      facts.specificationOperation.operationId,
      facts.claimOperation.operationId
    ]
  })
  const worktree = yield* interpreter.readTaskWorktree(worktreeOperation)
  if (worktree.observation._tag !== "PlannedWorktreeReady") {
    return { _tag: "AttemptRestartPending" as const, reason: "OldWorktreeNotReady" as const }
  }
  return { ...facts, _tag: "RestartAuthorityFacts" as const, oldWorktreeProof: worktree.observation, worktreeOperation }
})

const successorIsExact = (
  successor: PlannedTaskAttempt,
  facts: Pick<RestartTaskFacts, "specification">,
  subject: AttemptChoiceSubject,
  targetHeadSha: GitCommitSha
): boolean =>
  [
    successor.runId === subject.plannedAttempt.runId,
    successor.taskId === subject.plannedAttempt.taskId,
    successor.taskRevision === facts.specification.fingerprint,
    successor.baseSha === targetHeadSha,
    successor.attemptId !== subject.plannedAttempt.attemptId,
    successor.branch !== subject.plannedAttempt.branch,
    successor.worktree !== subject.plannedAttempt.worktree
  ].every(Boolean)

const recordAttemptReplacement = Effect.fn("AttemptRestart.recordReplacement")(function* (
  facts: RestartAuthorityFacts,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  integrationTarget: IntegrationTarget
) {
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  let records = yield* journal.read(subject.plannedAttempt.runId)
  const targetOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: nextRestartReadOperationId(
      records,
      requestId,
      "target-lineage",
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    plannedAttempt: subject.plannedAttempt,
    predecessorOperationIds: [facts.worktreeOperation.operationId]
  })
  const target = yield* interpreter.readTargetLineage(targetOperation)

  records = yield* journal.read(subject.plannedAttempt.runId)
  const alreadyRecorded = recordedReplacement(records, subject)
  if (alreadyRecorded?.event._tag === "PlannedAttemptReplaced") {
    return { _tag: "PlannedAttemptReplacementRecorded" as const, replacement: alreadyRecorded }
  }
  const planner = yield* PlannedTaskAttemptPlanner
  const allocator = yield* OperationIdAllocator
  const priorTaskAttemptCount = records.filter(
    ({ event }) =>
      (event._tag === "TaskAttemptPlanned" &&
        event.operation.plannedAttempt.taskId === subject.plannedAttempt.taskId) ||
      (event._tag === "PlannedAttemptReplaced" &&
        event.successorPlan.plannedAttempt.taskId === subject.plannedAttempt.taskId)
  ).length
  const successor = yield* planner.plan(
    facts.specification,
    target.observation.targetHeadSha,
    PlannedTaskAttemptOrdinal.make(priorTaskAttemptCount)
  )
  if (!successorIsExact(successor, facts, subject, target.observation.targetHeadSha)) {
    return yield* new AttemptRestartAuthorityContradiction({
      detail: "successor planner did not return a distinct exact F2/H2 attempt",
      requestId,
      subject
    })
  }
  const successorPlan = makeTaskAttemptPlanOperation({
    operationId: yield* allocator.allocate(),
    plannedAttempt: successor,
    predecessorOperationIds: [
      facts.graphOperation.operationId,
      facts.specificationOperation.operationId,
      facts.claimOperation.operationId,
      facts.worktreeOperation.operationId,
      targetOperation.operationId
    ]
  })
  const witness = PlannedAttemptReplacementWitness.make({
    claimObservationOperationId: facts.claimOperation.operationId,
    expectedClaim: facts.expectedClaim,
    graphObservationOperationId: facts.graphOperation.operationId,
    oldWorktreeObservationOperationId: facts.worktreeOperation.operationId,
    oldWorktreeProof: facts.oldWorktreeProof,
    quiescenceProof: proofFor(facts.quiescenceEvidence),
    specificationObservationOperationId: facts.specificationOperation.operationId,
    targetHeadSha: target.observation.targetHeadSha,
    targetLineageObservationOperationId: targetOperation.operationId
  })
  const replacement = yield* journal.append(
    subject.plannedAttempt.runId,
    plannedAttemptReplacedRecordKey(subject.plannedAttempt.attemptId),
    PlannedAttemptReplacedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject,
      successorPlan,
      version: workflowJournalEventVersion,
      witness
    })
  )
  return { _tag: "PlannedAttemptReplacementRecorded" as const, replacement }
})

const advanceAttemptRestartUnserialized = Effect.fn("AttemptRestart.advanceUnserialized")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  integrationTarget: IntegrationTarget,
  permit: PlannedAttemptProtocolPermit
) {
  const prepared = yield* prepareAttemptRestart(requestId, subject, permit)
  if (prepared._tag !== "RestartPrepared") return prepared
  const graphFacts = yield* readRestartGraph(prepared, requestId, subject)
  if (graphFacts._tag !== "RestartGraphFacts") return graphFacts
  const taskFacts = yield* readRestartTaskFacts(graphFacts, requestId, subject)
  if (taskFacts._tag !== "RestartTaskFacts") return taskFacts
  const claimFacts = yield* readRestartClaim(taskFacts, requestId, subject)
  if (claimFacts._tag !== "RestartClaimFacts") return claimFacts
  const authorityFacts = yield* readRestartWorktree(claimFacts, requestId, subject)
  if (authorityFacts._tag !== "RestartAuthorityFacts") return authorityFacts
  return yield* recordAttemptReplacement(authorityFacts, requestId, subject, integrationTarget)
})

export const advanceAttemptRestartWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  integrationTarget: IntegrationTarget
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(subject.plannedAttempt),
    advanceAttemptRestartUnserialized(requestId, subject, integrationTarget, permit)
  )

/** Advances the read-only authority checks and at most one atomic replacement append. */
export const advanceAttemptRestart = Effect.fn("AttemptRestart.advance")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  integrationTarget: IntegrationTarget
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(subject.plannedAttempt), (permit) =>
    advanceAttemptRestartUnserialized(requestId, subject, integrationTarget, permit)
  )
})
