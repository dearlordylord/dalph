import { makeTaskWorkSpecification } from "@dalph/contracts"
import { expect, it } from "vitest"
import { makeAcceptedIntegrationHistory } from "../../../test/support/accepted-integration-history.js"
import { integrationFinalityFixture as fixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import { journaledIntegrationEvidenceOf } from "./delivery-evidence.js"

const specification = makeTaskWorkSpecification({
  taskId: fixture.taskId,
  title: "Integration evidence",
  body: "Cache immutable evidence only"
})
const history = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: fixture.target
})

it("reuses delivery evidence for the same immutable journal source", () => {
  const source = journalEvidenceFrom(history.records)
  expect(journaledIntegrationEvidenceOf(source)).toBe(journaledIntegrationEvidenceOf(source))
})

it("recomputes raw audit rows after the caller adds the integration responsibility", () => {
  const queueOffset = history.records.findIndex(({ event }) => event._tag === "IntegrationResponsibilityBegan")
  const queue = history.records[queueOffset]
  if (queue === undefined) return expect.fail("fixture must include queued integration")
  const raw = history.records.slice(0, queueOffset)
  expect(journaledIntegrationEvidenceOf(raw).map(({ _tag }) => _tag)).toContain("AcceptedAwaitingIntegration")
  // eslint-disable-next-line functional/immutable-data -- Negative control: raw audit callers may reuse a mutable array identity.
  raw.push(queue)
  const after = journaledIntegrationEvidenceOf(raw).map(({ _tag }) => _tag)
  expect(after).toContain("QueuedIntegration")
  expect(after).not.toContain("AcceptedAwaitingIntegration")
})
