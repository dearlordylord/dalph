import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { InRunJournal, JournalStoreContradiction } from "../../../workflow-journal/store.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationStartedEvent } from "../integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantinedEvent,
  integrationQuarantineDirectionSubject
} from "../integration-quarantine/events.js"
import { IntegratorJournalContradiction } from "./errors.js"
import { Integrator, IntegratorGit, prepareIntegrationCandidateRun } from "./protocol.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../integration-quarantine/initial-conclusive.js"
import {
  IntegrationQuarantineDirectionNotAvailable,
  makeIntegrationQuarantineDirectionControl
} from "../integration-quarantine/control.js"
import { deriveIntegrationQuarantineState } from "../integration-quarantine/state.js"
import {
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent
} from "./events.js"
import { appendIntegratorSuccessorSessionIfNeeded, readActiveIntegratorSession } from "./successor-session.js"
import {
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  IntegratorPreparationInput,
  IntegratorSuccessorPreparationInput
} from "./session.js"
import { deriveCurrentIntegratorState, integratorResponsibilityFactsFromCorrelation } from "./state.js"

const sha = (value: string): GitCommitSha => GitCommitSha.make(value.repeat(40))

const runId = RunId.make("run-successor-1")
const attemptId = AttemptId.make("attempt-successor-1")
const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/successor.git")
})
const base = sha("a")
const predecessorHead = sha("b")
const freshHead = sha("c")
const acceptedCommit = sha("d")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId,
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/successor-1"),
  executor: TaskExecutorLocator.make("executor:successor-test"),
  runId,
  taskId: TaskId.make("task-successor-1"),
  taskRevision: TaskRevision.make("revision-successor-1"),
  worktree: WorktreeLocator.make("/worktrees/successor-1")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedCommit),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(2),
  startedAt: JournalPosition.make(3)
})
const predecessorInput = IntegratorPreparationInput.make({
  responsibility,
  targetLineage: TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: base,
    targetHeadSha: predecessorHead
  }),
  targetLineageObservedAt: JournalPosition.make(5)
})
const predecessor = integratorCorrelationFor(predecessorInput)

const journalRecord = (
  position: number,
  event: JournalRecord["event"],
  key = JournalRecordKey.make(`successor-test:${position}`)
): JournalRecord => ({ event, key, position: JournalPosition.make(position), runId })

const makeFixture = (observedHead: GitCommitSha = freshHead, observedAt: number = 15): ReadonlyArray<JournalRecord> => {
  const originalOperationId = OperationId.make("successor-original-lineage")
  const freshOperationId = OperationId.make("successor-fresh-lineage")
  const runOne = integratorRunCorrelationForSession(predecessor, IntegratorRunOrdinal.make(1))
  const detail = IntegratorNotPreparedDetail.make("successor fixture has no usable first-run candidate")
  const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause: { _tag: "NotPrepared", detail },
    evidence: { resultRecordedAt: JournalPosition.make(8) }
  })
  const quarantine = IntegrationQuarantinedEvent.make({
    basis,
    correlation: predecessor,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const direction = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt: JournalPosition.make(10),
      sessionId: predecessor.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "successor-test", runId }),
    version: workflowJournalEventVersion
  })
  const originalOperation = makeTargetLineageObservationOperation({
    integrationTarget: target,
    operationId: originalOperationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  const freshOperation = makeTargetLineageObservationOperation({
    integrationTarget: target,
    operationId: freshOperationId,
    plannedAttempt,
    predecessorOperationIds: [originalOperationId]
  })
  return [
    journalRecord(
      3,
      IntegrationStartedEvent.make({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: target,
        plannedAttempt,
        responsibilityBeganAt: responsibility.queuedAt,
        version: workflowJournalEventVersion
      })
    ),
    journalRecord(
      4,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: originalOperation,
        version: workflowJournalEventVersion
      })
    ),
    journalRecord(
      5,
      TargetLineageObservedEvent.make({
        observation: predecessorInput.targetLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId: originalOperationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    journalRecord(
      6,
      IntegratorSessionFixedEvent.make({ correlation: predecessor, version: workflowJournalEventVersion }),
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(predecessor))
    ),
    journalRecord(
      7,
      IntegratorRunStartedEvent.make({ run: runOne, version: workflowJournalEventVersion }),
      integratorRunStartedRecordKey(runOne)
    ),
    journalRecord(
      8,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: predecessor, detail }),
        run: runOne,
        version: workflowJournalEventVersion
      }),
      integratorRunResultRecordedRecordKey(runOne)
    ),
    journalRecord(10, quarantine, integrationQuarantinedRecordKey(predecessor.sessionId, basis)),
    journalRecord(
      12,
      direction,
      integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(direction.fingerprint))
    ),
    journalRecord(
      14,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: freshOperation,
        version: workflowJournalEventVersion
      }),
      intentRecordKey(freshOperationId)
    ),
    journalRecord(
      observedAt,
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: base,
          targetHeadSha: observedHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: freshOperationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(freshOperationId)
    )
  ].map((record) => ({ ...record, position: record.position }))
}

