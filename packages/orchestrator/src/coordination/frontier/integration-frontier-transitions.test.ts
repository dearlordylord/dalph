import { Effect, Option } from "effect"
import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { makeSuccessorPrefix } from "../../../test/support/automatic-successor-history.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  intentRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  integratorCompetingHeadSuccessorAuthorizedRecordKey,
  integratorAutomaticSuccessorSessionFixedRecordKey,
  localTargetCatchUpIntendedRecordKey,
  localTargetCatchUpObservedRecordKey,
  outcomeRecordKey,
  remoteBaselineObservedRecordKey,
  remoteBaselineReadIntendedRecordKey,
  remotePublicationAttemptIntendedRecordKey,
  remotePublicationIntendedRecordKey,
  remotePublicationRetainedRecordKey,
  remotePublicationResumeRequestedRecordKey,
  remotePublicationSucceededRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey
} from "../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  WorkflowRunBeganEvent
} from "../../workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import {
  deriveIntegrationAdmission,
  StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent,
  IntegrationProviderRunActivityAbsentEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegratorResult,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunStartedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunOrdinal,
  IntegratorSessionFixedEvent,
  IntegratorSuccessorSessionFixedEvent,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorAutomaticSuccessorSessionFixedEvent,
  maximumIntegratorSessionsPerResponsibility,
  IntegratorNotPreparedDetail,
  firstFullRerunSuccessorGeneration
} from "../../workflow/protocols/integrator/events.js"
import {
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor
} from "../../workflow/protocols/integrator/automatic-successor-events.js"
import {
  integratorAutomaticSuccessorCorrelationFor,
  prepareIntegratorAutomaticSuccessorSessionAppend,
  validateAutomaticSuccessorSessionFixedRecord
} from "../../workflow/protocols/integrator/automatic-successor-session.js"
import { invalidIntegrationHistoryEvent, makeIntegrationHistoryIndexes } from "../reconstruction/integration-history.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  integratorSuccessorCorrelationFor
} from "../../workflow/protocols/integrator/session.js"
import {
  deriveCurrentIntegratorState,
  integratorResponsibilityFactsFor,
  integratorRunQualifiedCandidateFromState
} from "../../workflow/protocols/integrator/state.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionReconciliationDeferral,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import { deriveIntegrationFrontier } from "./integration-frontier.js"
import { deriveStartedIntegrationFrontier } from "./integration-frontier-transitions.js"
import { FrontierExplanation, RunnableFrontierTransition } from "./frontier.js"
import { deriveRunFinalityDecision } from "./run-finality.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import type { CurrentTaskClaimAuthority } from "./task-claim-authority.js"
import { IntegrationResponsibilityIdentity } from "../../workflow/protocols/integration-admission/responsibility.js"
import {
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineObservedEvent,
  RemoteBaselineObservation,
  RemoteBaselineReadIntendedEvent,
  RemoteBaselineRound,
  remoteBaselineCorrelationFor
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import {
  RemotePublicationAttemptAuthorization,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationResumeRequestedEvent,
  RemotePublicationSucceededEvent,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "../../workflow/protocols/direct-publication/events.js"
import { deriveRemotePublicationState } from "../../workflow/protocols/direct-publication/state.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("integration-frontier-retry-run")
const notAppliedCancellation = { _tag: "RunCancellationNotApplied" as const }
const exactClaimAuthority: CurrentTaskClaimAuthority = { _tag: "Exact" }
const taskId = TaskId.make("integration-frontier-retry-task")
const attemptId = AttemptId.make("integration-frontier-retry-attempt")
const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/integration-frontier-retry.git")
})
const baseSha = sha("a")
const fixedHead = sha("b")
const changedHead = sha("e")
const acceptedCommit = sha("c")
const preparedCandidateCommit = sha("d")
const preparedCandidateText = IntegratorCandidateText.make("refs/heads/integrator/retry-candidate")
const notPreparedDetail = IntegratorNotPreparedDetail.make("the controlled Integrator returned no candidate")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId,
  baseSha,
  branch: TaskBranchRef.make("refs/heads/dalph/integration-frontier-retry"),
  executor: TaskExecutorLocator.make("executor:controlled-frontier-retry"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("integration-frontier-retry-revision"),
  worktree: WorktreeLocator.make("/worktrees/integration-frontier-retry")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedCommit),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(1),
  startedAt: JournalPosition.make(2)
})
const identity = (queuedAt: JournalPosition, identityRunId: RunId = runId) =>
  IntegrationResponsibilityIdentity.make({ queuedAt, runId: identityRunId })

const lineage = (targetHeadSha: GitCommitSha) =>
  TargetLineageObservation.make({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: baseSha, targetHeadSha })

const record = (position: number, event: JournalRecord["event"], key: string): JournalRecord => ({
  event,
  key: JournalRecordKey.make(key),
  position: JournalPosition.make(position),
  runId
})

const workflowRunBegan = (position = 1): JournalRecord =>
  record(
    position,
    WorkflowRunBeganEvent.make({
      initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      remotePublicationTarget: remotePublicationTargetForTest,
      target: FixtureTarget.make("integration-frontier-retry-target"),
      version: workflowJournalEventVersion
    }),
    `run:began:${position}`
  )

const firstStartedResponsibilityRecords = (responsibilityValue = responsibility) => [
  record(
    Number(responsibilityValue.queuedAt),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: responsibilityValue.acceptedResult,
      integrationTarget: responsibilityValue.integrationTarget,
      plannedAttempt: responsibilityValue.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    "integration-frontier:restored:first:responsibility"
  ),
  record(
    Number(responsibilityValue.startedAt),
    IntegrationStartedEvent.make({
      acceptedResult: responsibilityValue.acceptedResult,
      integrationTarget: responsibilityValue.integrationTarget,
      plannedAttempt: responsibilityValue.plannedAttempt,
      responsibilityBeganAt: responsibilityValue.queuedAt,
      version: workflowJournalEventVersion
    }),
    "integration-frontier:restored:first:started"
  )
]

const remoteBaselineReadyRecords = (
  readPosition: number,
  responsibilityValue: StartedIntegrationResponsibility
): ReadonlyArray<JournalRecord> => {
  const correlation = remoteBaselineCorrelationFor(
    runId,
    integratorResponsibilityFactsFor(responsibilityValue),
    responsibilityValue.integrationTarget,
    remotePublicationTargetForTest
  )
  return [
    record(
      readPosition,
      RemoteBaselineReadIntendedEvent.make({
        correlation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remoteBaselineReadIntendedRecordKey(correlation.baselineId).toString()
    ),
    record(
      readPosition + 1,
      RemoteBaselineObservedEvent.make({
        correlation,
        observation: RemoteBaselineObservation.cases.Aligned.make({ localHead: fixedHead, remoteHead: fixedHead }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      remoteBaselineObservedRecordKey(correlation.baselineId).toString()
    )
  ]
}

const unfinishedFirstSessionHistory = () => {
  const initialLineage = lineage(fixedHead)
  const initial = lineageRecords(4, initialLineage, "restored-initial-lineage")
  const session = integratorCorrelationFor({
    responsibility,
    targetLineage: initialLineage,
    targetLineageObservedAt: initial.observation.position
  })
  const run = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
  const records = [
    ...firstStartedResponsibilityRecords(),
    initial.intent,
    initial.observation,
    record(
      5,
      IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion }),
      integratorSessionFixedRecordKey({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: responsibility.integrationTarget,
        plannedAttempt: responsibility.plannedAttempt,
        queuedAt: responsibility.queuedAt,
        startedAt: responsibility.startedAt
      }).toString()
    ),
    record(
      6,
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(run).toString()
    )
  ]
  return {
    initialLineage,
    records,
    run,
    session,
    runState: {
      appliedThrough: JournalPosition.make(6),
      controlPolicy: Option.none(),
      graphKnowledge: { taskTrackerFacts: [] },
      pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
      cancellation: notAppliedCancellation,
      responsibility: { entries: [] },
      runId,
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    } satisfies ReconstructedRunState
  }
}

const quarantinedFirstSessionHistory = () => {
  const scenario = unfinishedFirstSessionHistory()
  const quarantineBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: notPreparedDetail }),
    evidence: { resultRecordedAt: JournalPosition.make(7) }
  })
  const records = [
    ...scenario.records,
    record(
      7,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: scenario.run, detail: notPreparedDetail }),
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(scenario.run).toString()
    ),
    record(
      8,
      IntegrationQuarantinedEvent.make({
        basis: quarantineBasis,
        correlation: scenario.session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      integrationQuarantinedRecordKey(scenario.session.sessionId, quarantineBasis).toString()
    )
  ]
  return {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(8),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }
}

const lineageRecords = (position: number, targetLineage: TargetLineageObservation, suffix: string) => {
  const operationId = OperationId.make(`integration-frontier-retry:${suffix}`)
  const operation = makeTargetLineageObservationOperation({
    integrationTarget: target,
    operationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  return {
    observation: record(
      position,
      TargetLineageObservedEvent.make({
        observation: targetLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(operationId)
    ),
    intent: record(
      position - 1,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      }),
      intentRecordKey(operationId)
    )
  }
}

type RetryEvidence = "ConclusiveResult" | "ProviderRunFailure"

const retryHistory = (evidence: RetryEvidence, freshHead?: GitCommitSha) => {
  const initialLineage = lineage(fixedHead)
  const initial = lineageRecords(4, initialLineage, "initial-lineage")
  const session = integratorCorrelationFor({
    responsibility,
    targetLineage: initialLineage,
    targetLineageObservedAt: initial.observation.position
  })
  const runOne = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
  const initialRecords: ReadonlyArray<JournalRecord> = [
    ...firstStartedResponsibilityRecords(),
    initial.intent,
    initial.observation,
    record(
      5,
      IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion }),
      integratorSessionFixedRecordKey({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: responsibility.integrationTarget,
        plannedAttempt: responsibility.plannedAttempt,
        queuedAt: responsibility.queuedAt,
        startedAt: responsibility.startedAt
      })
    ),
    record(
      6,
      IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runOne)
    )
  ]

  const terminalRecords =
    evidence === "ConclusiveResult"
      ? [
          record(
            7,
            IntegratorRunResultRecordedEvent.make({
              result: IntegratorResult.cases.NotPrepared.make({ correlation: runOne, detail: notPreparedDetail }),
              run: runOne,
              version: workflowJournalEventVersion
            }),
            integratorRunResultRecordedRecordKey(runOne)
          )
        ]
      : [
          record(
            7,
            IntegrationProviderRunActivityAbsentEvent.make({
              correlation: session,
              detail: IntegrationQuarantineFailureDetail.make("the provider run has no owned activity"),
              occurrenceClassification: "NonActionOccurrence",
              run: runOne,
              version: workflowJournalEventVersion
            }),
            integrationProviderRunActivityAbsentRecordKey(runOne)
          )
        ]

  const quarantineBasis =
    evidence === "ConclusiveResult"
      ? IntegrationQuarantineBasis.cases.ConclusiveResult.make({
          cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: notPreparedDetail }),
          evidence: { resultRecordedAt: JournalPosition.make(7) }
        })
      : IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
          detail: IntegrationQuarantineFailureDetail.make("the provider run has no owned activity"),
          ownedActivityProvenAbsentAt: JournalPosition.make(7)
        })
  const quarantine = record(
    8,
    IntegrationQuarantinedEvent.make({
      basis: quarantineBasis,
      correlation: session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    }),
    integrationQuarantinedRecordKey(session.sessionId, quarantineBasis).toString()
  )
  const direction = record(
    9,
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: quarantine.position,
        sessionId: session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "frontier-retry", runId }),
      version: workflowJournalEventVersion
    }),
    integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({ quarantineAt: quarantine.position, sessionId: session.sessionId })
    ).toString()
  )
  const fresh = freshHead === undefined ? undefined : lineageRecords(11, lineage(freshHead), "fresh-lineage")
  const records = [
    ...initialRecords,
    ...terminalRecords,
    quarantine,
    direction,
    ...(fresh === undefined ? [] : [fresh.intent, fresh.observation])
  ]
  return {
    currentLineage:
      fresh?.observation.event._tag === "TargetLineageObserved" ? fresh.observation.event.observation : initialLineage,
    records,
    runState: {
      appliedThrough: records.at(-1)?.position ?? null,
      controlPolicy: Option.none(),
      graphKnowledge: { taskTrackerFacts: [] },
      pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
      cancellation: notAppliedCancellation,
      responsibility: { entries: [] },
      runId,
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    } satisfies ReconstructedRunState,
    session
  }
}

