import { Context, Effect, Option } from "effect"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  IntegrationJournalUnavailable,
  IntegrationTargetSelection,
  queueAcceptedResultIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"

/** Captures optional integration configuration and journal access for process-local fresh stages. */
export const makeIntegrationStageContext = Effect.fn("Workflow.makeIntegrationStageContext")(function* () {
  const ambient = yield* Effect.context<never>()
  const integrationTarget = Context.getOption(ambient, IntegrationTargetSelection)
  const integrationJournal = Context.getOption(ambient, JournalStore)
  const queueAcceptedResult = (...args: Parameters<typeof queueAcceptedResultIntegrationResponsibility>) => {
    const journal = Option.getOrUndefined(integrationJournal)
    return journal === undefined
      ? Effect.fail(new IntegrationJournalUnavailable({ attemptId: args[0].attemptId, runId: args[0].runId }))
      : queueAcceptedResultIntegrationResponsibility(...args).pipe(
          Effect.provideService(JournalStore, journal),
          Effect.asVoid
        )
  }
  return { integrationTarget, queueAcceptedResult }
})
