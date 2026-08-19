import { Schema } from "effect"
import { runJournalBaseline } from "./adapters/journal-baseline.ts"
import { runEffectWorkflow } from "./adapters/effect-workflow.ts"
import { AdapterName, ChildMessage, FaultPoint, fixture } from "./contracts.ts"

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
  const adapter = Schema.decodeUnknownSync(AdapterName)(argumentValue("--adapter"))
  const faultPoint = Schema.decodeUnknownSync(FaultPoint)(argumentValue("--fault-point"))
  const processInstance = argumentValue("--process-instance")
  const runId = argumentValue("--run-id")
  const workspace = argumentValue("--workspace")
  if (runId !== fixture.runId) throw new Error(`unexpected Run ID ${runId}`)

  const onExecutionStored = async (executionId: string, attemptIds: ReadonlyArray<string>): Promise<void> => {
    emit(
      ChildMessage.cases.ChildReady.make({
        adapter,
        attemptIds,
        executionId,
        plannedBaseSha: fixture.plannedBaseSha,
        runId
      })
    )
  }
  const onFault = async (reached: FaultPoint): Promise<never> => {
    emit(ChildMessage.cases.FaultReached.make({ faultPoint: reached, runId }))
    return waitForever()
  }
  const runAdapter = adapter === "journal-baseline" ? runJournalBaseline : runEffectWorkflow
  const recoveredDecision = await runAdapter({
    adapter,
    faultPoint,
    onExecutionStored,
    onFault,
    processInstance,
    workspace
  })
  if (typeof recoveredDecision === "object") {
    emit(
      ChildMessage.cases.ExecutionFailedClosed.make({
        adapter,
        detail: `unfinished ${recoveredDecision.found} execution cannot reinterpret ${recoveredDecision.changedStep} as ${recoveredDecision.requested}`,
        runId
      })
    )
    return
  }
  emit(ChildMessage.cases.ExecutionCompleted.make({ adapter, recoveredDecision, runId }))
}

await main().catch((cause: unknown) => {
  emit(
    ChildMessage.cases.ChildProtocolFailure.make({
      detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    })
  )
  process.exitCode = 1
})