const transitionsFor = (
  scenario: ReturnType<typeof retryHistory>,
  runtimeOverrides: Partial<Parameters<typeof deriveStartedIntegrationFrontier>[1]> = {}
) =>
  deriveStartedIntegrationFrontier(
    scenario.runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilities: [identity(responsibility.queuedAt)],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, scenario.currentLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      targetPromotionConfigured: true,
      taskClaimAuthorityByAttemptId: new Map([[attemptId, exactClaimAuthority]]),
      ...runtimeOverrides
    },
    [responsibility]
  ).transitions()

const fullRerunHistory = (freshHead?: GitCommitSha) => {
  const scenario = retryHistory("ConclusiveResult", freshHead)
  const records = scenario.records.map((candidate) =>
    candidate.position !== JournalPosition.make(9)
      ? candidate
      : record(
          9,
          IntegrationQuarantineDirectionAppliedEvent.make({
            fingerprint: IntegrationQuarantineDirectionFingerprint.make({
              direction: "FullRerun",
              quarantineAt: JournalPosition.make(8),
              sessionId: scenario.session.sessionId
            }),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "frontier-full-rerun", runId }),
            version: workflowJournalEventVersion
          }),
          integrationQuarantineDirectionAppliedRecordKey(
            IntegrationQuarantineDirectionSubject.make({
              quarantineAt: JournalPosition.make(8),
              sessionId: scenario.session.sessionId
            })
          ).toString()
        )
  )
  return {
    ...scenario,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }
}

it("releases the target before an initial Integrator run when fresh lineage is incompatible", () => {
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const baseline = remoteBaselineReadyRecords(5, responsibility)
  const fresh = lineageRecords(8, incompatibleLineage, "incompatible-initial-lineage")
  const records = [
    workflowRunBegan(),
    ...firstStartedResponsibilityRecords(),
    ...baseline,
    fresh.intent,
    fresh.observation
  ]
  const runState: ReconstructedRunState = {
    appliedThrough: JournalPosition.make(8),
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId,
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  expect(
    deriveStartedIntegrationFrontier(
      runState,
      {
        activeResponsibilities: [],
        currentTrackerTaskIds: new Set([taskId]),
        heldResponsibilities: [identity(responsibility.queuedAt)],
        integrationTarget: Option.some(target),
        remotePublicationConfigured: true,
        targetLineageByAttemptId: new Map([[attemptId, incompatibleLineage]]),
        targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })])
})

it("does not treat another Run at the same journal position as this Run's held target", () => {
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const fresh = lineageRecords(4, incompatibleLineage, "cross-run-position-collision")
  const records = [...firstStartedResponsibilityRecords(), fresh.intent, fresh.observation]
  const runState: ReconstructedRunState = {
    appliedThrough: JournalPosition.make(4),
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId,
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilities: [
        IntegrationResponsibilityIdentity.make({
          queuedAt: responsibility.queuedAt,
          runId: RunId.make("another-run-at-position-two")
        })
      ],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, incompatibleLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
    },
    [responsibility]
  ).transitions()

  expect(transitions).toContainEqual(RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility }))
  expect(transitions).not.toContainEqual(RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility }))
})

it("keeps unobserved claims and absent durable lineage waiting without starting Integrator", () => {
  const records = firstStartedResponsibilityRecords()
  const runState: ReconstructedRunState = {
    appliedThrough: JournalPosition.make(2),
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId,
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const baseFacts = {
    activeResponsibilities: [],
    currentTrackerTaskIds: new Set([taskId]),
    heldResponsibilities: [identity(responsibility.queuedAt)],
    integrationTarget: Option.some(target),
    targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>()
  }

  const unobserved = deriveStartedIntegrationFrontier(
    runState,
    {
      ...baseFacts,
      targetLineageByAttemptId: new Map([[attemptId, lineage(fixedHead)]]),
      taskClaimAuthorityByAttemptId: new Map()
    },
    [responsibility]
  )
  expect(unobserved.claimConstraintFor(responsibility)).toEqual({ _tag: "Unobserved" })
  expect(unobserved.transitions()).toEqual([])

  const noCurrentLineage = deriveStartedIntegrationFrontier(
    runState,
    { ...baseFacts, taskClaimAuthorityByAttemptId: new Map([[attemptId, exactClaimAuthority]]) },
    [responsibility]
  )
  expect(noCurrentLineage.transitions()).toEqual([])

  const noDurableLineage = deriveStartedIntegrationFrontier(
    runState,
    {
      ...baseFacts,
      targetLineageByAttemptId: new Map([[attemptId, lineage(fixedHead)]]),
      taskClaimAuthorityByAttemptId: new Map([[attemptId, exactClaimAuthority]])
    },
    [responsibility]
  )
  expect(noDurableLineage.transitions()).toEqual([])
})

it("waits for an explicitly applied claim reacquisition when integration claim evidence is missing", () => {
  const scenario = unfinishedFirstSessionHistory()
  const frontier = deriveIntegrationFrontier(scenario.runState, {
    activeResponsibilities: [],
    currentTrackerTaskIds: new Set([taskId]),
    heldResponsibilities: [identity(responsibility.queuedAt)],
    integrationTarget: Option.some(target),
    targetLineageByAttemptId: new Map([[attemptId, scenario.initialLineage]]),
    targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
    targetPromotionConfigured: true,
    taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Missing" as const }]])
  })

  expect(frontier.explanations).toEqual([
    {
      _tag: "IntegrationTaskClaimConstraint",
      claimState: "Missing",
      plannedAttempt: responsibility.plannedAttempt,
      wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
    }
  ])
  expect(frontier.transitions).toEqual([])
})

it("explains incompatible lineage as a target rewrite after the fixed session", () => {
  const scenario = unfinishedFirstSessionHistory()
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const analysis = deriveStartedIntegrationFrontier(
    scenario.runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilities: [identity(responsibility.queuedAt)],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, incompatibleLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([[attemptId, exactClaimAuthority]])
    },
    [responsibility]
  )

  expect(analysis.explanationForStarted(responsibility)).toMatchObject({
    _tag: "PlannedAttemptGitConstraint",
    gitState: "TargetRewrite",
    taskId
  })
})

it("records CandidateRejected quarantine from the exact run result and candidate observation", () => {
  const scenario = unfinishedFirstSessionHistory()
  const result = IntegratorResult.cases.PreparedCandidate.make({
    candidateText: preparedCandidateText,
    correlation: scenario.run
  })
  const records = [
    workflowRunBegan(),
    ...scenario.records,
    record(
      7,
      IntegratorRunResultRecordedEvent.make({ result, run: scenario.run, version: workflowJournalEventVersion }),
      integratorRunResultRecordedRecordKey(scenario.run)
    ),
    record(
      8,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: preparedCandidateText,
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(scenario.run, preparedCandidateText)
    ),
    record(
      9,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: preparedCandidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText: preparedCandidateText }),
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(scenario.run, preparedCandidateText)
    )
  ]
  const runState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(9),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set(),
      heldResponsibilities: [],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map()
    },
    [responsibility]
  ).transitions()

  expect(transitions).toEqual([
    expect.objectContaining({
      _tag: "RecordInitialConclusiveIntegrationQuarantine",
      responsibility,
      result: expect.objectContaining({
        _tag: "CandidateRejected",
        candidateText: preparedCandidateText,
        observation: { _tag: "Missing", candidateText: preparedCandidateText },
        run: scenario.run
      })
    })
  ])
})

it("does not authorize Retry when the fresh fixed-head lineage is incompatible", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const records = scenario.records.map((candidate) =>
    candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
      ? {
          ...candidate,
          event: TargetLineageObservedEvent.make({ ...candidate.event, observation: incompatibleLineage })
        }
      : candidate
  )
  const incompatible = {
    ...scenario,
    currentLineage: incompatibleLineage,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }

  expect(transitionsFor(incompatible)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("recovers a durable initial Integrator result by recording Q before any fresh tracker read", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const records = scenario.records.filter(({ position }) => position <= JournalPosition.make(7))
  const runState: ReconstructedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(7),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set(),
      heldResponsibilities: [],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map()
    },
    [responsibility]
  ).transitions()

  expect(transitions).toHaveLength(1)
  expect(transitions[0]).toMatchObject({
    _tag: "RecordInitialConclusiveIntegrationQuarantine",
    responsibility,
    result: {
      _tag: "NotPrepared",
      detail: notPreparedDetail,
      run: { ordinal: IntegratorRunOrdinal.make(1), session: scenario.session }
    }
  })
})

it("recovers provider-owned activity absence by recording Q without calling Integrator again", () => {
  const scenario = retryHistory("ProviderRunFailure", fixedHead)
  const records = scenario.records.filter(({ position }) => position <= JournalPosition.make(7))
  const runState: ReconstructedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(7),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set(),
      heldResponsibilities: [],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map()
    },
    [responsibility]
  ).transitions()

  expect(transitions).toEqual([
    expect.objectContaining({
      _tag: "RecordProviderRunFailureIntegrationQuarantine",
      input: {
        detail: IntegrationQuarantineFailureDetail.make("the provider run has no owned activity"),
        run: { ordinal: IntegratorRunOrdinal.make(1), session: scenario.session }
      },
      responsibility
    })
  ])
  expect(transitions).not.toContainEqual(expect.objectContaining({ _tag: "RunIntegrator" }))
})

it("starts one unchanged Retry run with the same session and fresh lineage position", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const transitions = transitionsFor(scenario)
  expect(transitions).toHaveLength(1)
  expect(transitions[0]).toMatchObject({
    _tag: "RunIntegrator",
    lineage: scenario.currentLineage,
    lineageObservedAt: JournalPosition.make(11),
    responsibility,
    run: { ordinal: IntegratorRunOrdinal.make(2), session: scenario.session }
  })
})

