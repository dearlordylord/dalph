import { AttemptId, GitCommitSha, type RunId, TaskBranchRef, TaskId, WorktreeLocator } from "@dalph/contracts"
import {
  currentSignalOf,
  DeliveryDiagnostics,
  initialRunPolicyRevision,
  JournalPosition,
  OperationId,
  RunControlPolicy,
  TaskWorkCapacity,
  type TaskDagSnapshot
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { deliveryRuntime } from "../../orchestrator/src/coordination/delivery/delivery-runtime-adapter.js"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer
} from "../../orchestrator/src/coordination/delivery/in-memory-relations.js"
import { type DeliveryRelationInputBundle } from "../../orchestrator/src/coordination/delivery/relations.js"
import { makeFreshTaskAdmissionTestBasis } from "../../orchestrator/test/support/fresh-task-admission.js"
import { makeTestJournaledTrackerGraphObservation } from "../../orchestrator/test/journaled-graph-observation.js"

const graphObservationPosition = 3
const gitShaLength = 40

/** A passive, complete runtime publication evaluated through the real delivery relations. */
export const runningHostPageObservation = Effect.fn("RunningHostTest.pageObservation")(function* (
  runId: RunId,
  snapshot: TaskDagSnapshot,
  options: { readonly paused?: boolean; readonly phase?: "Executing" | "Delivered" } = {}
) {
  const policy = RunControlPolicy.make({
    revision: initialRunPolicyRevision,
    taskExecutionCapacity: TaskWorkCapacity.make(1)
  })
  const observation = makeTestJournaledTrackerGraphObservation({
    operationId: OperationId.make(`page-read:${snapshot.revision}`),
    recordedAt: JournalPosition.make(graphObservationPosition),
    snapshot
  })
  const bundle: DeliveryRelationInputBundle = {
    publication: { exactEvidence: [], graph: { _tag: "GraphEstablished", observation }, policy },
    actionInputs: {
      freshTaskCandidates: [],
      proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
      reflectionProposals: [],
      trackerGraphProposals: [],
      runtimeFacts: {
        runId,
        acceptedAt: observation.recordedAt,
        acceptedFactPublication: { _tag: "WorkflowProgress" },
        cancellationApplied: false,
        pauseCoverage: {
          _tag: "PauseCoverageGraphNotEstablished",
          applied: { run: { _tag: options.paused ? "RunPaused" : "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
        },
        quiescence: options.paused
          ? { _tag: "QuiescencePassive", reason: "RunPaused" }
          : { _tag: "TrackerReconfirmationAllowed" },
        taskWork: makeFreshTaskAdmissionTestBasis({ runId, capacity: policy.taskExecutionCapacity })
      }
    }
  }
  const source = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({ ...deterministicDeliveryRuntimeSupport(policy), coherent: currentSignalOf(bundle) })
    )
  )
  const evaluation = yield* source.get
  const diagnostics = DeliveryDiagnostics.make({
    runId,
    trackerWait: { _tag: "None" },
    tasks:
      options.phase === undefined
        ? []
        : [
            {
              taskId: TaskId.make("root"),
              identity: { _tag: "Unavailable" },
              phase: options.phase,
              lastSubstantiveAt: observation.recordedAt,
              retainedAttempt: {
                attemptId: AttemptId.make("page-attempt"),
                runId,
                taskId: TaskId.make("root"),
                baseSha: GitCommitSha.make("a".repeat(gitShaLength)),
                branch: TaskBranchRef.make("refs/heads/page"),
                worktree: WorktreeLocator.make("/fixture/page")
              },
              candidateHead: { _tag: "Unavailable" },
              failure: { _tag: "None" },
              recovery: { _tag: "NotApplicable" }
            }
          ]
  })
  return { _tag: "Ready" as const, evaluation: { ...evaluation, diagnostics }, liveOwners: [] }
})
