import { Context, Effect, Layer, Ref, Schema } from "effect"
import { acceptedResultFixture, evidenceReferenceFixture } from "../../../../test/support/evidence.js"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { runIntegrationCandidateConstruction as runIntegrationCandidateConstructionWithLimit } from "../../../coordination/run/integration-candidate-runtime.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalStore } from "../../../workflow-journal/store.js"
import { rememberValidatedJournalPrefixSuccessor } from "../../../workflow-journal/prefix-lineage.js"
import {
  attemptPlanRecordKey,
  integrationCandidateAgentReportRecordKey,
  integrationCandidateConstructionIntentRecordKey,
  integrationCandidateGitObservationRecordKey,
  integrationCandidateSessionSupersededRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../../../workflow-journal/record-key.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../../control/policy.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorkCapacityChangedEvent
} from "../../registry/event.js"
import { makeTaskAttemptPlanOperation, makeTaskClaimAcquisitionOperation } from "../../registry/operation.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "../integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import {
  CandidateContinuationLimit,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateSessionSupersededEvent,
  integrationCandidateConstructionEventCorrelation
} from "./events.js"
import {
  CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction as continueIntegrationCandidateConstructionWithLimit,
  deriveIntegrationCandidateConstruction,
  deriveConstructedIntegrationCandidateOccurrence,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitReadFailure,
  IntegrationCandidateTargetLineageRejected,
  IntegrationSessionId,
  integrationCandidateSuccessorOrdinalFor,
  supersededSessionMatches,
  type IntegrationCandidateAgentRequest
} from "./protocol.js"

const runId = RunId.make("candidate-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/candidate.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const base = GitCommitSha.make("1".repeat(40))
const head = GitCommitSha.make("2".repeat(40))
const advancedHead = GitCommitSha.make("8".repeat(40))
const acceptedCommit = GitCommitSha.make("3".repeat(40))
const candidate = GitCommitSha.make("4".repeat(40))
const successorCandidate = GitCommitSha.make("9".repeat(40))
const continuationLimit = CandidateContinuationLimit.make(2)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("candidate-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/candidate-attempt"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("candidate-task"),
  taskRevision: TaskRevision.make("candidate-revision"),
  worktree: WorktreeLocator.make("/worktrees/candidate-attempt")
})
const acceptedResult = acceptedResultFixture(acceptedCommit)
const started = StartedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(8),
  startedAt: JournalPosition.make(9)
})
const lineage = TargetLineageObservation.make({
  plannedBaseIsAncestorOfTargetHead: true,
  plannedBaseSha: base,
  targetHeadSha: head
})
const continueIntegrationCandidateConstruction = (
  ...input: Parameters<typeof continueIntegrationCandidateConstructionWithLimit> extends [
    infer Responsibility,
    infer Lineage,
    infer CorrectionLimit,
    unknown
  ]
    ? [Responsibility, Lineage, CorrectionLimit]
    : never
) => continueIntegrationCandidateConstructionWithLimit(...input, continuationLimit)
const runIntegrationCandidateConstruction = (
  ...input: Parameters<typeof runIntegrationCandidateConstructionWithLimit> extends [
    infer Responsibility,
    infer Lineage,
    infer CorrectionLimit,
    unknown,
    infer Resources
  ]
    ? [Responsibility, Lineage, CorrectionLimit, Resources]
    : never
) => runIntegrationCandidateConstructionWithLimit(input[0], input[1], input[2], continuationLimit, input[3])
const placeholderCorrelation = {
  acceptanceManifest: acceptedResult.evidenceManifest,
  acceptedResultCommit: acceptedCommit,
  attemptId: plannedAttempt.attemptId,
  candidateId: IntegrationCandidateId.make("placeholder-candidate"),
  candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/placeholder"),
  expectedTargetHead: head,
  integrationSessionId: IntegrationSessionId.make("placeholder-session"),
  integrationTarget: target,
  runId
}

