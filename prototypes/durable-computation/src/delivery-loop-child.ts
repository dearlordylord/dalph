import { DeliveryLoopChildMessage } from "./contracts.ts"
import { runEffectWorkflowDeliveryLoop, runJournalDeliveryLoop } from "./delivery-loop.ts"

const argumentValue = (name: string): string => {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (value === undefined) throw new Error(`missing ${name}`)
  return value
}

const emit = (message: DeliveryLoopChildMessage): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const waitForever = (): Promise<never> => new Promise(() => undefined)

const main = async (): Promise<void> => {
  const actionCount = Number(argumentValue("--action-count"))
  if (actionCount !== 1 && actionCount !== 2) throw new Error(`unsupported action count ${actionCount}`)
  const activityIdentityMode = argumentValue("--activity-identity-mode")
  if (activityIdentityMode !== "ExactOperationId" && activityIdentityMode !== "Generic") {
    throw new Error(`unsupported Activity identity mode ${activityIdentityMode}`)
  }
  const publicationMode = argumentValue("--publication-mode")
  if (publicationMode !== "Publish" && publicationMode !== "Suppress") {
    throw new Error(`unsupported publication mode ${publicationMode}`)
  }
  const processInstance = argumentValue("--process-instance")
  const adapter = argumentValue("--adapter")
  if (adapter !== "effect-workflow-v1" && adapter !== "journal-baseline") {
    throw new Error(`unsupported delivery-loop adapter ${adapter}`)
  }
  const workspace = argumentValue("--workspace")
  const runId = "run-233-delivery-loop-0001"
  const run = adapter === "journal-baseline" ? runJournalDeliveryLoop : runEffectWorkflowDeliveryLoop
  await run({
    actionCount,
    adapter,
    activityIdentityMode,
    onExecutionStored: async (executionId) => {
      emit(
        DeliveryLoopChildMessage.cases.DeliveryLoopChildReady.make({
          attemptIds: [],
          executionId,
          plannedBaseSha: "d4128e475ddfdda6970ac7951ce7696d7736685a",
          runId
        })
      )
    },
    onFault: async () => {
      emit(DeliveryLoopChildMessage.cases.DeliveryLoopFaultReached.make({ runId }))
      return waitForever()
    },
    processInstance,
    publicationMode,
    workspace
  })
  emit(DeliveryLoopChildMessage.cases.DeliveryLoopCompleted.make({ runId }))
}

await main().catch((cause: unknown) => {
  emit(
    DeliveryLoopChildMessage.cases.DeliveryLoopProtocolFailure.make({
      detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    })
  )
  process.exitCode = 1
})
