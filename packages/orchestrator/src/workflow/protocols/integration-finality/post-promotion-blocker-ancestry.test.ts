import { describe, expect, it } from "vitest"
import { GitCommitSha, RunId, TaskId, makeTaskWorkSpecification } from "@dalph/contracts"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { Effect } from "effect"
import {
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  TaskTrackerFactsReadFailed
} from "../../task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../task-tracker-read/protocol.js"
import { TrackerAdapterReadFailureReason } from "../../../authorities/task-tracker/graph-reader.js"
import { makeTrackerGraphObservationOperation } from "../../registry/operation.js"
import { WorkflowRunBeganEvent, taskTrackerReadIntent } from "../../registry/event.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import {
  PostPromotionBlockerCandidateAncestryObservation,
  PostPromotionBlockerCandidateAncestryObservedEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerClearAuthorization,
  postPromotionBlockerAncestryOperationIdFor
} from "./events.js"
import { TargetPromotionGit, TargetPromotionGitReadObservation } from "../target-promotion/events.js"
import {
  invalidPostPromotionBlockerAncestryHistory,
  postPromotionBlockerAncestryIsPositive,
  postPromotionBlockerAncestryOutcomeFor,
  postPromotionBlockerClearAuthorizationFor,
  postPromotionBlockerClearAuthorizationIssue,
  readPostPromotionBlockerCandidateAncestry
} from "./post-promotion-blocker-ancestry.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import { integratorCorrelationFor } from "../integrator/session.js"

const blocker = TaskId.make("post-promotion-blocker")

const snapshotFor = (revision: string, blockerLifecycle: TaskLifecycle) => {
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make(revision),
    tasks: [
      { id: blocker, lifecycle: blockerLifecycle, parentTaskId: null, prerequisiteIds: [] },
      {
        id: fixture.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: [blocker]
      }
    ]
  })
  if (projected._tag === "Invalid") expect.fail("post-promotion fixture graph must project")
  return projected.snapshot
}

