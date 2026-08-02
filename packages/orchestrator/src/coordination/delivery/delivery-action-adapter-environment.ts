import type { PlannedAttemptExecutor } from "@dalph/contracts"
import type { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import type { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import type { InRunJournal } from "../../workflow-journal/store.js"

/** Services captured once by the closed executor and interpreted only by route-specific leaves. */
export type DeliveryActionAdapterEnvironment =
  | InRunJournal
  | PlannedAttemptExecutor
  | TaskClaimAcquisitionPlanner
  | WorkflowInterpreter
  | WorkflowTrace
