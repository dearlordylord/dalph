/* eslint-disable max-lines -- One linear Restart protocol keeps every read boundary and atomic append auditable. */
import {
  type GitCommitSha,
  plannedAttemptExecutorCorrelation,
  type IntegrationTarget,
  type PlannedTaskAttempt,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { Data, Effect, Match } from "effect"
import { type PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { isExactTaskClaim, type ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import {
  attemptRestartAuthorityReadFailedRecordKey,
  plannedAttemptReplacedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
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
  PlannedTaskAttemptPlanner,
  PlannedTaskAttemptPlanRequest
} from "../task-attempt-planning/plan.js"
import { recordedTaskAttemptPlans } from "../task-attempt-planning/journal-evidence.js"
import {
  type AttemptChoiceRequestId,
  type AttemptChoiceSubject,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "./events.js"
import {
  AttemptRestartAuthorityContradiction,
  AttemptRestartChoiceContradiction,
  exactAppliedRestart,
  nextRestartReadOperationId,
  proofFor,
  recordedReplacement,
  restartClaimAuthorityAtApplication,
  restartChoiceWasInvalidatedByLaterSpecification,
  type PlannedAttemptReplacementRecord,
  type RestartApplicationRecord,
  terminalOrSafeRestartQuiescence
} from "./restart-authority.js"
import type { AttemptRestartPendingReason } from "./restart-reasons.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  type AttemptRestartAuthorityReadFailure,
  AttemptRestartTaskFactsReadFailure,
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness
} from "./replacement-events.js"

export {
  AttemptRestartAuthorityContradiction,
  type AttemptRestartAdvanceResult,
  AttemptRestartChoiceContradiction
} from "./restart-authority.js"
export type { AttemptRestartPendingReason, AttemptRestartRejectedReason } from "./restart-reasons.js"

const lastRecordOffset = -1

type RecordedReplacementLookup = Data.TaggedEnum<{
  Absent: Record<never, never>
  Contradictory: { readonly replacement: PlannedAttemptReplacementRecord }
  Exact: { readonly replacement: PlannedAttemptReplacementRecord }
}>

const RecordedReplacementLookup = Data.taggedEnum<RecordedReplacementLookup>()

const exactRecordedReplacement = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RecordedReplacementLookup => {
  const replacement = recordedReplacement(records, subject)
  if (replacement === undefined) return RecordedReplacementLookup.Absent()
  return [
    sameAttemptChoiceRequestId(replacement.event.requestId, requestId),
    sameAttemptChoiceSubject(replacement.event.subject, subject)
  ].every(Boolean)
    ? RecordedReplacementLookup.Exact({ replacement })
    : RecordedReplacementLookup.Contradictory({ replacement })
}

/** Every post-application Restart phase derives its exact request and subject from this one durable record. */
interface ExactRestartContext {
  readonly application: RestartApplicationRecord
}

const restartRequestFor = (context: ExactRestartContext) => context.application.event

const recordRestartAuthorityReadFailure = Effect.fn("AttemptRestart.recordAuthorityReadFailure")(function* (
  operationId: ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"],
  failure: AttemptRestartAuthorityReadFailure,
  context: ExactRestartContext
) {
  const { requestId, subject } = restartRequestFor(context)
  const journal = yield* InRunJournal
  yield* journal.append(
    subject.plannedAttempt.runId,
    attemptRestartAuthorityReadFailedRecordKey(operationId),
    AttemptRestartAuthorityReadFailedEvent.make({
      failure,
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  )
})

const unreadableTaskFacts = (
  operationId: ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"],
  source: AttemptRestartTaskFactsReadFailure["source"],
  detail: string,
  target: AttemptRestartTaskFactsReadFailure["target"],
  context: ExactRestartContext
) =>
  recordRestartAuthorityReadFailure(
    operationId,
    AttemptRestartTaskFactsReadFailure.make({ detail, source, target }),
    context
  ).pipe(Effect.as({ _tag: "Unreadable" as const }))

interface RestartBasis extends ExactRestartContext {
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

type EstablishedRestartQuiescence = Effect.Success<ReturnType<typeof terminalOrSafeRestartQuiescence>>
type RestartQuiescence =
  | Exclude<EstablishedRestartQuiescence, { readonly _tag: "Pending" }>
  | { readonly _tag: "Pending"; readonly reason: AttemptRestartPendingReason }

const executorContradictory = () =>
  Effect.succeed({ _tag: "Pending" as const, reason: "ExecutorContradictory" as const })
const executorUnavailable = () => Effect.succeed({ _tag: "Pending" as const, reason: "ExecutorUnavailable" as const })

const preparedRestartFrom = (quiescence: RestartQuiescence, application: RestartApplicationRecord) => {
  const { requestId, subject } = application.event
  return Match.valueTags(quiescence, {
    Pending: ({ reason }) => Effect.succeed({ _tag: "AttemptRestartPending" as const, reason }),
    Proof: ({ evidence }) =>
      Effect.succeed({ _tag: "RestartPrepared" as const, application, quiescenceEvidence: evidence }),
    Rejected: ({ reason }) => Effect.succeed({ _tag: "AttemptRestartRejected" as const, reason }),
    /* v8 ignore next -- @preserve The closed quiescence interpreter returns Pending, Proof, or Rejected for every accepted executor report. */
    Unproved: () =>
      Effect.fail(
        new AttemptRestartAuthorityContradiction({
          detail: "executor reconciliation did not publish exact replacement quiescence",
          requestId,
          subject
        })
      )
  })
}

const prepareAttemptRestart = Effect.fn("AttemptRestart.prepare")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const existing = exactRecordedReplacement(records, requestId, subject)
  if (existing._tag === "Contradictory") {
    return yield* new AttemptRestartChoiceContradiction({ requestId, subject })
  }
  if (existing._tag === "Exact") {
    return { _tag: "PlannedAttemptReplacementRecorded" as const, replacement: existing.replacement }
  }
  const application = exactAppliedRestart(records, requestId, subject)
  /* v8 ignore next -- @preserve The protocol controller exposes Restart only from its exact durable application record. */
  if (application === undefined) return yield* new AttemptRestartChoiceContradiction({ requestId, subject })
  if (restartChoiceWasInvalidatedByLaterSpecification(records, application.position, subject)) {
    return { _tag: "AttemptRestartRejected" as const, reason: "NewFingerprintChoiceRequired" as const }
  }
  const quiescence = yield* terminalOrSafeRestartQuiescence(records, application, subject, permit).pipe(
    Effect.catchTags({
      PlannedAttemptExecutorCorrelationMismatch: executorContradictory,
      PlannedAttemptExecutorProjectionCorrelationMismatch: executorContradictory,
      PlannedAttemptExecutorProjectionNoCurrentReport: executorUnavailable,
      PlannedAttemptExecutorProjectionTemporarilyUnavailable: executorUnavailable,
      PlannedAttemptExecutorProjectionUnreadable: executorUnavailable,
      PlannedAttemptExecutorStateNoCurrentReport: executorUnavailable,
      PlannedAttemptExecutorStateTemporarilyUnavailable: executorUnavailable,
      PlannedAttemptExecutorStateUnreadable: executorUnavailable
    })
  )
  return yield* preparedRestartFrom(quiescence, application)
})

const readRestartGraph = Effect.fn("AttemptRestart.readGraph")(function* (prepared: RestartPrepared) {
  const { requestId, subject } = restartRequestFor(prepared)
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
      /* v8 ignore next -- @preserve The applied Restart record is already present in this non-empty journal. */
      records.at(lastRecordOffset)?.position ?? prepared.application.position
    ),
    began.event.target,
    [],
    [subject.plannedAttempt.taskId]
  )
  const graphRead = yield* interpreter.readTrackerGraph(graphOperation).pipe(
    Effect.map((graph) => ({ _tag: "Readable" as const, graph })),
    Effect.catchTags({
      "FixtureReader.FixtureReadError": (failure) =>
        unreadableTaskFacts(graphOperation.operationId, failure._tag, failure.detail, graphOperation.target, prepared),
      "TaskDag.GraphProjectionError": (failure) =>
        unreadableTaskFacts(
          graphOperation.operationId,
          failure._tag,
          JSON.stringify(failure.issues),
          graphOperation.target,
          prepared
        ),
      "TrackerGraphReader.AdapterReadError": (failure) =>
        unreadableTaskFacts(graphOperation.operationId, failure._tag, failure.detail, graphOperation.target, prepared),
      "TrackerGraphReader.TrackerReadError": (failure) =>
        unreadableTaskFacts(graphOperation.operationId, failure._tag, failure.detail, graphOperation.target, prepared),
      /* v8 ignore next -- @preserve This live read has just journaled its outcome, so reconstruction cannot lack that outcome. */
      TaskTrackerKnowledgeUnavailable: (failure) =>
        Effect.fail(
          new AttemptRestartAuthorityContradiction({
            detail: `${failure.knowledge} could not be reconstructed from its recorded outcome ${failure.operationId}`,
            requestId,
            subject
          })
        )
    })
  )
  if (graphRead._tag === "Unreadable") {
    return { _tag: "AttemptRestartPending" as const, reason: "TaskFactsUnreadable" as const }
  }
  const graph = graphRead.graph
  if (!graph.eligibleTasks().some(({ id }) => id === subject.plannedAttempt.taskId)) {
    return { _tag: "AttemptRestartPending" as const, reason: "TaskNotEligible" as const }
  }
  return { ...prepared, _tag: "RestartGraphFacts" as const, graphOperation }
})

const readRestartTaskFacts = Effect.fn("AttemptRestart.readTaskFacts")(function* (facts: RestartGraphFacts) {
  const { requestId, subject } = restartRequestFor(facts)
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    nextRestartReadOperationId(
      records,
      requestId,
      "specification",
      /* v8 ignore next -- @preserve The applied Restart and graph-read records make this journal non-empty. */
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    facts.graphOperation.target,
    subject.plannedAttempt.taskId,
    [facts.graphOperation.operationId]
  )
  const specificationRead = yield* interpreter.readTaskWorkSpecification(specificationOperation).pipe(
    Effect.map((specification) => ({ _tag: "Readable" as const, specification })),
    Effect.catchTags({
      "FixtureReader.FixtureReadError": (failure) =>
        unreadableTaskFacts(
          specificationOperation.operationId,
          failure._tag,
          failure.detail,
          specificationOperation.target,
          facts
        ),
      "TrackerGraphReader.AdapterReadError": (failure) =>
        unreadableTaskFacts(
          specificationOperation.operationId,
          failure._tag,
          failure.detail,
          specificationOperation.target,
          facts
        ),
      "TrackerGraphReader.TrackerReadError": (failure) =>
        unreadableTaskFacts(
          specificationOperation.operationId,
          failure._tag,
          failure.detail,
          specificationOperation.target,
          facts
        ),
      /* v8 ignore next -- @preserve This live read has just journaled its outcome, so reconstruction cannot lack that outcome. */
      TaskTrackerKnowledgeUnavailable: (failure) =>
        Effect.fail(
          new AttemptRestartAuthorityContradiction({
            detail: `${failure.knowledge} could not be reconstructed from its recorded outcome ${failure.operationId}`,
            requestId,
            subject
          })
        )
    })
  )
  if (specificationRead._tag === "Unreadable") {
    return { _tag: "AttemptRestartPending" as const, reason: "TaskFactsUnreadable" as const }
  }
  const specification = specificationRead.specification
  if (specification.fingerprint !== subject.observedTaskRevision) {
    return { _tag: "AttemptRestartRejected" as const, reason: "NewFingerprintChoiceRequired" as const }
  }
  return { ...facts, _tag: "RestartTaskFacts" as const, specification, specificationOperation }
})

const readRestartClaim = Effect.fn("AttemptRestart.readClaim")(function* (facts: RestartTaskFacts) {
  const { requestId, subject } = restartRequestFor(facts)
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const claimOperation = makeTaskClaimObservationOperation(
    nextRestartReadOperationId(
      records,
      requestId,
      "claim",
      /* v8 ignore next -- @preserve The prior Restart authority reads make this journal non-empty. */
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
  const expectedClaim = restartClaimAuthorityAtApplication(
    yield* journal.read(subject.plannedAttempt.runId),
    facts.application
  )?.claim
  /* v8 ignore next -- @preserve An accepted Restart application is validated against its exact P1 claim authority. */
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

const readRestartWorktree = Effect.fn("AttemptRestart.readWorktree")(function* (facts: RestartClaimFacts) {
  const { requestId, subject } = restartRequestFor(facts)
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: nextRestartReadOperationId(
      records,
      requestId,
      "worktree",
      /* v8 ignore next -- @preserve The prior Restart authority reads make this journal non-empty. */
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    plannedAttempt: subject.plannedAttempt,
    predecessorOperationIds: [
      facts.graphOperation.operationId,
      facts.specificationOperation.operationId,
      facts.claimOperation.operationId
    ]
  })
  const worktreeRead = yield* interpreter.readTaskWorktree(worktreeOperation).pipe(
    Effect.map((worktree) => ({ _tag: "Readable" as const, worktree })),
    Effect.catchTag("GitWorktreeReadFailure", (failure) =>
      recordRestartAuthorityReadFailure(worktreeOperation.operationId, failure, facts).pipe(
        Effect.as({ _tag: "Unreadable" as const })
      )
    )
  )
  if (worktreeRead._tag === "Unreadable") {
    return { _tag: "AttemptRestartPending" as const, reason: "OldWorktreeUnreadable" as const }
  }
  const worktree = worktreeRead.worktree
  if (worktree.observation._tag !== "PlannedWorktreeReady") {
    return { _tag: "AttemptRestartPending" as const, reason: "OldWorktreeNotReady" as const }
  }
  return { ...facts, _tag: "RestartAuthorityFacts" as const, oldWorktreeProof: worktree.observation, worktreeOperation }
})

const successorIsExact = (
  successor: PlannedTaskAttempt,
  facts: Pick<RestartTaskFacts, "application" | "specification">,
  targetHeadSha: GitCommitSha
): boolean => {
  const { subject } = restartRequestFor(facts)
  return [
    successor.runId === subject.plannedAttempt.runId,
    successor.taskId === subject.plannedAttempt.taskId,
    successor.taskRevision === facts.specification.fingerprint,
    successor.baseSha === targetHeadSha,
    successor.attemptId !== subject.plannedAttempt.attemptId,
    successor.branch !== subject.plannedAttempt.branch,
    successor.worktree !== subject.plannedAttempt.worktree
  ].every(Boolean)
}

const replacementDispositionBeforeAllocation = Effect.fn("AttemptRestart.dispositionBeforeAllocation")(function* (
  records: ReadonlyArray<JournalRecord>,
  facts: RestartAuthorityFacts
) {
  const { requestId, subject } = restartRequestFor(facts)
  const recorded = exactRecordedReplacement(records, requestId, subject)
  /* v8 ignore next -- @preserve Valid reconstructed history cannot contain contradictory exact replacement records. */
  if (recorded._tag === "Contradictory") {
    return yield* new AttemptRestartChoiceContradiction({ requestId, subject })
  }
  /* v8 ignore next -- @preserve The caller reconciles an already-recorded replacement before entering allocation. */
  if (recorded._tag === "Exact") {
    return { _tag: "PlannedAttemptReplacementRecorded" as const, replacement: recorded.replacement }
  }
  return restartChoiceWasInvalidatedByLaterSpecification(records, facts.application.position, subject)
    ? { _tag: "AttemptRestartRejected" as const, reason: "NewFingerprintChoiceRequired" as const }
    : undefined
})

const recordAttemptReplacement = Effect.fn("AttemptRestart.recordReplacement")(function* (
  facts: RestartAuthorityFacts,
  integrationTarget: IntegrationTarget
) {
  const { requestId, subject } = restartRequestFor(facts)
  const journal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  let records = yield* journal.read(subject.plannedAttempt.runId)
  const targetOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: nextRestartReadOperationId(
      records,
      requestId,
      "target-lineage",
      /* v8 ignore next -- @preserve The prior Restart authority reads make this journal non-empty. */
      records.at(lastRecordOffset)?.position ?? facts.application.position
    ),
    plannedAttempt: subject.plannedAttempt,
    predecessorOperationIds: [facts.worktreeOperation.operationId]
  })
  const targetRead = yield* interpreter.readTargetLineage(targetOperation).pipe(
    Effect.map((target) => ({ _tag: "Readable" as const, target })),
    Effect.catchTag("GitTargetLineageReadFailure", (failure) =>
      recordRestartAuthorityReadFailure(targetOperation.operationId, failure, facts).pipe(
        Effect.as({ _tag: "Unreadable" as const })
      )
    )
  )
  if (targetRead._tag === "Unreadable") {
    return { _tag: "AttemptRestartPending" as const, reason: "TargetHeadUnreadable" as const }
  }
  const target = targetRead.target

  records = yield* journal.read(subject.plannedAttempt.runId)
  const disposition = yield* replacementDispositionBeforeAllocation(records, facts)
  if (disposition !== undefined) return disposition
  const planner = yield* PlannedTaskAttemptPlanner
  const allocator = yield* OperationIdAllocator
  const priorRecordedAttemptCount = recordedTaskAttemptPlans(records).filter(
    ({ plannedAttempt }) => plannedAttempt.taskId === subject.plannedAttempt.taskId
  ).length
  const successor = yield* planner.plan(
    PlannedTaskAttemptPlanRequest.ExactReplacement({
      baseSha: target.observation.targetHeadSha,
      ordinal: PlannedTaskAttemptOrdinal.make(priorRecordedAttemptCount),
      specification: facts.specification
    })
  )
  if (!successorIsExact(successor, facts, target.observation.targetHeadSha)) {
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
      facts.expectedClaim.operationId,
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
  const graphFacts = yield* readRestartGraph(prepared)
  if (graphFacts._tag !== "RestartGraphFacts") return graphFacts
  const taskFacts = yield* readRestartTaskFacts(graphFacts)
  if (taskFacts._tag !== "RestartTaskFacts") return taskFacts
  const claimFacts = yield* readRestartClaim(taskFacts)
  if (claimFacts._tag !== "RestartClaimFacts") return claimFacts
  const authorityFacts = yield* readRestartWorktree(claimFacts)
  if (authorityFacts._tag !== "RestartAuthorityFacts") return authorityFacts
  return yield* recordAttemptReplacement(authorityFacts, integrationTarget)
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
