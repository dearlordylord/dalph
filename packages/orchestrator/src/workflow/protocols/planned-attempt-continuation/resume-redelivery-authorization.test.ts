import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import { Option } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../attempt-choice/events.js"
import type { SafeContinuationRevalidationEligibility } from "../../../coordination/frontier/fresh-facts.js"
import { deriveJournalResponsibilityFacts } from "../../../coordination/run/recovery-activation.js"
import type { ReconstructedRunState } from "../../../coordination/reconstruction/state.js"
import { validSnapshot } from "../../../../test/task-dag.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  PlannedAttemptExecutorResumeRedeliveryOrdinal,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../planned-attempt-executor-work/events.js"
import {
  evaluatePlannedAttemptResumeRedeliveryAuthorization,
  evaluatePlannedAttemptResumeRedeliveryProof,
  isPlannedAttemptResumeRedeliveryAuthorization
} from "./resume-redelivery-authorization.js"

const runId = RunId.make("resume-redelivery-authorization-run")
const taskId = TaskId.make("C")
const target = FixtureTarget.make("resume-redelivery-authorization-target")
const specification = makeTaskWorkSpecification({ body: "Continue C", taskId, title: "C" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("resume-redelivery-authorization-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/C"),
  executor: TaskExecutorLocator.make("executor:resume-redelivery"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/C")
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("resume-redelivery-claim-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("resume-redelivery-claim")
})
const resumeCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)

const append = (records: Array<JournalRecord>, event: JournalRecord["event"]): JournalRecord => {
  const record = {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(records.length + 1),
    runId
  }
  records.push(record)
  return record
}

const fixture = () => {
  const records: Array<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
  ]
  const claimAcquisition = makeTaskClaimAcquisitionOperation({ acquisition: activeClaim, predecessorOperationIds: [] })
  append(
    records,
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimAcquisition, version: workflowJournalEventVersion })
  )
  append(records, TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion }))
  const planOperationId = OperationId.make("resume-redelivery-plan")
  append(
    records,
    TaskAttemptPlannedEvent.make({
      operation: makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt,
        predecessorOperationIds: [activeClaim.operationId]
      }),
      version: workflowJournalEventVersion
    })
  )
  const responsibility = append(
    records,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
  })
  const lifecycleGraph = (state: "closed" | "open") =>
    makeTrackerGraphObservationOperation(
      { _tag: "AttemptContinuation" },
      OperationId.make(`resume-redelivery-lifecycle-${state}`),
      target,
      [planOperationId],
      [taskId]
    )
  const lifecycleSnapshot = (state: "closed" | "open") =>
    validSnapshot({
      revision: `resume-redelivery-lifecycle-${state}`,
      tasks: [
        {
          id: taskId,
          lifecycle: state === "closed" ? ({ _tag: "TerminalWithoutSuccess" } as const) : ({ _tag: "Open" } as const),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
  const closedGraph = lifecycleGraph("closed")
  const reopenedGraph = lifecycleGraph("open")
  append(records, taskTrackerReadIntent(closedGraph))
  append(
    records,
    taskTrackerFactsObservedEvent(
      closedGraph.operationId,
      makeCompleteTaskTrackerFactsObserved(closedGraph, lifecycleSnapshot("closed"))
    )
  )
  const acceptedSafeOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
  append(
    records,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: acceptedSafeOrdinal,
      report: safe,
      version: workflowJournalEventVersion
    })
  )
  append(records, taskTrackerReadIntent(reopenedGraph))
  append(
    records,
    taskTrackerFactsObservedEvent(
      reopenedGraph.operationId,
      makeCompleteTaskTrackerFactsObserved(reopenedGraph, lifecycleSnapshot("open"))
    )
  )
  append(
    records,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: resumeCommandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const projection = append(
    records,
    PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: resumeCommandOrdinal,
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report: safe }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal,
      version: workflowJournalEventVersion
    })
  )
  const graph = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make("resume-redelivery-graph"),
    target,
    [planOperationId],
    [taskId]
  )
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("resume-redelivery-specification"),
    target,
    taskId,
    [planOperationId, graph.operationId]
  )
  const claimRead = makeTaskClaimObservationOperation(OperationId.make("resume-redelivery-claim"), target, taskId, [
    planOperationId,
    graph.operationId,
    specificationRead.operationId
  ])
  const worktree = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("resume-redelivery-worktree"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const lineage = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("resume-redelivery-lineage"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  append(records, taskTrackerReadIntent(graph))
  append(
    records,
    taskTrackerGraphFactsObserved(graph, {
      revision: TrackerRevision.make("resume-redelivery-current-graph"),
      taskIds: [taskId]
    })
  )
  append(records, taskTrackerReadIntent(specificationRead))
  append(
    records,
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, specification)
    )
  )
  append(records, taskTrackerReadIntent(claimRead))
  append(
    records,
    taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsObserved(claimRead, activeClaim))
  )
  append(
    records,
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: worktree,
      version: workflowJournalEventVersion
    })
  )
  append(
    records,
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktree.operationId,
      version: workflowJournalEventVersion
    })
  )
  append(
    records,
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: lineage,
      version: workflowJournalEventVersion
    })
  )
  append(
    records,
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: plannedAttempt.baseSha
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineage.operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const witness = {
    activeTaskContinuationRead: {
      graphObservationOperationId: graph.operationId,
      taskClaimObservationOperationId: claimRead.operationId,
      taskWorkSpecificationObservationOperationId: specificationRead.operationId
    },
    targetLineageObservationOperationId: lineage.operationId,
    worktreeObservationOperationId: worktree.operationId
  }
  const runState: ReconstructedRunState = {
    appliedThrough: records.at(-1)?.position ?? null,
    cancellation: { _tag: "RunCancellationNotApplied" },
    controlPolicy: Option.none(),
    graphKnowledge: {
      taskTrackerFacts: [
        makeCompleteTaskTrackerFactsObserved(closedGraph, lifecycleSnapshot("closed")),
        makeCompleteTaskTrackerFactsObserved(reopenedGraph, lifecycleSnapshot("open"))
      ]
    },
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    responsibility: {
      entries: [{ _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: responsibility.position, plannedAttempt }]
    },
    runId,
    workflowHistory: { evidence: journalEvidenceFrom(records) }
  }
  const facts = deriveJournalResponsibilityFacts(runState).find(
    (candidate) => candidate._tag === "PlannedAttemptExecutorFreshFacts"
  )
  const eligibility = facts?.safeContinuationRevalidationEligibility
  if (eligibility === undefined) expect.fail("fixture must mint exact reconciled-Safe eligibility")
  return { eligibility, projection, records, witness }
}

