import { GitCommitSha, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import {
  ClaimOwner,
  controlledWorkflowInterpreterLayer,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  workflowInterpreterLayer
} from "@dalph/orchestrator"
import { Layer } from "effect"
import { dryRunPlannedAttemptExecutorLayer } from "./dry-run-planned-attempt-executor.js"

export { workflowInterpreterLayer }

export const dryRunWorkflowInterpreterLayer = Layer.mergeAll(
  controlledWorkflowInterpreterLayer,
  dryRunPlannedAttemptExecutorLayer
)

export const dryRunOperationIdAllocatorLayer = deterministicOperationIdAllocatorLayer("dry-run-operation")

export const dryRunTaskClaimPlannerLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("dry-run"),
  tokenPrefix: "dry-run-claim"
})

export const dryRunPlannedTaskAttemptLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  executor: TaskExecutorLocator.make("executor:dry-run"),
  runId: RunId.make("dry-run"),
  worktreeRoot: WorktreeLocator.make("/dalph/dry-run")
})
