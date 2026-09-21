import { expect, it } from "vitest"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineObservedEvent,
  RemoteBaselineObservation,
  RemoteBaselineReadIntendedEvent,
  remoteBaselineCorrelationFor,
  type RemoteBaselineJournalEvent
} from "./baseline-events.js"
import { deriveRemoteBaselineState } from "./baseline-state.js"

const candidate = integrationFinalityFixture.qualifiedCandidate
const session = candidate.run.session
const correlation = remoteBaselineCorrelationFor(
  session.plannedAttempt.runId,
  integratorResponsibilityFactsFromCorrelation(session),
  session.integrationTarget,
  remotePublicationTargetForTest
)
const localHead = session.expectedTargetHead
const remoteHead = candidate.candidateCommit
const actor = { _tag: "DalphCoordinator" as const }

const readIntent = RemoteBaselineReadIntendedEvent.make({
  correlation,
  initiatedBy: actor,
  occurrenceClassification: "InitiatedAction",
  version: workflowJournalEventVersion
})

const localAncestor = RemoteBaselineObservedEvent.make({
  correlation,
  observation: RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead }),
  occurrenceClassification: "NonActionOccurrence",
  version: workflowJournalEventVersion
})

const catchUpIntent = LocalTargetCatchUpIntendedEvent.make({
  correlation,
  expectedLocalHead: localHead,
  initiatedBy: actor,
  occurrenceClassification: "InitiatedAction",
  remoteHead,
  version: workflowJournalEventVersion
})

it("requires a journaled catch-up after proving the local target is behind the remote baseline", () => {
  expect(deriveRemoteBaselineState([readIntent, localAncestor])).toMatchObject({
    _tag: "CatchUpRequired",
    expectedLocalHead: localHead,
    remoteHead
  })
})

it("admits Integrator fixation only after the exact catch-up result", () => {
  const result = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, result])).toMatchObject({
    _tag: "Ready",
    remoteHead
  })
})

it("retains an unsafe local relation and rejects a fabricated catch-up intent", () => {
  const divergent = RemoteBaselineObservedEvent.make({
    correlation,
    observation: RemoteBaselineObservation.cases.Diverged.make({ localHead, remoteHead }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, divergent])).toMatchObject({ _tag: "Retained" })
  expect(deriveRemoteBaselineState([readIntent, divergent, catchUpIntent])).toMatchObject({
    _tag: "Contradiction",
    detail: "unsafe baseline relation cannot authorize catch-up"
  })
})

it("rejects a catch-up result that does not bind its exact observed heads", () => {
  const foreign = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: remoteHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead }),
    version: workflowJournalEventVersion
  })
  const events: ReadonlyArray<RemoteBaselineJournalEvent> = [readIntent, localAncestor, catchUpIntent, foreign]
  expect(deriveRemoteBaselineState(events)).toMatchObject({ _tag: "Contradiction" })
})
