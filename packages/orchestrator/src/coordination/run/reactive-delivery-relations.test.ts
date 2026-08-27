import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Deferred, Effect, Fiber, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  makeTaskAttemptPlanOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent, TaskAttemptPlannedEvent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore, InRunJournal } from "../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeRunRecoveryProjection } from "./recovery-activation.js"
import { makeReactiveDeliveryRelationsLayer } from "../delivery/reactive-delivery-relations.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { makeJournal } from "../delivery/journal.js"
import { DeliveryAcceptedFactPublication } from "../delivery/delivery-accepted-fact-publication.js"

const runId = RunId.make("reactive-progress-runtime-acceptance")
const target = FixtureTarget.make("reactive-progress-runtime-acceptance-target")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/reactive-progress-runtime-acceptance.git")
})
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(3) })
const taskIds = [TaskId.make("A"), TaskId.make("B"), TaskId.make("C")] as const

const attempts = new Map(
  taskIds.map((taskId) => [
    taskId,
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`reactive-progress-${taskId}`),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make(`refs/heads/dalph/reactive-progress-${taskId}`),
      executor: TaskExecutorLocator.make(`executor:reactive-progress-${taskId}`),
      runId,
      taskId,
      taskRevision: TaskRevision.make(`reactive-progress-${taskId}-revision`),
      worktree: WorktreeLocator.make(`/worktrees/reactive-progress-${taskId}`)
    })
  ])
)

const graphSnapshotFor = Effect.fn("ReactiveProgressAcceptance.graphSnapshotFor")(function* (revision: string) {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: taskIds.map((id) => ({ id, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }))
  })
  if (projected._tag === "Invalid") return yield* Effect.die(projected)
  return projected.snapshot
})

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const appendGraph = Effect.fn("ReactiveProgressAcceptance.appendGraph")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  operationId: OperationId,
  revision: string
) {
  const operation = makeTrackerGraphObservationOperation(operationId, target, [], [...taskIds])
  const snapshot = yield* graphSnapshotFor(revision)
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
})

const appendProgressRead = Effect.fn("ReactiveProgressAcceptance.appendProgressRead")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  operationId: OperationId,
  revision: string
) {
  const operation = makeTrackerGraphObservationOperation(operationId, target, [], [...taskIds])
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    makeTaskTrackerFactsObservedFromRead(yield* journal.read(runId), operation, yield* graphSnapshotFor(revision))
  )
})

const appendResponsibility = Effect.fn("ReactiveProgressAcceptance.appendResponsibility")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  taskId: TaskId
) {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(attempts.get(taskId)))
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`reactive-progress-plan-${taskId}`),
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
})

const appendRunning = Effect.fn("ReactiveProgressAcceptance.appendRunning")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  taskId: TaskId,
  commandOrdinalValue: number,
  reportOrdinalValue: number
) {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(attempts.get(taskId)))
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinalValue)
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
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(reportOrdinalValue)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.Running.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      version: workflowJournalEventVersion
    })
  )
})

const progressProposal = (value: Effect.Success<typeof deliveryRuntime>) => {
  if (value.proposedActions._tag !== "DeliveryProposalsAvailable") return undefined
  return value.proposedActions.proposals.find(
    ({ route }) => route._tag === "TrackerGraphReadRoute" && route.purpose === "CheckExecutorProgress"
  )
}

