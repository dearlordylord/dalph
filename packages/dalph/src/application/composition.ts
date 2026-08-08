import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import { controlledWorkflowInterpreterLayer, workflowInterpreterLayer } from "@dalph/orchestrator"
import { Layer } from "effect"

export { workflowInterpreterLayer }

export const dryRunWorkflowInterpreterLayer = Layer.mergeAll(
  controlledWorkflowInterpreterLayer,
  controlledFakePlannedAttemptExecutorLayer
)
