import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option, Queue, Ref, Scope } from "effect"
import { expect } from "vitest"
import { ActivationCause, makeActivationCoordinator } from "./coordinator.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunnableFrontierTransition, runnableTransitionTaskId } from "../frontier/frontier.js"
import { makeTaskAdmissionController } from "../admission/controller.js"
import { makeSelectedTransitionIdentity } from "./selected-transition.js"

const freshTransition = (taskId: TaskId) =>
  RunnableFrontierTransition.CommitFreshTaskClaimIntent({
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`)
  })

type ActivationCoordinatorInput = Parameters<typeof makeActivationCoordinator>[0]
type ActivationCoordinatorControl = NonNullable<ActivationCoordinatorInput["control"]>
type ActivationCoordinatorCheckpoint = Parameters<ActivationCoordinatorControl["checkpoint"]>[0]
type ActivationCoordinatorCheckpointFailure = Effect.Error<ReturnType<ActivationCoordinatorControl["checkpoint"]>>
it.effect("coalesces concurrent triggers into one owner for one exact transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("activation-A")
      const transition = freshTransition(taskId)
      const releaseRunner = yield* Deferred.make<void>()
      const runnerStarted = yield* Deferred.make<void>()
      const runnerCount = yield* Ref.make(0)
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
        runId: RunId.make("activation-run"),
        runTransition: () =>
          Ref.update(runnerCount, (count) => count + 1).pipe(
            Effect.andThen(Deferred.succeed(runnerStarted, undefined)),
            Effect.andThen(Deferred.await(releaseRunner))
          )
      })

      yield* Effect.all(
        [coordinator.signal(ActivationCause.Startup()), coordinator.signal(ActivationCause.WorkflowResultRecorded())],
        { concurrency: "unbounded" }
      )
      yield* Deferred.await(runnerStarted)

      expect(yield* Ref.get(runnerCount)).toBe(1)
      expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskId])

      yield* Deferred.succeed(releaseRunner, undefined)
    })
  )
)

it.effect("acknowledges a signal only after the pass assigned to that signal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstReadEntered = yield* Deferred.make<void>()
      const releaseFirstRead = yield* Deferred.make<void>()
      const secondReadEntered = yield* Deferred.make<void>()
      const releaseSecondRead = yield* Deferred.make<void>()
      const readCount = yield* Ref.make(0)
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Ref.getAndUpdate(readCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Deferred.succeed(firstReadEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseFirstRead)))
              : Deferred.succeed(secondReadEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseSecondRead)))
          ),
          Effect.as({ explanations: [], transitions: [] })
        ),
        runId: RunId.make("signal-causality-run"),
        runTransition: () => Effect.void
      })

      const firstSignal = yield* coordinator.signal(ActivationCause.Startup()).pipe(Effect.forkScoped)
      yield* Deferred.await(firstReadEntered)
      const secondSignal = yield* coordinator.signal(ActivationCause.Resume()).pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      yield* Deferred.succeed(releaseFirstRead, undefined)
      yield* Fiber.join(firstSignal)
      yield* Deferred.await(secondReadEntered)

      expect(secondSignal.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(releaseSecondRead, undefined)
      yield* Fiber.join(secondSignal)
      expect(yield* Ref.get(readCount)).toBe(2)
    })
  )
)

it.effect("publishes the first wake even when its signalling fiber is interrupted after registration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registrationReached = yield* Deferred.make<void>()
      const registrationCount = yield* Ref.make(0)
      const readCount = yield* Ref.make(0)
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const control: ActivationCoordinatorControl = {
        afterSignalRegistration: Ref.getAndUpdate(registrationCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Deferred.succeed(registrationReached, undefined).pipe(Effect.andThen(Effect.yieldNow))
              : Effect.void
          )
        ),
        checkpoint: () => Effect.void
      }
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        control,
        readFrontier: Ref.update(readCount, (count) => count + 1).pipe(
          Effect.as({ explanations: [], transitions: [] })
        ),
        runId: RunId.make("interrupted-signal-registration-run"),
        runTransition: () => Effect.void
      })

      const interruptedSignal = yield* coordinator.signal(ActivationCause.Startup()).pipe(Effect.forkScoped)
      yield* Deferred.await(registrationReached)
      yield* Fiber.interrupt(interruptedSignal)

      yield* coordinator.signal(ActivationCause.Resume()).pipe(Effect.timeout("1 second"))

      expect(yield* Ref.get(readCount)).toBeGreaterThanOrEqual(1)
    })
  )
)

it.effect("keeps stale frontier snapshots from readmitting a runner whose ownership is being released", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("stale-owner-task")
      const transition = freshTransition(taskId)
      const frontier = yield* Ref.make<ReadonlyArray<RunnableFrontierTransition>>([transition])
      const readCount = yield* Ref.make(0)
      const runnerCount = yield* Ref.make(0)
      const runnerStarted = yield* Deferred.make<void>()
      const releaseRunner = yield* Deferred.make<void>()
      const staleReadEntered = yield* Deferred.make<void>()
      const releaseStaleRead = yield* Deferred.make<void>()
      const operationReturned = yield* Deferred.make<void>()
      const ownershipReleased = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const control: ActivationCoordinatorControl = {
        checkpoint: (checkpoint) =>
          checkpoint._tag === "OperationReturned"
            ? Deferred.succeed(operationReturned, undefined)
            : checkpoint._tag === "OwnershipReleased"
              ? Deferred.succeed(ownershipReleased, undefined)
              : Effect.void
      }
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        control,
        readFrontier: Effect.gen(function* () {
          const snapshot = yield* Ref.get(frontier)
          const index = yield* Ref.getAndUpdate(readCount, (count) => count + 1)
          if (index === 1) {
            yield* Deferred.succeed(staleReadEntered, undefined)
            yield* Deferred.await(releaseStaleRead)
          }
          return { explanations: [], transitions: snapshot }
        }),
        runId: RunId.make("stale-owner-run"),
        runTransition: () =>
          Ref.update(runnerCount, (count) => count + 1).pipe(
            Effect.andThen(Deferred.succeed(runnerStarted, undefined)),
            Effect.andThen(Deferred.await(releaseRunner)),
            Effect.andThen(Ref.set(frontier, []))
          )
      })

      const startup = yield* coordinator.signal(ActivationCause.Startup()).pipe(Effect.forkScoped)
      yield* Deferred.await(runnerStarted)
      yield* Deferred.await(staleReadEntered)
      yield* Deferred.succeed(releaseRunner, undefined)
      yield* Deferred.await(operationReturned)

      yield* Deferred.succeed(releaseStaleRead, undefined)
      yield* Fiber.join(startup)
      yield* Deferred.await(ownershipReleased)

      expect(yield* Ref.get(runnerCount)).toBe(1)
    })
  )
)

it.effect("finishes an in-flight suspension before continuing the same attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("suspension-order-run")
      const taskId = TaskId.make("suspension-order-task")
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("suspension-order-attempt"),
        baseSha: GitCommitSha.make("4".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/suspension-order-attempt"),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId,
        taskId,
        taskRevision: TaskRevision.make("suspension-order-revision"),
        worktree: WorktreeLocator.make("/worktrees/suspension-order-attempt")
      })
      const suspension = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
      const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
      const releaseSuspension = yield* Deferred.make<void>()
      const releaseContinuation = yield* Deferred.make<void>()
      const suspensionFinished = yield* Ref.make(false)
      const started = yield* Queue.unbounded<RunnableFrontierTransition["_tag"]>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(2) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Ref.get(suspensionFinished).pipe(
          Effect.map((finished) => ({
            explanations: [],
            transitions: finished ? [continuation] : [suspension, continuation]
          }))
        ),
        runId,
        runTransition: (transition) =>
          Queue.offer(started, transition._tag).pipe(
            Effect.andThen(
              transition._tag === "SuspendPlannedAttemptExecutorWork"
                ? Deferred.await(releaseSuspension).pipe(Effect.andThen(Ref.set(suspensionFinished, true)))
                : Deferred.await(releaseContinuation)
            )
          )
      })

      yield* coordinator.signal(ActivationCause.Startup())
      expect(yield* Queue.take(started)).toBe("SuspendPlannedAttemptExecutorWork")
      expect(yield* coordinator.isIdle).toBe(false)
      expect(Option.isNone(yield* Queue.poll(started))).toBe(true)

      yield* Deferred.succeed(releaseSuspension, undefined)
      expect(yield* Queue.take(started)).toBe("ContinuePlannedAttemptExecutorWork")
      yield* Deferred.succeed(releaseContinuation, undefined)
    })
  )
)

it.effect("waits for another activation cause before retrying a failed transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const transition = freshTransition(TaskId.make("activation-failed-read"))
      const returned = yield* Deferred.make<void>()
      const runnerCount = yield* Ref.make(0)
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const control: ActivationCoordinatorControl = {
        checkpoint: (checkpoint) =>
          checkpoint._tag === "OwnershipReleased" && checkpoint.runnerExit === "Failed"
            ? Deferred.succeed(returned, undefined)
            : Effect.void
      }
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        control,
        readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
        runId: RunId.make("activation-failed-read-run"),
        runTransition: () =>
          Ref.update(runnerCount, (count) => count + 1).pipe(Effect.andThen(Effect.fail("typed boundary read failure")))
      })

      yield* coordinator.signal(ActivationCause.Startup())
      yield* Deferred.await(returned)
      yield* Effect.yieldNow
      expect(yield* Ref.get(runnerCount)).toBe(1)

      yield* coordinator.signal(ActivationCause.Resume())
      expect(yield* Ref.get(runnerCount)).toBe(2)
    })
  )
)

it.effect("serializes selection while capacity-N runners overlap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskA = TaskId.make("overlap-A")
      const taskC = TaskId.make("overlap-C")
      const transitions = [freshTransition(taskA), freshTransition(taskC)]
      const started = yield* Queue.unbounded<TaskId>()
      const releaseRunners = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(2) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Effect.succeed({ explanations: [], transitions }),
        runId: RunId.make("overlap-run"),
        runTransition: (transition) =>
          Queue.offer(started, runnableTransitionTaskId(transition)).pipe(
            Effect.andThen(Deferred.await(releaseRunners))
          )
      })

      yield* coordinator.signal(ActivationCause.Startup())
      expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(new Set([taskA, taskC]))
      expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskA, taskC])

      yield* Deferred.succeed(releaseRunners, undefined)
    })
  )
)

it.effect("lowers capacity without preempting two holders and admits C only after both positions are released", () =>
  Effect.gen(function* () {
    const runId = RunId.make("contract-capacity-run")
    const taskA = TaskId.make("contract-capacity-A")
    const taskB = TaskId.make("contract-capacity-B")
    const taskC = TaskId.make("contract-capacity-C")
    const transitionA = freshTransition(taskA)
    const transitionB = freshTransition(taskB)
    const transitionC = freshTransition(taskC)
    const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(2) })

    yield* controller.admit({ explanations: [], transitions: [transitionA] }, runId)
    yield* controller.admit({ explanations: [], transitions: [transitionB] }, runId)
    yield* controller.resize(TaskWorkCapacity.make(1))

    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskA, taskB])
    expect((yield* controller.admit({ explanations: [], transitions: [transitionC] }, runId)).transition._tag).toBe(
      "None"
    )

    yield* controller.cancelReservedPosition(makeSelectedTransitionIdentity(runId, transitionA))
    expect((yield* controller.admit({ explanations: [], transitions: [transitionC] }, runId)).transition._tag).toBe(
      "None"
    )

    yield* controller.cancelReservedPosition(makeSelectedTransitionIdentity(runId, transitionB))
    expect((yield* controller.admit({ explanations: [], transitions: [transitionC] }, runId)).transition._tag).toBe(
      "Some"
    )
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskC])
  })
)

it.effect("increasing capacity keeps the holder and admits another task on the next decision", () =>
  Effect.gen(function* () {
    const runId = RunId.make("expand-capacity-run")
    const taskA = TaskId.make("expand-capacity-A")
    const taskB = TaskId.make("expand-capacity-B")
    const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })

    yield* controller.admit({ explanations: [], transitions: [freshTransition(taskA)] }, runId)
    yield* controller.resize(TaskWorkCapacity.make(2))
    const admitted = yield* controller.admit({ explanations: [], transitions: [freshTransition(taskB)] }, runId)

    expect(admitted.transition._tag).toBe("Some")
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskA, taskB])
  })
)

it.effect("keeps the immutable selection correlation after intent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("mixed-time-A")
      const transition = freshTransition(taskId)
      const intentRecorded = yield* Deferred.make<void>()
      const releaseRunner = yield* Deferred.make<void>()
      const runnerCount = yield* Ref.make(0)
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
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
    })
  )
)

it.effect("releases generic selected-transition positions on runner exit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const preIntentTask = TaskId.make("exit-before-intent")
      const postIntentTask = TaskId.make("exit-after-intent")
      const frontier = yield* Ref.make([freshTransition(preIntentTask), freshTransition(postIntentTask)])
      const exits = yield* Queue.unbounded<TaskId>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(2) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Ref.get(frontier).pipe(Effect.map((transitions) => ({ explanations: [], transitions }))),
        runId: RunId.make("runner-exit-run"),
        runTransition: (transition, execution) =>
          Ref.update(frontier, (current) =>
            current.filter((candidate) => runnableTransitionTaskId(candidate) !== runnableTransitionTaskId(transition))
          ).pipe(
            Effect.andThen(
              runnableTransitionTaskId(transition) === postIntentTask
                ? execution.recordIntent(OperationId.make("post-intent-operation"))
                : Effect.void
            ),
            Effect.andThen(Queue.offer(exits, runnableTransitionTaskId(transition))),
            Effect.andThen(Effect.fail("controlled runner exit"))
          )
      })

      yield* coordinator.signal(ActivationCause.Startup())
      expect(new Set([yield* Queue.take(exits), yield* Queue.take(exits)])).toEqual(
        new Set([preIntentTask, postIntentTask])
      )
      yield* Effect.yieldNow

      expect((yield* controller.snapshot()).reservedTaskIds).toEqual([])
    })
  )
)

it.effect("rederives while pre-intent and post-intent owners remain live without readmitting either", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const preIntentTask = TaskId.make("live-before-intent")
      const postIntentTask = TaskId.make("live-after-intent")
      const releaseRunners = yield* Deferred.make<void>()
      const started = yield* Queue.unbounded<TaskId>()
      const runnerCounts = yield* Ref.make(new Map<TaskId, number>())
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(2) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Effect.succeed({
          explanations: [],
          transitions: [freshTransition(preIntentTask), freshTransition(postIntentTask)]
        }),
        runId: RunId.make("live-owners-run"),
        runTransition: (transition, execution) =>
          Ref.update(runnerCounts, (counts) => {
            const next = new Map(counts)
            const selectedTaskId = runnableTransitionTaskId(transition)
            next.set(selectedTaskId, (next.get(selectedTaskId) ?? 0) + 1)
            return next
          }).pipe(
            Effect.andThen(
              runnableTransitionTaskId(transition) === postIntentTask
                ? execution.recordIntent(OperationId.make("live-post-intent-operation"))
                : Effect.void
            ),
            Effect.andThen(Queue.offer(started, runnableTransitionTaskId(transition))),
            Effect.andThen(Deferred.await(releaseRunners))
          )
      })

      yield* coordinator.signal(ActivationCause.Startup())
      expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(
        new Set([preIntentTask, postIntentTask])
      )
      yield* coordinator.signal(ActivationCause.Resume())

      expect(yield* Ref.get(runnerCounts)).toEqual(
        new Map([
          [preIntentTask, 1],
          [postIntentTask, 1]
        ])
      )
      const positions = (yield* controller.snapshot()).reservedPositions
      expect(positions.map(({ correlation }) => correlation._tag)).toEqual([
        "SelectedTransitionReservation",
        "SelectedTransitionReservation"
      ])

      yield* Deferred.succeed(releaseRunners, undefined)
    })
  )
)

it.effect("records a result, releases its exact position, and rederives the next transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskA = TaskId.make("result-A")
      const taskC = TaskId.make("result-C")
      const remaining = yield* Ref.make([taskA, taskC])
      const started = yield* Queue.unbounded<TaskId>()
      const releaseC = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Ref.get(remaining).pipe(
          Effect.map((tasks) => ({ explanations: [], transitions: tasks.map(freshTransition) }))
        ),
        runId: RunId.make("result-release-run"),
        runTransition: (transition, execution) =>
          execution
            .recordIntent(OperationId.make(`result-operation:${runnableTransitionTaskId(transition)}`))
            .pipe(
              Effect.andThen(Queue.offer(started, runnableTransitionTaskId(transition))),
              Effect.andThen(
                runnableTransitionTaskId(transition) === taskA
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
    })
  )
)

it.effect("finishes an owned non-capacity operation without releasing an absent position", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("non-capacity-claim")
      const transition = RunnableFrontierTransition.CheckTaskClaim({
        operationId: OperationId.make("non-capacity-operation"),
        taskId
      })
      const remaining = yield* Ref.make([transition])
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Ref.get(remaining).pipe(Effect.map((transitions) => ({ explanations: [], transitions }))),
        runId: RunId.make("non-capacity-run"),
        runTransition: (_, execution) =>
          execution.recordIntent(transition.operationId).pipe(Effect.andThen(Ref.set(remaining, [])))
      })

      yield* coordinator.signal(ActivationCause.Startup())
      yield* Effect.yieldNow

      expect(yield* Ref.get(remaining)).toEqual([])
      expect((yield* controller.snapshot()).reservedPositions).toEqual([])
    })
  )
)

it.effect("rolls back the exact partial handoff when a controlled boundary interrupts", () =>
  Effect.forEach(
    [
      { interruptedTag: "OwnedTransitionsExcluded", transitionKind: "Capacity" },
      { interruptedTag: "AdmissionReserved", transitionKind: "Capacity" },
      { interruptedTag: "AdmissionReserved", transitionKind: "NonCapacity" },
      { interruptedTag: "OwnershipRegistered", transitionKind: "Capacity" },
      { interruptedTag: "OwnershipRegistered", transitionKind: "NonCapacity" }
    ] as const,
    ({ interruptedTag, transitionKind }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const taskId = TaskId.make(`interrupted-${interruptedTag}-${transitionKind}`)
          const transition =
            transitionKind === "Capacity"
              ? freshTransition(taskId)
              : RunnableFrontierTransition.CheckTaskClaim({
                  operationId: OperationId.make(`interrupted-operation-${interruptedTag}`),
                  taskId
                })
          const checkpoints = yield* Ref.make<ReadonlyArray<ActivationCoordinatorCheckpoint["_tag"]>>([])
          const runnerCount = yield* Ref.make(0)
          const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
          const control: ActivationCoordinatorControl = {
            checkpoint: (checkpoint) =>
              Ref.update(checkpoints, (current) => [...current, checkpoint._tag]).pipe(
                Effect.andThen(
                  checkpoint._tag === interruptedTag
                    ? Effect.fail({ _tag: "InterruptActivation" } satisfies ActivationCoordinatorCheckpointFailure)
                    : Effect.void
                )
              )
          }
          const coordinator = yield* makeActivationCoordinator({
            admissionController: controller,
            control,
            readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
            runId: RunId.make(`interrupted-run-${interruptedTag}`),
            runTransition: () => Ref.update(runnerCount, (count) => count + 1)
          })

          yield* coordinator.signal(ActivationCause.Startup())

          expect(yield* Ref.get(runnerCount), interruptedTag).toBe(0)
          expect((yield* controller.snapshot()).reservedPositions, interruptedTag).toEqual([])
          expect(yield* Ref.get(checkpoints), interruptedTag).toContain(interruptedTag)
        })
      ),
    { discard: true }
  )
)

it.effect("isolates the exact duplicate result while preserving its original owner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("controlled-duplicate")
      const runId = RunId.make("controlled-duplicate-run")
      const transition = freshTransition(taskId)
      const releaseRunner = yield* Deferred.make<void>()
      const runnerStarted = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const competingAttempts = yield* Ref.make(0)
      const ownershipSnapshots = yield* Ref.make<ReadonlyArray<{ readonly isolated: number; readonly owners: number }>>(
        []
      )
      const control: ActivationCoordinatorControl = {
        attemptCompetingOwnershipRegistration: (attempt) =>
          Ref.update(competingAttempts, (count) => count + 1).pipe(Effect.andThen(attempt)),
        checkpoint: (checkpoint) =>
          checkpoint._tag === "FrontierDerived"
            ? Ref.update(ownershipSnapshots, (current) => [
                ...current,
                {
                  isolated: checkpoint.observation.ownership.isolatedTransitionKeys.size,
                  owners: checkpoint.observation.ownership.owners.size
                }
              ])
            : Effect.void
      }
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        control,
        readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
        runId,
        runTransition: () =>
          Deferred.succeed(runnerStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseRunner)))
      })

      yield* coordinator.signal(ActivationCause.Startup())
      yield* Deferred.await(runnerStarted)
      yield* coordinator.signal(ActivationCause.Resume())

      expect(yield* Ref.get(competingAttempts)).toBe(1)
      expect((yield* Ref.get(ownershipSnapshots)).at(-1)).toEqual({ isolated: 1, owners: 1 })
      expect((yield* controller.snapshot()).reservedPositions).toHaveLength(1)
      yield* Deferred.succeed(releaseRunner, undefined)
    })
  )
)

it.effect("isolates a duplicate ownership checkpoint without rolling back its position", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const taskId = TaskId.make("checkpoint-duplicate")
      const transition = freshTransition(taskId)
      const releaseRunner = yield* Deferred.make<void>()
      const runnerStarted = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const ownershipSnapshots = yield* Ref.make<ReadonlyArray<{ readonly isolated: number; readonly owners: number }>>(
        []
      )
      const control: ActivationCoordinatorControl = {
        checkpoint: (checkpoint) =>
          checkpoint._tag === "OwnershipRegistered"
            ? Effect.fail({ _tag: "RejectDuplicateOwnership" } satisfies ActivationCoordinatorCheckpointFailure)
            : checkpoint._tag === "FrontierDerived"
              ? Ref.update(ownershipSnapshots, (current) => [
                  ...current,
                  {
                    isolated: checkpoint.observation.ownership.isolatedTransitionKeys.size,
                    owners: checkpoint.observation.ownership.owners.size
                  }
                ])
              : Effect.void
      }
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        control,
        readFrontier: Effect.succeed({ explanations: [], transitions: [transition] }),
        runId: RunId.make("checkpoint-duplicate-run"),
        runTransition: () =>
          Deferred.succeed(runnerStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseRunner)))
      })

      yield* coordinator.signal(ActivationCause.Startup())
      yield* Deferred.await(runnerStarted)
      yield* coordinator.signal(ActivationCause.Resume())

      expect((yield* Ref.get(ownershipSnapshots)).at(-1)).toEqual({ isolated: 1, owners: 1 })
      expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskId])
      yield* Deferred.succeed(releaseRunner, undefined)
    })
  )
)

it.effect("atomically rejects or drains signals when the coordinator closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const failFrontier = yield* Deferred.make<void>()
      const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
      const coordinator = yield* makeActivationCoordinator({
        admissionController: controller,
        readFrontier: Deferred.await(failFrontier).pipe(Effect.andThen(Effect.fail("controlled frontier failure"))),
        runId: RunId.make("closing-signal-run"),
        runTransition: () => Effect.void
      })

      const signals = Array.from({ length: 64 }, (_, index) =>
        coordinator
          .signal(index % 2 === 0 ? ActivationCause.Resume() : ActivationCause.WorkflowResultRecorded())
          .pipe(Effect.exit)
      )
      const exits = yield* Effect.all(
        [Deferred.succeed(failFrontier, undefined), Effect.all(signals, { concurrency: "unbounded" })],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.map(([, results]) => results),
        Effect.timeout("1 second")
      )

      expect(exits).toHaveLength(64)
      expect(exits.every(Exit.isFailure)).toBe(true)
    })
  )
)

it.effect("rejects a signal submitted after its exact coordinator scope closes", () =>
  Effect.gen(function* () {
    const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
    const coordinatorScope = yield* Scope.make()
    const coordinator = yield* makeActivationCoordinator({
      admissionController: controller,
      readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
      runId: RunId.make("closed-coordinator-run"),
      runTransition: () => Effect.void
    }).pipe(Scope.provide(coordinatorScope))

    yield* Scope.close(coordinatorScope, Exit.void)

    expect((yield* Effect.exit(coordinator.signal(ActivationCause.Resume())))._tag).toBe("Failure")
  })
)
