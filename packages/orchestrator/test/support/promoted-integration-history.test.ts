import { expect, it } from "vitest"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { integrationFinalityFixture } from "../../src/workflow/protocols/integration-finality/fixtures.js"
import { integratorCorrelationFor } from "../../src/workflow/protocols/integrator/session.js"
import { makeAcceptedIntegrationHistory } from "./accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "./promoted-integration-history.js"

it("refuses to turn a partial session fixture into accepted promotion history", () => {
  const fixture = integrationFinalityFixture
  expect(() =>
    makePromotedIntegrationHistory({
      candidateCommit: fixture.qualifiedCandidate.candidateCommit,
      candidateText: fixture.qualifiedCandidate.candidateText,
      originalClaim: fixture.activeClaim,
      records: [],
      session: fixture.qualifiedCandidate.run.session
    })
  ).toThrow()
})

it("qualifies Git, promotes the candidate, and replaces the claim using only earlier actual positions", () => {
  const fixture = integrationFinalityFixture
  const specification = makeTaskWorkSpecification({
    body: "Exercise exact completion boundaries after a real accepted integration prefix.",
    taskId: fixture.taskId,
    title: "Completion boundary fixture"
  })
  const base = makeAcceptedIntegrationHistory({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    activeClaim: fixture.activeClaim,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
    runId: fixture.runId,
    targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
    taskSpecification: specification,
    trackerTarget: fixture.target
  })
  const history = makePromotedIntegrationHistory({
    candidateCommit: fixture.qualifiedCandidate.candidateCommit,
    candidateText: fixture.qualifiedCandidate.candidateText,
    originalClaim: base.activeClaim,
    records: base.records,
    session: integratorCorrelationFor(base)
  })
  for (const records of [history.qualifiedRecords, history.promotedRecords, history.replacedRecords]) {
    expect(reduceWorkflowJournalHistory(fixture.runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }
  expect(history.qualifiedCandidate.qualifiedAt).toBe(history.qualifiedRecords.at(-1)?.position)
  expect(history.qualifiedCandidate.qualifiedAt).toBeGreaterThan(base.targetLineageObservedAt)
  expect(history.promotionRecord.position).toBeGreaterThan(history.qualifiedCandidate.qualifiedAt)
  expect(history.replacementRecord.position).toBeGreaterThan(history.promotionRecord.position)
  expect(history.completionRequest.claim).toEqual(history.claim)
})
