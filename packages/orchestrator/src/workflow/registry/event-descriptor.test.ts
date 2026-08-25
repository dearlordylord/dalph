import { describe, expect, it } from "vitest"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"
import {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent
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
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
} from "../../workflow-journal/record-key.js"

const candidateText = IntegratorCandidateText.make("refs/heads/descriptor-candidate")
const integratorCorrelation = IntegratorSessionCorrelation.make({
  ...integrationFinalityFixture.qualifiedCandidate.run.session,
  candidateResource: integrationFinalityFixture.qualifiedCandidate.run.session.candidateResource
})
const integratorRun = IntegratorRunCorrelation.make({
  ordinal: IntegratorRunOrdinal.make(1),
  session: integratorCorrelation
})

describe("journal event descriptors", () => {
  it("describes retained Integrator and completion boundary events by exact key", () => {
    const integratorResult = IntegratorResult.cases.PreparedCandidate.make({
      candidateText,
      correlation: integratorRun
    })
    const integratorEvents = [
      IntegratorRunStartedEvent.make({ run: integratorRun, version: workflowJournalEventVersion }),
      IntegratorRunResultRecordedEvent.make({
        result: integratorResult,
        run: integratorRun,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText,
        run: integratorRun,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(integratorEvents[0]).expectedKey).toEqual(integratorRunStartedRecordKey(integratorRun))
    expect(describeJournalEvent(integratorEvents[1]).expectedKey).toEqual(
      integratorRunResultRecordedRecordKey(integratorRun)
    )
    expect(describeJournalEvent(integratorEvents[2]).expectedKey).toEqual(
      integratorRunCandidateGitReadIntendedRecordKey(integratorRun, candidateText)
    )
    expect(describeJournalEvent(integratorEvents[3]).expectedKey).toEqual(
      integratorRunCandidateGitObservedRecordKey(integratorRun, candidateText)
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
