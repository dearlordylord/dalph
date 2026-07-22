import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Queue, Ref } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AuthoritativeTaskWorktreeReady,
  ClaimOwner,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  FixtureTarget,
  GitCommitSha,
  liveFakeWorkflowInterpreterLayer,
  MatchingTaskWorkSessionReported,
  PlannedTaskAttemptPlanner,
  PlannedWorktreeReady,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  runWorkflow,
  TaskAttemptPlanRecordAcknowledged,
  TaskExecutorLocator,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TaskWorktreeExecutionModeContradiction,
  TraceOutputError,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  WorkerProcessId,
  WorkflowInterpreter,
  WorkflowOutcome,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import type { TraceItem } from "./workflow.js"

const fixture = (name: "singleton" | "wayfinder-105") => new URL(`../fixtures/${name}.json`, import.meta.url).pathname

const planningLayers = [
  deterministicOperationIdAllocatorLayer("workflow-test"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    executor: TaskExecutorLocator.make("executor:workflow-test"),
    runId: RunId.make("workflow-test"),
    sessionRoot: TaskWorkSessionLocator.make("session:workflow-test"),
    worktreeRoot: WorktreeLocator.make("/tmp/dalph-workflow-test")
  }),
  deterministicTaskClaimAcquisitionPlannerLayer({
    owner: ClaimOwner.make("workflow-test"),
    tokenPrefix: "workflow-test-claim"
  })
] as const

const successfulTaskRunner = TaskRunner.of({
  lookupTaskWorkSession: Effect.fn("TaskRunner.WorkflowTest.lookup")(function*(lookup) {
    return MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
      sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
      work: { _tag: "NoProviderWorkReported" }
    })
  }),
  requestTaskWorkStart: Effect.fn("TaskRunner.WorkflowTest.start")(function*(request) {
    return {
      observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
      providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
    }
  })
})

const runLayered = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  traceLayer: Layer.Layer<WorkflowTrace>,
  runner = successfulTaskRunner,
  attemptPlannerLayer = planningLayers[1],
  interpreterLayer = liveFakeWorkflowInterpreterLayer
) =>
  effect.pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(traceLayer),
    Effect.provide(Layer.succeed(TaskRunner, runner)),
    Effect.provide(trackerGraphReaderFileLayer),
    Effect.provide(planningLayers[0]),
    Effect.provide(attemptPlannerLayer),
    Effect.provide(planningLayers[2])
  )

it.effect("simulates task-work establishment without provider protocol effects", () =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: (item) => Ref.update(items, (current) => [...current, item])
      })
    )
    yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      traceLayer
    )

    expect((yield* Ref.get(items)).map((item) => item._tag)).toEqual([
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "OperationSelected",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "TrackerExecutionAdmitted",
      "OperationSelected",
      "TaskAttemptPlanRecordingSimulated",
      "OperationSelected",
      "TaskWorktreeReconciliationSimulated",
      "OperationSelected",
      "TaskWorkSessionEstablishmentSimulated",
      "OperationSelected",
      "TaskExecutionAdmitted",
      "TaskExecutionSimulated"
    ])
  }))

it.effect("establishes task work only after an authoritative worktree proof", () =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const liveInterpreterLayer = Layer.effect(
      WorkflowInterpreter,
      Effect.gen(function*() {
        const delegate = yield* WorkflowInterpreter
        return WorkflowInterpreter.of({
          ...delegate,
          executeTaskWork: (operation) =>
            Effect.succeed(WorkflowOutcome.cases.TaskExecutionObserved.make({
              outcome: {
                _tag: "Succeeded",
                observationId: ProviderObservationId.make("live-process-observation"),
                operationId: operation.request.operationId,
                output: "scripted implementation complete",
                processId: WorkerProcessId.make(101),
                sessionId: TaskWorkSessionId.make("live-session")
              }
            })),
          establishTaskWorkSession: (operation) =>
            Effect.succeed(
              WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
                operationId: operation.request.operationId,
                sessionId: TaskWorkSessionId.make("live-session")
              })
            ),
          recordTaskAttemptPlan: (operation) =>
            Effect.succeed(
              TaskAttemptPlanRecordAcknowledged.make({
                plannedAttempt: operation.plannedAttempt
              })
            ),
          reconcileTaskWorktree: (operation) =>
            Effect.succeed(AuthoritativeTaskWorktreeReady.make({
              proof: PlannedWorktreeReady.make({
                baseSha: operation.plannedAttempt.baseSha,
                branch: operation.plannedAttempt.branch,
                headSha: operation.plannedAttempt.baseSha,
                worktree: operation.plannedAttempt.worktree
              })
            }))
        })
      })
    ).pipe(Layer.provide(liveFakeWorkflowInterpreterLayer))
    yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({
          emit: (item) => Ref.update(items, (current) => [...current, item])
        })
      ),
      successfulTaskRunner,
      planningLayers[1],
      liveInterpreterLayer
    )

    const tags = (yield* Ref.get(items)).map((item) => item._tag)
    expect(tags.indexOf("TaskWorktreeReady")).toBeLessThan(
      tags.indexOf("TaskWorkSessionEstablished")
    )
  }))

