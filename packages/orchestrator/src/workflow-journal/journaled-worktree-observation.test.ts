import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
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
  WorkflowInterpreter,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation
} from "../workflow/registry/operation.js"
import { AttemptWorktreeLost } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { legacyMemoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

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

const journaledTestLayer = (base: Layer.Layer<WorkflowInterpreter>) =>
  journaledWorkflowInterpreterLayer(runId, base).pipe(Layer.provide(legacyMemoryJournalStoreLayer))

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
  }).pipe(Effect.provide(replayingLostWorktreeLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(retryingLostWorktreeLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(retryingTargetLineageLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)
