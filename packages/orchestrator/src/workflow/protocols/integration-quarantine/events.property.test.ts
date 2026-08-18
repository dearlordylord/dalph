import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import fc from "fast-check"
import { expect } from "vitest"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId
} from "./events.js"
import { IntegratorSessionId } from "../integrator/events.js"

const runId = RunId.make("integration-quarantine-events-property-run")
const sessionId = IntegratorSessionId.make("integration-quarantine-events-property-session")

it.effect("round-trips generated Retry and FullRerun direction events through the closed journal union", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.constantFrom<"Retry" | "FullRerun">("Retry", "FullRerun"), async (direction) => {
        const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
          direction,
          quarantineAt: JournalPosition.make(9),
          sessionId
        })
        const event = IntegrationQuarantineDirectionAppliedEvent.make({
          fingerprint,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: `property-${direction}`, runId }),
          version: workflowJournalEventVersion
        })
        await expect(Effect.runPromise(decodeJournalEvent(encodeJournalEvent(event)))).resolves.toEqual(event)
      }),
      { numRuns: 20 }
    )
  )
)