it.effect("rejects acknowledged planning paired with simulated Git reconciliation", () =>
  Effect.gen(function*() {
    const starts = yield* Ref.make(0)
    const mixedLayer = Layer.effect(
      WorkflowInterpreter,
      Effect.gen(function*() {
        const delegate = yield* WorkflowInterpreter
        return WorkflowInterpreter.of({
          ...delegate,
          establishTaskWorkSession: () =>
            Ref.update(starts, (value) => value + 1).pipe(
              Effect.andThen(Effect.die("mixed mode must not start agent work"))
            ),
          recordTaskAttemptPlan: (operation) =>
            Effect.succeed(
              TaskAttemptPlanRecordAcknowledged.make({
                plannedAttempt: operation.plannedAttempt
              })
            )
        })
      })
    ).pipe(Layer.provide(liveFakeWorkflowInterpreterLayer))
    const failure = yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      successfulTaskRunner,
      planningLayers[1],
      mixedLayer
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskWorktreeExecutionModeContradiction)
    expect(yield* Ref.get(starts)).toBe(0)
  }))

it.effect("reserves no more than the configured concurrent task attempts", () =>
  Effect.gen(function*() {
    const started = yield* Queue.unbounded<string>()
    const release = yield* Deferred.make<void>()
    const gatedPlannerLayer = Layer.effect(
      PlannedTaskAttemptPlanner,
      Effect.gen(function*() {
        const delegate = yield* PlannedTaskAttemptPlanner
        return PlannedTaskAttemptPlanner.of({
          plan: (task, revision) =>
            Queue.offer(started, task.id).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(delegate.plan(task, revision))
            )
        })
      })
    ).pipe(Layer.provide(planningLayers[1]))
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )
    const fiber = yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("wayfinder-105")), TaskWorkCapacity.make(2)),
      traceLayer,
      successfulTaskRunner,
      gatedPlannerLayer
    ).pipe(Effect.forkScoped)

    yield* Queue.take(started)
    yield* Queue.take(started)
    expect(yield* Queue.size(started)).toBe(0)
    yield* Fiber.interrupt(fiber)
  }))

it.effect("does not send a start request when capacity trace output fails", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const runner = TaskRunner.of({
      ...successfulTaskRunner,
      requestTaskWorkStart: (request) =>
        Ref.update(requests, (count) => count + 1).pipe(
          Effect.as({
            observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
            providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
          })
        )
    })
    const failure = new TraceOutputError({ detail: "capacity trace failed" })
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: (item) =>
          item._tag === "TaskExecutionAdmitted"
            ? Effect.fail(failure)
            : Effect.void
      })
    )
    const observed = yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      traceLayer,
      runner
    ).pipe(Effect.flip)

    expect(observed).toBe(failure)
    expect(yield* Ref.get(requests)).toBe(0)
  }))

it.effect("revalidates tracker eligibility immediately before task-work start", () =>
  Effect.gen(function*() {
    const reads = yield* Ref.make(0)
    const requests = yield* Ref.make(0)
    const initiallyEligible = validSnapshot({
      revision: "initially-eligible",
      tasks: [{
        id: "task-revalidation",
        lifecycle: { _tag: "Open" },
        parentTaskId: null,
        prerequisiteIds: []
      }]
    })
    const noLongerEligible = validSnapshot({
      revision: "no-longer-eligible",
      tasks: []
    })
    const readerLayer = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () =>
          Ref.getAndUpdate(reads, (value) => value + 1).pipe(
            Effect.map((ordinal) => ordinal === 0 ? initiallyEligible : noLongerEligible)
          )
      })
    )
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("lookup must not run"),
        requestTaskWorkStart: () =>
          Ref.update(requests, (value) => value + 1).pipe(
            Effect.andThen(Effect.die("request must not run"))
          )
      })
    )
    yield* runWorkflow(
      FixtureTarget.make("revalidation-target"),
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(readerLayer),
      Effect.provide(runnerLayer),
      Effect.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      )),
      Effect.provide(planningLayers[0]),
      Effect.provide(planningLayers[1]),
      Effect.provide(planningLayers[2])
    )

    expect(yield* Ref.get(reads)).toBe(2)
    expect(yield* Ref.get(requests)).toBe(0)
  }))