it("uses the last accepted journal position rather than record count for sparse Retry evidence", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const records = scenario.records.map((candidate) =>
    candidate.position === JournalPosition.make(10)
      ? { ...candidate, position: JournalPosition.make(100) }
      : candidate.position === JournalPosition.make(11)
        ? { ...candidate, position: JournalPosition.make(101) }
        : candidate
  )
  const evidence = journalEvidenceFrom(records)
  const sparse = {
    ...scenario,
    records,
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(101), workflowHistory: { evidence } }
  }

  expect(evidence.records).toHaveLength(11)
  expect(evidence.lastPosition).toBe(JournalPosition.make(101))
  expect(transitionsFor(sparse)).toEqual([
    RunnableFrontierTransition.RunIntegrator({
      lineage: scenario.currentLineage,
      lineageObservedAt: JournalPosition.make(101),
      responsibility,
      run: integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
    })
  ])
})

it("resumes the same unfinished Retry run after process disappearance", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const records = [
    workflowRunBegan(),
    ...scenario.records,
    record(
      12,
      IntegratorRunStartedEvent.make({ run: runTwo, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runTwo)
    )
  ]
  const recovered = {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(12),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(recovered)).toEqual([
    RunnableFrontierTransition.RunIntegrator({
      lineage: scenario.currentLineage,
      lineageObservedAt: JournalPosition.make(11),
      responsibility,
      run: runTwo
    })
  ])
})

it("promotes the Git-qualified candidate from the successful Retry run", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const observation = IntegratorGitObservation.cases.Commit.make({
    candidateText: preparedCandidateText,
    commit: preparedCandidateCommit,
    directParents: [fixedHead, acceptedCommit]
  })
  const runBegan = workflowRunBegan()
  const records = [
    runBegan,
    ...scenario.records,
    record(
      12,
      IntegratorRunStartedEvent.make({ run: runTwo, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runTwo)
    ),
    record(
      13,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({
          candidateText: preparedCandidateText,
          correlation: runTwo
        }),
        run: runTwo,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(runTwo)
    ),
    record(
      14,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: preparedCandidateText,
        run: runTwo,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(runTwo, preparedCandidateText)
    ),
    record(
      15,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: preparedCandidateText,
        observation,
        run: runTwo,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(runTwo, preparedCandidateText)
    )
  ]
  const qualified = {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(15),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(qualified, { remotePublicationConfigured: true })).toEqual([
    expect.objectContaining({
      _tag: "RunRemotePublication",
      candidate: expect.objectContaining({
        candidateCommit: preparedCandidateCommit,
        candidateText: preparedCandidateText,
        run: runTwo
      }),
      responsibility,
      target: remotePublicationTargetForTest
    })
  ])
})

