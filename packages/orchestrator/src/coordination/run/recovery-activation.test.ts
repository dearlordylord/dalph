import { it as effectIt } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect, it } from "vitest"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
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
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { validSnapshot } from "../../../test/task-dag.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { UntrackedWorktreePath, PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  TargetPromotionIntendedEvent,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorResult,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId as OuterIntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../../workflow/protocols/integrator/state.js"
import { evaluateIntegratorRetryAuthorization } from "../../workflow/protocols/integrator/retry-authorization.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import type { PlannedAttemptWorktreeObservation } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../workflow/registry/event.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  outcomeRecordKey
} from "../../workflow-journal/record-key.js"
import {
  continuationDecisionFor,
  continuationFreshnessBaselineForAttempt,
  deriveJournalResponsibilityFacts,
  filterFrontierForActivePauses,
  makeRunRecoveryProjection,
  safelySuspendedAttemptMayContinue,
  taskPauseSuspensionIsOwed
} from "./recovery-activation.js"
import { authorizedClaimForAttempt } from "./recovery-authority.js"
import { ReconstructedPauseState, type ReconstructedRunState } from "../reconstruction/state.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"

const coverageRunId = RunId.make("recovery-activation-coverage-run")
const coverageTarget = FixtureTarget.make("recovery-activation-coverage-target")
const coverageAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("recovery-activation-coverage-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/recovery-activation-coverage"),
  executor: TaskExecutorLocator.make("executor:recovery-activation-coverage"),
  runId: coverageRunId,
  taskId: TaskId.make("recovery-activation-coverage-task"),
  taskRevision: TaskRevision.make("recovery-activation-planned-revision"),
  worktree: WorktreeLocator.make("/worktrees/recovery-activation-coverage")
})
const coveragePolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const coverageRecord = (position: number, event: JournalRecord["event"], runId = coverageRunId): JournalRecord => ({
  event,
  key: outcomeRecordKey(OperationId.make(`recovery-activation-coverage-record-${position}`)),
  position: JournalPosition.make(position),
  runId
})

const coverageRunState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: ReconstructedRunState["responsibility"]["entries"] = [],
  runId = coverageRunId
): ReconstructedRunState => ({
  appliedThrough: records.at(-1)?.position ?? null,
  controlPolicy: Option.none(),
  graphKnowledge: { taskTrackerFacts: [] },
  pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
  responsibility: { entries: responsibility },
  runId,
  workflowHistory: { records }
})

const coverageAcquisition = {
  operationId: OperationId.make("recovery-activation-coverage-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: coverageAttempt.taskId,
  token: ClaimToken.make("recovery-activation-coverage-token")
}
const coverageClaim = ActiveTaskClaim.make(coverageAcquisition)
const coverageAcquireOperation = makeTaskClaimAcquisitionOperation({
  acquisition: coverageAcquisition,
  predecessorOperationIds: []
})
const coveragePlanOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("recovery-activation-coverage-plan"),
  plannedAttempt: coverageAttempt,
  predecessorOperationIds: [coverageAcquisition.operationId]
})
const coverageResponsibility = {
  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
  beganAt: JournalPosition.make(4),
  plannedAttempt: coverageAttempt
}

