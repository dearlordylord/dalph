import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { JournalEventKind, JournalEventVersion, workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { OperationId } from "../workflow/identity.js"
import { decodeJournalEvent, encodeJournalEvent } from "./event-codec.js"
import { TargetLineageObservedEvent, taskTrackerReadIntent } from "../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent,
  IntegratorSessionId
} from "../workflow/protocols/integrator/events.js"
import { JournalPosition } from "./identity.js"

it.effect("round-trips the current generic journal vocabulary", () =>
  Effect.gen(function* () {
    const event = taskTrackerReadIntent(
      makeTrackerGraphObservationOperation(OperationId.make("read-graph"), FixtureTarget.make("fixture"), [], [])
    )
    const decoded = yield* decodeJournalEvent(encodeJournalEvent(event))
    expect(decoded).toEqual(event)
    expect(decoded._tag).toBe("TaskTrackerReadIntentRecorded")
  })
)

it.effect("round-trips the outer Integrator session with its exact causal identities", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const event = IntegratorSessionFixedEvent.make({
      correlation: IntegratorSessionCorrelation.make({
        acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("resource:event-codec-integrator"),
        expectedTargetHead: fixture.promotionCorrelation.qualifiedCandidate.run.session.expectedTargetHead,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        queuedAt: JournalPosition.make(7),
        sessionId: IntegratorSessionId.make("session:event-codec-integrator"),
        startedAt: JournalPosition.make(8),
        targetLineageObservedAt: JournalPosition.make(6)
      }),
      version: workflowJournalEventVersion
    })

    expect(yield* decodeJournalEvent(encodeJournalEvent(event))).toEqual(event)
  })
)

it.effect("rejects malformed payloads, unsupported versions, and invalid event shapes", () =>
  Effect.gen(function* () {
    const kind = JournalEventKind.make("TaskTrackerReadIntentRecorded")
    const cases = [
      { kind, payloadJson: "{", version: JournalEventVersion.make(6) },
      { kind, payloadJson: "[]", version: JournalEventVersion.make(6) },
      { kind, payloadJson: "{}", version: JournalEventVersion.make(5) },
      { kind, payloadJson: "{}", version: JournalEventVersion.make(6) }
    ]
    for (const encoded of cases) {
      const issue = yield* decodeJournalEvent(encoded).pipe(Effect.flip)
      expect(issue._tag).toBe("JournalEventDecodeIssue")
    }
  })
)

it.effect("rejects removed session-only Integrator journal rows", () =>
  Effect.gen(function* () {
    const qualifiedCandidate = integrationFinalityFixture.promotionCorrelation.qualifiedCandidate
    const correlation = qualifiedCandidate.run.session
    const preparedResult = {
      _tag: "PreparedCandidate" as const,
      candidateText: qualifiedCandidate.candidateText,
      correlation
    }
    const observation = {
      _tag: "Commit" as const,
      candidateText: qualifiedCandidate.candidateText,
      commit: qualifiedCandidate.candidateCommit,
      directParents: qualifiedCandidate.directParents
    }
    const removedRows = [
      { kind: "IntegratorResultRecorded", payload: { result: preparedResult } },
      {
        kind: "IntegratorCandidateGitReadIntended",
        payload: { candidateText: qualifiedCandidate.candidateText, correlation }
      },
      {
        kind: "IntegratorCandidateGitObserved",
        payload: { candidateText: qualifiedCandidate.candidateText, correlation, observation }
      }
    ] as const

    for (const removedRow of removedRows) {
      const issue = yield* decodeJournalEvent({
        kind: JournalEventKind.make(removedRow.kind),
        payloadJson: JSON.stringify(removedRow.payload),
        version: JournalEventVersion.make(workflowJournalEventVersion)
      }).pipe(Effect.flip)
      expect(issue._tag).toBe("JournalEventDecodeIssue")
    }
  })
)

it.effect("rejects target-lineage evidence for a different planned Base SHA", () =>
  Effect.gen(function* () {
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("event-codec-attempt"),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/event-codec"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId: RunId.make("event-codec-run"),
      taskId: TaskId.make("event-codec-task"),
      taskRevision: TaskRevision.make("event-codec-revision"),
      worktree: WorktreeLocator.make("/worktrees/event-codec")
    })
    const valid = encodeJournalEvent(
      TargetLineageObservedEvent.make({
        observation: {
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: plannedAttempt.baseSha,
          targetHeadSha: GitCommitSha.make("3".repeat(40))
        },
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make("event-codec-target-lineage"),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const payload = JSON.parse(valid.payloadJson) as { observation: { plannedBaseSha: string } }
    const encoded = {
      ...valid,
      payloadJson: JSON.stringify({
        ...payload,
        observation: { ...payload.observation, plannedBaseSha: "2".repeat(40) }
      })
    }

    expect((yield* decodeJournalEvent(encoded).pipe(Effect.flip))._tag).toBe("JournalEventDecodeIssue")
  })
)