it("schedules one bounded baseline refresh when Ready H2 predates activation entry", () => {
  const fixture = makeSuccessorPrefix()
  const records = fixture.records()
  const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const runBeginning = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (
    authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
    runBeginning?.event._tag !== "WorkflowRunBegan"
  ) {
    throw new Error("Ready H2 fixture must include its exact authorization and pinned Run")
  }
  const responsibility = deriveIntegrationAdmission(fixture.reduction.prefix).responsibilities.find(
    (entry): entry is StartedIntegrationResponsibility => entry._tag === "StartedIntegrationResponsibility"
  )
  if (responsibility === undefined) throw new Error("Ready H2 fixture must retain its started FIFO responsibility")
  const activationBaselinePosition = records.at(-1)?.position
  if (activationBaselinePosition === undefined) throw new Error("Ready H2 fixture must have a stable activation entry")
  const automaticBaselineRoundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    integratorResponsibilityFactsFor(responsibility),
    responsibility.integrationTarget,
    runBeginning.event.remotePublicationTarget,
    authorization.position,
    RemoteBaselineRound.make(2)
  )
  const runState: ReconstructedRunState = {
    appliedThrough: activationBaselinePosition,
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId: fixture.runId,
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const plannedAttempt = responsibility.plannedAttempt
  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      activationBaselinePosition: Option.some(activationBaselinePosition),
      currentTrackerTaskIds: new Set([plannedAttempt.taskId]),
      heldResponsibilities: [
        IntegrationResponsibilityIdentity.make({ queuedAt: responsibility.queuedAt, runId: fixture.runId })
      ],
      integrationTarget: Option.some(responsibility.integrationTarget),
      remotePublicationConfigured: true,
      targetLineageByAttemptId: new Map([[plannedAttempt.attemptId, fixture.input.targetLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      targetPromotionConfigured: true,
      taskClaimAuthorityByAttemptId: new Map([[plannedAttempt.attemptId, { _tag: "Exact" as const }]])
    },
    [responsibility]
  ).transitions()

  expect(transitions).toEqual([
    RunnableFrontierTransition.EstablishRemoteBaseline({ correlation: automaticBaselineRoundTwo, responsibility })
  ])
  expect(automaticBaselineRoundTwo).toMatchObject({
    _tag: "AutomaticCompetingHead",
    authorizationAt: authorization.position,
    baselineRound: 2
  })
})

it("releases the S2 responsibility after an H3 refresh catch-up CAS observes a changed local ref", () => {
  const fixture = makeSuccessorPrefix()
  const records = fixture.records()
  const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const firstRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
  if (
    authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
    firstRead?.event._tag !== "RemoteBaselineReadIntended" ||
    firstRead.event.correlation._tag !== "AutomaticCompetingHead"
  ) {
    throw new Error("S2 H2 prefix must contain its exact authorization and ready baseline")
  }
  const runBeginning = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (runBeginning?.event._tag !== "WorkflowRunBegan") throw new Error("S2 prefix must retain its pinned Run")
  const started = deriveIntegrationAdmission(fixture.reduction.prefix).responsibilities.find(
    (entry): entry is StartedIntegrationResponsibility => entry._tag === "StartedIntegrationResponsibility"
  )
  if (started === undefined) throw new Error("S2 prefix must retain its exact started responsibility")

  const remoteHead = sha("8")
  const observedLocalHead = sha("9")
  const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    integratorResponsibilityFactsFor(started),
    started.integrationTarget,
    runBeginning.event.remotePublicationTarget,
    authorization.position,
    RemoteBaselineRound.make(2)
  )
  const roundTwoEvents: Array<JournalRecord> = [...records]
  const append = (event: JournalRecord["event"], key: string) => {
    const position = JournalPosition.make(Number(roundTwoEvents.at(-1)?.position ?? 0) + 1)
    roundTwoEvents.push({ event, key: JournalRecordKey.make(key), position, runId: fixture.runId })
  }
  append(
    RemoteBaselineReadIntendedEvent.make({
      correlation: roundTwo,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    remoteBaselineReadIntendedRecordKey(roundTwo.baselineId)
  )
  append(
    RemoteBaselineObservedEvent.make({
      correlation: roundTwo,
      observation: RemoteBaselineObservation.cases.LocalAncestor.make({
        localHead: authorization.event.mergeBase,
        remoteHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    }),
    remoteBaselineObservedRecordKey(roundTwo.baselineId)
  )
  append(
    LocalTargetCatchUpIntendedEvent.make({
      correlation: roundTwo,
      expectedLocalHead: authorization.event.mergeBase,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      remoteHead,
      version: workflowJournalEventVersion
    }),
    localTargetCatchUpIntendedRecordKey(roundTwo.baselineId)
  )
  append(
    LocalTargetCatchUpObservedEvent.make({
      correlation: roundTwo,
      expectedLocalHead: authorization.event.mergeBase,
      occurrenceClassification: "NonActionOccurrence",
      remoteHead,
      result: LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: observedLocalHead }),
      version: workflowJournalEventVersion
    }),
    localTargetCatchUpObservedRecordKey(roundTwo.baselineId)
  )
  const lastPosition = roundTwoEvents.at(-1)?.position
  if (lastPosition === undefined) throw new Error("S2 catch-up rejection must have a journal position")
  const runState: ReconstructedRunState = {
    appliedThrough: lastPosition,
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId: fixture.runId,
    workflowHistory: { evidence: journalEvidenceFrom(roundTwoEvents) }
  }
  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      activationBaselinePosition: Option.some(lastPosition),
      currentTrackerTaskIds: new Set([started.plannedAttempt.taskId]),
      heldResponsibilities: [
        IntegrationResponsibilityIdentity.make({ queuedAt: started.queuedAt, runId: fixture.runId })
      ],
      integrationTarget: Option.some(started.integrationTarget),
      remotePublicationConfigured: true,
      targetLineageByAttemptId: new Map([[started.plannedAttempt.attemptId, fixture.input.targetLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      targetPromotionConfigured: true,
      taskClaimAuthorityByAttemptId: new Map([[started.plannedAttempt.attemptId, { _tag: "Exact" as const }]])
    },
    [started]
  ).transitions()

  expect(
    roundTwoEvents.filter(
      ({ event }) =>
        event._tag === "LocalTargetCatchUpObserved" &&
        event.correlation._tag === "AutomaticCompetingHead" &&
        Number(event.correlation.baselineRound) === 2
    )
  ).toMatchObject([
    {
      event: {
        result: { _tag: "Rejected", observedHead: observedLocalHead },
        expectedLocalHead: authorization.event.mergeBase,
        remoteHead
      }
    }
  ])
  expect(transitions).toEqual([RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: started })])
  expect(roundTwoEvents.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
    0
  )
  expect(roundTwoEvents.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
  expect(roundTwoEvents.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(2)
})

it("retains the exact compatible-head wait after the third automatic successor", () => {
  const scenario = unfinishedFirstSessionHistory()
  const candidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText: preparedCandidateText,
    commit: preparedCandidateCommit,
    directParents: [fixedHead, acceptedCommit]
  })
  const publicationAttemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
  const runBegan = workflowRunBegan()
  const resultRecorded = record(
    7,
    IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({
        candidateText: preparedCandidateText,
        correlation: scenario.run
      }),
      run: scenario.run,
      version: workflowJournalEventVersion
    }),
    integratorRunResultRecordedRecordKey(scenario.run)
  )
  const candidateReadIntent = record(
    8,
    IntegratorRunCandidateGitReadIntendedEvent.make({
      candidateText: preparedCandidateText,
      run: scenario.run,
      version: workflowJournalEventVersion
    }),
    integratorRunCandidateGitReadIntendedRecordKey(scenario.run, preparedCandidateText)
  )
  const candidateObserved = record(
    9,
    IntegratorRunCandidateGitObservedEvent.make({
      candidateText: preparedCandidateText,
      observation: candidateObservation,
      run: scenario.run,
      version: workflowJournalEventVersion
    }),
    integratorRunCandidateGitObservedRecordKey(scenario.run, preparedCandidateText)
  )
  const qualifiedRecords = [...scenario.records, resultRecorded, candidateReadIntent, candidateObserved]
  const qualifiedState = deriveCurrentIntegratorState(qualifiedRecords, responsibility)
  expect(qualifiedState._tag).toBe("GitQualifiedPrepared")
  if (qualifiedState._tag !== "GitQualifiedPrepared") return
  const candidate = integratorRunQualifiedCandidateFromState(qualifiedState)
  const publicationCorrelation = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
  const retainedCause = RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
    mergeBase: fixedHead,
    remoteHead: changedHead
  })
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: publicationCorrelation,
    cause: retainedCause,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const records = [
    runBegan,
    ...qualifiedRecords,
    record(
      10,
      RemotePublicationIntendedEvent.make({
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(publicationCorrelation.requestId)
    ),
    record(
      11,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: publicationAttemptOrdinal,
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(candidate.candidateCommit, publicationCorrelation.target.branch),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(publicationCorrelation.requestId, publicationAttemptOrdinal)
    ),
    record(
      12,
      retained,
      remotePublicationRetainedRecordKey(
        publicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      )
    )
  ]
  const runState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(12),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const runtimeFacts = {
    activeResponsibilities: [],
    currentTrackerTaskIds: new Set([taskId]),
    heldResponsibilities: [identity(responsibility.queuedAt)],
    integrationTarget: Option.some(target),
    remotePublicationConfigured: true,
    targetPromotionConfigured: true,
    targetLineageByAttemptId: new Map([[attemptId, lineage(fixedHead)]]),
    targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
    taskClaimAuthorityByAttemptId: new Map([[attemptId, exactClaimAuthority]])
  }
  const expected = RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
    authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
      publicationCorrelation.requestId,
      JournalPosition.make(12),
      fixedHead,
      changedHead
    ),
    correlation: publicationCorrelation,
    mergeBase: fixedHead,
    remoteHead: changedHead,
    remotePublicationRetainedAt: JournalPosition.make(12),
    responsibility
  })

  expect(
    deriveStartedIntegrationFrontier(
      runState,
      { ...runtimeFacts, targetLineageRefreshRequiredAttemptIds: new Set([attemptId]) },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(deriveStartedIntegrationFrontier(runState, runtimeFacts, [responsibility]).transitions()).toEqual([expected])
  expect(records.some(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")).toBe(false)
  const authorizationAt = JournalPosition.make(13)
  const authorization = IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
    authorizationId: expected.authorizationId,
    correlation: publicationCorrelation,
    initiatedBy: { _tag: "DalphCoordinator" },
    mergeBase: fixedHead,
    occurrenceClassification: "InitiatedAction",
    remoteHead: changedHead,
    remotePublicationRetainedAt: JournalPosition.make(12),
    version: workflowJournalEventVersion
  })
  const authorizedRecords = [
    ...records,
    record(
      Number(authorizationAt),
      authorization,
      integratorCompetingHeadSuccessorAuthorizedRecordKey(expected.authorizationId).toString()
    )
  ]
  const authorizedRunState = {
    ...runState,
    appliedThrough: authorizationAt,
    workflowHistory: { evidence: journalEvidenceFrom(authorizedRecords) }
  }
  const automaticBaselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    runId,
    integratorResponsibilityFactsFor(responsibility),
    target,
    remotePublicationTargetForTest,
    authorizationAt,
    RemoteBaselineRound.make(1)
  )
  expect(automaticBaselineCorrelation.baselineId).not.toBe(
    remoteBaselineCorrelationFor(
      runId,
      integratorResponsibilityFactsFor(responsibility),
      target,
      remotePublicationTargetForTest
    ).baselineId
  )
  expect(deriveStartedIntegrationFrontier(authorizedRunState, runtimeFacts, [responsibility]).transitions()).toEqual([
    RunnableFrontierTransition.EstablishRemoteBaseline({ correlation: automaticBaselineCorrelation, responsibility })
  ])
  const freshLineage = lineageRecords(17, lineage(changedHead), "automatic-successor-fresh-head")
  const baselineObservedRecords = [
    ...authorizedRecords,
    record(
      14,
      RemoteBaselineReadIntendedEvent.make({
        correlation: automaticBaselineCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remoteBaselineReadIntendedRecordKey(automaticBaselineCorrelation.baselineId).toString()
    ),
    record(
      15,
      RemoteBaselineObservedEvent.make({
        correlation: automaticBaselineCorrelation,
        observation: RemoteBaselineObservation.cases.Aligned.make({ localHead: changedHead, remoteHead: changedHead }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      remoteBaselineObservedRecordKey(automaticBaselineCorrelation.baselineId).toString()
    )
  ]
  const baselineCompleteWithoutFreshLineageRunState = {
    ...authorizedRunState,
    appliedThrough: JournalPosition.make(15),
    workflowHistory: { evidence: journalEvidenceFrom(baselineObservedRecords) }
  }
  const lineageWaitingRuntimeFacts = {
    ...runtimeFacts,
    targetLineageByAttemptId: new Map([[attemptId, lineage(changedHead)]])
  }
  expect(
    deriveStartedIntegrationFrontier(
      baselineCompleteWithoutFreshLineageRunState,
      { ...lineageWaitingRuntimeFacts, targetLineageRefreshRequiredAttemptIds: new Set([attemptId]) },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(
      baselineCompleteWithoutFreshLineageRunState,
      { ...lineageWaitingRuntimeFacts, targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>() },
      [responsibility]
    ).transitions()
  ).toEqual([])
  const readyBaselineRecords = [...baselineObservedRecords, freshLineage.intent, freshLineage.observation]
  const readyBaselineRunState = {
    ...authorizedRunState,
    appliedThrough: JournalPosition.make(17),
    workflowHistory: { evidence: journalEvidenceFrom(readyBaselineRecords) }
  }
  const recoveryEntryPosition = JournalPosition.make(17)
  const refreshCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    runId,
    integratorResponsibilityFactsFor(responsibility),
    target,
    remotePublicationTargetForTest,
    authorizationAt,
    RemoteBaselineRound.make(2)
  )
  expect(
    deriveStartedIntegrationFrontier(
      readyBaselineRunState,
      {
        ...runtimeFacts,
        activationBaselinePosition: Option.some(recoveryEntryPosition),
        targetLineageByAttemptId: new Map([[attemptId, lineage(changedHead)]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.EstablishRemoteBaseline({ correlation: refreshCorrelation, responsibility })])

  const refreshedHead = sha("f")
  const refreshedLineage = lineageRecords(23, lineage(refreshedHead), "automatic-successor-refreshed-head")
  const secondRoundReadyRecords = [
    ...readyBaselineRecords,
    record(
      18,
      RemoteBaselineReadIntendedEvent.make({
        correlation: refreshCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remoteBaselineReadIntendedRecordKey(refreshCorrelation.baselineId).toString()
    ),
    record(
      19,
      RemoteBaselineObservedEvent.make({
        correlation: refreshCorrelation,
        observation: RemoteBaselineObservation.cases.LocalAncestor.make({
          localHead: changedHead,
          remoteHead: refreshedHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      remoteBaselineObservedRecordKey(refreshCorrelation.baselineId).toString()
    ),
    record(
      20,
      LocalTargetCatchUpIntendedEvent.make({
        correlation: refreshCorrelation,
        expectedLocalHead: changedHead,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        remoteHead: refreshedHead,
        version: workflowJournalEventVersion
      }),
      localTargetCatchUpIntendedRecordKey(refreshCorrelation.baselineId).toString()
    ),
    record(
      21,
      LocalTargetCatchUpObservedEvent.make({
        correlation: refreshCorrelation,
        expectedLocalHead: changedHead,
        occurrenceClassification: "NonActionOccurrence",
        remoteHead: refreshedHead,
        result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: refreshedHead }),
        version: workflowJournalEventVersion
      }),
      localTargetCatchUpObservedRecordKey(refreshCorrelation.baselineId).toString()
    ),
    refreshedLineage.intent,
    refreshedLineage.observation
  ]
  const refreshedBaselineRunState = {
    ...authorizedRunState,
    appliedThrough: JournalPosition.make(23),
    workflowHistory: { evidence: journalEvidenceFrom(secondRoundReadyRecords) }
  }
  const movedAfterCatchUpHead = sha("c")
  const movedAfterCatchUpLineage = lineageRecords(
    26,
    lineage(movedAfterCatchUpHead),
    "automatic-successor-head-moved-after-catch-up"
  )
  const movedAfterCatchUpRunState = {
    ...refreshedBaselineRunState,
    appliedThrough: JournalPosition.make(26),
    workflowHistory: {
      evidence: journalEvidenceFrom([
        ...secondRoundReadyRecords,
        movedAfterCatchUpLineage.intent,
        movedAfterCatchUpLineage.observation
      ])
    }
  }
  expect(
    deriveStartedIntegrationFrontier(
      movedAfterCatchUpRunState,
      {
        ...runtimeFacts,
        activationBaselinePosition: Option.some(recoveryEntryPosition),
        targetLineageByAttemptId: new Map([[attemptId, lineage(movedAfterCatchUpHead)]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })])
  const refreshedSuccessorInput = {
    authorizationAt,
    predecessor: scenario.session,
    targetLineage: lineage(refreshedHead),
    targetLineageObservedAt: JournalPosition.make(23)
  }
  expect(
    deriveStartedIntegrationFrontier(
      refreshedBaselineRunState,
      {
        ...runtimeFacts,
        activationBaselinePosition: Option.some(recoveryEntryPosition),
        targetLineageByAttemptId: new Map([[attemptId, lineage(refreshedHead)]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([
    RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
      input: refreshedSuccessorInput,
      responsibility
    })
  ])
  const successorInput = {
    authorizationAt,
    predecessor: scenario.session,
    targetLineage: lineage(changedHead),
    targetLineageObservedAt: JournalPosition.make(17)
  }
  const fixSuccessor = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
    input: successorInput,
    responsibility
  })
  expect(
    deriveStartedIntegrationFrontier(
      readyBaselineRunState,
      { ...runtimeFacts, targetLineageByAttemptId: new Map([[attemptId, lineage(changedHead)]]) },
      [responsibility]
    ).transitions()
  ).toEqual([fixSuccessor])
  const automaticSuccessor = integratorAutomaticSuccessorCorrelationFor(successorInput)
  const fixedAutomaticSuccessor = IntegratorAutomaticSuccessorSessionFixedEvent.make({
    authorizationAt,
    predecessor: scenario.session,
    successor: automaticSuccessor,
    successorGeneration: IntegratorAutomaticSuccessorGeneration.make(2),
    version: workflowJournalEventVersion
  })
  const fixedSuccessorRecords = [
    ...readyBaselineRecords,
    record(
      18,
      fixedAutomaticSuccessor,
      integratorAutomaticSuccessorSessionFixedRecordKey(scenario.session, authorizationAt).toString()
    )
  ]
  const fixedSuccessorState = deriveCurrentIntegratorState(fixedSuccessorRecords, responsibility)
  expect(fixedSuccessorState).toMatchObject({ _tag: "RunUnfinished", run: { ordinal: 1 } })
  if (fixedSuccessorState._tag !== "RunUnfinished") return
  expect(fixedSuccessorState.run.session).toEqual(automaticSuccessor)
  const fixedSuccessorRunState = {
    ...readyBaselineRunState,
    appliedThrough: JournalPosition.make(18),
    workflowHistory: { evidence: journalEvidenceFrom(fixedSuccessorRecords) }
  }
  expect(
    deriveStartedIntegrationFrontier(
      fixedSuccessorRunState,
      { ...runtimeFacts, targetLineageByAttemptId: new Map([[attemptId, lineage(changedHead)]]) },
      [responsibility]
    ).transitions()
  ).toEqual([
    RunnableFrontierTransition.RunIntegrator({
      lineage: lineage(changedHead),
      lineageObservedAt: JournalPosition.make(17),
      responsibility,
      run: integratorRunCorrelationForSession(automaticSuccessor, IntegratorRunOrdinal.make(1))
    })
  ])
  expect(fixedSuccessorRecords.filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
  expect(
    deriveStartedIntegrationFrontier(runState, { ...runtimeFacts, taskClaimAuthorityByAttemptId: new Map() }, [
      responsibility
    ]).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(runState, { ...runtimeFacts, heldResponsibilities: [] }, [
      responsibility
    ]).transitions()
  ).toEqual([RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })])

  const secondSessionRun = integratorRunCorrelationForSession(automaticSuccessor, IntegratorRunOrdinal.make(1))
  const secondCandidateText = IntegratorCandidateText.make("refs/heads/integrator/retry-candidate-2")
  const secondCandidateCommit = sha("f")
  const secondRemoteHead = sha("1")
  const secondCandidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText: secondCandidateText,
    commit: secondCandidateCommit,
    directParents: [changedHead, acceptedCommit]
  })
  const secondQualifiedRecords = [
    ...fixedSuccessorRecords,
    record(
      19,
      IntegratorRunStartedEvent.make({ run: secondSessionRun, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(secondSessionRun).toString()
    ),
    record(
      20,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({
          candidateText: secondCandidateText,
          correlation: secondSessionRun
        }),
        run: secondSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(secondSessionRun).toString()
    ),
    record(
      21,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: secondCandidateText,
        run: secondSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(secondSessionRun, secondCandidateText).toString()
    ),
    record(
      22,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: secondCandidateText,
        observation: secondCandidateObservation,
        run: secondSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(secondSessionRun, secondCandidateText).toString()
    )
  ]
  const secondQualifiedState = deriveCurrentIntegratorState(secondQualifiedRecords, responsibility)
  expect(secondQualifiedState._tag).toBe("GitQualifiedPrepared")
  if (secondQualifiedState._tag !== "GitQualifiedPrepared") return
  const secondCandidate = integratorRunQualifiedCandidateFromState(secondQualifiedState)
  const secondPublicationCorrelation = remotePublicationCorrelationFor(secondCandidate, remotePublicationTargetForTest)
  const secondRetainedAt = JournalPosition.make(25)
  const secondRetained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: secondPublicationCorrelation,
    cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
      mergeBase: changedHead,
      remoteHead: secondRemoteHead
    }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const secondPublicationAttemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
  const secondPublicationRecords = [
    ...secondQualifiedRecords,
    record(
      23,
      RemotePublicationIntendedEvent.make({
        correlation: secondPublicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(secondPublicationCorrelation.requestId).toString()
    ),
    record(
      24,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: secondPublicationAttemptOrdinal,
        correlation: secondPublicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(
          secondCandidate.candidateCommit,
          secondPublicationCorrelation.target.branch
        ),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(
        secondPublicationCorrelation.requestId,
        secondPublicationAttemptOrdinal
      ).toString()
    ),
    record(
      Number(secondRetainedAt),
      secondRetained,
      remotePublicationRetainedRecordKey(
        secondPublicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      ).toString()
    )
  ]
  const secondAuthorizationAt = JournalPosition.make(26)
  const secondAuthorizationId = integratorCompetingHeadSuccessorAuthorizationIdFor(
    secondPublicationCorrelation.requestId,
    secondRetainedAt,
    changedHead,
    secondRemoteHead
  )
  const secondAuthorization = IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
    authorizationId: secondAuthorizationId,
    correlation: secondPublicationCorrelation,
    initiatedBy: { _tag: "DalphCoordinator" },
    mergeBase: changedHead,
    occurrenceClassification: "InitiatedAction",
    remoteHead: secondRemoteHead,
    remotePublicationRetainedAt: secondRetainedAt,
    version: workflowJournalEventVersion
  })
  const secondAuthorizedRecords = [
    ...secondPublicationRecords,
    record(
      Number(secondAuthorizationAt),
      secondAuthorization,
      integratorCompetingHeadSuccessorAuthorizedRecordKey(secondAuthorizationId).toString()
    )
  ]
  const secondBaselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    runId,
    integratorResponsibilityFactsFor(responsibility),
    target,
    remotePublicationTargetForTest,
    secondAuthorizationAt,
    RemoteBaselineRound.make(1)
  )
  const secondLineage = lineage(secondRemoteHead)
  const secondLineageRecords = lineageRecords(30, secondLineage, "automatic-successor-second-head")
  const secondReadyRecords = [
    ...secondAuthorizedRecords,
    record(
      27,
      RemoteBaselineReadIntendedEvent.make({
        correlation: secondBaselineCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remoteBaselineReadIntendedRecordKey(secondBaselineCorrelation.baselineId).toString()
    ),
    record(
      28,
      RemoteBaselineObservedEvent.make({
        correlation: secondBaselineCorrelation,
        observation: RemoteBaselineObservation.cases.Aligned.make({
          localHead: secondRemoteHead,
          remoteHead: secondRemoteHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      remoteBaselineObservedRecordKey(secondBaselineCorrelation.baselineId).toString()
    ),
    secondLineageRecords.intent,
    secondLineageRecords.observation
  ]
  const thirdSessionInput = {
    authorizationAt: secondAuthorizationAt,
    predecessor: automaticSuccessor,
    targetLineage: secondLineage,
    targetLineageObservedAt: JournalPosition.make(30)
  }
  const thirdSession = integratorAutomaticSuccessorCorrelationFor(thirdSessionInput)
  const thirdSessionFixed = IntegratorAutomaticSuccessorSessionFixedEvent.make({
    authorizationAt: secondAuthorizationAt,
    predecessor: automaticSuccessor,
    successor: thirdSession,
    successorGeneration: IntegratorAutomaticSuccessorGeneration.make(3),
    version: workflowJournalEventVersion
  })
  const thirdSessionRecords = [
    ...secondReadyRecords,
    record(
      31,
      thirdSessionFixed,
      integratorAutomaticSuccessorSessionFixedRecordKey(automaticSuccessor, secondAuthorizationAt).toString()
    )
  ]
  const thirdSessionState = deriveCurrentIntegratorState(thirdSessionRecords, responsibility)
  const s1ToS2Fixation = fixedSuccessorRecords.find(
    ({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed"
  )
  const s2ToS3Fixation = thirdSessionRecords.find(
    ({ event }) =>
      event._tag === "IntegratorAutomaticSuccessorSessionFixed" && event.successor.sessionId === thirdSession.sessionId
  )
  expect(s1ToS2Fixation).toBeDefined()
  expect(s2ToS3Fixation).toBeDefined()
  if (s1ToS2Fixation === undefined || s2ToS3Fixation === undefined) return
  expect(validateAutomaticSuccessorSessionFixedRecord(thirdSessionRecords, s1ToS2Fixation, scenario.session)).toEqual({
    _tag: "Valid"
  })
  expect(validateAutomaticSuccessorSessionFixedRecord(thirdSessionRecords, s2ToS3Fixation, automaticSuccessor)).toEqual(
    { _tag: "Valid" }
  )
  expect(
    Effect.runSync(
      prepareIntegratorAutomaticSuccessorSessionAppend(successorInput, journalEvidenceFrom(thirdSessionRecords))
    )
  ).toMatchObject({ _tag: "Existing", record: s1ToS2Fixation })

  let integrationHistoryIndexes = makeIntegrationHistoryIndexes()
  const automaticSuccessorHistoryIssues: Array<string | undefined> = []
  for (const historyRecord of thirdSessionRecords) {
    const validation = invalidIntegrationHistoryEvent(historyRecord, integrationHistoryIndexes, thirdSessionRecords)
    integrationHistoryIndexes = validation.indexes
    if (historyRecord.event._tag === "IntegratorAutomaticSuccessorSessionFixed") {
      automaticSuccessorHistoryIssues.push(validation.detail)
    }
  }
  expect(automaticSuccessorHistoryIssues).toEqual([undefined, undefined])
  expect(thirdSessionState).toMatchObject({ _tag: "RunUnfinished", run: { ordinal: 1 } })
  if (thirdSessionState._tag !== "RunUnfinished") return
  expect(thirdSessionState.run.session).toEqual(thirdSession)
  const thirdSessionRun = integratorRunCorrelationForSession(thirdSession, IntegratorRunOrdinal.make(1))
  const thirdCandidateText = IntegratorCandidateText.make("refs/heads/integrator/retry-candidate-3")
  const thirdCandidateCommit = sha("2")
  const exhaustedRemoteHead = sha("3")
  const thirdCandidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText: thirdCandidateText,
    commit: thirdCandidateCommit,
    directParents: [secondRemoteHead, acceptedCommit]
  })
  const thirdCandidateRecords = [
    ...thirdSessionRecords,
    record(
      32,
      IntegratorRunStartedEvent.make({ run: thirdSessionRun, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(thirdSessionRun).toString()
    ),
    record(
      33,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({
          candidateText: thirdCandidateText,
          correlation: thirdSessionRun
        }),
        run: thirdSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(thirdSessionRun).toString()
    ),
    record(
      34,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: thirdCandidateText,
        run: thirdSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(thirdSessionRun, thirdCandidateText).toString()
    ),
    record(
      35,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: thirdCandidateText,
        observation: thirdCandidateObservation,
        run: thirdSessionRun,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(thirdSessionRun, thirdCandidateText).toString()
    )
  ]
  const thirdCandidateState = deriveCurrentIntegratorState(thirdCandidateRecords, responsibility)
  expect(thirdCandidateState._tag).toBe("GitQualifiedPrepared")
  if (thirdCandidateState._tag !== "GitQualifiedPrepared") return
  const thirdCandidate = integratorRunQualifiedCandidateFromState(thirdCandidateState)
  const thirdPublicationCorrelation = remotePublicationCorrelationFor(thirdCandidate, remotePublicationTargetForTest)
  const thirdRetainedAt = JournalPosition.make(38)
  const thirdRetained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: thirdPublicationCorrelation,
    cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
      mergeBase: secondRemoteHead,
      remoteHead: exhaustedRemoteHead
    }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const exhaustedRecords = [
    ...thirdCandidateRecords,
    record(
      36,
      RemotePublicationIntendedEvent.make({
        correlation: thirdPublicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(thirdPublicationCorrelation.requestId).toString()
    ),
    record(
      37,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
        correlation: thirdPublicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(thirdCandidate.candidateCommit, thirdPublicationCorrelation.target.branch),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(
        thirdPublicationCorrelation.requestId,
        RemotePublicationAttemptOrdinal.make(1)
      ).toString()
    ),
    record(
      Number(thirdRetainedAt),
      thirdRetained,
      remotePublicationRetainedRecordKey(
        thirdPublicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      ).toString()
    )
  ]
  const exhaustedRunState = {
    ...scenario.runState,
    appliedThrough: thirdRetainedAt,
    workflowHistory: { evidence: journalEvidenceFrom(exhaustedRecords) }
  }
  const exhaustedFrontier = deriveIntegrationFrontier(exhaustedRunState, {
    ...runtimeFacts,
    targetLineageByAttemptId: new Map([[attemptId, secondLineage]])
  })
  expect(exhaustedFrontier.explanations).toEqual([
    FrontierExplanation.BoundedRetainedWait({
      mergeBase: secondRemoteHead,
      plannedAttempt: responsibility.plannedAttempt,
      remoteHead: exhaustedRemoteHead,
      remotePublicationRetainedAt: thirdRetainedAt,
      sessionCount: maximumIntegratorSessionsPerResponsibility
    })
  ])
  expect(exhaustedFrontier.transitions).toEqual([])
  expect(
    exhaustedRecords.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  ).toHaveLength(2)
  expect(deriveRunFinalityDecision(exhaustedFrontier, exhaustedRunState.responsibility, true)).toEqual({
    _tag: "RunMustRemainActive",
    reason: "UnsettledResponsibility"
  })
})

it("reuses one successor authorization when a compatible resume receipt follows authorization before fixation", () => {
  const scenario = unfinishedFirstSessionHistory()
  const result = IntegratorResult.cases.PreparedCandidate.make({
    candidateText: preparedCandidateText,
    correlation: scenario.run
  })
  const observation = IntegratorGitObservation.cases.Commit.make({
    candidateText: preparedCandidateText,
    commit: preparedCandidateCommit,
    directParents: [fixedHead, acceptedCommit]
  })
  const qualifiedRecords = [
    ...scenario.records,
    record(
      7,
      IntegratorRunResultRecordedEvent.make({ result, run: scenario.run, version: workflowJournalEventVersion }),
      integratorRunResultRecordedRecordKey(scenario.run)
    ),
    record(
      8,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: preparedCandidateText,
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(scenario.run, preparedCandidateText)
    ),
    record(
      9,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: preparedCandidateText,
        observation,
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(scenario.run, preparedCandidateText)
    )
  ]
  const integratorState = deriveCurrentIntegratorState(qualifiedRecords, responsibility)
  expect(integratorState._tag).toBe("GitQualifiedPrepared")
  if (integratorState._tag !== "GitQualifiedPrepared") return
  const candidate = integratorRunQualifiedCandidateFromState(integratorState)
  const correlation = targetPromotionCorrelationFor(candidate)
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const publicationCorrelation = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
  const publicationAttemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
  const publication = RemotePublicationSucceededEvent.make({
    correlation: publicationCorrelation,
    occurrenceClassification: "NonActionOccurrence",
    proof: RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
      attemptOrdinal: publicationAttemptOrdinal,
      remoteHead: candidate.candidateCommit
    }),
    version: workflowJournalEventVersion
  })
  const runBegan = workflowRunBegan()
  const records = [
    runBegan,
    ...qualifiedRecords,
    record(
      10,
      RemotePublicationIntendedEvent.make({
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(publicationCorrelation.requestId)
    ),
    record(
      11,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: publicationAttemptOrdinal,
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(
          publicationCorrelation.qualifiedCandidate.candidateCommit,
          publicationCorrelation.target.branch
        ),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(publicationCorrelation.requestId, publicationAttemptOrdinal)
    ),
    record(12, publication, remotePublicationSucceededRecordKey(publicationCorrelation.requestId)),
    record(
      13,
      TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion }),
      targetPromotionIntentRecordKey(correlation.requestId).toString()
    ),
    record(
      14,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: fixedHead }),
        version: workflowJournalEventVersion
      }),
      targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal).toString()
    )
  ]
  const runState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(14),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  const runtimeFacts = {
    activeResponsibilities: [],
    heldResponsibilities: [identity(responsibility.queuedAt)],
    integrationTarget: Option.some(target),
    targetLineageByAttemptId: new Map([[attemptId, lineage(preparedCandidateCommit)]]),
    targetLineageRefreshRequiredAttemptIds: new Set([attemptId]),
    remotePublicationConfigured: true,
    targetPromotionConfigured: true
  }
  const qualifiedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(10),
    workflowHistory: { evidence: journalEvidenceFrom([runBegan, ...qualifiedRecords]) }
  }
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: publicationCorrelation,
    cause: RemotePublicationRetainedCause.cases.AttemptsExhausted.make({}),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const retainedRecords = [
    runBegan,
    ...qualifiedRecords,
    record(
      11,
      RemotePublicationIntendedEvent.make({
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(publicationCorrelation.requestId)
    ),
    record(
      12,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: publicationAttemptOrdinal,
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(
          publicationCorrelation.qualifiedCandidate.candidateCommit,
          publicationCorrelation.target.branch
        ),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(publicationCorrelation.requestId, publicationAttemptOrdinal)
    ),
    record(
      13,
      retained,
      remotePublicationRetainedRecordKey(
        publicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      )
    )
  ]
  const publicationRuntimeFacts = {
    ...runtimeFacts,
    targetLineageByAttemptId: new Map([[attemptId, lineage(fixedHead)]]),
    targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
    currentTrackerTaskIds: new Set([taskId]),
    taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
  }
  expect(
    deriveStartedIntegrationFrontier({ ...qualifiedRunState }, publicationRuntimeFacts, [responsibility]).transitions()
  ).toEqual([expect.objectContaining({ _tag: "RunRemotePublication", responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      {
        ...scenario.runState,
        appliedThrough: JournalPosition.make(13),
        workflowHistory: { evidence: journalEvidenceFrom(retainedRecords) }
      },
      { ...publicationRuntimeFacts },
      [responsibility]
    ).transitions()
  ).toEqual([])
  const resumeRequestId = RemotePublicationResumeRequestId.make("frontier-compatible-handoff-resume")
  const resumeRequest = RemotePublicationResumeRequest.make({
    requestId: resumeRequestId,
    responsibility: IntegrationResponsibilityIdentity.make({
      queuedAt: candidate.run.session.queuedAt,
      runId: candidate.run.session.plannedAttempt.runId
    }),
    runId: candidate.run.session.plannedAttempt.runId,
    schemaVersion: 1
  })
  const compatibleCause = RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
    mergeBase: candidate.run.session.expectedTargetHead,
    remoteHead: changedHead
  })
  const resumedHead = sha("3")
  const initialRetained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: publicationCorrelation,
    cause: compatibleCause,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const resumeReceipt = RemotePublicationResumeRequestedEvent.make({
    correlation: publicationCorrelation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request: resumeRequest,
    version: workflowJournalEventVersion
  })
  const resumedCompatibleRetained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: resumeRequestId }),
    correlation: publicationCorrelation,
    cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
      mergeBase: candidate.run.session.expectedTargetHead,
      remoteHead: resumedHead
    }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const firstAuthorizationId = integratorCompetingHeadSuccessorAuthorizationIdFor(
    publicationCorrelation.requestId,
    JournalPosition.make(13),
    candidate.run.session.expectedTargetHead,
    changedHead
  )
  const firstAuthorization = IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
    authorizationId: firstAuthorizationId,
    correlation: publicationCorrelation,
    initiatedBy: { _tag: "DalphCoordinator" },
    mergeBase: candidate.run.session.expectedTargetHead,
    occurrenceClassification: "InitiatedAction",
    remoteHead: changedHead,
    remotePublicationRetainedAt: JournalPosition.make(13),
    version: workflowJournalEventVersion
  })
  const resumeAuthorizedRecords = [
    ...retainedRecords.slice(0, -1),
    record(
      13,
      initialRetained,
      remotePublicationRetainedRecordKey(
        publicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      )
    ),
    record(
      14,
      firstAuthorization,
      integratorCompetingHeadSuccessorAuthorizedRecordKey(firstAuthorizationId).toString()
    ),
    record(15, resumeReceipt, remotePublicationResumeRequestedRecordKey(resumeRequestId)),
    record(
      16,
      resumedCompatibleRetained,
      remotePublicationRetainedRecordKey(
        publicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: resumeRequestId })
      )
    )
  ]
  const resumedPublicationState = deriveRemotePublicationState(
    resumeAuthorizedRecords.flatMap(({ event }) =>
      event._tag === "RemotePublicationIntended" ||
      event._tag === "RemotePublicationAttemptIntended" ||
      event._tag === "RemotePublicationRetained" ||
      event._tag === "RemotePublicationResumeRequested"
        ? [event]
        : []
    )
  )
  expect(resumedPublicationState).toMatchObject({
    _tag: "PublicationRetained",
    authorization: { _tag: "ResumeRequest", requestId: resumeRequestId },
    cause: { _tag: "CompatibleCompetingHead" }
  })
  const receiptAuthorizedCompatibleRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(16),
    workflowHistory: { evidence: journalEvidenceFrom(resumeAuthorizedRecords) }
  }
  const receiptAfterAuthorizationFacts = {
    ...publicationRuntimeFacts,
    targetLineageByAttemptId: new Map([[attemptId, lineage(resumedHead)]])
  }
  const resumedBaselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    runId,
    integratorResponsibilityFactsFor(responsibility),
    target,
    remotePublicationTargetForTest,
    JournalPosition.make(14),
    RemoteBaselineRound.make(1)
  )
  const compatibleHeadAnalysis = deriveStartedIntegrationFrontier(
    receiptAuthorizedCompatibleRunState,
    receiptAfterAuthorizationFacts,
    [responsibility]
  )
  expect(compatibleHeadAnalysis.transitions()).toEqual([
    RunnableFrontierTransition.EstablishRemoteBaseline({ correlation: resumedBaselineCorrelation, responsibility })
  ])
  expect(compatibleHeadAnalysis.transitions()).not.toContainEqual(
    expect.objectContaining({ _tag: "AuthorizeIntegratorCompetingHeadSuccessor" })
  )
  // Replay remains fail-closed when this exact receipt and retained handoff are
  // present but the current host has no configured publication authority.
  expect(
    deriveStartedIntegrationFrontier(
      receiptAuthorizedCompatibleRunState,
      { ...publicationRuntimeFacts, remotePublicationConfigured: false },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(
      runState,
      { ...runtimeFacts, currentTrackerTaskIds: new Set(), taskClaimAuthorityByAttemptId: new Map() },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.ReconcileTargetPromotionAttempt({ candidate, publication, responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      runState,
      {
        ...runtimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.RunTargetPromotion({ candidate, publication, responsibility })])

  const deferredRunState = {
    ...runState,
    appliedThrough: JournalPosition.make(15),
    workflowHistory: {
      evidence: journalEvidenceFrom([
        ...records,
        record(
          15,
          TargetPromotionReconciliationDeferredEvent.make({
            afterAttemptOrdinal: attemptOrdinal,
            correlation,
            deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
              observedHeadSha: fixedHead
            }),
            version: workflowJournalEventVersion
          }),
          "target-promotion-reconciliation-deferred"
        )
      ])
    }
  }
  const releasedRuntimeFacts = { ...runtimeFacts, heldResponsibilities: [] }
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      { ...releasedRuntimeFacts, currentTrackerTaskIds: new Set(), taskClaimAuthorityByAttemptId: new Map() },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      {
        ...releasedRuntimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      {
        ...runtimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.RunTargetPromotion({ candidate, publication, responsibility })])
})

it("reconciles an unmatched initial promotion attempt before fresh lineage can reject its own candidate", () => {
  const scenario = unfinishedFirstSessionHistory()
  const result = IntegratorResult.cases.PreparedCandidate.make({
    candidateText: preparedCandidateText,
    correlation: scenario.run
  })
  const observation = IntegratorGitObservation.cases.Commit.make({
    candidateText: preparedCandidateText,
    commit: preparedCandidateCommit,
    directParents: [fixedHead, acceptedCommit]
  })
  const qualifiedRecords = [
    ...scenario.records,
    record(
      7,
      IntegratorRunResultRecordedEvent.make({ result, run: scenario.run, version: workflowJournalEventVersion }),
      integratorRunResultRecordedRecordKey(scenario.run)
    ),
    record(
      8,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: preparedCandidateText,
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitReadIntendedRecordKey(scenario.run, preparedCandidateText)
    ),
    record(
      9,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: preparedCandidateText,
        observation,
        run: scenario.run,
        version: workflowJournalEventVersion
      }),
      integratorRunCandidateGitObservedRecordKey(scenario.run, preparedCandidateText)
    )
  ]
  const integratorState = deriveCurrentIntegratorState(qualifiedRecords, responsibility)
  expect(integratorState._tag).toBe("GitQualifiedPrepared")
  if (integratorState._tag !== "GitQualifiedPrepared") return
  const candidate = integratorRunQualifiedCandidateFromState(integratorState)
  const correlation = targetPromotionCorrelationFor(candidate)
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const publicationCorrelation = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
  const publicationAttemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
  const publication = RemotePublicationSucceededEvent.make({
    correlation: publicationCorrelation,
    occurrenceClassification: "NonActionOccurrence",
    proof: RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
      attemptOrdinal: publicationAttemptOrdinal,
      remoteHead: candidate.candidateCommit
    }),
    version: workflowJournalEventVersion
  })
  const runBegan = workflowRunBegan()
  const records = [
    runBegan,
    ...qualifiedRecords,
    record(
      10,
      RemotePublicationIntendedEvent.make({
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(publicationCorrelation.requestId)
    ),
    record(
      11,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: publicationAttemptOrdinal,
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(
          publicationCorrelation.qualifiedCandidate.candidateCommit,
          publicationCorrelation.target.branch
        ),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(publicationCorrelation.requestId, publicationAttemptOrdinal)
    ),
    record(12, publication, remotePublicationSucceededRecordKey(publicationCorrelation.requestId)),
    record(
      13,
      TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion }),
      targetPromotionIntentRecordKey(correlation.requestId).toString()
    ),
    record(
      14,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: fixedHead }),
        version: workflowJournalEventVersion
      }),
      targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal).toString()
    )
  ]
  const runState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(14),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  const runtimeFacts = {
    activeResponsibilities: [],
    heldResponsibilities: [identity(responsibility.queuedAt)],
    integrationTarget: Option.some(target),
    targetLineageByAttemptId: new Map([[attemptId, lineage(preparedCandidateCommit)]]),
    targetLineageRefreshRequiredAttemptIds: new Set([attemptId]),
    remotePublicationConfigured: true,
    targetPromotionConfigured: true
  }
  const qualifiedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(10),
    workflowHistory: { evidence: journalEvidenceFrom([runBegan, ...qualifiedRecords]) }
  }
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    correlation: publicationCorrelation,
    cause: RemotePublicationRetainedCause.cases.AttemptsExhausted.make({}),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const retainedRecords = [
    runBegan,
    ...qualifiedRecords,
    record(
      11,
      RemotePublicationIntendedEvent.make({
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      remotePublicationIntendedRecordKey(publicationCorrelation.requestId)
    ),
    record(
      12,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: publicationAttemptOrdinal,
        correlation: publicationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(
          publicationCorrelation.qualifiedCandidate.candidateCommit,
          publicationCorrelation.target.branch
        ),
        version: workflowJournalEventVersion
      }),
      remotePublicationAttemptIntendedRecordKey(publicationCorrelation.requestId, publicationAttemptOrdinal)
    ),
    record(
      13,
      retained,
      remotePublicationRetainedRecordKey(
        publicationCorrelation.requestId,
        RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
      )
    )
  ]
  const publicationRuntimeFacts = {
    ...runtimeFacts,
    targetLineageByAttemptId: new Map([[attemptId, lineage(fixedHead)]]),
    targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
    currentTrackerTaskIds: new Set([taskId]),
    taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
  }
  expect(
    deriveStartedIntegrationFrontier({ ...qualifiedRunState }, publicationRuntimeFacts, [responsibility]).transitions()
  ).toEqual([expect.objectContaining({ _tag: "RunRemotePublication", responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      {
        ...scenario.runState,
        appliedThrough: JournalPosition.make(13),
        workflowHistory: { evidence: journalEvidenceFrom(retainedRecords) }
      },
      { ...publicationRuntimeFacts },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(
      runState,
      { ...runtimeFacts, currentTrackerTaskIds: new Set(), taskClaimAuthorityByAttemptId: new Map() },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.ReconcileTargetPromotionAttempt({ candidate, publication, responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      runState,
      {
        ...runtimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.RunTargetPromotion({ candidate, publication, responsibility })])

  const deferredRunState = {
    ...runState,
    appliedThrough: JournalPosition.make(15),
    workflowHistory: {
      evidence: journalEvidenceFrom([
        ...records,
        record(
          15,
          TargetPromotionReconciliationDeferredEvent.make({
            afterAttemptOrdinal: attemptOrdinal,
            correlation,
            deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
              observedHeadSha: fixedHead
            }),
            version: workflowJournalEventVersion
          }),
          "target-promotion-reconciliation-deferred"
        )
      ])
    }
  }
  const releasedRuntimeFacts = { ...runtimeFacts, heldResponsibilities: [] }
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      { ...releasedRuntimeFacts, currentTrackerTaskIds: new Set(), taskClaimAuthorityByAttemptId: new Map() },
      [responsibility]
    ).transitions()
  ).toEqual([])
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      {
        ...releasedRuntimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })])
  expect(
    deriveStartedIntegrationFrontier(
      deferredRunState,
      {
        ...runtimeFacts,
        currentTrackerTaskIds: new Set([taskId]),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.RunTargetPromotion({ candidate, publication, responsibility })])
})

