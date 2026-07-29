import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer, Schema } from "effect"
import { CoordinatorOwnership } from "./coordinator-lock.js"
import { type GitCommonDirectoryTarget, RunId } from "./domain.js"
import { nodeGitCommandLayer } from "./git-command.js"
import { GitWorktree, runGitWorktreeReconciliation } from "./git-worktree.js"
import { JournalBoundaryDecodeIssue } from "./journal-recovery-model.js"
import { JournalStore } from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import {
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  productionCoordinatorOwnershipLayer
} from "./live-task-work-start.js"
import {
  hasUnfinishedManagedRunResponsibility,
  makeManagedRecoveryActivation,
  ManagedRecoveryActivation
} from "./managed-activation.js"
import {
  DuplicateUnfinishedTaskAttemptIssue,
  ManagedHistoryIdentityIssue,
  ManagedHistorySemanticIssue
} from "./managed-history-result.js"
import { reduceManagedHistory } from "./managed-history.js"
import { nodeGitWorktreeLayer } from "./node-git-worktree.js"
import { controlledFakePlannedAttemptExecutorLayer, PlannedAttemptExecutor } from "./planned-attempt-executor.js"
import {
  livePlannedAttemptRecoveryAuthorityLayer,
  PlannedAttemptRecoveryAuthority
} from "./planned-attempt-recovery-authority.js"
import { productionJournalStoreLayer } from "./sqlite-journal-store.js"
import type { TrackerMutation } from "./tracker-mutation.js"
import { makeLiveWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import { AuthoritativeTaskWorktreeReady, WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

export const StartupRecoveryIssue = Schema.Union([
  DuplicateUnfinishedTaskAttemptIssue,
  JournalBoundaryDecodeIssue,
  ManagedHistoryIdentityIssue,
  ManagedHistorySemanticIssue,
  Schema.TaggedStruct("OtherUnfinishedManagedRunIssue", {
    requestedRunId: RunId,
    unfinishedRunId: RunId
  })
])
export type StartupRecoveryIssue = typeof StartupRecoveryIssue.Type

/** Startup found preserved history that cannot be reconstructed safely. */
export class StartupRecoveryBlocked extends Schema.TaggedErrorClass<StartupRecoveryBlocked>()(
  "StartupRecoveryBlocked",
  { issues: Schema.Array(StartupRecoveryIssue) }
) {}

/**
 * Composes the production-shaped milestone with live tracker/Git boundaries
 * and one same-process coarse fake executor.
 */
export const productionWorkflowInterpreterLayer = <
  TrackerError,
  TrackerRequirements
>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  trackerMutationAdapterLayer: Layer.Layer<
    TrackerMutation,
    TrackerError,
    TrackerRequirements
  >
) => {
  const ownershipLayer = productionCoordinatorOwnershipLayer(target)
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(
    trackerMutationAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(
    nodeGitWorktreeLayer(target).pipe(
      Layer.provide(nodeGitCommandLayer),
      Layer.provide(NodeServices.layer)
    )
  ).pipe(Layer.provide(ownershipLayer))
  const journalLayer = productionJournalStoreLayer.pipe(
    Layer.provide(ownershipLayer)
  )
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer(
    "ProductionBase"
  ).pipe(Layer.provide(trackerMutationLayer))
  const baseInterpreterLayer = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const gitWorktree = yield* GitWorktree
      return WorkflowInterpreter.of({
        ...interpreter,
        reconcileTaskWorktree: (operation) =>
          runGitWorktreeReconciliation(
            gitWorktree,
            operation.plannedAttempt
          ).pipe(
            Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
          )
      })
    })
  ).pipe(
    Layer.provide(liveInterpreterLayer),
    Layer.provide(gitWorktreeLayer)
  )
  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    baseInterpreterLayer
  ).pipe(Layer.provide(journalLayer))
  const recoveryAuthorityLayer = livePlannedAttemptRecoveryAuthorityLayer.pipe(
    Layer.provide(gitWorktreeLayer),
    Layer.provide(trackerMutationLayer),
    Layer.provide(journalLayer)
  )

  return Layer.effectContext(
    Effect.gen(function*() {
      yield* CoordinatorOwnership
      const journal = yield* JournalStore
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const recoveryAuthority = yield* PlannedAttemptRecoveryAuthority
      const trace = yield* WorkflowTrace
      const scan = yield* journal.scan()
      const reductions = scan.runs.map((history) => reduceManagedHistory(history.runId, history.records))
      const issues = [
        ...scan.issues,
        ...reductions.flatMap((reduction) => {
          return reduction._tag === "InvalidManagedHistory" ? reduction.issues : []
        })
      ]
      if (issues.length > 0) {
        return yield* new StartupRecoveryBlocked({ issues })
      }
      const otherUnfinishedRun = reductions.find((reduction) =>
        reduction._tag === "ValidManagedHistory"
        && reduction.runId !== runId
        && hasUnfinishedManagedRunResponsibility(reduction.managedRun)
      )
      if (
        otherUnfinishedRun?._tag === "ValidManagedHistory"
      ) {
        return yield* new StartupRecoveryBlocked({
          issues: [{
            _tag: "OtherUnfinishedManagedRunIssue",
            requestedRunId: runId,
            unfinishedRunId: otherUnfinishedRun.runId
          }]
        })
      }
      const recovery = yield* makeManagedRecoveryActivation(runId)
      return Context.empty().pipe(
        Context.add(WorkflowInterpreter, interpreter),
        Context.add(ManagedRecoveryActivation, recovery),
        Context.add(PlannedAttemptExecutor, executor),
        Context.add(JournalStore, journal),
        Context.add(PlannedAttemptRecoveryAuthority, recoveryAuthority),
        Context.add(WorkflowTrace, trace)
      )
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(recoveryAuthorityLayer),
    Layer.provide(controlledFakePlannedAttemptExecutorLayer),
    Layer.provide(journalLayer),
    Layer.provide(ownershipLayer)
  )
}