const seedStartedResponsibility = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("candidate-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
  )
  const claimOperationId = OperationId.make("candidate-claim")
  const claim = {
    operationId: claimOperationId,
    owner: ClaimOwner.make("dalph"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make("candidate-claim-token")
  }
  yield* journal.append(
    runId,
    intentRecordKey(claimOperationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(claimOperationId),
    TaskClaimAcquiredEvent.make({ claim: { _tag: "ActiveTaskClaim", ...claim }, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({
      operation: makeTaskAttemptPlanOperation({
        operationId: OperationId.make("candidate-plan"),
        plannedAttempt,
        predecessorOperationIds: [claimOperationId]
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const executorReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, executorReportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: executorReportOrdinal,
      report: PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Accepted", acceptedResult }
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget: target,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationStartedRecordKey(plannedAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget: target,
      plannedAttempt,
      responsibilityBeganAt: JournalPosition.make(8),
      version: workflowJournalEventVersion
    })
  )
})

type GitResult = IntegrationCandidateGitObservation | IntegrationCandidateGitReadFailure

const candidateBoundaryLayer = (
  reports: ReadonlyArray<IntegrationCandidateAgentReport>,
  gitResults: ReadonlyArray<GitResult> = [
    IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
  ],
  normalizeCorrelation = true
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const pending = yield* Ref.make(reports)
      const pendingGit = yield* Ref.make(gitResults)
      const invocations = yield* Ref.make(0)
      const gitReads = yield* Ref.make(0)
      const requests = yield* Ref.make<ReadonlyArray<IntegrationCandidateAgentRequest>>([])
      return Context.empty().pipe(
        Context.add(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              Effect.gen(function* () {
                yield* Ref.update(invocations, (count) => count + 1)
                yield* Ref.update(requests, (current) => [...current, request])
                const report = yield* Ref.modify(pending, (current) => [current[0], current.slice(1)] as const)
                if (report === undefined)
                  return IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
                if (!normalizeCorrelation) return report
                return report._tag === "Submitted"
                  ? IntegrationCandidateAgentReport.cases.Submitted.make({
                      candidateCommit: report.candidateCommit,
                      correlation: request.correlation,
                      reviewManifest: report.reviewManifest
                    })
                  : report._tag === "Conflict"
                    ? IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: request.correlation })
                    : report._tag === "ExitedWithoutCandidate"
                      ? IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({
                          correlation: request.correlation
                        })
                      : IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
              })
          })
        ),
        Context.add(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: () =>
              Effect.gen(function* () {
                yield* Ref.update(gitReads, (count) => count + 1)
                const result = yield* Ref.modify(pendingGit, (current) => [current[0], current.slice(1)] as const)
                if (result === undefined) {
                  return IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
                }
                return result._tag === "IntegrationCandidateGitReadFailure" ? yield* result : result
              })
          })
        ),
        Context.add(CandidateBoundaryInspection, {
          gitReads: Ref.get(gitReads),
          invocations: Ref.get(invocations),
          requests: Ref.get(requests)
        })
      )
    })
  )

class CandidateBoundaryInspection extends Context.Service<
  CandidateBoundaryInspection,
  {
    readonly gitReads: Effect.Effect<number>
    readonly invocations: Effect.Effect<number>
    readonly requests: Effect.Effect<ReadonlyArray<IntegrationCandidateAgentRequest>>
  }
>()("@dalph/IntegrationCandidateConstruction/TestInspection") {}

