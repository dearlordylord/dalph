import type { TaskId } from "@dalph/contracts"
import type { DeliveryStatusSubject } from "./delivery-status-model.js"

/** Converts a Run-wide status read to its exact task subject without adding authority. */
export const taskStatusSubject = (
  subject: DeliveryStatusSubject,
  taskId: TaskId
): Extract<DeliveryStatusSubject, { readonly _tag: "Task" }> =>
  subject._tag === "Task" ? subject : { _tag: "Task", runId: subject.runId, taskId }