it("does not start Retry without a fresh target-lineage observation", () => {
  const scenario = retryHistory("ProviderRunFailure")
  const transitions = transitionsFor(scenario)
  expect(transitions).not.toContainEqual(expect.objectContaining({ _tag: "RunIntegrator" }))
})

it("derives no retry when the session target head has changed", () => {
  const scenario = retryHistory("ConclusiveResult", changedHead)
  const transitions = transitionsFor(scenario)
  expect(transitions).toEqual([
    RunnableFrontierTransition.RecordChangedHeadRetryQuarantine({
      request: {
        directionAppliedAt: JournalPosition.make(9),
        priorQuarantineAt: JournalPosition.make(8),
        session: scenario.session,
        targetLineage: scenario.currentLineage,
        targetLineageObservedAt: JournalPosition.make(11)
      },
      responsibility
    })
  ])
  expect(transitions).not.toContainEqual(expect.objectContaining({ _tag: "RunIntegrator" }))
})

it("fixes one FullRerun successor at the fresh head while preserving the predecessor responsibility", () => {
  const scenario = fullRerunHistory(changedHead)
  const transitions = transitionsFor(scenario)

  expect(transitions).toEqual([
    RunnableFrontierTransition.FixIntegratorSuccessorSession({
      input: {
        directionAppliedAt: JournalPosition.make(9),
        predecessor: scenario.session,
        quarantineAt: JournalPosition.make(8),
        targetLineage: scenario.currentLineage,
        targetLineageObservedAt: JournalPosition.make(11)
      },
      responsibility
    })
  ])
  expect(transitions).not.toContainEqual(expect.objectContaining({ _tag: "RunIntegrator" }))
})

