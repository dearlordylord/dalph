import { makeTaskWorkSpecification, GitCommitSha } from "@dalph/contracts"
import { TargetLineageObservation } from "../../src/authorities/git/target-lineage.js"
import { integrationFinalityFixture } from "../../src/workflow/protocols/integration-finality/fixtures.js"
import { makeAcceptedIntegrationHistory } from "./accepted-integration-history.js"
import { remotePublicationTargetForTest } from "./direct-publication.js"
import { OperationId } from "../../src/workflow/identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../src/workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../src/workflow/registry/operation.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import {
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineObservation,
  RemoteBaselineObservedEvent,
  RemoteBaselineReadIntendedEvent,
  automaticCompetingHeadRemoteBaselineCorrelationFor
} from "../../src/workflow/protocols/direct-publication/baseline-events.js"
import {
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "../../src/workflow/protocols/direct-publication/events.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult,
  IntegratorSessionFixedEvent
} from "../../src/workflow/protocols/integrator/events.js"
import {
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor
} from "../../src/workflow/protocols/integrator/automatic-successor-events.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession
} from "../../src/workflow/protocols/integrator/session.js"
import {
  deriveCurrentIntegratorState,
  integratorResponsibilityFactsFor
} from "../../src/workflow/protocols/integrator/state.js"

const gitShaLength = 40
const sha = (digit: string): GitCommitSha => GitCommitSha.make(digit.repeat(gitShaLength))

export const makeSuccessorPrefix = () => {
  const fixture = integrationFinalityFixture
  const specification = makeTaskWorkSpecification({
    body: "Recover one exact accepted task result after a competing remote update.",
    taskId: fixture.taskId,
    title: "Automatic competing-head successor"
  })
  const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    activeClaim: fixture.activeClaim,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt,
    runId: fixture.runId,
    targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
    taskSpecification: specification,
    trackerTarget: fixture.target
  })
  let records = [...accepted.records]
  const append = (event: JournalRecord["event"]): JournalRecord => {
    const descriptor = describeJournalEvent(event)
    const record: JournalRecord = {
      event,
      key: descriptor.expectedKey,
      position: JournalPosition.make(records.length + 1),
      runId: fixture.runId
    }
    records = [...records, record]
    return record
  }
  const predecessor = integratorCorrelationFor({
    responsibility: accepted.responsibility,
    targetLineage: accepted.targetLineage,
    targetLineageObservedAt: accepted.targetLineageObservedAt
  })
  const run = integratorRunCorrelationForSession(predecessor, IntegratorRunOrdinal.make(1))
  const candidateText = IntegratorCandidateText.make("refs/heads/dalph/automatic-successor-candidate")
  const candidateCommit = sha("5")
  const competingHead = sha("6")
  append(IntegratorSessionFixedEvent.make({ correlation: predecessor, version: workflowJournalEventVersion }))
  append(IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }))
  append(
    IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: run }),
      run,
      version: workflowJournalEventVersion
    })
  )
  append(IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion }))
  append(
    IntegratorRunCandidateGitObservedEvent.make({
      candidateText,
      observation: IntegratorGitObservation.cases.Commit.make({
        candidateText,
        commit: candidateCommit,
        directParents: [predecessor.expectedTargetHead, predecessor.acceptedResult.commit]
      }),
      run,
      version: workflowJournalEventVersion
    })
  )
  const state = deriveCurrentIntegratorState(records, accepted.responsibility)
  if (state._tag !== "GitQualifiedPrepared") throw new Error("fixture candidate must qualify against exact [H, C]")
  const candidate = {
    candidateCommit: state.candidateCommit,
    candidateText: state.candidateText,
    directParents: state.observation.directParents,
    qualifiedAt: state.qualifiedAt,
    run: state.run
  }
  const publication = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
  append(
    RemotePublicationIntendedEvent.make({
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  append(
    RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(candidate.candidateCommit, publication.target.branch),
      version: workflowJournalEventVersion
    })
  )
  const retainedAt = append(
    RemotePublicationRetainedEvent.make({
      cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
        mergeBase: predecessor.expectedTargetHead,
        remoteHead: competingHead
      }),
      correlation: publication,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  const authorization = append(
    IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
      authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
        publication.requestId,
        retainedAt.position,
        predecessor.expectedTargetHead,
        competingHead
      ),
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      mergeBase: predecessor.expectedTargetHead,
      occurrenceClassification: "InitiatedAction",
      remoteHead: competingHead,
      remotePublicationRetainedAt: retainedAt.position,
      version: workflowJournalEventVersion
    })
  )
  const baseline = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    integratorResponsibilityFactsFor(accepted.responsibility),
    accepted.integrationTarget,
    remotePublicationTargetForTest,
    authorization.position
  )
  append(
    RemoteBaselineReadIntendedEvent.make({
      correlation: baseline,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  append(
    RemoteBaselineObservedEvent.make({
      correlation: baseline,
      observation: RemoteBaselineObservation.cases.LocalAncestor.make({
        localHead: predecessor.expectedTargetHead,
        remoteHead: competingHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  append(
    LocalTargetCatchUpIntendedEvent.make({
      correlation: baseline,
      expectedLocalHead: predecessor.expectedTargetHead,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      remoteHead: competingHead,
      version: workflowJournalEventVersion
    })
  )
  append(
    LocalTargetCatchUpObservedEvent.make({
      correlation: baseline,
      expectedLocalHead: predecessor.expectedTargetHead,
      occurrenceClassification: "NonActionOccurrence",
      remoteHead: competingHead,
      result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: competingHead }),
      version: workflowJournalEventVersion
    })
  )
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: accepted.integrationTarget,
    operationId: OperationId.make("automatic-successor-fresh-target-lineage"),
    plannedAttempt,
    predecessorOperationIds: [accepted.targetLineageOperation.operationId]
  })
  const freshLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: plannedAttempt.baseSha,
    targetHeadSha: competingHead
  })
  append(
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: lineageOperation,
      version: workflowJournalEventVersion
    })
  )
  append(
    TargetLineageObservedEvent.make({
      observation: freshLineage,
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const input = {
    authorizationAt: authorization.position,
    predecessor,
    targetLineage: freshLineage,
    targetLineageObservedAt: JournalPosition.make(records.length)
  }
  const reduction = reduceWorkflowJournalHistory(fixture.runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    throw new Error(`fixture must be accepted before successor fixation: ${JSON.stringify(reduction.issues)}`)
  }
  return { accepted, append, input, records: () => records, reduction, runId: fixture.runId }
}