const coveragePlanRecords = (): ReadonlyArray<JournalRecord> => [
  coverageRecord(
    1,
    TaskClaimAcquisitionIntendedEvent.make({
      operation: coverageAcquireOperation,
      version: workflowJournalEventVersion
    })
  ),
  coverageRecord(2, TaskClaimAcquiredEvent.make({ claim: coverageClaim, version: workflowJournalEventVersion })),
  coverageRecord(
    3,
    TaskAttemptPlannedEvent.make({ operation: coveragePlanOperation, version: workflowJournalEventVersion })
  ),
  coverageRecord(
    4,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
]

const coverageGraphOperation = makeTrackerGraphObservationOperation(
  OperationId.make("recovery-activation-coverage-graph"),
  coverageTarget,
  [],
  [coverageAttempt.taskId]
)
const coverageGraph = validSnapshot({
  revision: "recovery-activation-coverage-graph-revision",
  tasks: [{ id: coverageAttempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
const coverageGraphEvent = taskTrackerFactsObservedEvent(
  coverageGraphOperation.operationId,
  makeCompleteTaskTrackerFactsObserved(coverageGraphOperation, coverageGraph)
)
const coverageSpecification = makeTaskWorkSpecification({
  body: "coverage body",
  taskId: coverageAttempt.taskId,
  title: "coverage title"
})
const coverageSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("recovery-activation-coverage-specification"),
  coverageTarget,
  coverageAttempt.taskId,
  [coverageGraphOperation.operationId]
)
const coverageSpecificationEvent = taskTrackerFactsObservedEvent(
  coverageSpecificationOperation.operationId,
  makeFocusedTaskWorkSpecificationFactsObserved(coverageSpecificationOperation, coverageSpecification)
)
const coverageClaimOperation = makeTaskClaimObservationOperation(
  OperationId.make("recovery-activation-coverage-claim"),
  coverageTarget,
  coverageAttempt.taskId,
  [coverageGraphOperation.operationId, coverageSpecificationOperation.operationId]
)
const coverageClaimEvent = taskTrackerFactsObservedEvent(
  coverageClaimOperation.operationId,
  makeFocusedTaskClaimFactsObserved(coverageClaimOperation, coverageClaim)
)
const coverageContinuationTransition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
  acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(4) },
  plannedAttempt: coverageAttempt
})

const continuationRecords = (
  claimEvent: typeof coverageClaimEvent,
  worktreeObservation: PlannedAttemptWorktreeObservation,
  includeContinueChoice = false
): ReadonlyArray<JournalRecord> => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-coverage-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [coverageClaimOperation.operationId]
  })
  const records = [
    ...coveragePlanRecords(),
    coverageRecord(5, coverageGraphEvent),
    coverageRecord(6, coverageSpecificationEvent),
    coverageRecord(7, claimEvent),
    coverageRecord(
      8,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      9,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: worktreeObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
  ]
  return includeContinueChoice
    ? [
        ...records,
        coverageRecord(
          10,
          AttemptChoiceAppliedEvent.make({
            choice: "ContinueExistingAttempt",
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: AttemptChoiceRequestId.make({
              nonce: "recovery-activation-coverage-continue",
              runId: coverageRunId
            }),
            subject: {
              observedTaskRevision: TaskRevision.make("recovery-activation-observed-revision"),
              plannedAttempt: coverageAttempt
            },
            version: workflowJournalEventVersion
          })
        )
      ]
    : records
}

const runPause = (ordinal: number) =>
  ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(ordinal),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })

const runUnpause = (ordinal: number) =>
  ControlDirectionAppliedEvent.make({
    direction: "Unpause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(ordinal),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })

const executorReport = (position: number, report: PlannedAttemptExecutorReport, ordinal = position): JournalRecord =>
  coverageRecord(
    position,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(ordinal),
      report,
      version: workflowJournalEventVersion
    })
  )

type PausedIntegrationScenario = {
  readonly responsibility: StartedIntegrationResponsibility
  readonly transitions: readonly [RunnableFrontierTransition]
  readonly intents: readonly [JournalRecord["event"]]
}

const pausedIntegrationScenario = (suffix: string, startedAt: number): PausedIntegrationScenario => {
  const acceptedResult = acceptedResultFixture(GitCommitSha.make("b".repeat(40)))
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/recovery-activation-paused-integration.git")
  })
  const responsibility = StartedIntegrationResponsibility.make({
    acceptedResult,
    integrationTarget,
    plannedAttempt: coverageAttempt,
    queuedAt: JournalPosition.make(7),
    startedAt: JournalPosition.make(startedAt)
  })
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: GitCommitSha.make("c".repeat(40)),
    candidateText: IntegratorCandidateText.make(`refs/candidates/paused-integration-${suffix}`),
    run: {
      ordinal: IntegratorRunOrdinal.make(1),
      session: {
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make(`resource:paused-integration-${suffix}`),
        expectedTargetHead: coverageAttempt.baseSha,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        queuedAt: responsibility.queuedAt,
        sessionId: OuterIntegratorSessionId.make(`session:paused-integration-${suffix}`),
        startedAt: responsibility.startedAt,
        targetLineageObservedAt: JournalPosition.make(6)
      }
    },
    directParents: [coverageAttempt.baseSha, acceptedResult.commit],
    qualifiedAt: JournalPosition.make(14)
  })
  const promotion = targetPromotionCorrelationFor(qualifiedCandidate)
  const promotionIntent = TargetPromotionIntendedEvent.make({
    correlation: promotion,
    version: workflowJournalEventVersion
  })
  return {
    responsibility,
    transitions: [RunnableFrontierTransition.RunTargetPromotion({ candidate: qualifiedCandidate, responsibility })],
    intents: [promotionIntent]
  }
}