it("delivers the already-recorded FullRerun successor after restart", () => {
  const scenario = fullRerunHistory(changedHead)
  const input = {
    directionAppliedAt: JournalPosition.make(9),
    predecessor: scenario.session,
    quarantineAt: JournalPosition.make(8),
    targetLineage: scenario.currentLineage,
    targetLineageObservedAt: JournalPosition.make(11)
  }
  const successor = integratorSuccessorCorrelationFor(input)
  const successorEvent = IntegratorSuccessorSessionFixedEvent.make({
    direction: "FullRerun",
    directionAppliedAt: input.directionAppliedAt,
    predecessor: scenario.session,
    quarantineAt: input.quarantineAt,
    successor,
    successorGeneration: firstFullRerunSuccessorGeneration,
    version: workflowJournalEventVersion
  })
  const records = [
    ...scenario.records,
    record(
      12,
      successorEvent,
      integratorSuccessorSessionFixedRecordKey(scenario.session, input.quarantineAt, input.directionAppliedAt)
    )
  ]
  const recovered = {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(12),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(recovered)).toEqual([
    RunnableFrontierTransition.RunIntegrator({
      lineage: scenario.currentLineage,
      lineageObservedAt: JournalPosition.make(11),
      responsibility,
      run: integratorRunCorrelationForSession(successor, IntegratorRunOrdinal.make(1))
    })
  ])
})

