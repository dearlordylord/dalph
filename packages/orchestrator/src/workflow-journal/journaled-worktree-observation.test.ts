import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
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
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref } from "effect"
import { expect } from "vitest"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../authorities/git/worktree.js"
import { GitTargetLineageReadFailure } from "../authorities/git/target-lineage.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../control/policy.js"
import { OperationId } from "../workflow/identity.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  InterruptibleWorkflowBoundaryIntent,
  WorkflowInterpreter,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import { AttemptWorktreeLost } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation
} from "../workflow/registry/operation.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import { memoryJournalTestLayer } from "./adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "./adapters/sqlite-store.js"
import { JournalDatabaseLocator } from "./identity.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { InRunJournal, JournalStore } from "./store.js"

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
const operation = makeTaskWorktreeObservationOperation({
  operationId: OperationId.make("journaled-worktree-observation-read"),
  plannedAttempt,
  predecessorOperationIds: []
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/journaled-target-lineage.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const journaledTestLayer = (
  readTaskWorktree: WorkflowInterpreterService["readTaskWorktree"],
  readTargetLineage: WorkflowInterpreterService["readTargetLineage"] = unused
) =>
  journaledWorkflowInterpreterLayer(
    runId,
    Layer.succeed(WorkflowInterpreter, testInterpreter(readTaskWorktree, readTargetLineage))
  ).pipe(Layer.provide(memoryJournalTestLayer))

const runWithJournal = <A, E>(effect: Effect.Effect<A, E, WorkflowInterpreter | JournalStore>) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    return yield* effect
  })

it.effect("records exact worktree loss and replays it without another Git read", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const layer = journaledTestLayer(() =>
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
    yield* runWithJournal(
      Effect.gen(function* () {
        const interpreter = yield* WorkflowInterpreter
        yield* interpreter.readTaskWorktree(operation)
        yield* interpreter.readTaskWorktree(operation)
        expect(yield* Ref.get(reads)).toBe(1)
        const journal = yield* JournalStore
        expect(
          (yield* journal.read(runId))
            .map(({ event }) => event._tag)
            .filter((tag) => tag === "GitReadIntentRecorded" || tag === "PlannedAttemptWorktreeObserved")
        ).toEqual(["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved"])
      })
    ).pipe(Effect.provide(layer), Effect.provide(memoryJournalTestLayer))
  })
)

