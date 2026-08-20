import { mkdir } from "node:fs/promises"
import { Effect, Schema } from "effect"
import { establishJournal } from "./journal.ts"
import { runWorkflowReconciliation } from "./workflow-reconciliation.ts"
import { ChildMessage, FaultName, fixture, WorktreeProcessInstance, WorktreeScenario } from "./contracts.ts"

const argumentValue = (name: string): string => {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (value === undefined) throw new Error(`missing ${name}`)
  return value
}

const emit = (message: ChildMessage): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const waitForever = (): Promise<never> => new Promise(() => undefined)

const main = async (): Promise<void> => {
  const scenario = Schema.decodeUnknownSync(WorktreeScenario)(argumentValue("--scenario"))
  const publicationMode = argumentValue("--publication") === "Suppress" ? "Suppress" : "Publish"
  const processInstance = WorktreeProcessInstance.make(argumentValue("--process-instance"))
  const workspace = argumentValue("--workspace")
  const runId = argumentValue("--run-id")
  if (runId !== fixture.runId) throw new Error(`unexpected Run ID ${runId}`)
  await mkdir(workspace, { recursive: true })
  await Effect.runPromise(establishJournal(workspace))
  const decision = await runWorkflowReconciliation({
    onReady: async (executionId) => {
      emit(
        ChildMessage.cases.ChildReady.make({
          activityName: fixture.activityName,
          attemptId: fixture.attemptId,
          branch: fixture.branch,
          executionId,
          operationId: fixture.operationId,
          plannedBaseSha: fixture.baseSha,
          runId: fixture.runId,
          worktree: fixture.worktree
        })
      )
    },
    onFault: async (fault: FaultName) => {
      emit(ChildMessage.cases.FaultReached.make({ fault, runId: fixture.runId }))
      return waitForever()
    },
    onPublicationSuppressed: async () => {
      emit(ChildMessage.cases.PublicationSuppressed.make({ runId: fixture.runId }))
      return waitForever()
    },
    processInstance,
    publicationMode,
    scenario,
    workspace
  })
  emit(ChildMessage.cases.Completed.make({ decision, runId: fixture.runId }))
}

await main().catch((cause: unknown) => {
  emit(
    ChildMessage.cases.ProtocolFailure.make({
      detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    })
  )
  process.exitCode = 1
})
