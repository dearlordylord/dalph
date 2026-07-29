import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  deterministicTestWorkflowInterpreterLayer,
  emptyRunRecoveryActivationLayer,
  makeDryRunWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer
} from "@dalph/orchestrator"
import { Layer } from "effect"

export {
  deterministicTestWorkflowInterpreterLayer,
  makeDryRunWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer
}

export const dryRunWorkflowInterpreterLayer = Layer.merge(
  makeDryRunWorkflowInterpreterLayer(),
  emptyRunRecoveryActivationLayer.pipe(Layer.provide(controlledFakePlannedAttemptExecutorLayer))
)
