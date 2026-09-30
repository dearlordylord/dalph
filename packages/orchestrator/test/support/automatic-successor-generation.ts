import { GitCommitSha } from "@dalph/contracts"
import { TargetLineageObservation } from "../../src/authorities/git/target-lineage.js"
import { remotePublicationTargetForTest } from "./direct-publication.js"
import { OperationId } from "../../src/workflow/identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../src/workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../src/workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import {
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineObservation,
  RemoteBaselineObservedEvent,
  RemoteBaselineReadIntendedEvent,
  initialAutomaticCompetingHeadBaselineRound,
  automaticCompetingHeadRemoteBaselineCorrelationFor
} from "../../src/workflow/protocols/direct-publication/baseline-events.js"
import {
  RemotePublicationAttemptAuthorization,
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
  integratorRunCorrelationsEqual,
  maximumIntegratorSessionsPerResponsibility,
  type IntegratorAutomaticSuccessorGeneration,
  type IntegratorSessionCorrelation
} from "../../src/workflow/protocols/integrator/events.js"
import {
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor
} from "../../src/workflow/protocols/integrator/automatic-successor-events.js"
import { integratorRunCorrelationForSession } from "../../src/workflow/protocols/integrator/session.js"
import {
  deriveCurrentIntegratorState,
  integratorResponsibilityFactsFor
} from "../../src/workflow/protocols/integrator/state.js"
import type { makeSuccessorPrefix } from "./automatic-successor-history.js"

const gitShaLength = 40
const automaticSuccessorCandidateCommitDigitOffset = 5
const sha = (digit: string): GitCommitSha => GitCommitSha.make(digit.repeat(gitShaLength))

/** Adds one exact competing-head publication and catch-up after an already-fixed automatic successor. */
export const appendAutomaticSuccessorGeneration = (
  fixture: ReturnType<typeof makeSuccessorPrefix>,
  predecessor: IntegratorSessionCorrelation,
  competingHead: GitCommitSha,
  generation: IntegratorAutomaticSuccessorGeneration
) => {
  const generationNumber = Number(generation)
  if (generationNumber > maximumIntegratorSessionsPerResponsibility) {
    throw new Error("automatic successor fixture cannot exceed the responsibility session capacity")
  }
  const run = integratorRunCorrelationForSession(predecessor, IntegratorRunOrdinal.make(1))
  const candidateText = IntegratorCandidateText.make(
    `refs/heads/dalph/automatic-successor-candidate-${generationNumber}`
  )
  const candidateCommit = sha(String(automaticSuccessorCandidateCommitDigitOffset + generationNumber))
  if (
    !fixture
      .records()
      .some(({ event }) => event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(event.run, run))
  ) {
    fixture.append(IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }))
  }
  fixture.append(
    IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: run }),
      run,
      version: workflowJournalEventVersion
    })
  )
  fixture.append(
    IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion })
  )
  fixture.append(
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
  const state = deriveCurrentIntegratorState(fixture.records(), fixture.accepted.responsibility)
  if (state._tag !== "GitQualifiedPrepared") {
    throw new Error("next automatic successor candidate must qualify at its exact head")
  }
  const candidate = {
    candidateCommit: state.candidateCommit,
    candidateText: state.candidateText,
    directParents: state.observation.directParents,
    qualifiedAt: state.qualifiedAt,
    run: state.run
  }
  const publication = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
  fixture.append(
    RemotePublicationIntendedEvent.make({
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  fixture.append(
    RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(candidate.candidateCommit, publication.target.branch),
      version: workflowJournalEventVersion
    })
  )
  const retained = fixture.append(
    RemotePublicationRetainedEvent.make({
      authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
      cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
        mergeBase: predecessor.expectedTargetHead,
        remoteHead: competingHead
      }),
      correlation: publication,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  const authorization = fixture.append(
    IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
      authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
        publication.requestId,
        retained.position,
        predecessor.expectedTargetHead,
        competingHead
      ),
      correlation: publication,
      initiatedBy: { _tag: "DalphCoordinator" },
      mergeBase: predecessor.expectedTargetHead,
      occurrenceClassification: "InitiatedAction",
      remoteHead: competingHead,
      remotePublicationRetainedAt: retained.position,
      version: workflowJournalEventVersion
    })
  )
  const baseline = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    integratorResponsibilityFactsFor(fixture.accepted.responsibility),
    fixture.accepted.integrationTarget,
    remotePublicationTargetForTest,
    authorization.position,
    initialAutomaticCompetingHeadBaselineRound
  )
  fixture.append(
    RemoteBaselineReadIntendedEvent.make({
      correlation: baseline,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  fixture.append(
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
  fixture.append(
    LocalTargetCatchUpIntendedEvent.make({
      correlation: baseline,
      expectedLocalHead: predecessor.expectedTargetHead,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      remoteHead: competingHead,
      version: workflowJournalEventVersion
    })
  )
  fixture.append(
    LocalTargetCatchUpObservedEvent.make({
      correlation: baseline,
      expectedLocalHead: predecessor.expectedTargetHead,
      occurrenceClassification: "NonActionOccurrence",
      remoteHead: competingHead,
      result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: competingHead }),
      version: workflowJournalEventVersion
    })
  )
  const lineagePredecessor = fixture.records().find(({ position }) => position === predecessor.targetLineageObservedAt)
  if (lineagePredecessor?.event._tag !== "TargetLineageObserved") {
    throw new Error("automatic successor requires its exact predecessor target-lineage observation")
  }
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: fixture.accepted.integrationTarget,
    operationId: OperationId.make(`automatic-successor-fresh-target-lineage-${generationNumber}`),
    plannedAttempt: predecessor.plannedAttempt,
    predecessorOperationIds: [lineagePredecessor.event.operationId]
  })
  const freshLineage = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: predecessor.plannedAttempt.baseSha,
    targetHeadSha: competingHead
  })
  fixture.append(
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: lineageOperation,
      version: workflowJournalEventVersion
    })
  )
  const observed = fixture.append(
    TargetLineageObservedEvent.make({
      observation: freshLineage,
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt: predecessor.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const input = {
    authorizationAt: authorization.position,
    predecessor,
    targetLineage: freshLineage,
    targetLineageObservedAt: observed.position
  }
  const reduction = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    throw new Error(`fixture must be accepted before next successor fixation: ${JSON.stringify(reduction.issues)}`)
  }
  return { input, reduction }
}