it("derives a fresh quarantine after the authorized Retry run ends conclusively", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const records = [
    ...scenario.records,
    record(
      12,
      IntegratorRunStartedEvent.make({ run: runTwo, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runTwo)
    ),
    record(
      13,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: runTwo, detail: notPreparedDetail }),
        run: runTwo,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(runTwo)
    )
  ]
  const runState: ReconstructedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(13),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilities: [identity(responsibility.queuedAt)],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, scenario.currentLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
    },
    [responsibility]
  ).transitions()

  expect(transitions).toEqual([
    expect.objectContaining({
      _tag: "RecordRetryConclusiveIntegrationQuarantine",
      responsibility,
      result: expect.objectContaining({ _tag: "NotPrepared", detail: notPreparedDetail, run: runTwo })
    })
  ])
})

it("fixes one FullRerun successor after the conclusive Retry run is quarantined", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const quarantineBasis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: notPreparedDetail }),
    evidence: { resultRecordedAt: JournalPosition.make(13) }
  })
  const quarantine = record(
    14,
    IntegrationQuarantinedEvent.make({
      basis: quarantineBasis,
      correlation: scenario.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    }),
    integrationQuarantinedRecordKey(scenario.session.sessionId, quarantineBasis)
  )
  const direction = record(
    15,
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: quarantine.position,
        sessionId: scenario.session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "frontier-q2-full-rerun", runId }),
      version: workflowJournalEventVersion
    }),
    integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({
        quarantineAt: quarantine.position,
        sessionId: scenario.session.sessionId
      })
    )
  )
  const fresh = lineageRecords(17, lineage(changedHead), "q2-full-rerun-lineage")
  const records = [
    ...scenario.records,
    record(
      12,
      IntegratorRunStartedEvent.make({ run: runTwo, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runTwo)
    ),
    record(
      13,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: runTwo, detail: notPreparedDetail }),
        run: runTwo,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(runTwo)
    ),
    quarantine,
    direction,
    fresh.intent,
    fresh.observation
  ]
  const fullRerunAfterRetry = {
    ...scenario,
    currentLineage: lineage(changedHead),
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(17),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(fullRerunAfterRetry)).toEqual([
    RunnableFrontierTransition.FixIntegratorSuccessorSession({
      input: {
        directionAppliedAt: JournalPosition.make(15),
        predecessor: scenario.session,
        quarantineAt: JournalPosition.make(14),
        targetLineage: lineage(changedHead),
        targetLineageObservedAt: JournalPosition.make(17)
      },
      responsibility
    })
  ])
})