const currentProjectionJournal = (
  runId: RunId,
  target: typeof coverageTarget,
  reconstructed: ReconstructedRunState
) => {
  const began = makeWorkflowRunBeganRecord(runId, target, coveragePolicy)
  const journal = InRunJournal.of({
    append: () => Effect.die("projection coverage does not append"),
    read: () => Effect.succeed([began])
  })
  return Object.assign(journal, { state: { get: Effect.succeed({ reconstructed }) } })
}

const directionProjectionFixture = (direction: "Retry" | "FullRerun", graphAfterDirection = true) => {
  const acceptedResult = acceptedResultFixture(GitCommitSha.make("b".repeat(40)))
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make(`/repositories/recovery-activation-direction-${direction}.git`)
  })
  const queuePosition = JournalPosition.make(10)
  const startedPosition = JournalPosition.make(11)
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make(`direction-${direction.toLowerCase()}-fixed-lineage`),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: []
  })
  const lineageObservation = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: coverageAttempt.baseSha,
    targetHeadSha: coverageAttempt.baseSha
  })
  const lineageRecord = coverageRecord(
    13,
    TargetLineageObservedEvent.make({
      observation: lineageObservation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const correlation = IntegratorSessionCorrelation.make({
    acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make(`direction-resource-${direction.toLowerCase()}`),
    expectedTargetHead: coverageAttempt.baseSha,
    integrationTarget,
    plannedAttempt: coverageAttempt,
    queuedAt: queuePosition,
    sessionId: OuterIntegratorSessionId.make(`direction-session-${direction.toLowerCase()}`),
    startedAt: startedPosition,
    targetLineageObservedAt: lineageRecord.position
  })
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
  const resultDetail = IntegratorNotPreparedDetail.make("the outer Integrator returned no candidate")
  const sessionRecord = {
    ...coverageRecord(14, IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })),
    key: integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(correlation))
  }
  const runStartedRecord = {
    ...coverageRecord(15, IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })),
    key: integratorRunStartedRecordKey(run)
  }
  const resultRecord = {
    ...coverageRecord(
      16,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation, detail: resultDetail }),
        run,
        version: workflowJournalEventVersion
      })
    ),
    key: integratorRunResultRecordedRecordKey(run)
  }
  const quarantine = IntegrationQuarantinedEvent.make({
    basis: IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: resultDetail }),
      evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: resultRecord.position })
    }),
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const quarantineRecord = {
    ...coverageRecord(17, quarantine),
    key: integrationQuarantinedRecordKey(correlation.sessionId, quarantine.basis)
  }
  const directionEvent = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction,
      quarantineAt: quarantineRecord.position,
      sessionId: correlation.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({
      nonce: `direction-${direction.toLowerCase()}-request`,
      runId: coverageRunId
    }),
    version: workflowJournalEventVersion
  })
  const directionRecord = {
    ...coverageRecord(18, directionEvent),
    key: integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({
        quarantineAt: quarantineRecord.position,
        sessionId: correlation.sessionId
      })
    )
  }
  const integrationRecords = [
    coverageRecord(
      Number(queuePosition),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      Number(startedPosition),
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        responsibilityBeganAt: queuePosition,
        version: workflowJournalEventVersion
      })
    )
  ]
  const claimObservation = coverageRecord(graphAfterDirection ? 22 : 5, coverageClaimEvent)
  const graphObservation = coverageRecord(graphAfterDirection ? 23 : 6, coverageGraphEvent)
  const records = [
    ...coveragePlanRecords(),
    ...integrationRecords,
    coverageRecord(
      12,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    lineageRecord,
    sessionRecord,
    runStartedRecord,
    resultRecord,
    quarantineRecord,
    directionRecord,
    claimObservation,
    graphObservation
  ].toSorted((left, right) => left.position - right.position)
  const reconstructed = coverageRunState(records)
  return {
    direction,
    directionRecord,
    integrationTarget,
    lineageOperation,
    reconstructed: { ...reconstructed, graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] } }
  }
}

