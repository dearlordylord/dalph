import { it } from "@effect/vitest"
import { Deferred, Effect, Queue, Ref } from "effect"
import { expect } from "vitest"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import { OperationId, RunId, TaskId, TaskWorkCapacity } from "./domain.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"

it.effect("coalesces concurrent triggers into one owner for one exact transition", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskId = TaskId.make("activation-A")
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId
    })
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
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId: taskA }),
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId: taskC })
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
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId
    })
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
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId: preIntentTask
      }),
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId: postIntentTask
      })
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
        ),
      onSubjectDefect: () => Effect.void
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
          RunnableFrontierTransition.CommitFreshTaskClaimIntent({
            taskId: preIntentTask
          }),
          RunnableFrontierTransition.CommitFreshTaskClaimIntent({
            taskId: postIntentTask
          })
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
          transitions: tasks.map((taskId) => RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId }))
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