it.effect("builds one candidate with current target first and accepted result second", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")
    if (first._tag !== "CandidateConstructed") return
    expect(first.candidateCommit).toBe(candidate)
    expect(first.expectedTargetHead).toBe(head)
    expect(first.acceptedResult.commit).toBe(acceptedCommit)

    const records = yield* (yield* JournalStore).read(runId)
    expect(deriveIntegrationCandidateConstruction(records, started)).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate,
      expectedTargetHead: head
    })
    const constructedOccurrence = deriveConstructedIntegrationCandidateOccurrence(records, started)
    expect(constructedOccurrence).toMatchObject({
      candidateCommit: candidate,
      constructedAt: expect.anything(),
      correlation: expect.objectContaining({ expectedTargetHead: head }),
      reviewManifest: evidenceReferenceFixture
    })
    expect(deriveConstructedIntegrationCandidateOccurrence(records.slice(0, -1), started)).toBeUndefined()
    const report = records.find(({ event }) => event._tag === "IntegrationCandidateAgentReported")?.event
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (
      report?._tag !== "IntegrationCandidateAgentReported" ||
      intent?._tag !== "IntegrationCandidateConstructionIntended"
    ) {
      return yield* Effect.die("candidate fixture lacks its report and intent")
    }
    expect(integrationCandidateConstructionEventCorrelation(report)).toEqual(report.expectedCorrelation)
    expect(integrationCandidateConstructionEventCorrelation(intent)).toEqual(intent.correlation)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: {
            acceptanceManifest: acceptedResult.evidenceManifest,
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          },
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("reuses validated journal prefixes while deriving candidate state", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const constructed = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    )
    expect(constructed._tag).toBe("CandidateConstructed")

    const journal = yield* JournalStore
    const priorRecords = yield* journal.read(runId)
    const prior = reduceWorkflowJournalHistory(runId, priorRecords)
    if (prior._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die("expected valid candidate prefix")
    const changed = yield* journal.append(
      runId,
      taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(2)),
      TaskWorkCapacityChangedEvent.make({
        capacity: defaultTaskWorkCapacity,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: RunPolicyRevision.make(1),
        revision: RunPolicyRevision.make(2),
        version: workflowJournalEventVersion
      })
    )
    const advancedRecords = yield* journal.read(runId)
    const advanced = reduceWorkflowJournalHistory(runId, advancedRecords)
    if (advanced._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die(`expected valid advanced prefix: ${JSON.stringify(advanced.issues)}`)
    }
    rememberValidatedJournalPrefixSuccessor(prior, advanced, changed)

    const alternate = StartedIntegrationResponsibility.make({ ...started, startedAt: JournalPosition.make(999) })
    expect(deriveIntegrationCandidateConstruction(advancedRecords, alternate)).toBeUndefined()
    expect(deriveIntegrationCandidateConstruction(advancedRecords, started)).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate
    })
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("reuses an already recorded successor session during stale-candidate reconciliation", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (intent?._tag !== "IntegrationCandidateConstructionIntended")
      return yield* Effect.die("missing candidate intent")
    const successor = {
      ...intent.correlation,
      candidateId: IntegrationCandidateId.make("pre-recorded-successor"),
      candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/pre-recorded-successor"),
      expectedTargetHead: advancedHead,
      integrationSessionId: IntegrationSessionId.make("pre-recorded-successor-session")
    }
    yield* journal.append(
      runId,
      integrationCandidateSessionSupersededRecordKey(intent.correlation, successor),
      IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: advancedHead,
        priorCandidateCommit: candidate,
        priorCorrelation: intent.correlation,
        responsibilityBeganAt: started.queuedAt,
        startedAt: started.startedAt,
        successorCorrelation: successor,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationCandidateConstructionIntentRecordKey(successor),
      IntegrationCandidateConstructionIntendedEvent.make({
        correlation: successor,
        correctionLimit: CandidateCorrectionLimit.make(2),
        continuationLimit,
        plannedAttempt,
        responsibilityBeganAt: started.queuedAt,
        startedAt: JournalPosition.make(99),
        version: workflowJournalEventVersion
      })
    )

    const reconciled = yield* continueIntegrationCandidateConstruction(
      started,
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: advancedHead
      }),
      CandidateCorrectionLimit.make(2)
    )
    expect(reconciled).toMatchObject({ _tag: "CandidateConstructed", candidateCommit: candidate })
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("supersedes a stale pre-promotion session before starting one successor", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")

    const successorLineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: base,
      targetHeadSha: advancedHead
    })
    const successor = yield* continueIntegrationCandidateConstruction(
      started,
      successorLineage,
      CandidateCorrectionLimit.make(2)
    )

    expect(successor).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: successorCandidate,
      expectedTargetHead: advancedHead
    })
    const records = yield* (yield* JournalStore).read(runId)
    const supersessionAt = records.findIndex(({ event }) => event._tag === "IntegrationCandidateSessionSuperseded")
    const intents = records.flatMap(({ event }, position) =>
      event._tag === "IntegrationCandidateConstructionIntended" ? [{ event, position }] : []
    )
    expect(supersessionAt).toBeGreaterThan(-1)
    expect(intents).toHaveLength(2)
    expect(supersessionAt).toBeLessThan(intents[1]?.position ?? Number.POSITIVE_INFINITY)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateConstructed")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateSessionSuperseded")).toHaveLength(1)
    const supersession = records.find(({ event }) => event._tag === "IntegrationCandidateSessionSuperseded")?.event
    if (supersession?._tag !== "IntegrationCandidateSessionSuperseded") return expect.fail("expected supersession")
    expect(integrationCandidateConstructionEventCorrelation(supersession)).toEqual(supersession.successorCorrelation)
    expect(supersededSessionMatches(supersession, supersession.priorCorrelation, advancedHead)).toBe(true)
    expect(
      supersededSessionMatches(
        supersession,
        { ...supersession.priorCorrelation, integrationSessionId: IntegrationSessionId.make("another-session") },
        advancedHead
      )
    ).toBe(false)
    expect(supersededSessionMatches(supersession, supersession.priorCorrelation, head)).toBe(false)
    expect(
      supersededSessionMatches(
        { _tag: "WorkflowRunBegan" } as Parameters<typeof supersededSessionMatches>[0],
        supersession.priorCorrelation,
        advancedHead
      )
    ).toBe(false)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")

    const repeated = yield* continueIntegrationCandidateConstruction(
      started,
      successorLineage,
      CandidateCorrectionLimit.make(2)
    )
    expect(repeated).toEqual(successor)
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(
        ({ event }) => event._tag === "IntegrationCandidateSessionSuperseded"
      )
    ).toHaveLength(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, successorCandidate].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ),
        [
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] }),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [advancedHead, acceptedCommit] })
        ]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("preserves a constructed candidate while rejecting an incompatible fresh target lineage", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")

    const incompatible = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: base,
      targetHeadSha: advancedHead
    })
    const rejected = yield* continueIntegrationCandidateConstruction(
      started,
      incompatible,
      CandidateCorrectionLimit.make(2)
    ).pipe(Effect.flip)

    expect(rejected).toBeInstanceOf(IntegrationCandidateTargetLineageRejected)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateSessionSuperseded")).toHaveLength(0)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateConstructed")).toHaveLength(1)
    expect(deriveIntegrationCandidateConstruction(records, started)).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate,
      expectedTargetHead: head
    })
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it("does not let an unrelated task in the same run perturb the successor ordinal", () => {
  const unrelatedAccepted = acceptedResultFixture(GitCommitSha.make("a".repeat(40)))
  const unrelatedAttempt = AttemptId.make("unrelated-task-attempt")
  const unrelatedPriorCorrelation = {
    ...placeholderCorrelation,
    acceptanceManifest: unrelatedAccepted.evidenceManifest,
    acceptedResultCommit: unrelatedAccepted.commit,
    attemptId: unrelatedAttempt,
    candidateId: IntegrationCandidateId.make("unrelated-prior-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("unrelated-prior-resource"),
    integrationSessionId: IntegrationSessionId.make("unrelated-prior-session")
  }
  const unrelatedSuccessorCorrelation = {
    ...unrelatedPriorCorrelation,
    candidateId: IntegrationCandidateId.make("unrelated-successor-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("unrelated-successor-resource"),
    expectedTargetHead: advancedHead,
    integrationSessionId: IntegrationSessionId.make("unrelated-successor-session")
  }
  const unrelated = IntegrationCandidateSessionSupersededEvent.make({
    observedTargetHead: advancedHead,
    priorCandidateCommit: candidate,
    priorCorrelation: unrelatedPriorCorrelation,
    responsibilityBeganAt: JournalPosition.make(90),
    startedAt: JournalPosition.make(91),
    successorCorrelation: unrelatedSuccessorCorrelation,
    version: workflowJournalEventVersion
  })
  const ownSuccessorCorrelation = {
    ...placeholderCorrelation,
    candidateId: IntegrationCandidateId.make("own-successor-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("own-successor-resource"),
    expectedTargetHead: advancedHead,
    integrationSessionId: IntegrationSessionId.make("own-successor-session")
  }
  const own = IntegrationCandidateSessionSupersededEvent.make({
    observedTargetHead: advancedHead,
    priorCandidateCommit: candidate,
    priorCorrelation: placeholderCorrelation,
    responsibilityBeganAt: started.queuedAt,
    startedAt: started.startedAt,
    successorCorrelation: ownSuccessorCorrelation,
    version: workflowJournalEventVersion
  })
  const record = (event: typeof unrelated, position: number) => ({
    event,
    key: JournalRecordKey.make(`successor-ordinal:${position}`),
    position: JournalPosition.make(position),
    runId
  })

  expect(integrationCandidateSuccessorOrdinalFor([record(unrelated, 1)], started)).toBe(1)
  expect(integrationCandidateSuccessorOrdinalFor([record(unrelated, 1), record(own, 2)], started)).toBe(2)
})

it.effect("does not verify or promote the constructed candidate", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const result = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(result._tag).toBe("CandidateConstructed")

    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag).filter((tag) => tag.startsWith("IntegrationCandidate"))).toEqual([
      "IntegrationCandidateConstructionIntended",
      "IntegrationCandidateAgentReported",
      "IntegrationCandidateGitObserved",
      "IntegrationCandidateConstructed"
    ])
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("requires explicit candidate submission instead of inferring worktree head", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const result = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(result._tag).toBe("CandidateConstructionInProgress")
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.gitReads).toBe(0)
  }).pipe(Effect.provide(candidateBoundaryLayer([])), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("keeps the first submitted candidate when later commits appear", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const second = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")
    expect(second).toEqual(first)
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: {
            acceptanceManifest: acceptedResult.evidenceManifest,
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          },
          reviewManifest: evidenceReferenceFixture
        }),
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: GitCommitSha.make("5".repeat(40)),
          correlation: {
            acceptanceManifest: acceptedResult.evidenceManifest,
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          },
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("reopens an ambiguously constructed candidate before retrying it", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const journal = yield* JournalStore
    const crashingJournal = JournalStore.of({
      ...journal,
      append: (recordRunId, key, event) =>
        event._tag === "IntegrationCandidateConstructed"
          ? Effect.die("process stopped after the Git observation")
          : journal.append(recordRunId, key, event)
    })
    const stopped = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(Effect.provide(Layer.succeed(InRunJournal, InRunJournal.of(crashingJournal))), Effect.exit)
    expect(stopped._tag).toBe("Failure")
    expect(deriveIntegrationCandidateConstruction(yield* journal.read(runId), started)?._tag).toBe(
      "CandidateValidationPending"
    )

    const reopened = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(reopened).toMatchObject({ _tag: "CandidateConstructed", candidateCommit: candidate })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect(
  "rejects rewritten target lineage before candidate construction and preserves its accepted responsibility",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const rejected = yield* continueIntegrationCandidateConstruction(
        started,
        TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: false,
          plannedBaseSha: base,
          targetHeadSha: GitCommitSha.make("9".repeat(40))
        }),
        CandidateCorrectionLimit.make(2)
      ).pipe(Effect.flip)
      expect(rejected).toBeInstanceOf(IntegrationCandidateTargetLineageRejected)
      const inspection = yield* CandidateBoundaryInspection
      expect(yield* inspection.invocations).toBe(0)
      const records = yield* (yield* JournalStore).read(runId)
      expect(records.filter(({ event }) => event._tag.startsWith("IntegrationCandidate"))).toEqual([])
      expect(records.slice(-2).map(({ event }) => event._tag)).toEqual([
        "IntegrationResponsibilityBegan",
        "IntegrationStarted"
      ])
    }).pipe(Effect.provide(candidateBoundaryLayer([])), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("keeps conflict edits bound to the same candidate and integration session", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const conflict = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const completed = yield* continueIntegrationCandidateConstruction(
      started,
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: GitCommitSha.make("8".repeat(40))
      }),
      CandidateCorrectionLimit.make(2)
    )
    expect(conflict._tag).toBe("CandidateConstructionInProgress")
    expect(completed._tag).toBe("CandidateConstructed")
    const requests = yield* (yield* CandidateBoundaryInspection).requests
    expect(requests).toHaveLength(2)
    expect(requests[0]?.correlation).toEqual(requests[1]?.correlation)
    expect(requests[0]?.correlation.expectedTargetHead).toBe(lineage.targetHeadSha)
    expect(requests[0]?.candidateResource).toBe(requests[1]?.candidateResource)
    expect(requests[0]?.candidateResource).not.toBe(plannedAttempt.worktree)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation }),
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("continues the fixed session after a later target rewrite observation", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const conflict = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const completed = yield* continueIntegrationCandidateConstruction(
      started,
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: false,
        plannedBaseSha: base,
        targetHeadSha: GitCommitSha.make("8".repeat(40))
      }),
      CandidateCorrectionLimit.make(2)
    )

    expect(conflict._tag).toBe("CandidateConstructionInProgress")
    expect(completed).toMatchObject({ _tag: "CandidateConstructed", expectedTargetHead: lineage.targetHeadSha })
    const requests = yield* (yield* CandidateBoundaryInspection).requests
    expect(requests[0]?.correlation).toEqual(requests[1]?.correlation)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation }),
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation,
          reviewManifest: evidenceReferenceFixture
        })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("stops automatic agent continuation at the durable configured limit", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const second = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const stopped = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))

    expect(first._tag).toBe("CandidateConstructionInProgress")
    expect(second._tag).toBe("CandidateConstructionInProgress")
    expect(stopped).toMatchObject({
      _tag: "CandidateContinuationLimitReached",
      continuationCount: 2,
      continuationLimit: 2
    })
    expect(yield* (yield* CandidateBoundaryInspection).invocations).toBe(2)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateContinuationLimitReached")).toHaveLength(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Working.make({ correlation: placeholderCorrelation }),
        IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({ correlation: placeholderCorrelation })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("preserves conflicting candidate work across restart", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(
      Effect.provide(
        candidateBoundaryLayer([
          IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation })
        ])
      )
    )
    const second = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(
      Effect.provide(
        candidateBoundaryLayer([
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ])
      )
    )
    expect(first._tag).toBe("CandidateConstructionInProgress")
    expect(second).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate,
      correlation: first._tag === "CandidateConstructionInProgress" ? first.correlation : undefined
    })
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("ignores agent reports addressed to another candidate responsibility", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const records = yield* (yield* JournalStore).read(runId)
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (intent?._tag !== "IntegrationCandidateConstructionIntended") return yield* Effect.die("missing intent")
    const foreign = { ...intent.correlation, candidateId: IntegrationCandidateId.make("foreign-candidate") }
    yield* (yield* JournalStore).append(
      runId,
      JournalRecordKey.make("candidate:foreign-agent-report"),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: foreign,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(2),
        report: IntegrationCandidateAgentReport.cases.Working.make({ correlation: foreign }),
        version: workflowJournalEventVersion
      })
    )
    expect(deriveIntegrationCandidateConstruction(yield* (yield* JournalStore).read(runId), started)?._tag).toBe(
      "CandidateConstructionInProgress"
    )
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation })
      ])
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect(
  "returns an invalid parent structure and accepts the first exact corrected submission in the same session",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const rejected = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(rejected._tag).toBe("CandidateCorrectionRequired")
      const completed = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(completed._tag).toBe("CandidateConstructed")
      const requests = yield* (yield* CandidateBoundaryInspection).requests
      expect(requests[1]?.correction).toContain("ordered direct parents")
      expect(requests[0]?.correlation.integrationSessionId).toBe(requests[1]?.correlation.integrationSessionId)
    }).pipe(
      Effect.provide(
        candidateBoundaryLayer(
          [
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: candidate,
              correlation: placeholderCorrelation,
              reviewManifest: evidenceReferenceFixture
            }),
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: GitCommitSha.make("5".repeat(40)),
              correlation: placeholderCorrelation,
              reviewManifest: evidenceReferenceFixture
            })
          ],
          [
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [acceptedCommit, head] }),
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
          ]
        )
      ),
      Effect.provide(legacyMemoryJournalStoreLayer)
    )
)