effectIt.effect(
  "acquires the target before a fresh direction-bound lineage read and reuses the read after restart",
  () =>
    Effect.gen(function* () {
      const direction = "Retry" as const
      for (const graphAfterDirection of [true, false]) {
        const fixture = directionProjectionFixture(direction, graphAfterDirection)
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(
            InRunJournal,
            currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
          )
        )
        const firstProjection = yield* recovery.readDeliveryProjection
        const acquire = firstProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
        )
        if (acquire?._tag !== "AcquireStartedIntegrationTarget") {
          return yield* Effect.die(
            `expected ${direction} to reacquire its integration target; got ${firstProjection.frontier.transitions.map(({ _tag }) => _tag).join(",")}; explanations ${firstProjection.frontier.explanations.map(({ _tag }) => _tag).join(",")}`
          )
        }
        expect(
          firstProjection.frontier.transitions.some(
            ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
          )
        ).toBe(false)
        yield* resources.acquire(acquire.responsibility)
        yield* resources.publishAcceptedOwnership(acquire.responsibility)

        const heldRecovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(
            InRunJournal,
            currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
          )
        )
        const heldProjection = yield* heldRecovery.readDeliveryProjection
        const firstRead = heldProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        if (firstRead?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
          const sessionRecord = fixture.reconstructed.workflowHistory.records.find(
            ({ event }) => event._tag === "IntegratorSessionFixed"
          )
          const authorization =
            sessionRecord?.event._tag === "IntegratorSessionFixed"
              ? evaluateIntegratorRetryAuthorization(
                  fixture.reconstructed.workflowHistory.records,
                  IntegratorRunCorrelation.make({
                    ordinal: IntegratorRunOrdinal.make(2),
                    session: sessionRecord.event.correlation
                  })
                )
              : undefined
          return yield* Effect.die(
            `expected ${direction} direction-bound target-lineage read; got ${heldProjection.frontier.transitions.map(({ _tag }) => _tag).join(",")}; authorization ${JSON.stringify(authorization)}`
          )
        }
        expect(firstRead.operation.predecessorOperationIds).toEqual([fixture.lineageOperation.operationId])
        expect(firstRead.operation.operationId).toContain(`d:${Number(fixture.directionRecord.position)}`)

        const intent = GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: firstRead.operation,
          version: workflowJournalEventVersion
        })
        const intentPosition = JournalPosition.make(Number(fixture.reconstructed.appliedThrough ?? 0) + 1)
        const afterIntent = {
          ...fixture.reconstructed,
          appliedThrough: intentPosition,
          workflowHistory: {
            records: [...fixture.reconstructed.workflowHistory.records, coverageRecord(intentPosition, intent)]
          }
        }
        const restarted = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterIntent))
        )
        const restartedProjection = yield* restarted.readDeliveryProjection
        const restartedRead = restartedProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        expect(restartedRead).toEqual(firstRead)

        const fixedSession = fixture.reconstructed.workflowHistory.records.find(
          ({ event }) => event._tag === "IntegratorSessionFixed"
        )
        if (fixedSession?.event._tag !== "IntegratorSessionFixed") {
          return yield* Effect.die("expected fixed Integrator session")
        }
        const observationPosition = JournalPosition.make(Number(intentPosition) + 1)
        const observation = TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: acquire.responsibility.plannedAttempt.baseSha,
            targetHeadSha: fixedSession.event.correlation.expectedTargetHead
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: firstRead.operation.operationId,
          plannedAttempt: acquire.responsibility.plannedAttempt,
          version: workflowJournalEventVersion
        })
        const afterObservation = {
          ...afterIntent,
          appliedThrough: observationPosition,
          workflowHistory: {
            records: [...afterIntent.workflowHistory.records, coverageRecord(observationPosition, observation)]
          }
        }
        const restartedResources = yield* makeIntegrationTargetResourceController()
        const afterObservationRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterObservation))
        )
        const reacquire = (yield* afterObservationRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
        )
        if (reacquire?._tag !== "AcquireStartedIntegrationTarget") {
          return yield* Effect.die("expected target reacquisition after the completed Retry lineage read")
        }
        yield* restartedResources.acquire(reacquire.responsibility)
        yield* restartedResources.publishAcceptedOwnership(reacquire.responsibility)
        const heldAfterObservationRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterObservation))
        )
        const runTwo = (yield* heldAfterObservationRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "RunIntegrator"
        )
        expect(runTwo?._tag === "RunIntegrator" ? runTwo.run.ordinal : undefined).toBe(2)

        const laterClaimPosition = JournalPosition.make(Number(observationPosition) + 1)
        const laterGraphPosition = JournalPosition.make(Number(observationPosition) + 2)
        const laterGraphOperation = makeTrackerGraphObservationOperation(
          OperationId.make(`direction-retry-graph-after-lineage:${graphAfterDirection}`),
          coverageTarget,
          [],
          [coverageAttempt.taskId]
        )
        const laterClaimOperation = makeTaskClaimObservationOperation(
          OperationId.make(`direction-retry-claim-after-lineage:${graphAfterDirection}`),
          coverageTarget,
          coverageAttempt.taskId,
          [coverageGraphOperation.operationId]
        )
        const afterLaterGraph = {
          ...afterObservation,
          appliedThrough: laterGraphPosition,
          workflowHistory: {
            records: [
              ...afterObservation.workflowHistory.records,
              coverageRecord(
                laterClaimPosition,
                taskTrackerFactsObservedEvent(
                  laterClaimOperation.operationId,
                  makeFocusedTaskClaimFactsObserved(laterClaimOperation, coverageClaim)
                )
              ),
              coverageRecord(
                laterGraphPosition,
                taskTrackerFactsObservedEvent(
                  laterGraphOperation.operationId,
                  makeCompleteTaskTrackerFactsObserved(laterGraphOperation, coverageGraph)
                )
              )
            ]
          }
        }
        const graphRefreshRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterLaterGraph))
        )
        const refreshedRead = (yield* graphRefreshRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        expect(refreshedRead?._tag === "ObservePlannedAttemptContinuationTargetLineage").toBe(true)
        expect(
          refreshedRead?._tag === "ObservePlannedAttemptContinuationTargetLineage"
            ? refreshedRead.operation.operationId
            : undefined
        ).not.toBe(firstRead.operation.operationId)
      }

      const withoutDirection = directionProjectionFixture("Retry")
      const recordsWithoutDirection = withoutDirection.reconstructed.workflowHistory.records.filter(
        ({ position }) => position !== withoutDirection.directionRecord.position
      )
      const noDirectionState = {
        ...withoutDirection.reconstructed,
        workflowHistory: { records: recordsWithoutDirection }
      }
      const noDirectionResources = yield* makeIntegrationTargetResourceController()
      const noDirectionRecovery = yield* makeRunRecoveryProjection(
        coverageRunId,
        withoutDirection.integrationTarget,
        noDirectionResources
      ).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, noDirectionState))
      )
      expect(
        (yield* noDirectionRecovery.readDeliveryProjection).frontier.transitions.some(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toBe(false)
    })
)

