import { GitCommitSha, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import {
  AttemptBasePolicy,
  ClaimOwner,
  controlledWorkflowInterpreterLayer,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  memoryJournalTestLayer,
  workflowInterpreterLayer
} from "@dalph/orchestrator"
import { Layer } from "effect"
import { dryRunPlannedAttemptExecutorLayer } from "./dry-run-planned-attempt-executor.js"

export { workflowInterpreterLayer }

export const dryRunWorkflowInterpreterLayer = Layer.mergeAll(
  controlledWorkflowInterpreterLayer,
  dryRunPlannedAttemptExecutorLayer,
  memoryJournalTestLayer
)

export const dryRunOperationIdAllocatorLayer = deterministicOperationIdAllocatorLayer("dry-run-operation")

export const dryRunTaskClaimPlannerLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("dry-run"),
  tokenPrefix: "dry-run-claim"
})

/** The fresh dry Run and its deterministic planner share this controlled Base. */
export const dryRunAttemptBasePolicy = AttemptBasePolicy.cases.ExplicitFixedBase.make({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000")
})

export const dryRunPlannedTaskAttemptLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: dryRunAttemptBasePolicy.baseSha,
  executor: TaskExecutorLocator.make("executor:dry-run"),
  runId: RunId.make("dry-run"),
  worktreeRoot: WorktreeLocator.make("/dalph/dry-run")
})
