import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  emptyRunRecoveryActivationLayer,
  makeDryRunWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer
} from "@dalph/orchestrator"
import { Layer } from "effect"

export { makeLiveWorkflowInterpreterLayer }

export const dryRunWorkflowInterpreterLayer = Layer.merge(
  makeDryRunWorkflowInterpreterLayer(),
  emptyRunRecoveryActivationLayer.pipe(Layer.provide(controlledFakePlannedAttemptExecutorLayer))
)