const graphRecord = (
  position: number,
  operationName: string,
  snapshot: ReturnType<typeof snapshotFor>
): JournalRecord => {
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(operationName),
    fixture.target,
    [],
    [blocker, fixture.taskId]
  )
  const observation = makeCompleteTaskTrackerFactsObserved(operation, snapshot)
  return {
    event: TaskTrackerFactsObservedEvent.make({
      observation,
      operationId: operation.operationId,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make(`post-promotion-graph:${position}`),
    position: JournalPosition.make(position),
    runId: fixture.runId
  }
}

const beginning = (): JournalRecord => ({
  event: WorkflowRunBeganEvent.make({
    initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    target: fixture.target,
    version: workflowJournalEventVersion
  }),
  key: JournalRecordKey.make("post-promotion-begin"),
  position: JournalPosition.make(1),
  runId: fixture.runId
})

const promotion = (): JournalRecord => ({
  event: fixture.promotionSuccess,
  key: JournalRecordKey.make("post-promotion-success"),
  position: JournalPosition.make(2),
  runId: fixture.runId
})

const chronology = () =>
  [
    beginning(),
    promotion(),
    graphRecord(
      3,
      "post-promotion-blocked",
      snapshotFor("post-promotion-blocked-revision", TaskLifecycle.cases.Open.make({}))
    ),
    graphRecord(
      4,
      "post-promotion-cleared",
      snapshotFor("post-promotion-cleared-revision", TaskLifecycle.cases.CompletedSuccessfully.make({}))
    )
  ] as const

const authorization = PostPromotionBlockerClearAuthorization.make({
  blockerClearedAt: JournalPosition.make(4),
  blockerObservedAt: JournalPosition.make(3),
  claim: fixture.claim
})

describe("post-promotion blocker ancestry chronology", () => {
  it("derives the exact blocked-then-cleared authorization and its boundary variants", () => {
    const records = chronology()
    expect(postPromotionBlockerClearAuthorizationFor(records, fixture.claim)).toEqual(authorization)
    const indexed = journalEvidenceFrom(records)
    expect(postPromotionBlockerClearAuthorizationFor(indexed, fixture.claim)).toEqual(authorization)
    expect(
      postPromotionBlockerClearAuthorizationFor(
        records.filter(({ event }) => event._tag !== "TargetPromotionObservedSuccess"),
        fixture.claim
      )
    ).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor([promotion()], fixture.claim)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor([beginning(), promotion()], fixture.claim)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor(records.slice(0, 3), fixture.claim)).toBeUndefined()

    const priorSnapshot = snapshotFor("post-promotion-missing-reconfirmation-prior", TaskLifecycle.cases.Open.make({}))
    const priorOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("post-promotion-missing-reconfirmation-prior"),
      fixture.target,
      [],
      [blocker, fixture.taskId]
    )
    const priorRecord: JournalRecord = {
      event: TaskTrackerFactsObservedEvent.make({
        observation: makeCompleteTaskTrackerFactsObserved(priorOperation, priorSnapshot),
        operationId: priorOperation.operationId,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("post-promotion-missing-reconfirmation-prior"),
      position: JournalPosition.make(3),
      runId: fixture.runId
    }
    const laterOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("post-promotion-missing-reconfirmation-later"),
      fixture.target,
      [priorOperation.operationId],
      [blocker, fixture.taskId]
    )
    const reconfirmation = makeTaskTrackerFactsObservedFromRead([priorRecord], laterOperation, priorSnapshot)
    expect(reconfirmation.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
    const missingPriorRecord: JournalRecord = {
      event: reconfirmation,
      key: JournalRecordKey.make("post-promotion-missing-reconfirmation-later"),
      position: JournalPosition.make(3),
      runId: fixture.runId
    }
    expect(
      postPromotionBlockerClearAuthorizationFor([beginning(), promotion(), missingPriorRecord], fixture.claim)
    ).toBeUndefined()

    const unrelatedProjected = projectTrackerSnapshot({
      revision: TrackerRevision.make("post-promotion-unrelated-revision"),
      tasks: [
        {
          id: TaskId.make("unrelated-task"),
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (unrelatedProjected._tag === "Invalid") expect.fail("unrelated fixture graph must project")
    expect(
      postPromotionBlockerClearAuthorizationFor(
        [...records.slice(0, 2), graphRecord(3, "post-promotion-unrelated", unrelatedProjected.snapshot)],
        fixture.claim
      )
    ).toBeUndefined()

    const incompleteOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("post-promotion-incomplete"),
      fixture.target,
      [],
      [fixture.taskId]
    )
    const incompleteRecord: JournalRecord = {
      event: TaskTrackerFactsObservedEvent.make({
        observation: TaskTrackerFactsReadFailed.make({
          completeness: "Unreadable",
          failure: {
            _tag: "TrackerAdapterReadError",
            detail: "graph incomplete",
            reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
          },
          operationId: incompleteOperation.operationId,
          target: fixture.target
        }),
        operationId: incompleteOperation.operationId,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("post-promotion-incomplete"),
      position: JournalPosition.make(5),
      runId: fixture.runId
    }
    expect(postPromotionBlockerClearAuthorizationFor([...records, incompleteRecord], fixture.claim)).toEqual(
      authorization
    )

    expect(postPromotionBlockerClearAuthorizationIssue(records, authorization)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationIssue(records, authorization, JournalPosition.make(5))).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationIssue(indexed, authorization)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationIssue(indexed, authorization, JournalPosition.make(5))).toBeUndefined()
    const mismatched = PostPromotionBlockerClearAuthorization.make({
      blockerClearedAt: JournalPosition.make(5),
      blockerObservedAt: JournalPosition.make(3),
      claim: fixture.claim
    })
    expect(postPromotionBlockerClearAuthorizationIssue(records, mismatched)).toContain("lacks its exact")
  })

  it("requires exact intent and outcome records and classifies Git ancestry", async () => {
    const operationId = postPromotionBlockerAncestryOperationIdFor(authorization)
    const intentEvent = PostPromotionBlockerCandidateAncestryReadIntendedEvent.make({
      authorization,
      operationId,
      version: workflowJournalEventVersion
    })
    const outcomeEvent = PostPromotionBlockerCandidateAncestryObservedEvent.make({
      authorization,
      observation: PostPromotionBlockerCandidateAncestryObservation.cases.Observed.make({
        observation: TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
          currentHeadSha: GitCommitSha.make("4".repeat(40))
        })
      }),
      operationId,
      version: workflowJournalEventVersion
    })
    const intentRecord: JournalRecord = {
      event: intentEvent,
      key: intentRecordKey(operationId),
      position: JournalPosition.make(5),
      runId: fixture.runId
    }
    const outcomeRecord: JournalRecord = {
      event: outcomeEvent,
      key: outcomeRecordKey(operationId),
      position: JournalPosition.make(6),
      runId: fixture.runId
    }
    const records = [...chronology(), intentRecord, outcomeRecord]
    expect(invalidPostPromotionBlockerAncestryHistory(records, intentRecord, fixture.runId)).toBeUndefined()
    expect(invalidPostPromotionBlockerAncestryHistory(records, outcomeRecord, fixture.runId)).toBeUndefined()
    expect(
      invalidPostPromotionBlockerAncestryHistory(records, intentRecord, RunId.make("post-promotion-foreign-run"))
    ).toMatchObject({ kind: "Identity" })
    expect(postPromotionBlockerAncestryOutcomeFor(records, authorization)?.event).toEqual(outcomeEvent)
    expect(postPromotionBlockerAncestryOutcomeFor(records.slice(0, -1), authorization)).toBeUndefined()

    const unusedGit = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("cached outcome should avoid Git"),
      read: () => Effect.die("cached outcome should avoid Git")
    })
    const specification = makeTaskWorkSpecification({
      body: "Exercise a cached post-promotion blocker ancestry read.",
      taskId: fixture.taskId,
      title: "Post-promotion blocker ancestry"
    })
    const accepted = makeAcceptedIntegrationHistory({
      acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
      activeClaim: fixture.activeClaim,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
      runId: fixture.runId,
      targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
      taskSpecification: specification,
      trackerTarget: fixture.target
    })
    const promoted = makePromotedIntegrationHistory({
      candidateCommit: fixture.qualifiedCandidate.candidateCommit,
      candidateText: fixture.qualifiedCandidate.candidateText,
      originalClaim: accepted.activeClaim,
      records: accepted.records,
      session: integratorCorrelationFor(accepted)
    })
    let boundaryRecords = promoted.promotedRecords
    const appendBoundary = (event: JournalRecord["event"]): JournalRecord => {
      const appended: JournalRecord = {
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(boundaryRecords.length + 1),
        runId: fixture.runId
      }
      boundaryRecords = [...boundaryRecords, appended]
      return appended
    }
    const appendGraph = (
      name: string,
      lifecycle: TaskLifecycle,
      predecessorOperationIds: ReadonlyArray<OperationId>
    ) => {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(name),
        fixture.target,
        predecessorOperationIds,
        [blocker, fixture.taskId]
      )
      appendBoundary(taskTrackerReadIntent(operation))
      appendBoundary(
        TaskTrackerFactsObservedEvent.make({
          observation: makeCompleteTaskTrackerFactsObserved(operation, snapshotFor(`${name}-revision`, lifecycle)),
          operationId: operation.operationId,
          version: workflowJournalEventVersion
        })
      )
      return operation.operationId
    }
    const blockedOperationId = appendGraph("accepted-post-promotion-blocked", TaskLifecycle.cases.Open.make({}), [
      accepted.graphOperation.operationId
    ])
    appendGraph("accepted-post-promotion-cleared", TaskLifecycle.cases.CompletedSuccessfully.make({}), [
      blockedOperationId
    ])
    const boundaryAuthorization = postPromotionBlockerClearAuthorizationFor(boundaryRecords, promoted.claim)
    if (boundaryAuthorization === undefined) expect.fail("accepted fixture lacks blocker-clear authorization")
    const boundaryOperationId = postPromotionBlockerAncestryOperationIdFor(boundaryAuthorization)
    appendBoundary(
      PostPromotionBlockerCandidateAncestryReadIntendedEvent.make({
        authorization: boundaryAuthorization,
        operationId: boundaryOperationId,
        version: workflowJournalEventVersion
      })
    )
    const boundaryOutcome = PostPromotionBlockerCandidateAncestryObservedEvent.make({
      authorization: boundaryAuthorization,
      observation: outcomeEvent.observation,
      operationId: boundaryOperationId,
      version: workflowJournalEventVersion
    })
    appendBoundary(boundaryOutcome)
    expect(
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* readPostPromotionBlockerCandidateAncestry(boundaryAuthorization)
        }).pipe(
          Effect.provideService(TargetPromotionGit, unusedGit),
          Effect.provide(
            liveJournalTestLayer({ records: boundaryRecords, runId: fixture.runId, target: fixture.target })
          )
        )
      )
    ).toEqual(boundaryOutcome.observation)

    const missingIntent = invalidPostPromotionBlockerAncestryHistory(chronology(), outcomeRecord, fixture.runId)
    expect(missingIntent).toMatchObject({ kind: "Semantic" })
    expect(
      invalidPostPromotionBlockerAncestryHistory(
        records,
        { ...intentRecord, runId: fixture.runId, position: JournalPosition.make(3) },
        fixture.runId
      )
    ).toMatchObject({ kind: "Semantic" })
    expect(invalidPostPromotionBlockerAncestryHistory(records, outcomeRecord, fixture.runId)).toBeUndefined()
    expect(invalidPostPromotionBlockerAncestryHistory(records, intentRecord, fixture.runId)).toBeUndefined()
    expect(invalidPostPromotionBlockerAncestryHistory(records, promotion(), fixture.runId)).toBeUndefined()

    expect(
      postPromotionBlockerAncestryIsPositive(
        PostPromotionBlockerCandidateAncestryObservation.cases.Observed.make({
          observation: TargetPromotionGitReadObservation.cases.CandidateAncestor.make({
            currentHeadSha: GitCommitSha.make("5".repeat(40))
          })
        })
      )
    ).toBe(true)
    expect(
      postPromotionBlockerAncestryIsPositive(
        PostPromotionBlockerCandidateAncestryObservation.cases.Observed.make({
          observation: TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
            currentHeadSha: GitCommitSha.make("6".repeat(40))
          })
        })
      )
    ).toBe(false)
    expect(
      postPromotionBlockerAncestryIsPositive(
        PostPromotionBlockerCandidateAncestryObservation.cases.Unreadable.make({ detail: "Git unavailable" })
      )
    ).toBe(false)
  })
})