effectIt.effect("requests a fresh direction-bound lineage read for FullRerun before fixing a successor", () =>
  Effect.gen(function* () {
    const fixture = directionProjectionFixture("FullRerun")
    const resources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
      Effect.provideService(
        InRunJournal,
        currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
      )
    )
    const first = yield* recovery.readDeliveryProjection
    const acquire = first.frontier.transitions.find(({ _tag }) => _tag === "AcquireStartedIntegrationTarget")
    if (acquire?._tag !== "AcquireStartedIntegrationTarget") {
      return yield* Effect.die("FullRerun must reacquire its existing responsibility before the fresh Git read")
    }
    yield* resources.acquire(acquire.responsibility)
    yield* resources.publishAcceptedOwnership(acquire.responsibility)

    const heldRecovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
      Effect.provideService(
        InRunJournal,
        currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
      )
    )
    const read = (yield* heldRecovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
    )
    if (read?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
      return yield* Effect.die("FullRerun must request its direction-bound target-lineage observation")
    }
    expect(read.operation.predecessorOperationIds).toEqual([fixture.lineageOperation.operationId])
    expect(read.operation.operationId).toContain(`d:${Number(fixture.directionRecord.position)}`)
  })
)

effectIt.effect("fails closed when recovered quarantine-direction evidence is not exact", () =>
  Effect.gen(function* () {
    const fixture = directionProjectionFixture("Retry")
    const records = fixture.reconstructed.workflowHistory.records
    const session = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
    const runStart = records.find(({ event }) => event._tag === "IntegratorRunStarted")
    const directionEvent = fixture.directionRecord.event
    if (
      session?.event._tag !== "IntegratorSessionFixed" ||
      runStart?.event._tag !== "IntegratorRunStarted" ||
      directionEvent._tag !== "IntegrationQuarantineDirectionApplied"
    ) {
      return yield* Effect.die("expected fixed session, initial run, and quarantine direction evidence")
    }
    const invalidHistories = [
      ["missing quarantine", records.filter(({ event }) => event._tag !== "IntegrationQuarantined")],
      ["duplicate session", [...records, { ...session, position: JournalPosition.make(24) }]],
      [
        "foreign session key",
        records.map((record) => (record === session ? { ...record, key: fixture.directionRecord.key } : record))
      ],
      ["duplicate run", [...records, { ...runStart }]],
      [
        "foreign run key",
        records.map((record) => (record === runStart ? { ...record, key: fixture.directionRecord.key } : record))
      ],
      [
        "missing fixed lineage",
        records.filter(
          ({ event }) =>
            event._tag !== "TargetLineageObserved" || event.operationId !== fixture.lineageOperation.operationId
        )
      ],
      [
        "foreign direction Journal Run",
        records.map((record) =>
          record !== fixture.directionRecord
            ? record
            : {
                ...record,
                event: IntegrationQuarantineDirectionAppliedEvent.make({
                  ...directionEvent,
                  requestId: IntegrationQuarantineDirectionRequestId.make({
                    nonce: "direction-retry-foreign-run",
                    runId: RunId.make("foreign-direction-run")
                  })
                })
              }
        )
      ]
    ] as const

    for (const [label, invalidRecords] of invalidHistories) {
      const resources = yield* makeIntegrationTargetResourceController()
      const invalidState = { ...fixture.reconstructed, workflowHistory: { records: invalidRecords } }
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, invalidState))
      )
      const projection = yield* recovery.readDeliveryProjection
      expect(
        projection.frontier.transitions.some(
          (transition) =>
            transition._tag === "ObservePlannedAttemptContinuationTargetLineage" &&
            transition.operation.operationId.includes(`d:${Number(fixture.directionRecord.position)}`)
        ),
        label
      ).toBe(false)
    }
  })
)

