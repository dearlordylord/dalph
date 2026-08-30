import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { integrationFinalityFixture as fixture } from "../integration-finality/fixtures.js"
import {
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunCorrelation,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent,
  IntegratorSessionId
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { validateProviderRunActivityAbsent } from "./canonical-provenance.js"
import { IntegrationProviderRunActivityAbsentEvent, IntegrationQuarantineFailureDetail } from "./events.js"

const run = fixture.qualifiedCandidate.run
const session = run.session
const runId = fixture.runId
const candidateText = IntegratorCandidateText.make("refs/heads/canonical-provenance-candidate")
const failureDetail = IntegrationQuarantineFailureDetail.make("provider activity is absent")

const lineageOperationId = OperationId.make("canonical-provenance:target-lineage")
const lineageOperation = makeTargetLineageObservationOperation({
  integrationTarget: session.integrationTarget,
  operationId: lineageOperationId,
  plannedAttempt: session.plannedAttempt,
  predecessorOperationIds: []
})

const lineageIntent: JournalRecord = {
  event: GitReadIntentRecordedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    operation: lineageOperation,
    version: workflowJournalEventVersion
  }),
  key: intentRecordKey(lineageOperationId),
  position: JournalPosition.make(7),
  runId
}
const lineageOutcome: JournalRecord = {
  event: TargetLineageObservedEvent.make({
    observation: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: session.plannedAttempt.baseSha,
      targetHeadSha: session.expectedTargetHead
    }),
    occurrenceClassification: "NonActionOccurrence",
    operationId: lineageOperationId,
    plannedAttempt: session.plannedAttempt,
    version: workflowJournalEventVersion
  }),
  key: outcomeRecordKey(lineageOperationId),
  position: session.targetLineageObservedAt,
  runId
}
const fixedSession: JournalRecord = {
  event: IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion }),
  key: integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
  position: JournalPosition.make(10),
  runId
}
const runStarted: JournalRecord = {
  event: IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }),
  key: integratorRunStartedRecordKey(run),
  position: JournalPosition.make(11),
  runId
}
const absence: JournalRecord = {
  event: IntegrationProviderRunActivityAbsentEvent.make({
    correlation: session,
    detail: failureDetail,
    occurrenceClassification: "NonActionOccurrence",
    run,
    version: workflowJournalEventVersion
  }),
  key: integrationProviderRunActivityAbsentRecordKey(run),
  position: JournalPosition.make(15),
  runId
}
const prefix: ReadonlyArray<JournalRecord> = [lineageIntent, lineageOutcome, fixedSession, runStarted]

const resultRecord = (recordRun: IntegratorRunCorrelation, journalRunId = runId): JournalRecord => ({
  event: IntegratorRunResultRecordedEvent.make({
    result: IntegratorResult.cases.NotPrepared.make({
      correlation: recordRun,
      detail: IntegratorNotPreparedDetail.make("provider returned no prepared candidate")
    }),
    run: recordRun,
    version: workflowJournalEventVersion
  }),
  key: integratorRunResultRecordedRecordKey(recordRun),
  position: JournalPosition.make(12),
  runId: journalRunId
})

it("accepts exact absence chronology and rejects a run start that is not after its fixed session", () => {
  expect(validateProviderRunActivityAbsent([...prefix, absence], absence)._tag).toBe("Valid")

  const startAtFixed = { ...runStarted, position: fixedSession.position }
  expect(
    validateProviderRunActivityAbsent([lineageIntent, lineageOutcome, fixedSession, startAtFixed, absence], absence)
  ).toMatchObject({
    _tag: "Invalid",
    detail: "provider-run quarantine requires one exact run start after the fixed session"
  })
})

it("distinguishes foreign result records from an exact result contradiction", () => {
  const foreignJournalResult = resultRecord(run, RunId.make("canonical-provenance-foreign-run"))
  expect(validateProviderRunActivityAbsent([...prefix, foreignJournalResult, absence], absence)).toMatchObject({
    _tag: "Invalid",
    detail: "provider-activity absence contradicts exact run evidence"
  })

  const foreignSession = IntegratorSessionCorrelation.make({
    ...session,
    sessionId: IntegratorSessionId.make("canonical-provenance-foreign-session")
  })
  const foreignResult = resultRecord(IntegratorRunCorrelation.make({ ordinal: run.ordinal, session: foreignSession }))
  expect(validateProviderRunActivityAbsent([...prefix, foreignResult, absence], absence)._tag).toBe("Valid")

  expect(validateProviderRunActivityAbsent([...prefix, resultRecord(run), absence], absence)).toMatchObject({
    _tag: "Invalid",
    detail: "provider-run absence contradicts an already recorded Integrator result"
  })
})

it("rejects exact candidate-read intent before provider-activity absence", () => {
  const candidateRead: JournalRecord = {
    event: IntegratorRunCandidateGitReadIntendedEvent.make({
      candidateText,
      run,
      version: workflowJournalEventVersion
    }),
    key: integratorRunCandidateGitReadIntendedRecordKey(run, candidateText),
    position: JournalPosition.make(12),
    runId
  }

  expect(validateProviderRunActivityAbsent([...prefix, candidateRead, absence], absence)).toMatchObject({
    _tag: "Invalid",
    detail: "provider-run absence contradicts run-bound candidate evidence"
  })
})
