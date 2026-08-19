import { Context, Effect, Option } from "effect"
import { InRunJournal } from "../../workflow-journal/store.js"
import {
  AcceptedResultEvidenceUnavailable,
  IntegrationJournalUnavailable,
  IntegrationTargetSelection,
  queueAcceptedResultIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { EvidenceStore } from "../../workflow/protocols/evidence-store.js"

/** Captures optional integration configuration and journal access for process-local fresh stages. */
export const makeIntegrationStageContext = Effect.fn("Workflow.makeIntegrationStageContext")(function* () {
  const ambient = yield* Effect.context<never>()
  const integrationTarget = Context.getOption(ambient, IntegrationTargetSelection)
  const integrationJournal = Context.getOption(ambient, InRunJournal)
  const acceptanceEvidenceStore = Context.getOption(ambient, EvidenceStore)
  const queueAcceptedResult = (...args: Parameters<typeof queueAcceptedResultIntegrationResponsibility>) => {
    const journal = Option.getOrUndefined(integrationJournal)
    const evidenceStore = Option.getOrUndefined(acceptanceEvidenceStore)
    return journal === undefined
      ? Effect.fail(new IntegrationJournalUnavailable({ attemptId: args[0].attemptId, runId: args[0].runId }))
      : evidenceStore === undefined
        ? Effect.fail(
            new AcceptedResultEvidenceUnavailable({
              attemptId: args[0].attemptId,
              detail: "acceptance evidence store is not configured for this run activation",
              reference: args[1].evidenceManifest,
              runId: args[0].runId
            })
          )
        : queueAcceptedResultIntegrationResponsibility(...args).pipe(
            Effect.provideService(InRunJournal, journal),
            Effect.provideService(EvidenceStore, evidenceStore),
            Effect.asVoid
          )
  }
  return { integrationTarget, queueAcceptedResult }
})
