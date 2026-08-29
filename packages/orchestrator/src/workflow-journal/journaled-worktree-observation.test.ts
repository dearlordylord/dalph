import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
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
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../authorities/git/worktree.js"
import { GitTargetLineageReadFailure } from "../authorities/git/target-lineage.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { OperationId } from "../workflow/identity.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  InterruptibleWorkflowBoundaryIntent,
  WorkflowInterpreter,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation
} from "../workflow/registry/operation.js"
import { AttemptWorktreeLost } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { memoryJournalTestLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsFor
} from "../coordination/run/run-activation-opportunity.js"

const unused = () => Effect.die("unused")
const testInterpreter = (
  readTaskWorktree: WorkflowInterpreterService["readTaskWorktree"],
  readTargetLineage: WorkflowInterpreterService["readTargetLineage"] = unused
) =>
  WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTargetLineage,
    readTaskWorktree,
    readTrackerGraph: unused,
    readTaskWorkSpecification: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    releaseTaskClaim: unused
  })
const runId = RunId.make("journaled-worktree-observation-run")
const target = FixtureTarget.make("journaled-worktree-observation-target")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("journaled-worktree-observation-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/journaled-worktree-observation"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("journaled-worktree-observation-task"),
  taskRevision: TaskRevision.make("journaled-worktree-observation-revision"),
  worktree: WorktreeLocator.make("/worktrees/journaled-worktree-observation")
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/journaled-target-lineage.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

const activeOpportunity = (source: "TrackerNotification" | "Timer") =>
  activeWorkAuthorityRefreshForOwner(source, activeWorkAuthorityRefreshSubjectsFor([plannedAttempt]))

/** Supervisor-visible chronology around an interrupted Git wait and a fresh application incarnation. */
const interruptedGitAuthoredCassette = [
  "GitIntentAcknowledged",
  "GitCallSent",
  "ExitCutoffClosed",
  "LocalGitWaitInterrupted",
  "ApplicationProcessDied",
  "OrdinaryRunEntry",
  "GitCheckedBeforeRetry",
  "GitObservationRecorded"
] as const

const journaledTestLayer = (base: Layer.Layer<WorkflowInterpreter>) =>
  journaledWorkflowInterpreterLayer(runId, base).pipe(Layer.provide(memoryJournalTestLayer))

const replayingLostWorktreeLayer = journaledTestLayer(
  Layer.effect(
    WorkflowInterpreter,
    Ref.make(0).pipe(
      Effect.map((reads) =>
        testInterpreter(() =>
          Ref.updateAndGet(reads, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Effect.succeed(
                    AuthoritativePlannedAttemptWorktreeObserved.make({
                      observation: AttemptWorktreeLost.make({ plannedAttempt })
                    })
                  )
                : Effect.die("journal replay repeated the Git worktree read")
            )
          )
        )
      )
    )
  )
)

const retryingLostWorktreeLayer = journaledTestLayer(
  Layer.effect(
    WorkflowInterpreter,
    Ref.make(0).pipe(
      Effect.map((reads) =>
        testInterpreter(() =>
          Ref.updateAndGet(reads, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Effect.fail(
                    new GitWorktreeReadFailure({
                      detail: "coordinator lost the first read response",
                      worktree: plannedAttempt.worktree
                    })
                  )
                : Effect.succeed(
                    AuthoritativePlannedAttemptWorktreeObserved.make({
                      observation: AttemptWorktreeLost.make({ plannedAttempt })
                    })
                  )
            )
          )
        )
      )
    )
  )
)

const retryingTargetLineageLayer = journaledTestLayer(
  Layer.effect(
    WorkflowInterpreter,
    Ref.make(0).pipe(
      Effect.map((lineageReads) =>
        testInterpreter(
          () =>
            Effect.succeed(
              AuthoritativePlannedAttemptWorktreeObserved.make({
                observation: PlannedWorktreeReady.make({
                  baseSha: plannedAttempt.baseSha,
                  branch: plannedAttempt.branch,
                  headSha: plannedAttempt.baseSha,
                  worktree: plannedAttempt.worktree
                })
              })
            ),
          () =>
            Ref.updateAndGet(lineageReads, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Effect.fail(
                      new GitTargetLineageReadFailure({
                        detail: "Git could not currently resolve the target",
                        plannedBaseSha: plannedAttempt.baseSha,
                        target: integrationTarget
                      })
                    )
                  : Effect.succeed(
                      AuthoritativeTargetLineageObserved.make({
                        observation: {
                          plannedBaseIsAncestorOfTargetHead: true,
                          plannedBaseSha: plannedAttempt.baseSha,
                          targetHeadSha: GitCommitSha.make("b".repeat(40))
                        }
                      })
                    )
              )
            )
        )
      )
    )
  )
)