it.effect("reconciles a limit-reaching Git observation after a crash before another agent call", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    expect(first).toMatchObject({ _tag: "CandidateCorrectionRequired", correctionCount: 0 })

    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (intent?._tag !== "IntegrationCandidateConstructionIntended") return yield* Effect.die("missing intent")
    const correctedCandidate = GitCommitSha.make("5".repeat(40))
    const correctedOrdinal = IntegrationCandidateAgentReportOrdinal.make(2)
    const submitted = yield* journal.append(
      runId,
      integrationCandidateAgentReportRecordKey(intent.correlation, correctedOrdinal),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: intent.correlation,
        ordinal: correctedOrdinal,
        report: IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: correctedCandidate,
          correlation: intent.correlation,
          reviewManifest: evidenceReferenceFixture
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationCandidateGitObservationRecordKey(intent.correlation, submitted.position),
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit: correctedCandidate,
        correlation: intent.correlation,
        observation: IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [] }),
        submissionAt: submitted.position,
        version: workflowJournalEventVersion
      })
    )
    expect(reduceWorkflowJournalHistory(runId, yield* journal.read(runId))._tag).toBe("ValidWorkflowJournalHistory")

    const recovered = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1)
    )
    expect(recovered).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1, correctionLimit: 1 })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ],
        [IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [] })]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("returns a missing or non-commit submission to the same integration agent", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const missing = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(3))
    const nonCommit = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(3)
    )
    const completed = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(3)
    )
    expect(missing).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "Missing" })
    expect(nonCommit).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "NonCommit" })
    expect(completed._tag).toBe("CandidateConstructed")
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40)), GitCommitSha.make("6".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.NonCommit.make({ objectType: "tree" }),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
        ]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("fails closed before Git and preserves involved sessions without automatic resubmission", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const contradicted = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    )
    expect(contradicted._tag).toBe("CandidateCorrelationContradiction")
    const repeated = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(repeated).toEqual(contradicted)
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.gitReads).toBe(0)
    expect(yield* inspection.invocations).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: {
              ...placeholderCorrelation,
              candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/foreign")
            },
            reviewManifest: evidenceReferenceFixture
          })
        ],
        undefined,
        false
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect(
  "keeps and rereads the same submitted candidate without charging an agent correction round when Git is unreadable",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const pending = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(pending).toMatchObject({ _tag: "CandidateValidationPending", candidateCommit: candidate })
      const completed = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(completed._tag).toBe("CandidateConstructed")
      const inspection = yield* CandidateBoundaryInspection
      expect(yield* inspection.invocations).toBe(1)
      expect(yield* inspection.gitReads).toBe(2)
    }).pipe(
      Effect.provide(
        candidateBoundaryLayer(
          [
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: candidate,
              correlation: placeholderCorrelation,
              reviewManifest: evidenceReferenceFixture
            })
          ],
          [
            new IntegrationCandidateGitReadFailure({
              candidateCommit: candidate,
              detail: "cat-file timed out",
              repository: target.repository
            }),
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
          ]
        )
      ),
      Effect.provide(legacyMemoryJournalStoreLayer)
    )
)