describe("Resume redelivery authorization", () => {
  it("authorizes only the exact issued retry basis after all five post-projection witnesses", () => {
    const { eligibility, records, witness } = fixture()
    const result = evaluatePlannedAttemptResumeRedeliveryAuthorization(records, plannedAttempt, eligibility, witness)
    expect(result._tag).toBe("Authorized")
    if (result._tag !== "Authorized") return
    expect(isPlannedAttemptResumeRedeliveryAuthorization(result.authorization)).toBe(true)
    expect(result.authorization).toMatchObject({
      plannedAttempt,
      projectionOrdinal,
      resumeCommandOrdinal,
      safeProjectionObservedAt:
        eligibility.basis._tag === "ReconciledResumeStillSafe" ? eligibility.basis.observedAt : -1,
      witness
    })
  })

  it.each([
    ["an unissued structural token", (eligibility: SafeContinuationRevalidationEligibility) => ({ ...eligibility })],
    [
      "first lifecycle-reopen eligibility",
      () => {
        const { eligibility } = fixture()
        return { ...eligibility, basis: { _tag: "LifecycleReopenAfterAcceptedSafe" as const } }
      }
    ]
  ])("rejects %s", (_name, alter) => {
    const { eligibility, records, witness } = fixture()
    const result = evaluatePlannedAttemptResumeRedeliveryAuthorization(
      records,
      plannedAttempt,
      alter(eligibility) as SafeContinuationRevalidationEligibility,
      witness
    )
    expect(result).toMatchObject({ _tag: "Rejected", reason: "InvalidEligibility" })
  })

  it("rejects an issued eligibility presented for another exact attempt", () => {
    const { eligibility, records, witness } = fixture()
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("foreign-resume-redelivery-attempt")
    })
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(records, foreignAttempt, eligibility, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "InvalidEligibility" })
  })

  it("rejects a missing or mismatched exact Resume projection", () => {
    const { eligibility, projection, records, witness } = fixture()
    const withoutProjection = records.filter(({ position }) => position !== projection.position)
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(withoutProjection, plannedAttempt, eligibility, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })

    if (eligibility.basis._tag !== "ReconciledResumeStillSafe") expect.fail("fixture retry basis missing")
    expect(
      evaluatePlannedAttemptResumeRedeliveryProof(
        records,
        plannedAttempt,
        { ...eligibility.basis, projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(2) },
        witness
      )
    ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })
  })

  it("rejects redelivery when the immutable Run target or accepted Resume intent is absent", () => {
    const { eligibility, records, witness } = fixture()
    if (eligibility.basis._tag !== "ReconciledResumeStillSafe") expect.fail("fixture retry basis missing")

    expect(
      evaluatePlannedAttemptResumeRedeliveryProof(records.slice(1), plannedAttempt, eligibility.basis, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "MissingWitness" })

    const withoutResumeIntent = records.filter(({ event }) => event._tag !== "PlannedAttemptExecutorCommandIntended")
    expect(
      evaluatePlannedAttemptResumeRedeliveryProof(withoutResumeIntent, plannedAttempt, eligibility.basis, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "MissingResumeIntent" })
  })

  it("rejects a later semantic command inserted before the reconciled projection", () => {
    const { eligibility, projection, records, witness } = fixture()
    if (eligibility.basis._tag !== "ReconciledResumeStillSafe") expect.fail("fixture retry basis missing")
    const shifted = records.map((record) =>
      record.position >= projection.position
        ? { ...record, position: JournalPosition.make(Number(record.position) + 1) }
        : record
    )
    const laterResume = PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(4),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
    shifted.splice(Number(projection.position) - 1, 0, {
      event: laterResume,
      key: describeJournalEvent(laterResume).expectedKey,
      position: projection.position,
      runId
    })
    expect(
      evaluatePlannedAttemptResumeRedeliveryProof(
        shifted,
        plannedAttempt,
        { ...eligibility.basis, observedAt: JournalPosition.make(Number(eligibility.basis.observedAt) + 1) },
        witness
      )
    ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })
  })

  it("rejects eligibility whose exact projection was already consumed", () => {
    const { eligibility, records, witness } = fixture()
    if (eligibility.basis._tag !== "ReconciledResumeStillSafe") expect.fail("fixture retry basis missing")
    append(
      records,
      PlannedAttemptExecutorResumeRedeliveryIntendedEvent.make({
        authorization: { safeProjectionObservedAt: eligibility.basis.observedAt, witness },
        commandOrdinal: eligibility.basis.resumeCommandOrdinal,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt,
        projectionOrdinal: eligibility.basis.projectionOrdinal,
        redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal.make(1),
        version: workflowJournalEventVersion
      })
    )
    const result = evaluatePlannedAttemptResumeRedeliveryAuthorization(records, plannedAttempt, eligibility, witness)
    expect(result).toMatchObject({ _tag: "Rejected", reason: "ConsumedProjection" })
  })

  it("rejects missing and stale post-projection focused evidence", () => {
    const { eligibility, projection, records, witness } = fixture()
    const missingGraph = records.filter(
      ({ event }) =>
        event._tag !== "TaskTrackerFactsObserved" ||
        event.operationId !== witness.activeTaskContinuationRead.graphObservationOperationId
    )
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(missingGraph, plannedAttempt, eligibility, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "MissingWitness", witness: "ActiveTaskContinuationGraph" })

    const graphOutcome = records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId === witness.activeTaskContinuationRead.graphObservationOperationId
    )
    if (graphOutcome === undefined) expect.fail("fixture graph outcome missing")
    const staleGraph = records.map((record) =>
      record === graphOutcome ? { ...record, position: projection.position } : record
    )
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(staleGraph, plannedAttempt, eligibility, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "StaleWitness", witness: "ActiveTaskContinuationGraph" })
  })

  it.each([
    [
      "graph",
      (witness: ReturnType<typeof fixture>["witness"]) => witness.activeTaskContinuationRead.graphObservationOperationId
    ],
    [
      "specification",
      (witness: ReturnType<typeof fixture>["witness"]) =>
        witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
    ],
    [
      "claim",
      (witness: ReturnType<typeof fixture>["witness"]) =>
        witness.activeTaskContinuationRead.taskClaimObservationOperationId
    ],
    ["worktree", (witness: ReturnType<typeof fixture>["witness"]) => witness.worktreeObservationOperationId],
    ["target lineage", (witness: ReturnType<typeof fixture>["witness"]) => witness.targetLineageObservationOperationId]
  ])("rejects a missing post-projection %s outcome", (_name, operationIdOf) => {
    const { eligibility, records, witness } = fixture()
    const operationId = operationIdOf(witness)
    const missing = records.filter(({ event }) => {
      if (event._tag === "TaskTrackerFactsObserved") return event.operationId !== operationId
      if (event._tag === "PlannedAttemptWorktreeObserved") return event.operationId !== operationId
      if (event._tag === "TargetLineageObserved") return event.operationId !== operationId
      return true
    })
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(missing, plannedAttempt, eligibility, witness)
    ).toMatchObject({ _tag: "Rejected", reason: "MissingWitness" })
  })

  it("rejects later executor projection evidence and a terminal operator choice", () => {
    const projected = fixture()
    append(
      projected.records,
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: resumeCommandOrdinal,
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
          })
        }),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(2),
        version: workflowJournalEventVersion
      })
    )
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(
        projected.records,
        plannedAttempt,
        projected.eligibility,
        projected.witness
      )
    ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })

    const terminal = fixture()
    append(
      terminal.records,
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({ nonce: "stop-after-reconciliation", runId }),
        subject: { observedTaskRevision: TaskRevision.make("changed-after-reconciliation"), plannedAttempt },
        version: workflowJournalEventVersion
      })
    )
    expect(
      evaluatePlannedAttemptResumeRedeliveryAuthorization(
        terminal.records,
        plannedAttempt,
        terminal.eligibility,
        terminal.witness
      )
    ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })
  })

  it("rejects later Begin or Resume executor evidence", () => {
    for (const command of ["Begin", "Resume"] as const) {
      const { eligibility, records, witness } = fixture()
      append(
        records,
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: PlannedAttemptExecutorCommandOrdinal.make(4),
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      expect(
        evaluatePlannedAttemptResumeRedeliveryAuthorization(records, plannedAttempt, eligibility, witness)
      ).toMatchObject({ _tag: "Rejected", reason: "StaleExecutorEvidence" })
    }
  })
})
