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
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent,
  IntegrationProviderRunActivityAbsentEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegratorResult,
  IntegratorRunStartedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunOrdinal,
  IntegratorSessionFixedEvent,
  IntegratorNotPreparedDetail
} from "../../workflow/protocols/integrator/events.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession
} from "../../workflow/protocols/integrator/session.js"
import { deriveStartedIntegrationFrontier } from "./integration-frontier-transitions.js"
import { RunnableFrontierTransition } from "./frontier.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("integration-frontier-retry-run")
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
      `integration-frontier-retry:${suffix}:observation`
    ),
    intent: record(
      position - 1,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      }),
      `integration-frontier-retry:${suffix}:intent`
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
              result: IntegratorResult.cases.NotPrepared.make({ correlation: session, detail: notPreparedDetail }),
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
              version: workflowJournalEventVersion
            }),
            "integration-frontier-retry:provider-activity-absent"
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
    "integration-frontier-retry:quarantine"
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
    "integration-frontier-retry:direction"
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
      taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
    },
    [responsibility]
  ).transitions()

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

it("does not start Retry without a fresh target-lineage observation", () => {
  const scenario = retryHistory("ProviderRunFailure")
  const transitions = transitionsFor(scenario)
  expect(transitions).not.toContainEqual(expect.objectContaining({ _tag: "RunIntegrator" }))
})

it("starts no retry when the session target head has changed", () => {
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
