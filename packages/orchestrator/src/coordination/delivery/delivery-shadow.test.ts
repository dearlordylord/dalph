import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Effect, Fiber, Layer, Option, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  TaskLifecycle,
  TrackerRevision,
  TrackerSnapshot,
  type TaskLifecycle as TaskLifecycleType
} from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import { FrontierExplanation, RunnableFrontierTransition, type RunnableFrontier } from "../frontier/frontier.js"
import type { IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import {
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState
} from "../reconstruction/state.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-relation.js"
import {
  compareDeliveryShadow,
  DeliveryShadowDiagnostics,
  type DeliveryShadowComparison,
  ticketDeliveryEvidenceOf,
  observeDeliveryShadow
} from "./delivery-shadow.js"
import { observeBoundaryDeliveryShadow } from "./boundary-delivery-shadow.js"
import { observeQuiescenceDeliveryShadow } from "./quiescence-delivery-shadow.js"
import { currentSignalOf, makeDeliveryReflection, makeDeliverySettlements, TrackerGraphState } from "./relations.js"
import { delivery } from "./delivery.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { observeDeliveryShadowWithinTurn } from "./delivery-shadow-budget.js"

const taskA = TaskId.make("A")
const taskB = TaskId.make("B")
const runId = RunId.make("run-shadow")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const pause = ReconstructedPauseState.make({
  run: ReconstructedRunPauseState.cases.RunUnpaused.make({}),
  tasks: ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
})

const attempt = (taskId: TaskId) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${taskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
    executor: TaskExecutorLocator.make("executor:fake"),
    runId,
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`),
    worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
  })

const graph = (lifecycleA: TaskLifecycleType = TaskLifecycle.cases.Open.make({})) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make("graph-shadow"),
      tasks: [
        { id: taskA, lifecycle: lifecycleA, parentTaskId: null, prerequisiteIds: [] },
        { id: taskB, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      ]
    })
  )
  return projected._tag === "Invalid" ? Effect.die("invalid test graph") : Effect.succeed(projected.snapshot)
}

const syntheticFrame = (currentGraph: TaskDagSnapshot): CurrentDeliveryFrame => ({
  _tag: "SyntheticCurrentDeliveryFrame",
  currentGraph,
  currentGraphOperationId: OperationId.make("operation:graph"),
  pause,
  responsibility: { entries: [] },
  runControlPolicy: policy,
  workflowFacts: []
})

const availableEvidence = (
  acceptedAt: JournalPosition | null = null,
  facts: ReadonlyArray<ResponsibilityFreshFacts> = [],
  integrationWaits: ReadonlyArray<IntegrationDeliveryWait> = []
) => ({ _tag: "AvailableDeliveryProjectionEvidence" as const, acceptedAt, facts, integrationWaits })

const executorFacts = (
  taskId: TaskId,
  disposition: Extract<ResponsibilityFreshFacts, { readonly _tag: "PlannedAttemptExecutorFreshFacts" }>["disposition"]
): ResponsibilityFreshFacts => ({
  _tag: "PlannedAttemptExecutorFreshFacts",
  disposition,
  responsibility: {
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(taskId === taskA ? 2 : 3),
    plannedAttempt: attempt(taskId)
  }
})

const acceptedResult = AcceptedResult.make({ commit: GitCommitSha.make("2".repeat(40)) })
const terminalAccepted = PlannedAttemptExecutorReport.cases.Terminal.make({
  correlation: { attemptId: attempt(taskA).attemptId, runId },
  result: PlannedAttemptExecutorResult.cases.Accepted.make({ acceptedResult })
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const record = (position: number, event: WorkflowJournalEvent) =>
  JournalRecord.make({
    event,
    key: JournalRecordKey.make(`shadow:${position}:${event._tag}`),
    position: JournalPosition.make(position),
    runId
  })

const terminalAcceptedRecords = () => {
  const plannedAttempt = attempt(taskA)
  return [
    record(
      1,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    ),
    record(
      2,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: terminalAccepted,
        version: workflowJournalEventVersion
      })
    )
  ]
}

const withHistory = (
  frame: CurrentDeliveryFrame,
  records: ReadonlyArray<JournalRecord>
): Extract<CurrentDeliveryFrame, { readonly _tag: "JournaledCurrentDeliveryFrame" }> => ({
  ...frame,
  _tag: "JournaledCurrentDeliveryFrame",
  acceptedAt: records.at(-1)?.position ?? JournalPosition.make(1),
  workflowHistory: { records }
})

it.effect("compares accepted responsibility facts independently from the legacy frontier", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    const facts = [
      executorFacts(taskA, ResponsibilityDisposition.TaskClaimUnreadableWait()),
      executorFacts(taskB, ResponsibilityDisposition.Ready())
    ]
    const legacy: RunnableFrontier = {
      explanations: [
        FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Unreadable",
          correlation: { attemptId: attempt(taskA).attemptId, runId },
          taskId: taskA,
          wakeCondition: "TaskClaimFactsObserved"
        })
      ],
      transitions: [RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt: attempt(taskB) })]
    }
    const comparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(null, facts),
      frame,
      legacy
    })

    expect(comparison._tag).toBe("ComparedDeliveryProjection")
    if (comparison._tag !== "ComparedDeliveryProjection") return
    expect(comparison.deliveries.deliveries.map(({ taskId }) => taskId)).toEqual(["A", "B"])
    expect(comparison.deliveries.deliveries.find(({ taskId }) => taskId === taskB)?.placement._tag).toBe(
      "EligibleOutsideBound"
    )
    expect(comparison.legacyOnlyTaskIds).toEqual([])
    expect(comparison.newOnlyTaskIds).toEqual([])
    expect(comparison.integrationIdentityDifferences).toEqual([])
    expect(comparison.integrationWaitDifferences).toEqual([])
    expect(comparison.proposalPresenceDifferences).toEqual([])
    expect(comparison.proposalFrontier._tag).toBe("DeliveryProposalsAvailable")
    expect(comparison.responsibilityIdentityDifferences).toEqual([])
    expect(comparison.responsibilitySituationDifferences).toEqual([])
  })
)

it.effect("compares duplicate proposal ownership as a conflict that authorizes no route", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    const plannedAttempt = attempt(taskA)
    const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
    const comparison = compareDeliveryShadow({
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(null, [executorFacts(taskA, ResponsibilityDisposition.Ready())]),
      frame,
      fresh: [],
      legacy: { explanations: [], transitions: [transition, transition, transition] },
      runId
    })

    expect(comparison).toMatchObject({
      _tag: "ComparedDeliveryProjection",
      proposalFrontier: {
        _tag: "DeliveryProposalOwnershipConflict",
        conflicts: [{ owners: ["TicketDelivery", "TicketDelivery", "TicketDelivery"] }]
      }
    })
  })
)

it.effect("preserves the fresh executor route instead of inferring provenance from its shared transition tag", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    const plannedAttempt = attempt(taskA)
    const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
    const comparison = compareDeliveryShadow({
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(),
      frame,
      fresh: [
        {
          step: FreshWorkflowStep.ContinuePlannedAttemptExecutorWork({
            plannedAttempt,
            task: Option.getOrThrow(
              Option.fromUndefinedOr(frame.currentGraph.eligibleTasks().find(({ id }) => id === taskA))
            )
          }),
          transition
        }
      ],
      legacy: { explanations: [], transitions: [transition] },
      runId
    })

    expect(comparison._tag).toBe("ComparedDeliveryProjection")
    if (comparison._tag !== "ComparedDeliveryProjection") return
    expect(comparison.proposalPresenceDifferences).toEqual([])
    expect(comparison.proposalFrontier).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [
        {
          actionIdentity: { _tag: "NoWorkflowOperationIdentity" },
          route: { _tag: "FreshExecutorWorkflowRoute", step: { _tag: "ContinuePlannedAttemptExecutorWork" } }
        }
      ]
    })
  })
)

it.effect("distinguishes missing epoch evidence from a mixed accepted epoch", () =>
  Effect.gen(function* () {
    const base = syntheticFrame(yield* graph())
    const journaled = withHistory(base, terminalAcceptedRecords())
    expect(
      compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: undefined,
        acceptedBefore: undefined,
        evidence: availableEvidence(),
        frame: journaled,
        legacy: { explanations: [], transitions: [] }
      })
    ).toMatchObject({ _tag: "SkippedDeliveryProjectionEpochUnavailable" })
    expect(
      compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: JournalPosition.make(3),
        acceptedBefore: JournalPosition.make(2),
        evidence: availableEvidence(JournalPosition.make(2)),
        frame: journaled,
        legacy: { explanations: [], transitions: [] }
      })
    ).toEqual({ _tag: "SkippedMixedAcceptedEpoch", after: 3, before: 2, frame: 2, responsibilities: 2 })
    expect(
      compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: JournalPosition.make(2),
        acceptedBefore: JournalPosition.make(2),
        evidence: availableEvidence(JournalPosition.make(3)),
        frame: journaled,
        legacy: { explanations: [], transitions: [] }
      })
    ).toEqual({ _tag: "SkippedMixedAcceptedEpoch", after: 2, before: 2, frame: 2, responsibilities: 3 })
  })
)

it.effect("ends settled and successful terminal responsibilities without inventing another action", () =>
  Effect.gen(function* () {
    const completedFrame = syntheticFrame(yield* graph(TaskLifecycle.cases.CompletedSuccessfully.make({})))
    const terminal = executorFacts(
      taskA,
      ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: terminalAccepted })
    )
    const settled = executorFacts(taskA, ResponsibilityDisposition.TaskExternalSuccessSettled())

    for (const facts of [terminal, settled]) {
      const comparison = compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: undefined,
        acceptedBefore: undefined,
        evidence: availableEvidence(null, [facts]),
        frame: completedFrame,
        legacy: { explanations: [], transitions: [] }
      })
      expect(comparison._tag).toBe("ComparedDeliveryProjection")
      if (comparison._tag === "ComparedDeliveryProjection") {
        expect(comparison.deliveries.deliveries.some(({ taskId }) => taskId === taskA)).toBe(false)
      }
    }
  })
)

it.effect("retains Terminal Accepted through queue, start, active candidate, non-convergence, and construction", () =>
  Effect.gen(function* () {
    const base = syntheticFrame(yield* graph())
    const plannedAttempt = attempt(taskA)
    const queued = record(
      3,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const started = record(
      4,
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        responsibilityBeganAt: queued.position,
        version: workflowJournalEventVersion
      })
    )
    const correlation = IntegrationCandidateCorrelation.make({
      acceptedResultCommit: acceptedResult.commit,
      attemptId: plannedAttempt.attemptId,
      candidateId: IntegrationCandidateId.make("candidate:A"),
      candidateResource: IntegrationCandidateResourceLocator.make("candidate-resource:A"),
      expectedTargetHead: GitCommitSha.make("3".repeat(40)),
      integrationSessionId: IntegrationSessionId.make("integration-session:A"),
      integrationTarget,
      runId
    })
    const intended = record(
      5,
      IntegrationCandidateConstructionIntendedEvent.make({
        correlation,
        correctionLimit: CandidateCorrectionLimit.make(2),
        continuationLimit: CandidateContinuationLimit.make(2),
        plannedAttempt,
        responsibilityBeganAt: queued.position,
        startedAt: started.position,
        version: workflowJournalEventVersion
      })
    )
    const nonConverged = record(
      6,
      IntegrationCandidateContinuationLimitReachedEvent.make({
        continuationCount: 2,
        continuationLimit: CandidateContinuationLimit.make(2),
        correlation,
        lastReportAt: intended.position,
        version: workflowJournalEventVersion
      })
    )
    const constructed = record(
      6,
      IntegrationCandidateConstructedEvent.make({
        candidateCommit: GitCommitSha.make("4".repeat(40)),
        correlation,
        gitObservationAt: intended.position,
        version: workflowJournalEventVersion
      })
    )
    const terminalFacts = [
      executorFacts(taskA, ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: terminalAccepted }))
    ]
    const tags = (records: ReadonlyArray<JournalRecord>) =>
      ticketDeliveryEvidenceOf(withHistory(base, records), terminalFacts).map(({ _tag }) => _tag)
    const standings = (records: ReadonlyArray<JournalRecord>) => {
      const frame = withHistory(base, records)
      const comparison = compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: frame.acceptedAt,
        acceptedBefore: frame.acceptedAt,
        evidence: availableEvidence(frame.acceptedAt, terminalFacts),
        frame,
        legacy: { explanations: [], transitions: [] }
      })
      if (comparison._tag !== "ComparedDeliveryProjection") return expect.fail("one accepted epoch must compare")
      return comparison.deliveries.deliveries.find(({ taskId }) => taskId === taskA)?.standings.map(({ _tag }) => _tag)
    }

    expect(tags(terminalAcceptedRecords())).toContain("AcceptedAwaitingIntegration")
    expect(tags([...terminalAcceptedRecords(), queued])).toContain("QueuedIntegration")
    expect(tags([...terminalAcceptedRecords(), queued, started, intended])).toContain("IntegrationCandidate")
    expect(tags([...terminalAcceptedRecords(), queued, started, intended, nonConverged])).toContain(
      "IntegrationCandidate"
    )
    expect(tags([...terminalAcceptedRecords(), queued, started, intended, constructed])).toContain(
      "IntegrationCandidate"
    )
    expect(standings(terminalAcceptedRecords())).toContain("AcceptedAwaitingIntegrationQueue")
    expect(standings([...terminalAcceptedRecords(), queued])).toContain("QueuedIntegration")
    expect(standings([...terminalAcceptedRecords(), queued, started, intended])).toContain("CandidateWorkActive")
    expect(standings([...terminalAcceptedRecords(), queued, started, intended, nonConverged])).toContain(
      "IntegrationNonConvergencePreserved"
    )
    expect(standings([...terminalAcceptedRecords(), queued, started, intended, constructed])).toContain(
      "CandidateConstructedUnsettled"
    )
    const candidateFrame = withHistory(base, [...terminalAcceptedRecords(), queued, started, intended, constructed])
    const candidateComparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: candidateFrame.acceptedAt,
      acceptedBefore: candidateFrame.acceptedAt,
      evidence: availableEvidence(candidateFrame.acceptedAt, terminalFacts),
      frame: candidateFrame,
      legacy: { explanations: [], transitions: [] }
    })
    if (candidateComparison._tag !== "ComparedDeliveryProjection") {
      return expect.fail("reconstructed candidate must compare at one accepted epoch")
    }
    const settlements = makeDeliverySettlements(candidateComparison.deliveries, [])
    expect(settlements.settlements).toEqual([])
    expect(makeDeliveryReflection(settlements).source.settlements).toEqual([])

    const reconstructedEvidence = ticketDeliveryEvidenceOf(candidateFrame, terminalFacts)
    const evaluateRestartedRelation = Effect.gen(function* () {
      const relation = yield* delivery.pipe(
        Effect.provide(
          makeDeliveryRelationsLayer({
            ...deterministicDeliveryRuntimeSupport(candidateFrame.runControlPolicy),
            exactEvidence: currentSignalOf(reconstructedEvidence),
            graph: currentSignalOf(
              TrackerGraphState.cases.GraphEstablished.make({ snapshot: candidateFrame.currentGraph })
            ),
            policy: currentSignalOf(candidateFrame.runControlPolicy)
          })
        )
      )
      return {
        actions: Array.from(yield* Stream.runCollect(relation.proposedActions.changes)),
        reflections: Array.from(yield* Stream.runCollect(relation.current.changes))
      }
    })
    const beforeStop = yield* evaluateRestartedRelation
    const afterRestart = yield* evaluateRestartedRelation

    expect(afterRestart).toEqual(beforeStop)
    expect(afterRestart.actions).toEqual([{ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }])
    expect(afterRestart.reflections[0]?.settlements.settlements).toEqual([])
    expect(
      afterRestart.reflections[0]?.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === taskA)
        ?.standings.some(({ _tag }) => _tag === "CandidateConstructedUnsettled")
    ).toBe(true)
  })
)

it.effect("reports a same-responsibility lifecycle disagreement instead of accepting identity equality", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    const facts = executorFacts(taskA, ResponsibilityDisposition.Ready())
    const comparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(null, [facts]),
      frame,
      legacy: {
        explanations: [
          FrontierExplanation.PlannedAttemptTaskClaimConstraint({
            claimState: "Unreadable",
            correlation: { attemptId: attempt(taskA).attemptId, runId },
            taskId: taskA,
            wakeCondition: "TaskClaimFactsObserved"
          })
        ],
        transitions: []
      }
    })

    expect(comparison._tag).toBe("ComparedDeliveryProjection")
    if (comparison._tag !== "ComparedDeliveryProjection") return
    expect(comparison.responsibilityIdentityDifferences).toEqual([])
    expect(comparison.responsibilitySituationDifferences).toHaveLength(2)
  })
)

it.effect("reports different exact integration attempts even when they belong to the same task", () =>
  Effect.gen(function* () {
    const base = syntheticFrame(yield* graph())
    const records = terminalAcceptedRecords()
    const frame = withHistory(base, records)
    const otherPlannedAttempt = PlannedTaskAttempt.make({
      ...attempt(taskA),
      attemptId: AttemptId.make("attempt:A:other")
    })
    const otherAccepted = UnqueuedAcceptedResult.make({
      acceptedResult,
      plannedAttempt: otherPlannedAttempt,
      terminalAt: JournalPosition.make(2)
    })
    const comparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: frame.acceptedAt,
      acceptedBefore: frame.acceptedAt,
      evidence: availableEvidence(frame.acceptedAt),
      frame,
      legacy: {
        explanations: [],
        transitions: [
          RunnableFrontierTransition.QueueAcceptedResultIntegrationResponsibility({
            accepted: otherAccepted,
            integrationTarget
          })
        ]
      }
    })

    expect(comparison._tag).toBe("ComparedDeliveryProjection")
    if (comparison._tag !== "ComparedDeliveryProjection") return
    expect(comparison.integrationIdentityDifferences).toEqual(
      [attempt(taskA), otherPlannedAttempt]
        .map((plannedAttempt) =>
          plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
        )
        .toSorted()
    )
  })
)

it.effect("keeps an integration configuration wait local while independent B remains proposed", () =>
  Effect.gen(function* () {
    const capacityTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const frame = withHistory(
      { ...syntheticFrame(yield* graph()), runControlPolicy: capacityTwo },
      terminalAcceptedRecords()
    )
    const comparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: frame.acceptedAt,
      acceptedBefore: frame.acceptedAt,
      evidence: availableEvidence(
        frame.acceptedAt,
        [],
        [{ _tag: "IntegrationConfigurationWait", plannedAttempt: attempt(taskA) }]
      ),
      frame,
      legacy: {
        explanations: [
          FrontierExplanation.IntegrationConfigurationWait({
            plannedAttempt: attempt(taskA),
            wakeCondition: "IntegrationTargetConfigured"
          })
        ],
        transitions: []
      }
    })

    expect(comparison._tag).toBe("ComparedDeliveryProjection")
    if (comparison._tag !== "ComparedDeliveryProjection") return
    expect(
      comparison.deliveries.deliveries
        .find(({ taskId }) => taskId === taskA)
        ?.standings.some(
          (standing) => standing._tag === "IntegrationWait" && standing.wait._tag === "IntegrationConfigurationWait"
        )
    ).toBe(true)
    expect(comparison.deliveries.deliveries.find(({ taskId }) => taskId === taskB)?.standings).toEqual([
      { _tag: "ProposedDelivery" }
    ])
    expect(comparison.integrationWaitDifferences).toEqual([])
    expect(comparison.integrationIdentityDifferences).toEqual([])
  })
)

it.effect("projects every lower integration wait independently of the legacy scheduler", () =>
  Effect.gen(function* () {
    const capacityTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const frame = { ...syntheticFrame(yield* graph()), runControlPolicy: capacityTwo }
    const waits: ReadonlyArray<IntegrationDeliveryWait> = [
      { _tag: "IntegrationDependencyWait", plannedAttempt: attempt(taskA), prerequisiteTaskIds: [taskB] },
      { _tag: "IntegrationConfigurationWait", plannedAttempt: attempt(taskA) },
      { _tag: "IntegrationTaskClaimConstraint", claimState: "Unreadable", plannedAttempt: attempt(taskA) },
      { _tag: "IntegrationTrackerFactsWait", plannedAttempt: attempt(taskA) },
      { _tag: "IntegrationTargetWait", plannedAttempt: attempt(taskA) }
    ]

    for (const wait of waits) {
      const comparison = compareDeliveryShadow({
        fresh: [],
        runId,
        acceptedAfter: undefined,
        acceptedBefore: undefined,
        evidence: availableEvidence(null, [], [wait]),
        frame,
        legacy: { explanations: [], transitions: [] }
      })
      if (comparison._tag !== "ComparedDeliveryProjection") {
        return expect.fail("synthetic current facts must always compare")
      }
      expect(comparison.deliveries.deliveries.find(({ taskId }) => taskId === taskA)?.standings).toEqual([
        { _tag: "IntegrationWait", wait }
      ])
      expect(comparison.deliveries.deliveries.find(({ taskId }) => taskId === taskB)?.standings).toEqual([
        { _tag: "ProposedDelivery" }
      ])
    }
  })
)

it.effect("recognizes exact attempt identity in every legacy integration situation", () =>
  Effect.gen(function* () {
    const plannedAttempt = attempt(taskA)
    const explanations: RunnableFrontier["explanations"] = [
      FrontierExplanation.IntegrationDependencyWait({
        plannedAttempt,
        prerequisiteTaskIds: [taskB],
        wakeCondition: "TaskTrackerFactsObserved"
      }),
      FrontierExplanation.IntegrationConfigurationWait({
        plannedAttempt,
        wakeCondition: "IntegrationTargetConfigured"
      }),
      FrontierExplanation.IntegrationTaskClaimConstraint({
        claimState: "Unreadable",
        plannedAttempt,
        wakeCondition: "TaskClaimFactsObserved"
      }),
      FrontierExplanation.IntegrationInProgress({ plannedAttempt }),
      FrontierExplanation.IntegrationTrackerFactsWait({ plannedAttempt, wakeCondition: "TaskTrackerFactsObserved" }),
      FrontierExplanation.IntegrationTargetWait({ plannedAttempt, wakeCondition: "IntegrationTargetReleased" }),
      FrontierExplanation.TypedIssue({
        operationId: OperationId.make("operation:unknown-to-shadow"),
        reason: "MissingFreshFacts"
      }),
      FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
        reason: "MissingFreshFacts"
      })
    ]
    const comparison = compareDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(),
      frame: syntheticFrame(yield* graph()),
      legacy: { explanations, transitions: [] }
    })

    if (comparison._tag !== "ComparedDeliveryProjection") {
      return expect.fail("synthetic current facts must compare")
    }
    expect(comparison.integrationIdentityDifferences).toEqual([
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
    ])
    expect(comparison.newOnlyTaskIds).toEqual([])
  })
)

it.effect("recognizes a started integration transition as the same exact attempt", () =>
  Effect.gen(function* () {
    const plannedAttempt = attempt(taskA)
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      queuedAt: JournalPosition.make(3),
      startedAt: JournalPosition.make(4)
    })
    const comparison = compareDeliveryShadow({
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(),
      frame: syntheticFrame(yield* graph()),
      fresh: [],
      legacy: {
        explanations: [],
        transitions: [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
      },
      runId
    })

    if (comparison._tag !== "ComparedDeliveryProjection") {
      return expect.fail("synthetic current facts must compare")
    }
    expect(comparison.integrationIdentityDifferences).toEqual([
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
    ])
  })
)

it.effect("projects the latest synthetic executor fact into the shared ticket lifecycle", () =>
  Effect.gen(function* () {
    const base = syntheticFrame(yield* graph())
    if (base._tag !== "SyntheticCurrentDeliveryFrame") return expect.fail("synthetic helper must stay synthetic")
    const plannedAttempt = attempt(taskA)
    const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    const frame: Extract<CurrentDeliveryFrame, { readonly _tag: "SyntheticCurrentDeliveryFrame" }> = {
      ...base,
      workflowFacts: [
        { _tag: "PlannedAttemptExecutorWorkReported", plannedAttempt, report: running, taskId: taskA },
        { _tag: "PlannedAttemptExecutorWorkReported", plannedAttempt, report: terminal, taskId: taskA }
      ]
    }

    expect(ticketDeliveryEvidenceOf(frame, [])).toEqual([
      { _tag: "SyntheticExecutorFacts", plannedAttempt, report: terminal }
    ])
  })
)

it.effect("cannot let a synchronous diagnostic failure alter the delivery turn", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    yield* observeDeliveryShadow({
      fresh: [],
      runId,
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: availableEvidence(),
      frame,
      legacy: { explanations: [], transitions: [] }
    })
  }).pipe(
    Effect.provide(
      Layer.succeed(DeliveryShadowDiagnostics, DeliveryShadowDiagnostics.of({ record: () => void JSON.parse("{") }))
    )
  )
)

it.effect("lets the authoritative turn continue when a shadow read never completes", () =>
  Effect.gen(function* () {
    const fiber = yield* observeDeliveryShadowWithinTurn(Effect.never).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* TestClock.adjust("100 millis")
    yield* Fiber.join(fiber)
  })
)

it.effect("keeps required safe-boundary work in the paused boundary proposal shadow", () => {
  const comparisons: Array<DeliveryShadowComparison> = []
  const facts = executorFacts(taskA, ResponsibilityDisposition.Ready())
  const plannedAttempt = attempt(taskA)
  const transition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
  return observeBoundaryDeliveryShadow({
    acceptedBefore: undefined,
    evidence: availableEvidence(null, [facts]),
    policy,
    readAccepted: Effect.succeed(null),
    requiresAcceptedEpoch: false,
    runId,
    transitions: [transition]
  }).pipe(
    Effect.provide(
      Layer.succeed(
        DeliveryShadowDiagnostics,
        DeliveryShadowDiagnostics.of({ record: (comparison) => void comparisons.push(comparison) })
      )
    ),
    Effect.tap(() =>
      Effect.sync(() => {
        expect(comparisons).toMatchObject([
          {
            _tag: "ComparedBoundaryDeliveryProposals",
            proposalFrontier: {
              _tag: "DeliveryProposalsAvailable",
              isolatedIssues: [],
              proposals: [
                {
                  admission: {
                    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId: taskA }
                  },
                  route: { _tag: "IdentityFreeWorkflowRoute", transition }
                }
              ]
            },
            proposalPresenceDifferences: []
          }
        ])
      })
    )
  )
})

it.effect("records a boundary comparison only from one exact accepted epoch", () => {
  const comparisons: Array<DeliveryShadowComparison> = []
  return Effect.gen(function* () {
    const acceptedAt = JournalPosition.make(1)
    const later = JournalPosition.make(2)
    const wait: IntegrationDeliveryWait = { _tag: "IntegrationConfigurationWait", plannedAttempt: attempt(taskA) }
    const observe = (input: {
      readonly acceptedBefore: JournalPosition | undefined
      readonly accepted: {
        readonly appliedPosition: JournalPosition
        readonly records: ReadonlyArray<JournalRecord>
      } | null
      readonly evidence:
        | ReturnType<typeof availableEvidence>
        | { readonly _tag: "UnavailableDeliveryProjectionEvidence" }
    }) =>
      observeBoundaryDeliveryShadow({
        acceptedBefore: input.acceptedBefore,
        evidence: input.evidence,
        policy,
        readAccepted: Effect.succeed(input.accepted),
        requiresAcceptedEpoch: true,
        runId,
        transitions: []
      })

    yield* observe({
      accepted: { appliedPosition: acceptedAt, records: [] },
      acceptedBefore: acceptedAt,
      evidence: { _tag: "UnavailableDeliveryProjectionEvidence" }
    })
    yield* observe({
      accepted: { appliedPosition: acceptedAt, records: [] },
      acceptedBefore: undefined,
      evidence: availableEvidence(acceptedAt)
    })
    yield* observe({ accepted: null, acceptedBefore: acceptedAt, evidence: availableEvidence(acceptedAt) })
    yield* observe({
      accepted: { appliedPosition: later, records: [] },
      acceptedBefore: acceptedAt,
      evidence: availableEvidence(later)
    })
    yield* observe({
      accepted: { appliedPosition: acceptedAt, records: [] },
      acceptedBefore: acceptedAt,
      evidence: availableEvidence(later)
    })
    yield* observe({
      accepted: { appliedPosition: acceptedAt, records: [] },
      acceptedBefore: acceptedAt,
      evidence: availableEvidence(acceptedAt, [], [wait])
    })

    expect(comparisons).toMatchObject([
      { _tag: "ComparedBoundaryDeliveryProposals", acceptedAt, proposalPresenceDifferences: [] }
    ])
  }).pipe(
    Effect.provide(
      Layer.succeed(
        DeliveryShadowDiagnostics,
        DeliveryShadowDiagnostics.of({ record: (comparison) => void comparisons.push(comparison) })
      )
    )
  )
})

it.effect("turns duplicate boundary proposal ownership into one fail-closed comparison", () => {
  const comparisons: Array<DeliveryShadowComparison> = []
  const plannedAttempt = attempt(taskA)
  const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
  return observeBoundaryDeliveryShadow({
    acceptedBefore: undefined,
    evidence: availableEvidence(null, [executorFacts(taskA, ResponsibilityDisposition.Ready())]),
    policy,
    readAccepted: Effect.succeed(null),
    requiresAcceptedEpoch: false,
    runId,
    transitions: [transition, transition]
  }).pipe(
    Effect.provide(
      Layer.succeed(
        DeliveryShadowDiagnostics,
        DeliveryShadowDiagnostics.of({ record: (comparison) => void comparisons.push(comparison) })
      )
    ),
    Effect.tap(() =>
      Effect.sync(() => {
        expect(comparisons).toMatchObject([
          {
            _tag: "ComparedBoundaryDeliveryProposals",
            proposalFrontier: { _tag: "DeliveryProposalOwnershipConflict", conflicts: [expect.any(Object)] }
          }
        ])
      })
    )
  )
})

it.effect("cannot let a boundary-shadow accepted-history failure alter the recovery turn", () =>
  observeBoundaryDeliveryShadow({
    acceptedBefore: JournalPosition.make(1),
    evidence: availableEvidence(JournalPosition.make(1)),
    policy,
    readAccepted: Effect.fail("diagnostic accepted-history read failed"),
    requiresAcceptedEpoch: true,
    runId,
    transitions: []
  })
)

it.effect("represents the production quiescence reread in the literal proposal relation", () =>
  Effect.gen(function* () {
    const comparisons: Array<DeliveryShadowComparison> = []
    const base = syntheticFrame(yield* graph())
    const frame = withHistory(base, terminalAcceptedRecords())
    yield* observeQuiescenceDeliveryShadow({
      readAccepted: Effect.succeed({ appliedPosition: frame.acceptedAt }),
      readEvidence: Effect.succeed(availableEvidence(frame.acceptedAt)),
      readFrame: Effect.succeed(frame),
      runId,
      target: FixtureTarget.make("quiescence-shadow-target")
    }).pipe(
      Effect.provide(
        Layer.succeed(
          DeliveryShadowDiagnostics,
          DeliveryShadowDiagnostics.of({ record: (comparison) => void comparisons.push(comparison) })
        )
      )
    )

    expect(comparisons).toMatchObject([
      {
        _tag: "ComparedQuiescenceDeliveryProposal",
        acceptedAt: frame.acceptedAt,
        proposalFrontier: {
          _tag: "DeliveryProposalsAvailable",
          proposals: [{ owner: "TrackerGraph", route: { purpose: "QuiescenceProbe" } }]
        }
      }
    ])
  })
)

it.effect("records no quiescence proposal from an incomplete or mixed accepted epoch", () => {
  const comparisons: Array<DeliveryShadowComparison> = []
  return Effect.gen(function* () {
    const acceptedAt = JournalPosition.make(2)
    const later = JournalPosition.make(3)
    const base = syntheticFrame(yield* graph())
    const frame = withHistory(base, terminalAcceptedRecords())
    const observe = (
      reads: readonly [
        { readonly appliedPosition: JournalPosition } | null,
        { readonly appliedPosition: JournalPosition } | null
      ],
      currentFrame: CurrentDeliveryFrame,
      evidence: ReturnType<typeof availableEvidence> | { readonly _tag: "UnavailableDeliveryProjectionEvidence" }
    ) =>
      Effect.gen(function* () {
        const readIndex = yield* Ref.make(0)
        yield* observeQuiescenceDeliveryShadow({
          readAccepted: Ref.getAndUpdate(readIndex, (index) => index + 1).pipe(
            Effect.map((index) => reads[index] ?? null)
          ),
          readEvidence: Effect.succeed(evidence),
          readFrame: Effect.succeed(currentFrame),
          runId,
          target: FixtureTarget.make("invalid-quiescence-shadow-target")
        })
      })

    yield* observe([null, { appliedPosition: acceptedAt }], frame, availableEvidence(acceptedAt))
    yield* observe([{ appliedPosition: acceptedAt }, null], frame, availableEvidence(acceptedAt))
    yield* observe([{ appliedPosition: acceptedAt }, { appliedPosition: later }], frame, availableEvidence(later))
    yield* observe(
      [{ appliedPosition: acceptedAt }, { appliedPosition: acceptedAt }],
      base,
      availableEvidence(acceptedAt)
    )
    yield* observe([{ appliedPosition: later }, { appliedPosition: later }], frame, availableEvidence(later))
    yield* observe([{ appliedPosition: acceptedAt }, { appliedPosition: acceptedAt }], frame, {
      _tag: "UnavailableDeliveryProjectionEvidence"
    })
    yield* observe([{ appliedPosition: acceptedAt }, { appliedPosition: acceptedAt }], frame, availableEvidence(later))

    expect(comparisons).toEqual([])
  }).pipe(
    Effect.provide(
      Layer.succeed(
        DeliveryShadowDiagnostics,
        DeliveryShadowDiagnostics.of({ record: (comparison) => void comparisons.push(comparison) })
      )
    )
  )
})

it.effect("skips an unavailable diagnostic input and remains silent without a diagnostic sink", () =>
  Effect.gen(function* () {
    const frame = syntheticFrame(yield* graph())
    const input = {
      acceptedAfter: undefined,
      acceptedBefore: undefined,
      evidence: { _tag: "UnavailableDeliveryProjectionEvidence" },
      frame,
      fresh: [],
      legacy: { explanations: [], transitions: [] },
      runId
    } as const

    expect(compareDeliveryShadow(input)).toEqual({ _tag: "SkippedDeliveryProjectionResponsibilityFactsUnavailable" })
    yield* observeDeliveryShadow(input)
    yield* observeDeliveryShadow({ ...input, evidence: availableEvidence() })
  })
)