it.effect("reopens persisted Git read intent in a fresh application and records the exact ready observation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-worktree-read-recovery-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const calls = yield* Ref.make(0)
      const firstCallStarted = yield* Deferred.make<void>()

      yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(
            runId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
          )
          const provider = Layer.succeed(
            WorkflowInterpreter,
            testInterpreter(() =>
              Ref.update(calls, (count) => count + 1).pipe(
                Effect.andThen(Deferred.succeed(firstCallStarted, undefined)),
                Effect.andThen(Effect.never)
              )
            )
          )
          const application = journaledWorkflowInterpreterLayer(runId, provider).pipe(
            Layer.provide(Layer.succeed(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read })))
          )
          const interpreter = Context.get(yield* Layer.build(application), WorkflowInterpreter)
          const lifecycle = yield* makeApplicationExitLifecycle()
          const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
          if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong first owner kind")
          const inFlight = yield* interpreter.readTaskWorktree(operation, Effect.void, owner).pipe(Effect.forkChild)
          yield* Deferred.await(firstCallStarted)
          yield* lifecycle.requestExit
          expect((yield* Fiber.await(inFlight))._tag).toBe("Failure")
          expect(yield* owner.snapshot).toEqual({
            _tag: "RecoverableAmbiguity",
            intent: InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
              family: "Git",
              operationId: operation.operationId
            })
          })
          yield* owner.release
          expect(
            (yield* journal.read(runId)).filter(({ event }) => event._tag === "GitReadIntentRecorded")
          ).toHaveLength(1)
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )

      const records = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.readRunForRecovery(runId, target)
          const ready = PlannedWorktreeReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha,
            worktree: plannedAttempt.worktree
          })
          const provider = Layer.succeed(
            WorkflowInterpreter,
            testInterpreter(() =>
              Ref.update(calls, (count) => count + 1).pipe(
                Effect.as(AuthoritativePlannedAttemptWorktreeObserved.make({ observation: ready }))
              )
            )
          )
          const application = journaledWorkflowInterpreterLayer(runId, provider).pipe(
            Layer.provide(Layer.succeed(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read })))
          )
          const interpreter = Context.get(yield* Layer.build(application), WorkflowInterpreter)
          const lifecycle = yield* makeApplicationExitLifecycle()
          const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
          if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong reopened owner kind")
          expect((yield* interpreter.readTaskWorktree(operation, Effect.void, owner)).observation).toEqual(ready)
          expect(yield* owner.snapshot).toMatchObject({
            _tag: "BoundaryResultRecorded",
            intent: InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
              family: "Git",
              operationId: operation.operationId
            })
          })
          yield* owner.release
          return yield* journal.read(runId)
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )

      expect(yield* Ref.get(calls)).toBe(2)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "GitReadIntentRecorded"
            ? [event.operation.operationId]
            : event._tag === "PlannedAttemptWorktreeObserved"
              ? [event.operationId]
              : []
        )
      ).toEqual([operation.operationId, operation.operationId])
      expect(
        records.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptWorktreeObserved" && event.observation._tag === "PlannedWorktreeReady"
        )
      ).toHaveLength(1)
    }).pipe(Effect.provide(nodePathAndFileSystemLayer))
  )
)

it.effect("retains the ready worktree while retrying a failed target-lineage read with the same identity", () =>
  Effect.gen(function* () {
    const lineageReads = yield* Ref.make(0)
    const layer = journaledTestLayer(
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
    yield* runWithJournal(
      Effect.gen(function* () {
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
        expect(yield* Ref.get(lineageReads)).toBe(2)
        const journal = yield* JournalStore
        expect(
          (yield* journal.read(runId))
            .filter(
              ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
            )
            .map(({ event }) => (event._tag === "GitReadIntentRecorded" ? event.operation.operationId : undefined))
        ).toEqual([lineageOperation.operationId])
      })
    ).pipe(Effect.provide(layer), Effect.provide(memoryJournalTestLayer))
  })
)

it.effect("ordinary typed Git failure leaves its intent unsettled and rereads with the same identity", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0)
    const layer = journaledTestLayer(() =>
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
    yield* runWithJournal(
      Effect.gen(function* () {
        const interpreter = yield* WorkflowInterpreter
        const journal = yield* JournalStore
        expect((yield* interpreter.readTaskWorktree(operation).pipe(Effect.flip))._tag).toBe("GitWorktreeReadFailure")
        expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "GitReadIntentRecorded")).toHaveLength(
          1
        )
        yield* interpreter.readTaskWorktree(operation)
        expect(yield* Ref.get(reads)).toBe(2)
        const records = (yield* journal.read(runId)).filter(
          ({ event }) => event._tag === "GitReadIntentRecorded" || event._tag === "PlannedAttemptWorktreeObserved"
        )
        expect(records).toHaveLength(2)
        const [intentRecord, observationRecord] = records
        expect(intentRecord?.event._tag).toBe("GitReadIntentRecorded")
        expect(observationRecord?.event._tag).toBe("PlannedAttemptWorktreeObserved")
        if (intentRecord?.event._tag !== "GitReadIntentRecorded") return expect.fail("ordinary intent required")
        if (observationRecord?.event._tag !== "PlannedAttemptWorktreeObserved") {
          return expect.fail("ordinary observation required")
        }
        expect([intentRecord.event.operation.operationId, observationRecord.event.operationId]).toEqual([
          operation.operationId,
          operation.operationId
        ])
      })
    ).pipe(Effect.provide(layer), Effect.provide(memoryJournalTestLayer))
  })
)
