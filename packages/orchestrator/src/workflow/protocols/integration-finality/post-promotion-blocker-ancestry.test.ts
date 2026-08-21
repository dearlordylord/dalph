import { describe, expect, it } from "vitest"
import { GitCommitSha, RunId, TaskId } from "@dalph/contracts"
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
import { TrackerAdapterReadFailureReason } from "../../../authorities/task-tracker/graph-reader.js"
import { makeTrackerGraphObservationOperation } from "../../registry/operation.js"
import { WorkflowRunBeganEvent } from "../../registry/event.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
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
    expect(
      postPromotionBlockerClearAuthorizationFor(
        records.filter(({ event }) => event._tag !== "TargetPromotionObservedSuccess"),
        fixture.claim
      )
    ).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor([promotion()], fixture.claim)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor([beginning(), promotion()], fixture.claim)).toBeUndefined()
    expect(postPromotionBlockerClearAuthorizationFor(records.slice(0, 3), fixture.claim)).toBeUndefined()

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
      key: JournalRecordKey.make("post-promotion-intent"),
      position: JournalPosition.make(5),
      runId: fixture.runId
    }
    const outcomeRecord: JournalRecord = {
      event: outcomeEvent,
      key: JournalRecordKey.make("post-promotion-outcome"),
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

    const journal = InRunJournal.of({ append: () => Effect.succeed(intentRecord), read: () => Effect.succeed(records) })
    const unusedGit = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("cached outcome should avoid Git"),
      read: () => Effect.die("cached outcome should avoid Git")
    })
    expect(
      await Effect.runPromise(
        readPostPromotionBlockerCandidateAncestry(authorization).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(TargetPromotionGit, unusedGit)
        )
      )
    ).toEqual(outcomeEvent.observation)

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