const makeJournal = (initial: ReadonlyArray<JournalRecord>) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial)
    const journal = InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const appended: JournalRecord = {
            event,
            key,
            position: JournalPosition.make(Math.max(...current.map((record) => Number(record.position))) + 1),
            runId: requestedRunId
          }
          return [Effect.succeed(appended), [...current, appended]] as const
        }).pipe(Effect.flatMap((result) => result)),
      read: (requestedRunId) =>
        Ref.get(records).pipe(Effect.map((current) => current.filter(({ runId: id }) => id === requestedRunId)))
    })
    return { journal, records }
  })

const successorInputFor = (records: ReadonlyArray<JournalRecord>): IntegratorSuccessorPreparationInput | undefined => {
  const observation = records.at(-1)
  return observation?.event._tag === "TargetLineageObserved"
    ? IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage: observation.event.observation,
        targetLineageObservedAt: observation.position
      })
    : undefined
}

describe("Integrator FullRerun successor session", () => {
  it.effect("preserves predecessor resources for separately authorized cleanup", () =>
    Effect.gen(function* () {
      const initial = makeFixture(predecessorHead)
      const freshObservation = initial.at(-1)
      if (freshObservation === undefined) return yield* Effect.die("fixture lacks fresh observation")
      const input = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage:
          freshObservation.event._tag === "TargetLineageObserved"
            ? freshObservation.event.observation
            : yield* Effect.die("fixture lacks TargetLineageObserved"),
        targetLineageObservedAt: freshObservation.position
      })
      const { journal, records } = yield* makeJournal(initial)
      const first = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, initial)
      const second = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, yield* Ref.get(records))
      expect(second).toEqual(first)
      expect(first.event.predecessor.candidateResource).toBe(predecessor.candidateResource)
      expect(first.event.successor.candidateResource).not.toBe(predecessor.candidateResource)
      expect(first.event.successor.sessionId).not.toBe(predecessor.sessionId)
      expect(first.event.successor.expectedTargetHead).toBe(predecessorHead)
      expect(first.event.successor.queuedAt).toBe(predecessor.queuedAt)
      expect(first.event.successor.startedAt).toBe(predecessor.startedAt)
      expect(first.event.successor.acceptedResult).toEqual(predecessor.acceptedResult)
      expect(
        (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
      ).toHaveLength(1)
      const active = yield* readActiveIntegratorSession(yield* Ref.get(records), responsibility)
      expect(Option.isSome(active) && active.value.sessionId).toBe(first.event.successor.sessionId)
      expect(deriveCurrentIntegratorState(yield* Ref.get(records), responsibility)).toMatchObject({
        _tag: "RunUnfinished",
        run: { ordinal: IntegratorRunOrdinal.make(1), session: first.event.successor }
      })
    })
  )

  it.effect("recovers a recorded full rerun without creating a second successor", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const input = successorInputFor(initial)
      if (input === undefined) return yield* Effect.die("successor fixture lacks fresh observation")
      const { journal, records } = yield* makeJournal(initial)

      const first = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, initial)
      const recovered = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, yield* Ref.get(records))
      const reconstructed = yield* readActiveIntegratorSession(yield* Ref.get(records), responsibility)

      expect(recovered).toEqual(first)
      expect(Option.isSome(reconstructed) && reconstructed.value).toEqual(first.event.successor)
      expect(
        (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
      ).toHaveLength(1)
    })
  )

  it.effect("rejects a read intended before D even when its observation arrives afterward", () =>
    Effect.gen(function* () {
      const initial = makeFixture(predecessorHead).map((record) =>
        record.position === JournalPosition.make(14) ? { ...record, position: JournalPosition.make(11) } : record
      )
      const observation = initial.find(({ position }) => position === JournalPosition.make(15))
      if (observation?.event._tag !== "TargetLineageObserved") return yield* Effect.die("fixture lacks observation")
      const input = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage: observation.event.observation,
        targetLineageObservedAt: observation.position
      })
      const { journal } = yield* makeJournal(initial)
      const failure = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, initial).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("full rerun preserves queue position and starts one successor session at the fresh head", () =>
    Effect.gen(function* () {
      const initial = [
        makeWorkflowRunBeganRecord(
          runId,
          FixtureTarget.make("successor-session-test"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        ),
        ...makeFixture(freshHead)
      ]
      const observation = initial.find(({ position }) => position === JournalPosition.make(15))
      if (observation?.event._tag !== "TargetLineageObserved") return yield* Effect.die("fixture lacks observation")
      const successorInput = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage: observation.event.observation,
        targetLineageObservedAt: observation.position
      })
      const { journal, records } = yield* makeJournal(initial)
      const fixed = yield* appendIntegratorSuccessorSessionIfNeeded(journal, successorInput, initial)
      let calls = 0
      const run = integratorRunCorrelationForSession(fixed.event.successor, IntegratorRunOrdinal.make(1))
      const result = yield* prepareIntegrationCandidateRun({
        preparation: {
          responsibility,
          targetLineage: observation.event.observation,
          targetLineageObservedAt: observation.position
        },
        run
      }).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.sync(() => {
                calls += 1
                return IntegratorResult.cases.NotPrepared.make({
                  correlation: request.correlation,
                  detail: IntegratorNotPreparedDetail.make("controlled successor run result")
                })
              })
          })
        ),
        Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
        Effect.provideService(InRunJournal, journal)
      )
      expect(result).toMatchObject({ _tag: "NotPrepared", run })
      if (result._tag !== "NotPrepared") return yield* Effect.die("controlled S2 run must be NotPrepared")
      const quarantine = yield* appendInitialConclusiveIntegrationQuarantine(result).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const directionControl = yield* makeIntegrationQuarantineDirectionControl(journal)
      const secondSuccessor = yield* directionControl
        .apply({
          fingerprint: { direction: "FullRerun", quarantineAt: quarantine.position, sessionId: run.session.sessionId },
          requestId: { nonce: "second-successor", runId }
        })
        .pipe(Effect.flip)
      expect(quarantine.event.correlation.sessionId).toBe(run.session.sessionId)
      expect(secondSuccessor).toBeInstanceOf(IntegrationQuarantineDirectionNotAvailable)
      expect(secondSuccessor).toMatchObject({ reason: "SuccessorGenerationLimitReached" })
      expect(deriveIntegrationQuarantineState(yield* Ref.get(records), run.session.sessionId)._tag).toBe("Quarantined")
      const invalidFingerprint = IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: quarantine.position,
        sessionId: run.session.sessionId
      })
      yield* journal.append(
        runId,
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(invalidFingerprint)),
        IntegrationQuarantineDirectionAppliedEvent.make({
          fingerprint: invalidFingerprint,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "persisted-second-successor", runId }),
          version: workflowJournalEventVersion
        })
      )
      expect(deriveIntegrationQuarantineState(yield* Ref.get(records), run.session.sessionId)._tag).toBe(
        "Contradiction"
      )
      expect(calls).toBe(1)
      expect(run.session.queuedAt).toBe(predecessor.queuedAt)
      expect(
        (yield* Ref.get(records)).filter(
          ({ event }) => event._tag === "IntegratorRunStarted" && event.run.session.sessionId === predecessor.sessionId
        )
      ).toHaveLength(1)
      expect(
        (yield* Ref.get(records)).filter(
          ({ event }) => event._tag === "IntegratorRunStarted" && event.run.session.sessionId === run.session.sessionId
        )
      ).toHaveLength(1)
      expect(
        (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
      ).toHaveLength(1)
    })
  )

  it.effect("rejects a fresh observation reordered before D", () =>
    Effect.gen(function* () {
      const initial = makeFixture(predecessorHead, 11)
      const observation = initial.at(-1)
      if (observation?.event._tag !== "TargetLineageObserved") return yield* Effect.die("fixture lacks observation")
      const input = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage: observation.event.observation,
        targetLineageObservedAt: observation.position
      })
      const { journal } = yield* makeJournal(initial)
      const failure = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, initial).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("rejects a second successor identity under the one predecessor key", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const observation = initial.at(-1)
      if (observation?.event._tag !== "TargetLineageObserved") return yield* Effect.die("fixture lacks observation")
      const input = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage: observation.event.observation,
        targetLineageObservedAt: observation.position
      })
      const { journal, records } = yield* makeJournal(initial)
      yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, initial)
      const later = yield* journal.append(
        runId,
        intentRecordKey(OperationId.make("successor-second-lineage")),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: makeTargetLineageObservationOperation({
            integrationTarget: target,
            operationId: OperationId.make("successor-second-lineage"),
            plannedAttempt,
            predecessorOperationIds: []
          }),
          version: workflowJournalEventVersion
        })
      )
      const secondObserved = yield* journal.append(
        runId,
        outcomeRecordKey(OperationId.make("successor-second-lineage")),
        TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: base,
            targetHeadSha: predecessorHead
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("successor-second-lineage"),
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const secondInput = IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(10),
        targetLineage:
          secondObserved.event._tag === "TargetLineageObserved"
            ? secondObserved.event.observation
            : yield* Effect.die("fixture lacks second observation"),
        targetLineageObservedAt: secondObserved.position
      })
      const failure = yield* appendIntegratorSuccessorSessionIfNeeded(
        journal,
        secondInput,
        yield* Ref.get(records)
      ).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      expect(
        (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
      ).toHaveLength(1)
      void later
    })
  )

  it.effect("rejects every missing or contradictory FullRerun predecessor fact before appending S2", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const input = successorInputFor(initial)
      if (input === undefined) return yield* Effect.die("successor fixture lacks fresh observation")

      const cases: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
        initial.filter((record) => record.event._tag !== "IntegratorSessionFixed"),
        initial.map((record) =>
          record.event._tag === "IntegratorSessionFixed" ? { ...record, position: JournalPosition.make(5) } : record
        ),
        initial.map((record) =>
          record.event._tag === "IntegratorSessionFixed" ? { ...record, position: JournalPosition.make(11) } : record
        ),
        initial.map((record) =>
          record.event._tag === "IntegrationStarted"
            ? { ...record, event: { ...record.event, responsibilityBeganAt: JournalPosition.make(99) } }
            : record
        ),
        initial.filter((record) => record.position !== JournalPosition.make(10)),
        initial.map((record) =>
          record.event._tag === "IntegrationQuarantineDirectionApplied"
            ? {
                ...record,
                event: { ...record.event, fingerprint: { ...record.event.fingerprint, direction: "Retry" as const } }
              }
            : record
        ),
        initial.map((record) =>
          record.event._tag === "TargetLineageObserved" && record.position === JournalPosition.make(15)
            ? {
                ...record,
                event: {
                  ...record.event,
                  observation: { ...record.event.observation, plannedBaseIsAncestorOfTargetHead: false }
                }
              }
            : record
        ),
        initial.filter((record) => record.position !== JournalPosition.make(14)),
        initial.map((record) =>
          record.event._tag === "TargetLineageObserved" && record.position === JournalPosition.make(15)
            ? {
                ...record,
                event: {
                  ...record.event,
                  observation: { ...record.event.observation, plannedBaseSha: predecessorHead }
                }
              }
            : record
        ),
        initial.map((record) =>
          record.event._tag === "TargetLineageObserved" && record.position === JournalPosition.make(15)
            ? { ...record, position: JournalPosition.make(11) }
            : record
        )
      ]

      for (const records of cases) {
        const failure = yield* appendIntegratorSuccessorSessionIfNeeded(
          {
            append: () => Effect.die("invalid predecessor facts must not append"),
            read: () => Effect.succeed(records)
          },
          input,
          records
        ).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
      }

      const direction = initial.find((record) => record.event._tag === "IntegrationQuarantineDirectionApplied")
      if (direction === undefined) return yield* Effect.die("successor fixture lacks direction evidence")
      const duplicateDirection = [
        ...initial,
        {
          ...direction,
          key: JournalRecordKey.make("successor-duplicate-direction"),
          position: JournalPosition.make(16)
        }
      ]
      const invalidState = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("contradictory quarantine state must not append"),
          read: () => Effect.succeed(duplicateDirection)
        },
        input,
        duplicateDirection
      ).pipe(Effect.flip)
      expect(invalidState).toBeInstanceOf(IntegratorJournalContradiction)

      const incompatibleInput = IntegratorSuccessorPreparationInput.make({
        ...input,
        targetLineage: { ...input.targetLineage, plannedBaseSha: predecessorHead }
      })
      const incompatible = yield* appendIntegratorSuccessorSessionIfNeeded(
        { append: () => Effect.die("incompatible lineage must not append"), read: () => Effect.succeed(initial) },
        incompatibleInput,
        initial
      ).pipe(Effect.flip)
      expect(incompatible).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("rejects duplicate or foreign successor identities and collisions with existing resources", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const input = successorInputFor(initial)
      if (input === undefined) return yield* Effect.die("successor fixture lacks fresh observation")

      const validJournal = yield* makeJournal(initial)
      const valid = yield* appendIntegratorSuccessorSessionIfNeeded(validJournal.journal, input, initial)
      const duplicateKeyRecords = [
        ...initial,
        { ...valid, position: JournalPosition.make(16) },
        { ...valid, position: JournalPosition.make(17) }
      ]
      const duplicateKey = yield* appendIntegratorSuccessorSessionIfNeeded(
        { append: () => Effect.die("duplicate key must not append"), read: () => Effect.succeed(duplicateKeyRecords) },
        input,
        duplicateKeyRecords
      ).pipe(Effect.flip)
      expect(duplicateKey).toBeInstanceOf(IntegratorJournalContradiction)

      const foreignKeyRecords = [
        ...initial,
        { ...valid, key: JournalRecordKey.make("successor-foreign-key"), position: JournalPosition.make(16) }
      ]
      const foreignKey = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("foreign successor key must not append"),
          read: () => Effect.succeed(foreignKeyRecords)
        },
        input,
        foreignKeyRecords
      ).pipe(Effect.flip)
      expect(foreignKey).toBeInstanceOf(IntegratorJournalContradiction)

      const fixed = initial.find((record) => record.event._tag === "IntegratorSessionFixed")
      if (fixed === undefined) return yield* Effect.die("successor fixture lacks fixed session")
      const collision = {
        ...fixed,
        event: IntegratorSessionFixedEvent.make({
          correlation: { ...predecessor, sessionId: valid.event.successor.sessionId },
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("successor-collision"),
        position: JournalPosition.make(16)
      }
      const collisionRecords = [...initial, collision]
      const collisionFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("identity collision must not append"),
          read: () => Effect.succeed(collisionRecords)
        },
        input,
        collisionRecords
      ).pipe(Effect.flip)
      expect(collisionFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const resourceCollision = {
        ...fixed,
        event: IntegratorSessionFixedEvent.make({
          correlation: { ...predecessor, candidateResource: valid.event.successor.candidateResource },
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("successor-resource-collision"),
        position: JournalPosition.make(16)
      }
      const resourceCollisionRecords = [...initial, resourceCollision]
      const resourceCollisionFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("resource collision must not append"),
          read: () => Effect.succeed(resourceCollisionRecords)
        },
        input,
        resourceCollisionRecords
      ).pipe(Effect.flip)
      expect(resourceCollisionFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const foreignPredecessorSession = IntegratorSessionId.make("foreign-predecessor")
      const successorSessionCollision = {
        ...valid,
        event: IntegratorSuccessorSessionFixedEvent.make({
          ...valid.event,
          predecessor: { ...valid.event.predecessor, sessionId: foreignPredecessorSession }
        }),
        key: JournalRecordKey.make("successor-session-collision"),
        position: JournalPosition.make(16)
      }
      const successorSessionCollisionRecords = [...initial, successorSessionCollision]
      const successorSessionCollisionFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("successor session identity collision must not append"),
          read: () => Effect.succeed(successorSessionCollisionRecords)
        },
        input,
        successorSessionCollisionRecords
      ).pipe(Effect.flip)
      expect(successorSessionCollisionFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const successorResourceCollision = {
        ...successorSessionCollision,
        event: IntegratorSuccessorSessionFixedEvent.make({
          ...valid.event,
          predecessor: { ...valid.event.predecessor, sessionId: foreignPredecessorSession },
          successor: { ...valid.event.successor, sessionId: IntegratorSessionId.make("another-successor") }
        }),
        key: JournalRecordKey.make("successor-resource-collision")
      }
      const successorResourceCollisionRecords = [...initial, successorResourceCollision]
      const successorResourceCollisionFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("successor resource identity collision must not append"),
          read: () => Effect.succeed(successorResourceCollisionRecords)
        },
        input,
        successorResourceCollisionRecords
      ).pipe(Effect.flip)
      expect(successorResourceCollisionFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const relatedOne = {
        ...valid,
        key: JournalRecordKey.make("successor-related-one"),
        position: JournalPosition.make(16)
      }
      const relatedTwo = {
        ...valid,
        key: JournalRecordKey.make("successor-related-two"),
        position: JournalPosition.make(17)
      }
      const relatedFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("duplicate related successors must not append"),
          read: () => Effect.succeed([...initial, relatedOne, relatedTwo])
        },
        input,
        [...initial, relatedOne, relatedTwo]
      ).pipe(Effect.flip)
      expect(relatedFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const differentSubject = {
        ...valid,
        key: JournalRecordKey.make("successor-different-subject"),
        position: JournalPosition.make(16),
        event: IntegratorSuccessorSessionFixedEvent.make({ ...valid.event, quarantineAt: JournalPosition.make(9) })
      }
      const subjectFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("different successor subject must not append"),
          read: () => Effect.succeed([...initial, differentSubject])
        },
        input,
        [...initial, differentSubject]
      ).pipe(Effect.flip)
      expect(subjectFailure).toBeInstanceOf(IntegratorJournalContradiction)

      const contradictoryIdentity = {
        ...valid,
        key: JournalRecordKey.make("successor-contradictory-identity"),
        position: JournalPosition.make(16),
        event: IntegratorSuccessorSessionFixedEvent.make({
          ...valid.event,
          successor: { ...valid.event.successor, sessionId: IntegratorSessionId.make("another-successor") }
        })
      }
      const identityFailure = yield* appendIntegratorSuccessorSessionIfNeeded(
        {
          append: () => Effect.die("contradictory successor identity must not append"),
          read: () => Effect.succeed([...initial, contradictoryIdentity])
        },
        input,
        [...initial, contradictoryIdentity]
      ).pipe(Effect.flip)
      expect(identityFailure).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("reconciles an ambiguous successor append only when the reread contains the exact winner", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const input = successorInputFor(initial)
      if (input === undefined) return yield* Effect.die("successor fixture lacks fresh observation")
      let winner: JournalRecord | undefined
      const winningJournal: InRunJournal["Service"] = {
        append: (requestedRunId, key, event) => {
          winner = { event, key, position: JournalPosition.make(16), runId: requestedRunId }
          return Effect.fail(
            new JournalStoreContradiction({ existingPosition: JournalPosition.make(16), key, runId: requestedRunId })
          )
        },
        read: () => Effect.succeed(winner === undefined ? initial : [...initial, winner])
      }
      const recovered = yield* appendIntegratorSuccessorSessionIfNeeded(winningJournal, input, initial)
      expect(recovered.position).toBe(16)

      const losingJournal: InRunJournal["Service"] = {
        append: (requestedRunId, key, _event) =>
          Effect.fail(
            new JournalStoreContradiction({ existingPosition: JournalPosition.make(16), key, runId: requestedRunId })
          ),
        read: () => Effect.succeed(initial)
      }
      const rejected = yield* appendIntegratorSuccessorSessionIfNeeded(losingJournal, input, initial).pipe(Effect.flip)
      expect(rejected).toBeInstanceOf(IntegratorJournalContradiction)

      const foreignRecord = initial.find((record) => record.event._tag === "IntegrationStarted")
      if (foreignRecord === undefined) return yield* Effect.die("successor fixture lacks IntegrationStarted")
      const foreignAppendJournal: InRunJournal["Service"] = {
        append: (requestedRunId, key) =>
          Effect.succeed({ ...foreignRecord, key, runId: requestedRunId, position: JournalPosition.make(16) }),
        read: () => Effect.succeed(initial)
      }
      const foreignAppend = yield* appendIntegratorSuccessorSessionIfNeeded(foreignAppendJournal, input, initial).pipe(
        Effect.flip
      )
      expect(foreignAppend).toBeInstanceOf(IntegratorJournalContradiction)
    })
  )

  it.effect("fails closed when reconstructing an active successor from duplicate, incomplete, or foreign history", () =>
    Effect.gen(function* () {
      const initial = makeFixture(freshHead)
      const input = successorInputFor(initial)
      if (input === undefined) return yield* Effect.die("successor fixture lacks fresh observation")
      const active = (records: ReadonlyArray<JournalRecord>) =>
        readActiveIntegratorSession(records, responsibility).pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Failure" as const, error }),
            onSuccess: (value) => ({ _tag: "Success" as const, value })
          })
        )

      const absent = yield* readActiveIntegratorSession(initial, responsibility)
      expect(Option.isSome(absent)).toBe(true)

      const validJournal = yield* makeJournal(initial)
      const fixed = yield* appendIntegratorSuccessorSessionIfNeeded(validJournal.journal, input, initial)
      const validRecords = yield* Ref.get(validJournal.records)
      const duplicate = yield* active([
        ...validRecords,
        { ...fixed, key: JournalRecordKey.make("successor-duplicate"), position: JournalPosition.make(17) }
      ])
      expect(duplicate._tag).toBe("Failure")

      const missingLineage = yield* active(
        validRecords.filter((record) => record.position !== fixed.event.successor.targetLineageObservedAt)
      )
      expect(missingLineage._tag).toBe("Failure")

      const foreignPredecessor = validRecords.map((record) =>
        record.event._tag === "IntegratorSuccessorSessionFixed"
          ? {
              ...record,
              event: IntegratorSuccessorSessionFixedEvent.make({
                ...record.event,
                predecessor: { ...record.event.predecessor, expectedTargetHead: freshHead }
              })
            }
          : record
      )
      const foreign = yield* active(foreignPredecessor)
      expect(foreign._tag).toBe("Failure")

      const foreignIdentity = validRecords.map((record) =>
        record.event._tag === "IntegratorSuccessorSessionFixed"
          ? {
              ...record,
              event: IntegratorSuccessorSessionFixedEvent.make({
                ...record.event,
                successor: { ...record.event.successor, sessionId: IntegratorSessionId.make("foreign-successor") }
              })
            }
          : record
      )
      const foreignIdentityResult = yield* active(foreignIdentity)
      expect(foreignIdentityResult._tag).toBe("Failure")

      const invalidPredecessor = yield* active(
        validRecords.filter((record) => record.event._tag !== "IntegrationStarted")
      )
      expect(invalidPredecessor._tag).toBe("Failure")

      const beforeFresh = validRecords.map((record) =>
        record.event._tag === "IntegratorSuccessorSessionFixed"
          ? { ...record, position: JournalPosition.make(14) }
          : record
      )
      const reordered = yield* active(beforeFresh)
      expect(reordered._tag).toBe("Failure")

      const unrelatedResponsibility = StartedIntegrationResponsibility.make({
        ...responsibility,
        plannedAttempt: { ...responsibility.plannedAttempt, runId: RunId.make("unrelated-successor-run") }
      })
      const noPredecessor = yield* readActiveIntegratorSession(initial, unrelatedResponsibility)
      expect(Option.isNone(noPredecessor)).toBe(true)
    })
  )
})
