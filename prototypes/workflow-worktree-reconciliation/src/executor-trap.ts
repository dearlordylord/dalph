import { open } from "node:fs/promises"
import { join } from "node:path"
import { PlannedAttemptExecutor } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import {
  ExecutorBoundaryContact,
  fixture,
  type WorktreeProcessInstance
} from "./contracts.ts"

const executorBoundaryLedgerPath = (workspace: string): string => join(workspace, "executor-boundary-contacts.ndjson")

/** The trap is the only writer for executor-boundary contacts and is consumed by the application seam below. */
const recordExecutorBoundaryContact = async (
  workspace: string,
  processInstance: WorktreeProcessInstance,
  method: "project" | "requestSuspension" | "startOrContinue",
  runId: typeof fixture.runId
): Promise<void> => {
  const file = await open(executorBoundaryLedgerPath(workspace), "a")
  try {
    await file.appendFile(
      `${JSON.stringify(
        ExecutorBoundaryContact.make({
          method,
          operationId: fixture.operationId,
          processInstance,
          runId
        })
      )}\n`,
      "utf8"
    )
    await file.sync()
  } finally {
    await file.close()
  }
}

const trap = (
  workspace: string,
  processInstance: WorktreeProcessInstance,
  method: "project" | "requestSuspension" | "startOrContinue",
  runId: typeof fixture.runId
): Effect.Effect<never> =>
  Effect.promise(() => recordExecutorBoundaryContact(workspace, processInstance, method, runId)).pipe(
    Effect.orDie,
    Effect.flatMap(() => Effect.die(`unexpected executor boundary contact: ${method}`))
  )

/** Supplies a loud process-local trap at the executor composition seam without implementing an executor. */
export const executorBoundaryTrapLayer = (
  workspace: string,
  processInstance: WorktreeProcessInstance
): Layer.Layer<PlannedAttemptExecutor> =>
  Layer.succeed(
    PlannedAttemptExecutor,
    PlannedAttemptExecutor.of({
      project: (correlation) => trap(workspace, processInstance, "project", correlation.runId),
      requestSuspension: (plannedAttempt) =>
        trap(workspace, processInstance, "requestSuspension", plannedAttempt.runId),
      startOrContinue: (request) => trap(workspace, processInstance, "startOrContinue", request.plannedAttempt.runId)
    })
  )