it("suspends a running grouping descendant and reopens it after current facts move it outside the parent", () => {
  const runId = RunId.make("grouping-descendant-suspension-run")
  const descendantTaskId = TaskId.make("D")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("grouping-descendant-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/grouping-descendant-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: descendantTaskId,
    taskRevision: TaskRevision.make("grouping-descendant-revision"),
    worktree: WorktreeLocator.make("/dalph/grouping-descendant-attempt")
  })
  const graph = validSnapshot({
    revision: "running-grouping-descendant-v1",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
    ]
  })
  const graphRead = makeTrackerGraphObservationOperation(
    OperationId.make("grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const records = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, graph)
      )
    },
    {
      position: JournalPosition.make(3),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(4),
      event: ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]

  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)

  const regrouped = validSnapshot({
    revision: "regrouped-descendant-v2",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  const pause = ReconstructedPauseState.make({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "TaskPauses", taskIds: [TaskId.make("A")] }
  })
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, graph)).toBe(false)
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, regrouped)).toBe(true)
  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const lateGroupingGraphRead = makeTrackerGraphObservationOperation(
    OperationId.make("late-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const reconfirmedGroupingGraphRead = makeTrackerGraphObservationOperation(
    OperationId.make("reconfirmed-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const lateGroupingGraphEvent = taskTrackerFactsObservedEvent(
    lateGroupingGraphRead.operationId,
    makeCompleteTaskTrackerFactsObserved(lateGroupingGraphRead, graph)
  )
  const reconfirmedGroupingGraphEvent = makeTaskTrackerFactsObservedFromRead(
    [{ event: lateGroupingGraphEvent }],
    reconfirmedGroupingGraphRead,
    graph
  )
  const responsibilityBegan = records[1]
  const taskPaused = records[2]
  if (responsibilityBegan === undefined || taskPaused === undefined) return expect.fail("expected pause records")
  const lateGroupingRecords = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, regrouped)
      )
    },
    responsibilityBegan,
    taskPaused,
    {
      position: JournalPosition.make(5),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(6),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    { position: JournalPosition.make(7), event: lateGroupingGraphEvent },
    { position: JournalPosition.make(8), event: reconfirmedGroupingGraphEvent },
    {
      position: JournalPosition.make(9),
      event: ControlDirectionAppliedEvent.make({
        direction: "Unpause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(2),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]
  expect(taskPauseSuspensionIsOwed(lateGroupingRecords, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const activePauseWithoutGraph = [responsibilityBegan, taskPaused]
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(
    false
  )
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...activePauseWithoutGraph,
        { position: JournalPosition.make(9), event: lateGroupingRecords.at(-1)?.event ?? taskPaused.event }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const lostSuspensionCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
    command: "Suspend",
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const exactSafeProjection = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    plannedAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        { position: JournalPosition.make(5), event: lostSuspensionCommand },
        { position: JournalPosition.make(6), event: exactSafeProjection }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        {
          position: JournalPosition.make(5),
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            }),
            version: workflowJournalEventVersion
          })
        }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  expect(
    taskPauseSuspensionIsOwed(
      [{ position: JournalPosition.make(1), event: taskPaused.event }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const exactTaskPause = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(2),
    subject: { _tag: "Task", runId, taskId: descendantTaskId },
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, { position: JournalPosition.make(4), event: exactTaskPause }],
      plannedAttempt,
      JournalPosition.make(2),
      undefined
    )
  ).toBe(true)
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, taskPaused, { position: JournalPosition.make(5), event: reconfirmedGroupingGraphEvent }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(true)
})