it.effect("coalesces three pending executor-progress requirements into one complete graph read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendGraph(journal, OperationId.make("reactive-progress-G0"), "reactive-progress-G0")
      yield* Effect.forEach(taskIds, (taskId) => appendResponsibility(journal, taskId), { discard: true })
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))

      yield* Effect.forEach(taskIds, (taskId) => appendRunning(journal, taskId, 1, 1), { discard: true })
      yield* publication.awaitCurrent
      const value = yield* relation.get
      const proposal = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(value)))
      if (proposal.route._tag !== "TrackerGraphReadRoute" || proposal.route.purpose !== "CheckExecutorProgress") {
        return yield* Effect.die("expected a progress graph read route")
      }
      expect(proposal.route.pendingReports.map(({ taskId }) => taskId)).toEqual(
        [...taskIds].toSorted((left, right) => left.localeCompare(right))
      )
      expect(proposal.route.pendingReports).toHaveLength(3)
      expect(value.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "TrackerGraphReadRoute", purpose: "CheckExecutorProgress" } }]
      })
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect(
  "does not read again after an unchanged executor-progress graph check until another Running report is accepted",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const journal = yield* makeJournalService
        yield* appendGraph(
          journal,
          OperationId.make("reactive-progress-unchanged-G0"),
          "reactive-progress-unchanged-G0"
        )
        yield* Effect.forEach(taskIds, (taskId) => appendResponsibility(journal, taskId), { discard: true })
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, journal)
        )
        const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
        const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
        const graphReadCount = yield* Ref.make(0)
        const firstRead = yield* Deferred.make<void>()
        const secondRead = yield* Deferred.make<void>()
        const observer = yield* relation.changes.pipe(
          Stream.tap((value) => {
            const proposal = progressProposal(value)
            if (proposal?._tag !== "DeliveryActionProposal" || proposal.route._tag !== "TrackerGraphReadRoute") {
              return Effect.void
            }
            if (proposal.route.unresolvedReadOperationId !== null) return Effect.void
            return Ref.updateAndGet(graphReadCount, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Deferred.succeed(firstRead, undefined)
                  : count === 2
                    ? Deferred.succeed(secondRead, undefined)
                    : Effect.void
              )
            )
          }),
          Stream.runDrain,
          Effect.forkChild
        )

        yield* appendRunning(journal, taskIds[0], 1, 1)
        yield* Deferred.await(firstRead)
        const progressRead = makeTrackerGraphObservationOperation(
          OperationId.make("reactive-progress-unchanged-check"),
          target,
          [],
          [...taskIds]
        )
        yield* journal.append(runId, intentRecordKey(progressRead.operationId), taskTrackerReadIntent(progressRead))
        yield* journal.append(
          runId,
          outcomeRecordKey(progressRead.operationId),
          makeTaskTrackerFactsObservedFromRead(
            yield* journal.read(runId),
            progressRead,
            yield* graphSnapshotFor("reactive-progress-unchanged-G0")
          )
        )

        yield* Effect.yieldNow
        expect(yield* Ref.get(graphReadCount)).toBe(1)
        expect(progressProposal(yield* relation.get)).toBeUndefined()

        yield* appendRunning(journal, taskIds[1], 1, 1)
        yield* Deferred.await(secondRead)
        expect(yield* Ref.get(graphReadCount)).toBe(2)
        const next = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(yield* relation.get)))
        if (next.route._tag !== "TrackerGraphReadRoute") return yield* Effect.die("expected a progress graph route")
        expect(next.route.pendingReports.map(({ taskId }) => taskId)).toEqual([taskIds[1]])
        yield* Fiber.interrupt(observer)
      })
    ).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("preserves executor continuation ordinals and the durable limit across tracker graph reads", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendGraph(journal, OperationId.make("reactive-progress-limit-G0"), "reactive-progress-limit-G0")
      yield* appendResponsibility(journal, taskIds[0])
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))

      for (const ordinal of [1, 2]) {
        yield* appendRunning(journal, taskIds[0], ordinal, ordinal)
        yield* publication.awaitCurrent
        const beforeRead = yield* relation.get
        const proposal = Option.getOrThrow(Option.fromUndefinedOr(progressProposal(beforeRead)))
        if (proposal.route._tag !== "TrackerGraphReadRoute") return yield* Effect.die("expected a progress graph route")
        expect(proposal.route.pendingReports.map(({ taskId }) => taskId)).toEqual([taskIds[0]])

        yield* appendProgressRead(
          journal,
          OperationId.make(`reactive-progress-limit-check-${ordinal}`),
          "reactive-progress-limit-G0"
        )
        yield* publication.awaitCurrent
        expect(progressProposal(yield* relation.get)).toBeUndefined()
      }

      yield* appendRunning(journal, taskIds[0], 3, 3)
      yield* publication.awaitCurrent
      expect(progressProposal(yield* relation.get)).toBeUndefined()

      const records = yield* journal.read(runId)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "StartOrContinue"
            ? [Number(event.ordinal)]
            : []
        )
      ).toEqual([1, 2, 3])
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [Number(event.ordinal)] : []
        )
      ).toEqual([1, 2, 3])
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)
