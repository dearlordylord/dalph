import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Queue, Ref } from "effect"
import { expect } from "vitest"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import { OperationId, RunId, TaskId, TaskRevision, TaskWorkCapacity } from "./domain.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"

const freshTransition = (taskId: TaskId) =>
  RunnableFrontierTransition.CommitFreshTaskClaimIntent({
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`)
  })

it.effect("coalesces concurrent triggers into one owner for one exact transition", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskId = TaskId.make("activation-A")
    const transition = freshTransition(taskId)
    const releaseRunner = yield* Deferred.make<void>()
    const runnerStarted = yield* Deferred.make<void>()
    const runnerCount = yield* Ref.make(0)
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Effect.succeed({
        explanations: [],
        transitions: [transition]
      }),
      runId: RunId.make("activation-run"),
      runTransition: () =>
        Ref.update(runnerCount, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(runnerStarted, undefined)),
          Effect.andThen(Deferred.await(releaseRunner))
        )
    })

    yield* Effect.all([
      coordinator.signal(ActivationCause.Startup()),
      coordinator.signal(ActivationCause.WorkflowResultRecorded())
    ], { concurrency: "unbounded" })
    yield* Deferred.await(runnerStarted)

    expect(yield* Ref.get(runnerCount)).toBe(1)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskId])

    yield* Deferred.succeed(releaseRunner, undefined)
  })))

it.effect("serializes selection while capacity-N runners overlap", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("overlap-A")
    const taskC = TaskId.make("overlap-C")
    const transitions = [
      freshTransition(taskA),
      freshTransition(taskC)
    ]
    const started = yield* Queue.unbounded<TaskId>()
    const releaseRunners = yield* Deferred.make<void>()
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Effect.succeed({ explanations: [], transitions }),
      runId: RunId.make("overlap-run"),
      runTransition: (transition) =>
        Queue.offer(started, transition.taskId).pipe(
          Effect.andThen(Deferred.await(releaseRunners))
        )
    })

    yield* coordinator.signal(ActivationCause.Startup())
    expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(
      new Set([taskA, taskC])
    )
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskA, taskC])

    yield* Deferred.succeed(releaseRunners, undefined)
  })))

it.effect("keeps the immutable selection correlation after intent", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskId = TaskId.make("mixed-time-A")
    const transition = freshTransition(taskId)
    const intentRecorded = yield* Deferred.make<void>()
    const releaseRunner = yield* Deferred.make<void>()
    const runnerCount = yield* Ref.make(0)
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Effect.succeed({
        explanations: [],
        transitions: [transition]
      }),
      runId: RunId.make("mixed-time-run"),
      runTransition: (_, execution) =>
        Ref.update(runnerCount, (count) => count + 1).pipe(
          Effect.andThen(execution.recordIntent(OperationId.make("mixed-time-operation"))),
          Effect.andThen(Deferred.succeed(intentRecorded, undefined)),
          Effect.andThen(Deferred.await(releaseRunner))
        )
    })

    yield* coordinator.signal(ActivationCause.Startup())
    yield* Deferred.await(intentRecorded)
    yield* coordinator.signal(ActivationCause.WorkflowResultRecorded())
    yield* Effect.yieldNow

    expect(yield* Ref.get(runnerCount)).toBe(1)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskId])

    yield* Deferred.succeed(releaseRunner, undefined)
  })))

it.effect("releases a pre-intent position but retains a post-intent position on runner exit", () =>
  Effect.scoped(Effect.gen(function*() {
    const preIntentTask = TaskId.make("exit-before-intent")
    const postIntentTask = TaskId.make("exit-after-intent")
    const frontier = yield* Ref.make([
      freshTransition(preIntentTask),
      freshTransition(postIntentTask)
    ])
    const exits = yield* Queue.unbounded<TaskId>()
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Ref.get(frontier).pipe(
        Effect.map((transitions) => ({ explanations: [], transitions }))
      ),
      runId: RunId.make("runner-exit-run"),
      runTransition: (transition, execution) =>
        Ref.update(frontier, (current) => current.filter((candidate) => candidate.taskId !== transition.taskId)).pipe(
          Effect.andThen(
            transition.taskId === postIntentTask
              ? execution.recordIntent(OperationId.make("post-intent-operation"))
              : Effect.void
          ),
          Effect.andThen(Queue.offer(exits, transition.taskId)),
          Effect.andThen(Effect.fail("controlled runner exit"))
        )
    })

    yield* coordinator.signal(ActivationCause.Startup())
    expect(new Set([yield* Queue.take(exits), yield* Queue.take(exits)])).toEqual(
      new Set([preIntentTask, postIntentTask])
    )
    yield* Effect.yieldNow

    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([
      postIntentTask
    ])
  })))

it.effect("rederives while pre-intent and post-intent owners remain live without readmitting either", () =>
  Effect.scoped(Effect.gen(function*() {
    const preIntentTask = TaskId.make("live-before-intent")
    const postIntentTask = TaskId.make("live-after-intent")
    const releaseRunners = yield* Deferred.make<void>()
    const started = yield* Queue.unbounded<TaskId>()
    const runnerCounts = yield* Ref.make(new Map<TaskId, number>())
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Effect.succeed({
        explanations: [],
        transitions: [
          freshTransition(preIntentTask),
          freshTransition(postIntentTask)
        ]
      }),
      runId: RunId.make("live-owners-run"),
      runTransition: (transition, execution) =>
        Ref.update(runnerCounts, (counts) => {
          const next = new Map(counts)
          next.set(transition.taskId, (next.get(transition.taskId) ?? 0) + 1)
          return next
        }).pipe(
          Effect.andThen(
            transition.taskId === postIntentTask
              ? execution.recordIntent(OperationId.make("live-post-intent-operation"))
              : Effect.void
          ),
          Effect.andThen(Queue.offer(started, transition.taskId)),
          Effect.andThen(Deferred.await(releaseRunners))
        )
    })

    yield* coordinator.signal(ActivationCause.Startup())
    expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(
      new Set([preIntentTask, postIntentTask])
    )
    yield* coordinator.signal(ActivationCause.Resume())

    expect(yield* Ref.get(runnerCounts)).toEqual(
      new Map([[preIntentTask, 1], [postIntentTask, 1]])
    )
    const positions = (yield* controller.snapshot()).reservedPositions
    expect(positions.map(({ correlation }) => correlation._tag).sort()).toEqual([
      "OperationReservation",
      "SelectedTransitionReservation"
    ])

    yield* Deferred.succeed(releaseRunners, undefined)
  })))

it.effect("records a result, releases its exact position, and rederives the next transition", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("result-A")
    const taskC = TaskId.make("result-C")
    const remaining = yield* Ref.make([taskA, taskC])
    const started = yield* Queue.unbounded<TaskId>()
    const releaseC = yield* Deferred.make<void>()
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Ref.get(remaining).pipe(
        Effect.map((tasks) => ({
          explanations: [],
          transitions: tasks.map(freshTransition)
        }))
      ),
      runId: RunId.make("result-release-run"),
      runTransition: (transition, execution) =>
        execution.recordIntent(
          OperationId.make(`result-operation:${transition.taskId}`)
        ).pipe(
          Effect.andThen(Queue.offer(started, transition.taskId)),
          Effect.andThen(
            transition.taskId === taskA
              ? Ref.update(remaining, (tasks) => tasks.filter((taskId) => taskId !== taskA))
              : Deferred.await(releaseC)
          )
        )
    })

    yield* coordinator.signal(ActivationCause.Startup())
    expect(yield* Queue.take(started)).toBe(taskA)
    expect(yield* Queue.take(started)).toBe(taskC)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskC])

    yield* Deferred.succeed(releaseC, undefined)
  })))

it.effect("finishes an owned non-capacity operation without releasing an absent position", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskId = TaskId.make("non-capacity-claim")
    const transition = RunnableFrontierTransition.CheckTaskClaim({
      operationId: OperationId.make("non-capacity-operation"),
      taskId
    })
    const remaining = yield* Ref.make([transition])
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Ref.get(remaining).pipe(
        Effect.map((transitions) => ({ explanations: [], transitions }))
      ),
      runId: RunId.make("non-capacity-run"),
      runTransition: () => Ref.set(remaining, [])
    })

    yield* coordinator.signal(ActivationCause.Startup())
    yield* Effect.yieldNow

    expect(yield* Ref.get(remaining)).toEqual([])
    expect((yield* controller.snapshot()).reservedPositions).toEqual([])
  })))

it.effect("atomically rejects or drains signals when the coordinator closes", () =>
  Effect.scoped(Effect.gen(function*() {
    const failFrontier = yield* Deferred.make<void>()
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Deferred.await(failFrontier).pipe(
        Effect.andThen(Effect.fail("controlled frontier failure"))
      ),
      runId: RunId.make("closing-signal-run"),
      runTransition: () => Effect.void
    })

    const signals = Array.from({ length: 64 }, (_, index) =>
      coordinator.signal(
        index % 2 === 0
          ? ActivationCause.Resume()
          : ActivationCause.WorkflowResultRecorded()
      ).pipe(Effect.exit))
    const exits = yield* Effect.all([
      Deferred.succeed(failFrontier, undefined),
      Effect.all(signals, { concurrency: "unbounded" })
    ], { concurrency: "unbounded" }).pipe(
      Effect.map(([, results]) => results),
      Effect.timeout("1 second")
    )

    expect(exits).toHaveLength(64)
    expect(exits.every(Exit.isFailure)).toBe(true)
  })))