it("retains an owed Run Pause suspension after Unpause until the exact executor report arrives", () => {
  const pause = coverageRecord(5, runPause(1))
  const unpause = coverageRecord(6, runUnpause(2))
  const crashedAfterPause = [...coveragePlanRecords(), pause, unpause]
  const [owedFacts] = deriveJournalResponsibilityFacts(coverageRunState(crashedAfterPause, [coverageResponsibility]))

  expect(owedFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
  })

  const safelySuspended = executorReport(
    7,
    PlannedAttemptExecutorReport.cases.SafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const [settledFacts] = deriveJournalResponsibilityFacts(
    coverageRunState([...crashedAfterPause, safelySuspended], [coverageResponsibility])
  )

  expect(settledFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 7 } }
  })
})

it("does not suspend an attempt that began after a historical Run Pause or was already safely reported", () => {
  const historicalPause = coverageRecord(2, runPause(1))
  const beganAfterPause = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), historicalPause], [coverageResponsibility])
  )[0]
  expect(beganAfterPause).toMatchObject({ _tag: "PlannedAttemptExecutorFreshFacts", disposition: { _tag: "Ready" } })

  const runningBeforePause = executorReport(
    5,
    PlannedAttemptExecutorReport.cases.Running.make({ correlation: plannedAttemptExecutorCorrelation(coverageAttempt) })
  )
  const safeBeforePause = executorReport(
    6,
    PlannedAttemptExecutorReport.cases.SafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const pauseAfterSafeReport = coverageRecord(7, runPause(1))
  const [alreadySettledFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [...coveragePlanRecords(), runningBeforePause, safeBeforePause, pauseAfterSafeReport],
      [coverageResponsibility]
    )
  )
  expect(alreadySettledFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 6 } }
  })
})

it("keeps a claim-backed attempt suspended when Git reports an untracked worktree path", () => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-coverage-untracked-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [coveragePlanOperation.operationId]
  })
  const records = [
    ...coveragePlanRecords(),
    coverageRecord(5, coverageClaimEvent),
    coverageRecord(
      6,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      7,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
  ]
  expect(authorizedClaimForAttempt(records, coverageAttempt)?.claim).toEqual(coverageClaim)
  const [facts] = deriveJournalResponsibilityFacts(coverageRunState(records, [coverageResponsibility]))

  expect(facts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
  })
})

it("uses the latest completed run pause as an attempt baseline and returns none without pause facts", () => {
  const pause = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(1),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })
  const unpause = ControlDirectionAppliedEvent.make({
    direction: "Unpause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(2),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })
  const pausedHistory = coverageRunState([coverageRecord(1, pause), coverageRecord(2, unpause)])

  expect(continuationFreshnessBaselineForAttempt(pausedHistory, Option.none(), coverageAttempt, undefined)).toEqual(
    Option.some(JournalPosition.make(2))
  )
  expect(
    continuationFreshnessBaselineForAttempt(coverageRunState([]), Option.none(), coverageAttempt, undefined)
  ).toEqual(Option.none())
})