it.effect("records exact worktree loss and replays it without another Git read", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const interpreter = yield* WorkflowInterpreter
    const operation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("journaled-worktree-observation-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })

    expect((yield* interpreter.readTaskWorktree(operation))._tag).toBe("AuthoritativePlannedAttemptWorktreeObserved")
    expect((yield* interpreter.readTaskWorktree(operation))._tag).toBe("AuthoritativePlannedAttemptWorktreeObserved")
    expect(
      (yield* journal.read(runId))
        .map(({ event }) => event._tag)
        .filter((tag) => tag === "GitReadIntentRecorded" || tag === "PlannedAttemptWorktreeObserved")
    ).toEqual(["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved"])
  }).pipe(Effect.provide(replayingLostWorktreeLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reopens an intent-only Git read with the same operation identity", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const interpreter = yield* WorkflowInterpreter
    const operation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("journaled-worktree-intent-only-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })

    expect((yield* interpreter.readTaskWorktree(operation).pipe(Effect.flip))._tag).toBe("GitWorktreeReadFailure")
    expect((yield* interpreter.readTaskWorktree(operation))._tag).toBe("AuthoritativePlannedAttemptWorktreeObserved")
    const gitRecords = (yield* journal.read(runId)).filter(
      ({ event }) => event._tag === "GitReadIntentRecorded" || event._tag === "PlannedAttemptWorktreeObserved"
    )
    expect(gitRecords).toHaveLength(2)
    expect(
      gitRecords.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded"
          ? [event.operation.operationId]
          : event._tag === "PlannedAttemptWorktreeObserved"
            ? [event.operationId]
            : []
      )
    ).toEqual([operation.operationId, operation.operationId])
    expect(
      (yield* journal.read(runId)).some(({ event }) => event._tag === "ActiveWorkAuthorityRefreshGitReadFailed")
    ).toBe(false)
  }).pipe(Effect.provide(retryingLostWorktreeLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("uses active Git protocol only for the attempts captured at activation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const secondAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("journaled-worktree-observation-second-attempt"),
      taskId: TaskId.make("journaled-worktree-observation-second-task"),
      worktree: WorktreeLocator.make("/worktrees/journaled-worktree-observation-second")
    })
    const uncapturedLaterAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("journaled-worktree-observation-later-attempt"),
      taskId: TaskId.make("journaled-worktree-observation-later-task"),
      worktree: WorktreeLocator.make("/worktrees/journaled-worktree-observation-later")
    })
    const operationFor = (attempt: PlannedTaskAttempt, suffix: string) =>
      makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(`active-subject-selection-${suffix}`),
        plannedAttempt: attempt,
        predecessorOperationIds: []
      })
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter((operation) =>
        Effect.succeed(
          AuthoritativePlannedAttemptWorktreeObserved.make({
            observation: PlannedWorktreeReady.make({
              baseSha: operation.plannedAttempt.baseSha,
              branch: operation.plannedAttempt.branch,
              headSha: operation.plannedAttempt.baseSha,
              worktree: operation.plannedAttempt.worktree
            })
          })
        )
      )
    )
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([plannedAttempt, secondAttempt])
    )
    const interpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base, opportunity))
    )

    yield* interpreter.readTaskWorktree(operationFor(plannedAttempt, "first"))
    yield* interpreter.readTaskWorktree(operationFor(secondAttempt, "second"))
    // This attempt may become Running after the activation baseline, but the
    // captured subject set cannot grant it active protocol authority.
    yield* interpreter.readTaskWorktree(operationFor(uncapturedLaterAttempt, "later"))

    const records = yield* journal.read(runId)
    const activeIntents = records.flatMap(({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" ? [event] : []
    )
    const ordinaryIntents = records.flatMap(({ event }) =>
      event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTaskWorktree" ? [event] : []
    )
    expect(activeIntents.map(({ operation }) => operation.plannedAttempt.attemptId)).toEqual([
      plannedAttempt.attemptId,
      secondAttempt.attemptId
    ])
    expect(ordinaryIntents.map(({ operation }) => operation.plannedAttempt.attemptId)).toEqual([
      uncapturedLaterAttempt.attemptId
    ])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("does not reinterpret an ordinary Git intent as an active-refresh read", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const calls = yield* Ref.make(0)
    const ready = AuthoritativePlannedAttemptWorktreeObserved.make({
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      })
    })
    const lineage = AuthoritativeTargetLineageObserved.make({
      observation: {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("b".repeat(40))
      }
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter(
        () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(ready)),
        () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(lineage))
      )
    )
    const ordinaryInterpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base))
    )
    const activeInterpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base, activeOpportunity("Timer")))
    )
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("ordinary-intent-captured-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("ordinary-intent-captured-lineage"),
      plannedAttempt,
      predecessorOperationIds: [worktreeOperation.operationId]
    })

    expect(
      (yield* ordinaryInterpreter
        .readTaskWorktree(worktreeOperation, Effect.die("simulated crash after ordinary Git intent"))
        .pipe(Effect.exit))._tag
    ).toBe("Failure")
    expect((yield* activeInterpreter.readTaskWorktree(worktreeOperation))._tag).toBe(
      "AuthoritativePlannedAttemptWorktreeObserved"
    )

    expect(
      (yield* ordinaryInterpreter
        .readTargetLineage(lineageOperation, Effect.die("simulated crash after ordinary Git intent"))
        .pipe(Effect.exit))._tag
    ).toBe("Failure")
    expect((yield* activeInterpreter.readTargetLineage(lineageOperation))._tag).toBe(
      "AuthoritativeTargetLineageObserved"
    )

    expect(yield* Ref.get(calls)).toBe(2)
    expect(
      (yield* journal.read(runId))
        .map(({ event }) => event._tag)
        .filter(
          (tag) =>
            tag === "GitReadIntentRecorded" ||
            tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" ||
            tag === "PlannedAttemptWorktreeObserved" ||
            tag === "TargetLineageObserved"
        )
    ).toEqual([
      "GitReadIntentRecorded",
      "PlannedAttemptWorktreeObserved",
      "GitReadIntentRecorded",
      "TargetLineageObserved"
    ])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("records the authored Git interruption and ordinary replay cassette", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const firstCallStarted = yield* Deferred.make<void>()
    const chronology = yield* Ref.make<Array<(typeof interruptedGitAuthoredCassette)[number]>>([])
    const record = (event: (typeof interruptedGitAuthoredCassette)[number]) =>
      Ref.update(chronology, (events) => [...events, event])
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter(() =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 1
              ? record("GitCallSent").pipe(
                  Effect.andThen(Deferred.succeed(firstCallStarted, undefined)),
                  Effect.andThen(Effect.never)
                )
              : record("GitCheckedBeforeRetry").pipe(
                  Effect.as(
                    AuthoritativePlannedAttemptWorktreeObserved.make({
                      observation: AttemptWorktreeLost.make({ plannedAttempt })
                    })
                  )
                )
          )
        )
      )
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, base)
    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const interpreter = yield* WorkflowInterpreter
      const operation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("application-exit-interrupted-git-read"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const exitingLifecycle = yield* makeApplicationExitLifecycle()
      const exitingOwner = yield* exitingLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (exitingOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const inFlight = yield* interpreter
        .readTaskWorktree(operation, record("GitIntentAcknowledged"), exitingOwner)
        .pipe(Effect.forkChild)

      yield* Deferred.await(firstCallStarted)
      yield* exitingLifecycle.requestExit
      yield* record("ExitCutoffClosed")
      expect((yield* Fiber.await(inFlight))._tag).toBe("Failure")
      yield* record("LocalGitWaitInterrupted")
      expect(yield* exitingOwner.snapshot).toEqual({
        _tag: "RecoverableAmbiguity",
        intent: InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
          family: "Git",
          operationId: operation.operationId
        })
      })
      yield* exitingOwner.release
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "GitReadIntentRecorded" || tag === "PlannedAttemptWorktreeObserved")
      ).toEqual(["GitReadIntentRecorded"])

      yield* record("ApplicationProcessDied")
      yield* record("OrdinaryRunEntry")
      const reopenedLifecycle = yield* makeApplicationExitLifecycle()
      const reopenedOwner = yield* reopenedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (reopenedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong reopened owner kind")
      expect((yield* interpreter.readTaskWorktree(operation, Effect.void, reopenedOwner))._tag).toBe(
        "AuthoritativePlannedAttemptWorktreeObserved"
      )
      yield* record("GitObservationRecorded")
      yield* reopenedOwner.release

      expect(yield* Ref.get(calls)).toBe(2)
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "GitReadIntentRecorded" || tag === "PlannedAttemptWorktreeObserved")
      ).toEqual(["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved"])
      expect(yield* Ref.get(chronology)).toEqual(interruptedGitAuthoredCassette)
    }).pipe(Effect.provide(journaled))
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("retains the ready worktree while retrying a failed target-lineage read with the same identity", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const interpreter = yield* WorkflowInterpreter
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("journaled-target-lineage-worktree-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("journaled-target-lineage-read"),
      plannedAttempt,
      predecessorOperationIds: [worktreeOperation.operationId]
    })

    yield* interpreter.readTaskWorktree(worktreeOperation)
    expect((yield* interpreter.readTargetLineage(lineageOperation).pipe(Effect.flip))._tag).toBe(
      "GitTargetLineageReadFailure"
    )
    expect((yield* interpreter.readTargetLineage(lineageOperation))._tag).toBe("AuthoritativeTargetLineageObserved")
    expect((yield* interpreter.readTargetLineage(lineageOperation))._tag).toBe("AuthoritativeTargetLineageObserved")
    const gitRecords = (yield* journal.read(runId)).filter(
      ({ event }) =>
        event._tag === "GitReadIntentRecorded" ||
        event._tag === "PlannedAttemptWorktreeObserved" ||
        event._tag === "TargetLineageObserved"
    )
    expect(gitRecords.map(({ event }) => event._tag)).toEqual([
      "GitReadIntentRecorded",
      "PlannedAttemptWorktreeObserved",
      "GitReadIntentRecorded",
      "TargetLineageObserved"
    ])
    expect(
      gitRecords
        .filter(({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage")
        .map(({ event }) => (event._tag === "GitReadIntentRecorded" ? event.operation.operationId : undefined))
    ).toEqual([lineageOperation.operationId])
  }).pipe(Effect.provide(retryingTargetLineageLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("records an active-refresh worktree failure after its intent and preserves the typed failure", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const chronology = yield* Ref.make<Array<"intent" | "call">>([])
    const failure = new GitWorktreeReadFailure({
      detail: "Git worktree registration is temporarily unreadable",
      worktree: plannedAttempt.worktree
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter(() =>
        Ref.update(chronology, (events): Array<"intent" | "call"> => [...events, "call"]).pipe(
          Effect.andThen(Effect.fail(failure))
        )
      )
    )
    const activeLayer = journaledWorkflowInterpreterLayer(runId, base, activeOpportunity("TrackerNotification"))
    const operation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-worktree-failure-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(activeLayer))
    const observed = yield* interpreter
      .readTaskWorktree(
        operation,
        Ref.update(chronology, (events): Array<"intent" | "call"> => [...events, "intent"])
      )
      .pipe(Effect.flip)

    expect(observed).toEqual(failure)
    expect(yield* Ref.get(chronology)).toEqual(["intent", "call"])
    const gitRecords = (yield* journal.read(runId)).filter(
      ({ event }) =>
        event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" ||
        event._tag === "ActiveWorkAuthorityRefreshGitReadFailed"
    )
    expect(gitRecords.map(({ event }) => event._tag)).toEqual([
      "ActiveWorkAuthorityRefreshGitReadIntentRecorded",
      "ActiveWorkAuthorityRefreshGitReadFailed"
    ])
    const intent = gitRecords[0]?.event
    const recorded = gitRecords[1]?.event
    if (intent?._tag !== "ActiveWorkAuthorityRefreshGitReadIntentRecorded") {
      return yield* Effect.die("missing active-refresh intent")
    }
    if (recorded?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") return yield* Effect.die("missing failure event")
    expect(intent.operation).toEqual(recorded.operation)
    expect(recorded.operation.operationId).toBe(intent.operation.operationId)
    expect(recorded.operation.plannedAttempt).toEqual(operation.plannedAttempt)
    expect(recorded).toMatchObject({
      authority: { attemptId: plannedAttempt.attemptId, runId },
      failure,
      operation: { _tag: "ReadTaskWorktree", operationId: operation.operationId },
      ordinal: 1,
      source: "TrackerNotification"
    })

    const replayed = yield* interpreter.readTaskWorktree(operation).pipe(Effect.flip)
    expect(replayed).toEqual(failure)
    expect(yield* Ref.get(chronology)).toEqual(["intent", "call"])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("replays an active intent-only crash with the same durable identity", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const operation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-intent-only-crash"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const firstLayer = journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(
        WorkflowInterpreter,
        testInterpreter(() => Effect.die("the crashed process must not call Git after its intent is acknowledged"))
      ),
      activeOpportunity("TrackerNotification")
    )
    const firstInterpreter = yield* WorkflowInterpreter.pipe(Effect.provide(firstLayer))
    const crashed = yield* firstInterpreter
      .readTaskWorktree(operation, Effect.die("simulated process death after active intent"))
      .pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")

    const replayedLayer = journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(
        WorkflowInterpreter,
        testInterpreter(() =>
          Effect.succeed(
            AuthoritativePlannedAttemptWorktreeObserved.make({
              observation: PlannedWorktreeReady.make({
                baseSha: plannedAttempt.baseSha,
                branch: plannedAttempt.branch,
                headSha: plannedAttempt.baseSha,
                worktree: plannedAttempt.worktree
              })
            })
          )
        )
      ),
      activeOpportunity("Timer")
    )
    const replayedInterpreter = yield* WorkflowInterpreter.pipe(Effect.provide(replayedLayer))
    expect((yield* replayedInterpreter.readTaskWorktree(operation))._tag).toBe(
      "AuthoritativePlannedAttemptWorktreeObserved"
    )

    const records = yield* journal.read(runId)
    const intents = records.flatMap(({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" &&
      event.operation.operationId === operation.operationId
        ? [event]
        : []
    )
    expect(intents).toHaveLength(1)
    const intent = intents[0]
    if (intent === undefined) return yield* Effect.die("active intent was not persisted")
    expect(intent.operation).toMatchObject({ authority: { attemptId: plannedAttempt.attemptId, runId }, ordinal: 1 })
    expect(intent).not.toHaveProperty("source")
    expect(intent.operation).not.toHaveProperty("source")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("derives ordinal two after a successful active read in a fresh interpreter layer", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const firstOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-success-before-restart"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const firstLayer = journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(
        WorkflowInterpreter,
        testInterpreter(() =>
          Effect.succeed(
            AuthoritativePlannedAttemptWorktreeObserved.make({
              observation: PlannedWorktreeReady.make({
                baseSha: plannedAttempt.baseSha,
                branch: plannedAttempt.branch,
                headSha: plannedAttempt.baseSha,
                worktree: plannedAttempt.worktree
              })
            })
          )
        )
      ),
      activeOpportunity("TrackerNotification")
    )
    const firstInterpreter = yield* WorkflowInterpreter.pipe(Effect.provide(firstLayer))
    yield* firstInterpreter.readTaskWorktree(firstOperation)

    const secondOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("active-refresh-failure-after-restart"),
      plannedAttempt,
      predecessorOperationIds: [firstOperation.operationId]
    })
    const failure = new GitTargetLineageReadFailure({
      detail: "target lineage became unreadable after restart",
      plannedBaseSha: plannedAttempt.baseSha,
      target: integrationTarget
    })
    const secondLayer = journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(
        WorkflowInterpreter,
        testInterpreter(unused, () => Effect.fail(failure))
      ),
      activeOpportunity("Timer")
    )
    const secondInterpreter = yield* WorkflowInterpreter.pipe(Effect.provide(secondLayer))
    expect(yield* secondInterpreter.readTargetLineage(secondOperation).pipe(Effect.flip)).toEqual(failure)

    const records = yield* journal.read(runId)
    const intents = records.flatMap(({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" ? [event] : []
    )
    expect(intents.map(({ operation }) => operation.operationId)).toEqual([
      firstOperation.operationId,
      secondOperation.operationId
    ])
    expect(intents.map(({ operation }) => operation.ordinal)).toEqual([1, 2])
    const failureEvent = records.find(({ event }) => event._tag === "ActiveWorkAuthorityRefreshGitReadFailed")?.event
    if (failureEvent?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("missing active-refresh failure after successful intent")
    }
    expect(failureEvent.operation.operationId).toBe(secondOperation.operationId)
    expect(failureEvent.ordinal).toBe(2)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("counts a successful worktree read before an active-refresh lineage failure", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const calls = yield* Ref.make(0)
    const failure = new GitTargetLineageReadFailure({
      detail: "Git target lineage is temporarily unreadable",
      plannedBaseSha: plannedAttempt.baseSha,
      target: integrationTarget
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter(
        () =>
          Effect.succeed(
            AuthoritativePlannedAttemptWorktreeObserved.make({
              observation: PlannedWorktreeReady.make({
                baseSha: plannedAttempt.baseSha,
                branch: plannedAttempt.branch,
                headSha: plannedAttempt.baseSha,
                worktree: plannedAttempt.worktree
              })
            })
          ),
        () => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(failure)))
      )
    )
    const activeLayer = journaledWorkflowInterpreterLayer(runId, base, activeOpportunity("Timer"))
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-lineage-worktree-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("active-refresh-lineage-failure-read"),
      plannedAttempt,
      predecessorOperationIds: [worktreeOperation.operationId]
    })
    const result = yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      yield* interpreter.readTaskWorktree(worktreeOperation)
      return yield* interpreter.readTargetLineage(lineageOperation).pipe(Effect.flip)
    }).pipe(Effect.provide(activeLayer), Effect.provide(memoryJournalTestLayer))

    expect(result).toEqual(failure)
    expect(yield* Ref.get(calls)).toBe(1)
    const recorded = (yield* journal.read(runId)).find(
      ({ event }) => event._tag === "ActiveWorkAuthorityRefreshGitReadFailed"
    )?.event
    if (recorded?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed")
      return yield* Effect.die("missing lineage failure")
    expect(recorded).toMatchObject({
      authority: { attemptId: plannedAttempt.attemptId, runId },
      failure,
      operation: {
        _tag: "ReadTargetLineage",
        integrationTarget,
        operationId: lineageOperation.operationId,
        plannedAttempt
      },
      ordinal: 2,
      source: "Timer"
    })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("assigns a fresh active-refresh ordinal when a later Git read retries with a new operation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const calls = yield* Ref.make(0)
    const failure = new GitWorktreeReadFailure({
      detail: "Git worktree registration is still unreadable",
      worktree: plannedAttempt.worktree
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      testInterpreter(() => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(failure))))
    )
    const activeLayer = journaledWorkflowInterpreterLayer(runId, base, activeOpportunity("TrackerNotification"))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(activeLayer))
    const operations = [1, 2].map((ordinal) =>
      makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(`active-refresh-worktree-retry-${ordinal}`),
        plannedAttempt,
        predecessorOperationIds: []
      })
    )
    for (const operation of operations) {
      expect(yield* interpreter.readTaskWorktree(operation).pipe(Effect.flip)).toEqual(failure)
    }

    const failures = (yield* journal.read(runId)).flatMap(({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" ? [event] : []
    )
    expect(yield* Ref.get(calls)).toBe(2)
    expect(failures.map(({ ordinal }) => ordinal)).toEqual([1, 2])
    expect(failures.map(({ operation }) => operation.operationId)).toEqual(
      operations.map(({ operationId }) => operationId)
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("derives the next active-refresh ordinal from durable history after a fresh interpreter layer", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const failure = new GitWorktreeReadFailure({
      detail: "Git worktree registration remains unreadable after restart",
      worktree: plannedAttempt.worktree
    })
    const operationFor = (operationId: string) =>
      makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(operationId),
        plannedAttempt,
        predecessorOperationIds: []
      })
    const firstOperation = operationFor("active-refresh-restart-first-read")
    const firstInterpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(
        journaledWorkflowInterpreterLayer(
          runId,
          Layer.succeed(
            WorkflowInterpreter,
            testInterpreter(() => Effect.fail(failure))
          ),
          activeOpportunity("TrackerNotification")
        )
      )
    )
    expect(yield* firstInterpreter.readTaskWorktree(firstOperation).pipe(Effect.flip)).toEqual(failure)

    const secondOperation = operationFor("active-refresh-restart-second-read")
    const secondInterpreter = yield* WorkflowInterpreter.pipe(
      Effect.provide(
        journaledWorkflowInterpreterLayer(
          runId,
          Layer.succeed(
            WorkflowInterpreter,
            testInterpreter(() => Effect.fail(failure))
          ),
          activeOpportunity("Timer")
        )
      )
    )
    expect(yield* secondInterpreter.readTaskWorktree(secondOperation).pipe(Effect.flip)).toEqual(failure)

    const failures = (yield* journal.read(runId)).flatMap(({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" ? [event] : []
    )
    expect(failures.map(({ ordinal }) => ordinal)).toEqual([1, 2])
    expect(failures.map(({ operation }) => operation.operationId)).toEqual([
      firstOperation.operationId,
      secondOperation.operationId
    ])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
