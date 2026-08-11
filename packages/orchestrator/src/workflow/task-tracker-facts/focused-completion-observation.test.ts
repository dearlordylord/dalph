import { Schema } from "effect"
import { expect, it } from "vitest"
import { OperationId } from "../identity.js"
import { integrationFinalityFixture as fixture } from "../protocols/integration-finality/fixtures.js"
import { FocusedTaskCompletionFactsObserved } from "./focused-completion-observation.js"

it("rejects a focused completion observation with a foreign read identity", () => {
  const decoded = Schema.decodeUnknownExit(FocusedTaskCompletionFactsObserved)({
    ...fixture.focusedSuccessFactsEvent.observation,
    operationId: OperationId.make("foreign-focused-completion-read")
  })

  expect(decoded._tag).toBe("Failure")
})

it("rejects focused completion facts that do not bind the outer read identity", () => {
  const decoded = Schema.decodeUnknownExit(FocusedTaskCompletionFactsObserved)({
    ...fixture.focusedSuccessFactsEvent.observation,
    facts: {
      ...fixture.focusedSuccessFactsEvent.observation.facts,
      operationId: OperationId.make("foreign-focused-completion-facts")
    }
  })

  expect(decoded._tag).toBe("Failure")
})
