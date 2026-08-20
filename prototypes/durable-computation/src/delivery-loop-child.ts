import {
  DeliveryLoopChildMessage,
  DeliveryLoopExecutionId,
  DeliveryLoopProcessInstance,
  deliveryLoopFixture,
  fixture
} from "./contracts.ts"
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
  const processInstance = DeliveryLoopProcessInstance.make(argumentValue("--process-instance"))
  const adapter = argumentValue("--adapter")
  if (adapter !== "effect-workflow-v1" && adapter !== "journal-baseline") {
    throw new Error(`unsupported delivery-loop adapter ${adapter}`)
  }
  const workspace = argumentValue("--workspace")
  const runId = deliveryLoopFixture.runId
  const run = adapter === "journal-baseline" ? runJournalDeliveryLoop : runEffectWorkflowDeliveryLoop
  const currentTaskDecision = await run({
    actionCount,
    adapter,
    activityIdentityMode,
    onExecutionStored: async (executionId) => {
      emit(
        DeliveryLoopChildMessage.cases.DeliveryLoopChildReady.make({
          attemptIds: [],
          executionId: DeliveryLoopExecutionId.make(executionId),
          plannedBaseSha: deliveryLoopFixture.plannedBaseSha,
          reservedAttemptId: fixture.attemptId,
          runId
        })
      )
    },
    onFault: async () => {
      emit(DeliveryLoopChildMessage.cases.DeliveryLoopFaultReached.make({ runId }))
      return waitForever()
    },
    onPublicationSuppressed: async () => {
      emit(DeliveryLoopChildMessage.cases.DeliveryLoopPublicationSuppressed.make({ runId }))
      return waitForever()
    },
    processInstance,
    publicationMode,
    workspace
  })
  emit(DeliveryLoopChildMessage.cases.DeliveryLoopCompleted.make({ currentTaskDecision, runId }))
}

await main().catch((cause: unknown) => {
  emit(
    DeliveryLoopChildMessage.cases.DeliveryLoopProtocolFailure.make({
      detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    })
  )
  process.exitCode = 1
})
