import { describe, expect, it } from "vitest"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorResultRecordedEvent
} from "../protocols/integrator/events.js"
import {
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal
} from "../protocols/integration-finality/events.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import { describeJournalEvent } from "./event-descriptor.js"
import {
  completionTaskRequestLookupIntentRecordKey,
  completionTaskRequestLookupRecordKey,
  integratorCandidateGitObservedRecordKey,
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey
} from "../../workflow-journal/record-key.js"

const candidateText = IntegratorCandidateText.make("refs/heads/descriptor-candidate")
const integratorCorrelation = IntegratorCorrelation.make({
  ...integrationFinalityFixture.qualifiedCandidate.run.session,
  candidateResource: integrationFinalityFixture.qualifiedCandidate.run.session.candidateResource
})

describe("journal event descriptors", () => {
  it("describes retained Integrator and completion boundary events by exact key", () => {
    const integratorResult = IntegratorResult.cases.PreparedCandidate.make({
      candidateText,
      correlation: integratorCorrelation
    })
    const integratorEvents = [
      IntegratorResultRecordedEvent.make({ result: integratorResult, version: workflowJournalEventVersion }),
      IntegratorCandidateGitReadIntendedEvent.make({
        candidateText,
        correlation: integratorCorrelation,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitObservedEvent.make({
        candidateText,
        correlation: integratorCorrelation,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(integratorEvents[0]).expectedKey).toEqual(
      integratorResultRecordedRecordKey(integratorCorrelation)
    )
    expect(describeJournalEvent(integratorEvents[1]).expectedKey).toEqual(
      integratorCandidateGitReadIntendedRecordKey(integratorCorrelation, candidateText)
    )
    expect(describeJournalEvent(integratorEvents[2]).expectedKey).toEqual(
      integratorCandidateGitObservedRecordKey(integratorCorrelation, candidateText)
    )

    const request = integrationFinalityFixture.completionRequest
    const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
    const lookupEvents = [
      CompletionTaskRequestLookupIntendedEvent.make({
        attemptOrdinal,
        operationId: request.operationId,
        request,
        version: workflowJournalEventVersion
      }),
      CompletionTaskRequestLookupObservedEvent.make({
        attemptOrdinal,
        lookup: CompletionTaskRequestLookup.cases.Applied.make({ request }),
        operationId: request.operationId,
        request,
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(lookupEvents[0]).expectedKey).toEqual(
      completionTaskRequestLookupIntentRecordKey(request, attemptOrdinal)
    )
    expect(describeJournalEvent(lookupEvents[1]).expectedKey).toEqual(
      completionTaskRequestLookupRecordKey(request, attemptOrdinal)
    )
  })
})