it("stops continuation after a foreign current claim, and preserves a transition for a non-ready worktree", () => {
  const foreignClaim = ActiveTaskClaim.make({
    ...coverageAcquisition,
    owner: ClaimOwner.make("another-owner"),
    token: ClaimToken.make("another-token")
  })
  const foreignClaimEvent = taskTrackerFactsObservedEvent(
    coverageClaimOperation.operationId,
    makeFocusedTaskClaimFactsObserved(coverageClaimOperation, foreignClaim)
  )
  const foreignDecision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(foreignClaimEvent, UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree })),
    { event: coverageGraphEvent, position: JournalPosition.make(5) },
    Option.none(),
    Option.none()
  )
  expect(foreignDecision).toEqual({})

  const worktreeDecision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(coverageClaimEvent, UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree })),
    { event: coverageGraphEvent, position: JournalPosition.make(5) },
    Option.none(),
    Option.none()
  )
  expect(worktreeDecision).toEqual({ transition: coverageContinuationTransition })
})

it("waits for integration configuration after an applied Continue choice has current ready facts", () => {
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const decision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(coverageClaimEvent, ready, true),
    { event: coverageGraphEvent, position: JournalPosition.make(5) },
    Option.none(),
    Option.none()
  )

  expect(decision).toEqual({
    explanation: {
      _tag: "IntegrationConfigurationWait",
      plannedAttempt: coverageAttempt,
      wakeCondition: "IntegrationTargetConfigured"
    }
  })
})

it("reconciles each exact pre-Pause integration intent but filters a post-Pause request", () => {
  const beforePause = pausedIntegrationScenario("before", 8)
  const afterPause = pausedIntegrationScenario("after", 12)
  const runPausedWithTaskPause = coverageRunState(
    [
      coverageRecord(1, beforePause.intents[0]),
      coverageRecord(10, runPause(1)),
      coverageRecord(
        11,
        ControlDirectionAppliedEvent.make({
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(2),
          subject: { _tag: "Task", runId: coverageRunId, taskId: coverageAttempt.taskId },
          version: workflowJournalEventVersion
        })
      ),
      coverageRecord(12, afterPause.intents[0])
    ],
    [],
    coverageRunId
  )
  const pausedState: ReconstructedRunState = {
    ...runPausedWithTaskPause,
    pause: { run: { _tag: "RunPaused" }, tasks: { _tag: "TaskPauses", taskIds: [coverageAttempt.taskId] } }
  }

  for (const index of [0]) {
    const beforeTransition = Option.getOrThrow(Option.fromUndefinedOr(beforePause.transitions[index]))
    const afterTransition = Option.getOrThrow(Option.fromUndefinedOr(afterPause.transitions[index]))
    const frontier = filterFrontierForActivePauses(
      { explanations: [], transitions: [beforeTransition, afterTransition] },
      pausedState,
      undefined,
      new Set(),
      new Set()
    )
    expect(frontier.transitions).toEqual([beforeTransition])
  }
})

effectIt.effect("uses the current reconstructed state for configured projection and rejects a mismatched run", () =>
  Effect.gen(function* () {
    const matchingState = coverageRunState([])
    const configuredJournal = currentProjectionJournal(coverageRunId, coverageTarget, matchingState)
    const integrationTarget = IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/repositories/recovery-activation-coverage.git")
    })
    const configuredRecovery = yield* makeRunRecoveryProjection(coverageRunId, integrationTarget).pipe(
      Effect.provideService(InRunJournal, configuredJournal)
    )
    const configuredProjection = yield* configuredRecovery.readDeliveryProjection
    if (configuredProjection.evidence._tag !== "AvailableDeliveryProjectionEvidence") {
      return expect.fail("expected configured delivery projection evidence")
    }
    expect(configuredProjection.evidence.facts).toEqual([])

    const otherRunId = RunId.make("recovery-activation-other-run")
    const mismatchedJournal = currentProjectionJournal(
      coverageRunId,
      coverageTarget,
      coverageRunState([], [], otherRunId)
    )
    const mismatchedRecovery = yield* makeRunRecoveryProjection(coverageRunId).pipe(
      Effect.provideService(InRunJournal, mismatchedJournal)
    )
    const failure = yield* mismatchedRecovery.readDeliveryProjection.pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "RunRecoveryProjectionRunMismatch",
      expectedRunId: coverageRunId,
      receivedRunId: otherRunId
    })
  })
)
