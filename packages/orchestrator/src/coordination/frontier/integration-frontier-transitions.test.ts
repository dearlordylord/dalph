import { Option } from "effect"
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
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
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
  outcomeRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey
} from "../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../workflow/registry/event.js"
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
  IntegratorNotPreparedDetail,
  firstFullRerunSuccessorGeneration
} from "../../workflow/protocols/integrator/events.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  integratorSuccessorCorrelationFor
} from "../../workflow/protocols/integrator/session.js"
import {
  deriveCurrentIntegratorState,
  integratorRunQualifiedCandidateFromState
} from "../../workflow/protocols/integrator/state.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import { deriveIntegrationFrontier } from "./integration-frontier.js"
import { deriveStartedIntegrationFrontier } from "./integration-frontier-transitions.js"
import { RunnableFrontierTransition } from "./frontier.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("integration-frontier-retry-run")
const notAppliedCancellation = { _tag: "RunCancellationNotApplied" as const }
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

const lineage = (targetHeadSha: GitCommitSha) =>
  TargetLineageObservation.make({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: baseSha, targetHeadSha })

const record = (position: number, event: JournalRecord["event"], key: string): JournalRecord => ({
  event,
  key: JournalRecordKey.make(key),
  position: JournalPosition.make(position),
  runId
})

const firstStartedResponsibilityRecords = () => [
  record(
    1,
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: responsibility.acceptedResult,
      integrationTarget: responsibility.integrationTarget,
      plannedAttempt: responsibility.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    "integration-frontier:restored:first:responsibility"
  ),
  record(
    2,
    IntegrationStartedEvent.make({
      acceptedResult: responsibility.acceptedResult,
      integrationTarget: responsibility.integrationTarget,
      plannedAttempt: responsibility.plannedAttempt,
      responsibilityBeganAt: responsibility.queuedAt,
      version: workflowJournalEventVersion
    }),
    "integration-frontier:restored:first:started"
  )
]

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
      workflowHistory: { records }
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(8), workflowHistory: { records } }
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
      workflowHistory: { records }
    } satisfies ReconstructedRunState,
    session
  }
}

const transitionsFor = (scenario: ReturnType<typeof retryHistory>) =>
  deriveStartedIntegrationFrontier(
    scenario.runState,
    {
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilityPositions: new Set([responsibility.queuedAt]),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, scenario.currentLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set(),
      targetPromotionConfigured: true,
      taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
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
  return { ...scenario, records, runState: { ...scenario.runState, workflowHistory: { records } } }
}

it("releases the target before an initial Integrator run when fresh lineage is incompatible", () => {
  const incompatibleLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: false,
    plannedBaseSha: baseSha,
    targetHeadSha: fixedHead
  })
  const fresh = lineageRecords(4, incompatibleLineage, "incompatible-initial-lineage")
  const records = [...firstStartedResponsibilityRecords(), fresh.intent, fresh.observation]
  const runState: ReconstructedRunState = {
    appliedThrough: JournalPosition.make(4),
    controlPolicy: Option.none(),
    graphKnowledge: { taskTrackerFacts: [] },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    cancellation: notAppliedCancellation,
    responsibility: { entries: [] },
    runId,
    workflowHistory: { records }
  }

  expect(
    deriveStartedIntegrationFrontier(
      runState,
      {
        activeResponsibilityPositions: new Set(),
        currentTrackerTaskIds: new Set([taskId]),
        heldResponsibilityPositions: new Set([responsibility.queuedAt]),
        integrationTarget: Option.some(target),
        targetLineageByAttemptId: new Map([[attemptId, incompatibleLineage]]),
        targetLineageRefreshRequiredAttemptIds: new Set(),
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })])
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
    runState: { ...scenario.runState, workflowHistory: { records } }
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
    workflowHistory: { records }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set(),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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
    workflowHistory: { records }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set(),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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