it("continues unrelated runnable work while an integration session is restored", () => {
  const scenario = unfinishedFirstSessionHistory()
  const unrelatedTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/integration-frontier-unrelated.git")
  })
  const unrelatedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("integration-frontier-restored-unrelated-attempt"),
    baseSha,
    branch: TaskBranchRef.make("refs/heads/dalph/integration-frontier-restored-unrelated"),
    executor: TaskExecutorLocator.make("executor:controlled-frontier-unrelated"),
    runId,
    taskId: TaskId.make("integration-frontier-restored-unrelated-task"),
    taskRevision: TaskRevision.make("integration-frontier-restored-unrelated-revision"),
    worktree: WorktreeLocator.make("/worktrees/integration-frontier-restored-unrelated")
  })
  const unrelatedResult = acceptedResultFixture(sha("d"))
  const records = [
    ...scenario.records,
    record(
      7,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: unrelatedResult,
        integrationTarget: unrelatedTarget,
        plannedAttempt: unrelatedAttempt,
        version: workflowJournalEventVersion
      }),
      "integration-frontier:restored:unrelated:responsibility"
    )
  ]
  const runState: ReconstructedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(7),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const admission = deriveIntegrationAdmission(records)
  const restored = admission.responsibilities.find(
    (candidate) => candidate.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId
  )
  const unrelated = admission.responsibilities.find(
    (candidate) => candidate.plannedAttempt.attemptId === unrelatedAttempt.attemptId
  )
  expect(restored?._tag).toBe("StartedIntegrationResponsibility")
  expect(unrelated?._tag).toBe("QueuedIntegrationResponsibility")
  if (restored?._tag !== "StartedIntegrationResponsibility") return
  if (unrelated?._tag !== "QueuedIntegrationResponsibility") return

  expect(
    deriveIntegrationFrontier(runState, {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([restored.plannedAttempt.taskId, unrelated.plannedAttempt.taskId]),
      heldResponsibilities: [],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[restored.plannedAttempt.attemptId, scenario.initialLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([
        [restored.plannedAttempt.attemptId, { _tag: "Exact" as const }],
        [unrelated.plannedAttempt.attemptId, { _tag: "Exact" as const }]
      ])
    }).transitions
  ).toEqual([
    RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: restored }),
    RunnableFrontierTransition.StartQueuedIntegration({ responsibility: unrelated })
  ])

  expect(
    deriveIntegrationFrontier(runState, {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([restored.plannedAttempt.taskId, unrelated.plannedAttempt.taskId]),
      heldResponsibilities: [identity(restored.queuedAt, restored.plannedAttempt.runId)],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[restored.plannedAttempt.attemptId, scenario.initialLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([
        [restored.plannedAttempt.attemptId, { _tag: "Exact" as const }],
        [unrelated.plannedAttempt.attemptId, { _tag: "Exact" as const }]
      ])
    }).transitions
  ).toEqual([
    RunnableFrontierTransition.RunIntegrator({
      lineage: scenario.initialLineage,
      lineageObservedAt: JournalPosition.make(4),
      responsibility: restored,
      run: scenario.run
    }),
    RunnableFrontierTransition.StartQueuedIntegration({ responsibility: unrelated })
  ])
})

it("blocks later same-target integration while unrelated work continues", () => {
  const scenario = quarantinedFirstSessionHistory()
  const laterSameTargetAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("integration-frontier-quarantined-later-attempt"),
    baseSha,
    branch: TaskBranchRef.make("refs/heads/dalph/integration-frontier-quarantined-later"),
    executor: TaskExecutorLocator.make("executor:controlled-frontier-later"),
    runId,
    taskId: TaskId.make("integration-frontier-quarantined-later-task"),
    taskRevision: TaskRevision.make("integration-frontier-quarantined-later-revision"),
    worktree: WorktreeLocator.make("/worktrees/integration-frontier-quarantined-later")
  })
  const unrelatedTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/integration-frontier-quarantined-unrelated.git")
  })
  const unrelatedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("integration-frontier-quarantined-unrelated-attempt"),
    baseSha,
    branch: TaskBranchRef.make("refs/heads/dalph/integration-frontier-quarantined-unrelated"),
    executor: TaskExecutorLocator.make("executor:controlled-frontier-unrelated"),
    runId,
    taskId: TaskId.make("integration-frontier-quarantined-unrelated-task"),
    taskRevision: TaskRevision.make("integration-frontier-quarantined-unrelated-revision"),
    worktree: WorktreeLocator.make("/worktrees/integration-frontier-quarantined-unrelated")
  })
  const records = [
    ...scenario.records,
    record(
      9,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResultFixture(sha("d")),
        integrationTarget: target,
        plannedAttempt: laterSameTargetAttempt,
        version: workflowJournalEventVersion
      }),
      "integration-frontier:quarantined:later:responsibility"
    ),
    record(
      10,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResultFixture(sha("f")),
        integrationTarget: unrelatedTarget,
        plannedAttempt: unrelatedAttempt,
        version: workflowJournalEventVersion
      }),
      "integration-frontier:quarantined:unrelated:responsibility"
    )
  ]
  const runState: ReconstructedRunState = {
    ...scenario.runState,
    appliedThrough: JournalPosition.make(10),
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const admission = deriveIntegrationAdmission(records)
  const laterSameTarget = admission.responsibilities.find(
    (candidate) => candidate.plannedAttempt.attemptId === laterSameTargetAttempt.attemptId
  )
  const unrelated = admission.responsibilities.find(
    (candidate) => candidate.plannedAttempt.attemptId === unrelatedAttempt.attemptId
  )
  expect(laterSameTarget?._tag).toBe("QueuedIntegrationResponsibility")
  expect(unrelated?._tag).toBe("QueuedIntegrationResponsibility")
  if (laterSameTarget?._tag !== "QueuedIntegrationResponsibility") {
    return
  }
  if (unrelated?._tag !== "QueuedIntegrationResponsibility") {
    return
  }

  expect(
    deriveIntegrationFrontier(runState, {
      activeResponsibilities: [],
      currentTrackerTaskIds: new Set([
        responsibility.plannedAttempt.taskId,
        laterSameTarget.plannedAttempt.taskId,
        unrelated.plannedAttempt.taskId
      ]),
      heldResponsibilities: [],
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set<AttemptId>(),
      taskClaimAuthorityByAttemptId: new Map([
        [responsibility.plannedAttempt.attemptId, { _tag: "Exact" as const }],
        [laterSameTarget.plannedAttempt.attemptId, { _tag: "Exact" as const }],
        [unrelated.plannedAttempt.attemptId, { _tag: "Exact" as const }]
      ])
    }).transitions
  ).toEqual([RunnableFrontierTransition.StartQueuedIntegration({ responsibility: unrelated })])
})

it("fixes a FullRerun successor when the fresh lineage remains compatible", () => {
  const scenario = fullRerunHistory(fixedHead)

  expect(transitionsFor(scenario)).toEqual([
    RunnableFrontierTransition.FixIntegratorSuccessorSession({
      input: {
        directionAppliedAt: JournalPosition.make(9),
        predecessor: scenario.session,
        quarantineAt: JournalPosition.make(8),
        targetLineage: scenario.currentLineage,
        targetLineageObservedAt: JournalPosition.make(11)
      },
      responsibility
    })
  ])
})

it("releases the target when Retry keeps its fixed head but loses lineage ancestry", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const records = scenario.records.map((candidate) =>
    candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
      ? {
          ...candidate,
          event: TargetLineageObservedEvent.make({ ...candidate.event, observation: incompatibleLineage })
        }
      : candidate
  )
  const blocked = {
    ...scenario,
    currentLineage: incompatibleLineage,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("releases the target when Retry evidence cannot prove the prior run result", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const records = scenario.records.filter(
    ({ event }) => !(event._tag === "IntegratorRunResultRecorded" && event.run.ordinal === IntegratorRunOrdinal.make(1))
  )
  const blocked = {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: records.at(-1)?.position ?? null,
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("blocks a FullRerun successor when its fresh lineage is not an ancestor", () => {
  const scenario = fullRerunHistory(fixedHead)
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const records = scenario.records.map((candidate) =>
    candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
      ? {
          ...candidate,
          event: TargetLineageObservedEvent.make({ ...candidate.event, observation: incompatibleLineage })
        }
      : candidate
  )
  const blocked = {
    ...scenario,
    currentLineage: incompatibleLineage,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("blocks a changed-head Retry when the fresh lineage has a different planned base", () => {
  const scenario = retryHistory("ConclusiveResult", changedHead)
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: sha("f"),
    targetHeadSha: changedHead
  })
  const records = scenario.records.map((candidate) =>
    candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
      ? {
          ...candidate,
          event: TargetLineageObservedEvent.make({ ...candidate.event, observation: incompatibleLineage })
        }
      : candidate
  )
  const blocked = {
    ...scenario,
    currentLineage: incompatibleLineage,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("blocks an ordinal-two Retry when a fresh lineage operation is duplicated", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const fresh = scenario.records.find(
    (candidate) => candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
  )
  expect(fresh?.event._tag).toBe("TargetLineageObserved")
  if (fresh === undefined || fresh.event._tag !== "TargetLineageObserved") return
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const runStart = record(
    12,
    IntegratorRunStartedEvent.make({ run: runTwo, version: workflowJournalEventVersion }),
    integratorRunStartedRecordKey(runTwo)
  )
  const duplicateFresh = {
    ...fresh,
    key: JournalRecordKey.make("integration-frontier:duplicate-fresh-lineage"),
    position: JournalPosition.make(13)
  }
  const records = [...scenario.records, runStart, duplicateFresh]
  const blocked = {
    ...scenario,
    records,
    runState: {
      ...scenario.runState,
      appliedThrough: JournalPosition.make(13),
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("blocks a Retry when its durable result detail no longer matches the quarantine", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const mismatchedDetail = IntegratorNotPreparedDetail.make("a different durable terminal detail")
  const records = scenario.records.map((candidate) =>
    candidate.event._tag === "IntegratorRunResultRecorded" &&
    candidate.event.run.ordinal === IntegratorRunOrdinal.make(1)
      ? {
          ...candidate,
          event: IntegratorRunResultRecordedEvent.make({
            ...candidate.event,
            result: IntegratorResult.cases.NotPrepared.make({
              correlation: candidate.event.run,
              detail: mismatchedDetail
            })
          })
        }
      : candidate
  )
  const blocked = {
    ...scenario,
    records,
    runState: { ...scenario.runState, workflowHistory: { evidence: journalEvidenceFrom(records) } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})
