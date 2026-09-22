import { expect, it } from "vitest"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineId,
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
const foreignObservation: RemoteBaselineJournalEvent = {
  ...localAncestor,
  correlation: { ...correlation, baselineId: RemoteBaselineId.make("foreign-baseline") }
}

it("requires a journaled catch-up after proving the local target is behind the remote baseline", () => {
  expect(deriveRemoteBaselineState([])).toMatchObject({ _tag: "Absent" })
  expect(deriveRemoteBaselineState([localAncestor])).toMatchObject({ _tag: "Contradiction" })
  expect(deriveRemoteBaselineState([readIntent])).toMatchObject({ _tag: "ReadPending" })
  expect(deriveRemoteBaselineState([readIntent, catchUpIntent])).toMatchObject({ _tag: "Contradiction" })
  expect(deriveRemoteBaselineState([readIntent, foreignObservation])).toMatchObject({ _tag: "Contradiction" })
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
  const current = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, current])).toMatchObject({
    _tag: "Ready"
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
  const ahead = RemoteBaselineObservedEvent.make({
    correlation,
    observation: RemoteBaselineObservation.cases.LocalAhead.make({ localHead, remoteHead }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, ahead])).toMatchObject({ _tag: "Retained" })
  expect(deriveRemoteBaselineState([readIntent, ahead, catchUpIntent])).toMatchObject({ _tag: "Contradiction" })
  const missing = RemoteBaselineObservedEvent.make({
    correlation,
    observation: RemoteBaselineObservation.cases.RemoteMissing.make({}),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, missing])).toMatchObject({ _tag: "Retained" })
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
  const pending = deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent])
  expect(pending).toMatchObject({ _tag: "CatchUpPending" })
  const foreignResult = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: localHead }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, foreignResult])).toMatchObject({
    _tag: "Contradiction"
  })
  const rejected = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: localHead }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, rejected])).toMatchObject({
    _tag: "Retained"
  })
  const unavailable = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.Unavailable.make({ reason: "TargetUnreadable" }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, unavailable])).toMatchObject({
    _tag: "Retained"
  })
})

it("rejects malformed aligned and catch-up chronology", () => {
  const aligned = RemoteBaselineObservedEvent.make({
    correlation,
    observation: RemoteBaselineObservation.cases.Aligned.make({ localHead, remoteHead: localHead }),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, aligned, catchUpIntent])).toMatchObject({ _tag: "Contradiction" })
  expect(deriveRemoteBaselineState([readIntent, aligned, aligned])).toMatchObject({ _tag: "Contradiction" })
  const wrongIntent = LocalTargetCatchUpIntendedEvent.make({ ...catchUpIntent, expectedLocalHead: remoteHead })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, wrongIntent])).toMatchObject({ _tag: "Contradiction" })
  const tooMany = LocalTargetCatchUpObservedEvent.make({
    correlation,
    expectedLocalHead: localHead,
    occurrenceClassification: "NonActionOccurrence",
    remoteHead,
    result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead }),
    version: workflowJournalEventVersion
  })
  expect(deriveRemoteBaselineState([readIntent, localAncestor, catchUpIntent, tooMany, tooMany])).toMatchObject({
    _tag: "Contradiction"
  })
})