it("resumes the same unfinished Retry run after process disappearance", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const runTwo = integratorRunCorrelationForSession(scenario.session, IntegratorRunOrdinal.make(2))
  const records = [
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(12), workflowHistory: { records } }
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(15), workflowHistory: { records } }
  }

  expect(transitionsFor(qualified)).toEqual([
    expect.objectContaining({
      _tag: "RunTargetPromotion",
      candidate: expect.objectContaining({
        candidateCommit: preparedCandidateCommit,
        candidateText: preparedCandidateText,
        run: runTwo
      }),
      responsibility
    })
  ])
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
  const records = [
    ...qualifiedRecords,
    record(
      10,
      TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion }),
      targetPromotionIntentRecordKey(correlation.requestId).toString()
    ),
    record(
      11,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: fixedHead }),
        version: workflowJournalEventVersion
      }),
      targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal).toString()
    )
  ]
  const runState = { ...scenario.runState, appliedThrough: JournalPosition.make(11), workflowHistory: { records } }

  expect(
    deriveStartedIntegrationFrontier(
      runState,
      {
        activeResponsibilityPositions: new Set(),
        currentTrackerTaskIds: new Set(),
        heldResponsibilityPositions: new Set([responsibility.queuedAt]),
        integrationTarget: Option.some(target),
        targetLineageByAttemptId: new Map([[attemptId, lineage(preparedCandidateCommit)]]),
        targetLineageRefreshRequiredAttemptIds: new Set([attemptId]),
        targetPromotionConfigured: true,
        taskClaimAuthorityByAttemptId: new Map()
      },
      [responsibility]
    ).transitions()
  ).toEqual([RunnableFrontierTransition.RunTargetPromotion({ candidate, responsibility })])
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(12), workflowHistory: { records } }
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
    workflowHistory: { records }
  }

  const transitions = deriveStartedIntegrationFrontier(
    runState,
    {
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set([taskId]),
      heldResponsibilityPositions: new Set([responsibility.queuedAt]),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[attemptId, scenario.currentLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(17), workflowHistory: { records } }
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
    workflowHistory: { records }
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
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set([restored.plannedAttempt.taskId, unrelated.plannedAttempt.taskId]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[restored.plannedAttempt.attemptId, scenario.initialLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set([restored.plannedAttempt.taskId, unrelated.plannedAttempt.taskId]),
      heldResponsibilityPositions: new Set([restored.queuedAt]),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map([[restored.plannedAttempt.attemptId, scenario.initialLineage]]),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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
    workflowHistory: { records }
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
      activeResponsibilityPositions: new Set(),
      currentTrackerTaskIds: new Set([
        responsibility.plannedAttempt.taskId,
        laterSameTarget.plannedAttempt.taskId,
        unrelated.plannedAttempt.taskId
      ]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(target),
      targetLineageByAttemptId: new Map(),
      targetLineageRefreshRequiredAttemptIds: new Set(),
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
    runState: { ...scenario.runState, workflowHistory: { records } }
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
    runState: { ...scenario.runState, appliedThrough: records.at(-1)?.position ?? null, workflowHistory: { records } }
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
    runState: { ...scenario.runState, workflowHistory: { records } }
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
    runState: { ...scenario.runState, workflowHistory: { records } }
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
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(13), workflowHistory: { records } }
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
  const blocked = { ...scenario, records, runState: { ...scenario.runState, workflowHistory: { records } } }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("blocks the initial Retry authorization when its fresh lineage operation repeats", () => {
  const scenario = retryHistory("ConclusiveResult", fixedHead)
  const fresh = scenario.records.find(
    (candidate) => candidate.position === JournalPosition.make(11) && candidate.event._tag === "TargetLineageObserved"
  )
  expect(fresh?.event._tag).toBe("TargetLineageObserved")
  if (fresh === undefined || fresh.event._tag !== "TargetLineageObserved") return
  const duplicateFresh = {
    ...fresh,
    key: JournalRecordKey.make("integration-frontier:duplicate-initial-retry-lineage"),
    position: JournalPosition.make(13)
  }
  const records = [...scenario.records, duplicateFresh]
  const blocked = {
    ...scenario,
    records,
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(13), workflowHistory: { records } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})

it("does not synthesize a provider quarantine from duplicate absence records", () => {
  const scenario = retryHistory("ProviderRunFailure", fixedHead)
  const absence = scenario.records.find(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")
  expect(absence?.event._tag).toBe("IntegrationProviderRunActivityAbsent")
  if (absence === undefined || absence.event._tag !== "IntegrationProviderRunActivityAbsent") {
    return
  }
  const duplicate = {
    ...absence,
    key: JournalRecordKey.make("integration-frontier:duplicate-provider-absence"),
    position: JournalPosition.make(13)
  }
  const records = [...scenario.records, duplicate]
  const blocked = {
    ...scenario,
    records,
    runState: { ...scenario.runState, appliedThrough: JournalPosition.make(13), workflowHistory: { records } }
  }

  expect(transitionsFor(blocked)).toEqual([
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })
  ])
})