it.effect("resolves a later readable invalid Git result through same-session correction", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const pending = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const invalid = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(pending._tag).toBe("CandidateValidationPending")
    expect(invalid).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "WrongParents" })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(2)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ],
        [
          new IntegrationCandidateGitReadFailure({
            candidateCommit: candidate,
            detail: "repository temporarily unreadable",
            repository: target.repository
          }),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [acceptedCommit, head] })
        ]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("preserves non-convergent work and leaves the task incomplete after correction exhaustion", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    const exhausted = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1)
    )
    expect(first._tag).toBe("CandidateCorrectionRequired")
    expect(exhausted).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1 })
    const repeated = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    expect(repeated).toEqual(exhausted)
    expect(yield* (yield* CandidateBoundaryInspection).invocations).toBe(2)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head] })
        ]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("releases the integration target after non-convergence so unrelated work may continue", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const resources = yield* makeIntegrationTargetResourceController()
    yield* resources.acquire(started)
    yield* runIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1), resources)
    const exhausted = yield* runIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1),
      resources
    )
    expect(exhausted).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1 })
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    expect(exhausted._tag === "CandidateCorrectionLimitReached" && exhausted.correlation.acceptedResultCommit).toBe(
      acceptedCommit
    )
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit,
            correlation: placeholderCorrelation,
            reviewManifest: evidenceReferenceFixture
          })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head] })
        ]
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect(
  "releases the integration target after automatic continuation exhaustion so unrelated work may continue",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const resources = yield* makeIntegrationTargetResourceController()
      yield* resources.acquire(started)
      const first = yield* runIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(1),
        resources
      )
      const exhausted = yield* runIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(1),
        resources
      )
      const released = yield* runIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(1),
        resources
      )
      expect(first._tag).toBe("CandidateConstructionInProgress")
      expect(exhausted._tag).toBe("CandidateConstructionInProgress")
      expect(released).toMatchObject({
        _tag: "CandidateContinuationLimitReached",
        continuationCount: 2,
        continuationLimit: 2
      })
      expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    }).pipe(
      Effect.provide(
        candidateBoundaryLayer([
          IntegrationCandidateAgentReport.cases.Working.make({ correlation: placeholderCorrelation }),
          IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation })
        ])
      ),
      Effect.provide(legacyMemoryJournalStoreLayer)
    )
)

