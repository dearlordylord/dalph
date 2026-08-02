import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  emptyRunRecoveryProjectionLayer,
  makeDryRunWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer
} from "@dalph/orchestrator"
import { Layer } from "effect"

export { makeLiveWorkflowInterpreterLayer }

export const dryRunWorkflowInterpreterLayer = Layer.mergeAll(
  makeDryRunWorkflowInterpreterLayer(),
  controlledFakePlannedAttemptExecutorLayer,
  emptyRunRecoveryProjectionLayer
)
