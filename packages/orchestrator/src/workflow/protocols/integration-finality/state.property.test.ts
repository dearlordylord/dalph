import * as fc from "fast-check"
import { expect, it } from "vitest"
import { TaskRevision } from "@dalph/contracts"
import { completionTaskClaimEquals } from "./events.js"
import { deriveIntegrationFinalityStateFor } from "./state.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"

const nonFixtureRevision = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,24}$/)
  .filter((revision) => revision !== "planned-task-revision")

it("keeps every generated planned-revision mutation foreign to exact completion evidence", () => {
  fc.assert(
    fc.property(nonFixtureRevision, (revision) => {
      const altered = {
        ...fixture.claim,
        plannedAttempt: { ...fixture.plannedAttempt, taskRevision: TaskRevision.make(revision) }
      }
      expect(completionTaskClaimEquals(fixture.claim, altered)).toBe(false)
      expect(deriveIntegrationFinalityStateFor([], altered)).toBeUndefined()
    })
  )
})