it("rejects every cross-scope and identity-changing candidate-session supersession", () => {
  const successorCorrelation = {
    ...placeholderCorrelation,
    candidateId: IntegrationCandidateId.make("supersession-successor"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/supersession-successor"),
    integrationSessionId: IntegrationSessionId.make("supersession-successor-session")
  }
  const base = {
    _tag: "IntegrationCandidateSessionSuperseded" as const,
    observedTargetHead: head,
    priorCandidateCommit: candidate,
    priorCorrelation: placeholderCorrelation,
    responsibilityBeganAt: JournalPosition.make(8),
    startedAt: JournalPosition.make(9),
    successorCorrelation,
    version: workflowJournalEventVersion
  }
  expect(Schema.is(IntegrationCandidateSessionSupersededEvent)(base)).toBe(true)

  const invalid = (change: Partial<typeof base>) =>
    expect(Schema.is(IntegrationCandidateSessionSupersededEvent)({ ...base, ...change })).toBe(false)
  invalid({ successorCorrelation: { ...successorCorrelation, runId: RunId.make("foreign-run") } })
  invalid({ successorCorrelation: { ...successorCorrelation, attemptId: AttemptId.make("foreign-attempt") } })
  invalid({
    successorCorrelation: {
      ...successorCorrelation,
      integrationTarget: IntegrationTarget.make({
        repository: target.repository,
        ref: IntegrationTargetRef.make("refs/heads/other")
      })
    }
  })
  invalid({
    successorCorrelation: {
      ...successorCorrelation,
      integrationTarget: IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/other.git"),
        ref: target.ref
      })
    }
  })
  invalid({
    successorCorrelation: { ...successorCorrelation, candidateResource: placeholderCorrelation.candidateResource }
  })
  invalid({
    successorCorrelation: { ...successorCorrelation, acceptedResultCommit: GitCommitSha.make("6".repeat(40)) }
  })
  invalid({
    successorCorrelation: {
      ...successorCorrelation,
      acceptanceManifest: {
        ...successorCorrelation.acceptanceManifest,
        byteLength: successorCorrelation.acceptanceManifest.byteLength + 1
      }
    }
  })
  invalid({ successorCorrelation: { ...successorCorrelation, candidateId: placeholderCorrelation.candidateId } })
  invalid({
    successorCorrelation: { ...successorCorrelation, integrationSessionId: placeholderCorrelation.integrationSessionId }
  })
  invalid({ observedTargetHead: GitCommitSha.make("7".repeat(40)) })
})
