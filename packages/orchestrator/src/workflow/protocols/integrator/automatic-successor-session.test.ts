import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { GitCommitSha } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Context, Effect, FileSystem, Layer, Path, type Scope } from "effect"
import { WorkflowActor } from "../../registry/actor.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { Journal, journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { JournalDatabaseLocator, JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { OperationId } from "../../identity.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import { IntegrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import { applyRemotePublicationBatchGrantWithAdmission } from "../direct-publication/batch-grant-control.js"
import {
  RemotePublicationBatchGrantRequest,
  RemotePublicationBatchGrantRequestId
} from "../direct-publication/events.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorAutomaticSuccessorSessionFixedEvent,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunStartedEvent,
  IntegratorRunResultRecordedEvent
} from "./events.js"
import {
  integratorAutomaticSuccessorPreparationIsCurrent,
  prepareIntegratorAutomaticSuccessorSessionAppend,
  validateAutomaticSuccessorSessionFixedRecord
} from "./automatic-successor-session.js"
import { integratorSessionCapacityFor, integratorSessionCapacityForJournal } from "./session-capacity.js"
import { evaluateIntegratorRetryAuthorization } from "./retry-authorization.js"
import { deriveCurrentIntegratorState } from "./state.js"
import { makeSuccessorPrefix } from "../../../../test/support/automatic-successor-history.js"
import { appendAutomaticSuccessorGeneration } from "../../../../test/support/automatic-successor-generation.js"

const seedStoreWithPrefix = Effect.fn("AutomaticSuccessorSessionTest.seedStoreWithPrefix")(function* (
  store: JournalStore["Service"],
  prefix: ReturnType<typeof makeSuccessorPrefix>
) {
  const [began, ...remaining] = prefix.records()
  if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("accepted prefix must begin the Run")
  yield* store.beginRun(
    prefix.runId,
    began.event.target,
    began.event.initialControlPolicy,
    began.event.remotePublicationTarget
  )
  for (const record of remaining) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("prefix may not contain another Run lifecycle event")
    }
    yield* store.append(prefix.runId, record.key, record.event)
  }
})

const existingAutomaticSuccessorCount = (records: ReadonlyArray<JournalRecord>): number =>
  records.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed").length

it.effect("reconstructs a fourth automatic successor only after its exact publication batch grant", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const s2 = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
    if (s2._tag !== "Append") return yield* Effect.die("the accepted prefix must fix S2")
    fixture.append(s2.event)

    const secondGeneration = appendAutomaticSuccessorGeneration(
      fixture,
      s2.event.successor,
      GitCommitSha.make("8".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(2)
    )
    const s3 = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      secondGeneration.input,
      secondGeneration.reduction.prefix
    )
    if (s3._tag !== "Append") return yield* Effect.die("the ungranted limit must allow exactly S3")
    fixture.append(s3.event)

    const thirdGeneration = appendAutomaticSuccessorGeneration(
      fixture,
      s3.event.successor,
      GitCommitSha.make("9".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(3)
    )
    expect(integratorSessionCapacityForJournal(fixture.records(), fixture.input.predecessor)._tag).toBe("Exhausted")
    const ungrantedS4 = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(thirdGeneration.input, thirdGeneration.reduction.prefix)
    )
    expect(ungrantedS4._tag).toBe("Failure")
    const exhaustion = fixture
      .records()
      .findLast(
        ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "CompatibleCompetingHead"
      )
    if (exhaustion?.event._tag !== "RemotePublicationRetained") {
      return yield* Effect.die("S3 must have its own compatible competing-head retained occurrence")
    }

    const context = yield* Layer.build(
      liveJournalTestLayer({ records: fixture.records(), runId: fixture.runId, target: fixture.accepted.trackerTarget })
    )
    const journal = Context.get(context, Journal)
    const inRunJournal = Context.get(context, InRunJournal)
    const grant = yield* applyRemotePublicationBatchGrantWithAdmission(
      fixture.runId,
      journal,
      RemotePublicationBatchGrantRequest.make({
        exhaustionAt: exhaustion.position,
        requestId: RemotePublicationBatchGrantRequestId.make("automatic-successor-batch-grant"),
        responsibility: IntegrationResponsibilityIdentity.make({
          queuedAt: fixture.input.predecessor.queuedAt,
          runId: fixture.runId
        }),
        runId: fixture.runId,
        schemaVersion: 1
      })
    )
    expect(grant._tag).toBe("NewlyRecordedBatchGrant")

    const acceptedGrantPrefix = yield* journal.state.get
    const s4 = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      thirdGeneration.input,
      acceptedGrantPrefix.prefix
    )
    if (s4._tag !== "Append") return yield* Effect.die("the exact grant must authorize S4")
    expect(s4.event.publicationBatchGrantAt).toBe(grant.result.acceptedAt)
    expect(s4.event.successorGeneration).toBe(4)
    yield* inRunJournal.append(fixture.runId, s4.key, s4.event)

    const extendedPrefix = yield* journal.state.get
    const current = deriveCurrentIntegratorState(extendedPrefix.prefix, fixture.accepted.responsibility)
    expect(current).toMatchObject({ _tag: "RunUnfinished", run: { session: s4.event.successor } })
    const recovered = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      thirdGeneration.input,
      extendedPrefix.prefix
    )
    expect(recovered).toMatchObject({ _tag: "Existing", record: { position: extendedPrefix.position } })
    expect(existingAutomaticSuccessorCount(yield* inRunJournal.read(fixture.runId))).toBe(3)
  })
)

it("counts predecessor and successor identities together against the shared session capacity", () => {
  const predecessor = makeSuccessorPrefix().input.predecessor
  const successor = IntegratorSessionCorrelation.make({
    ...predecessor,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:capacity-successor"),
    sessionId: IntegratorSessionId.make("integrator-session:capacity-successor")
  })
  const finalSuccessor = IntegratorSessionCorrelation.make({
    ...successor,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:capacity-final-successor"),
    sessionId: IntegratorSessionId.make("integrator-session:capacity-final-successor")
  })
  const capacity = integratorSessionCapacityFor(predecessor, [
    { _tag: "Successor", predecessor, successor },
    { _tag: "Successor", predecessor: successor, successor: finalSuccessor }
  ])

  expect(capacity._tag).toBe("Exhausted")
  expect(Array.from(capacity.fixedSessionIds)).toEqual([
    predecessor.sessionId,
    successor.sessionId,
    finalSuccessor.sessionId
  ])

  const foreignResponsibility = IntegratorSessionCorrelation.make({
    ...predecessor,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-capacity"),
    sessionId: IntegratorSessionId.make("integrator-session:foreign-capacity"),
    startedAt: JournalPosition.make(Number(predecessor.startedAt) + 1)
  })
  const foreignCapacity = integratorSessionCapacityFor(predecessor, [
    { _tag: "Initial", correlation: foreignResponsibility }
  ])
  expect(foreignCapacity._tag).toBe("NoFixedSession")
  expect(foreignCapacity.fixedSessionIds.size).toBe(0)
})

const proveFixedAppendRecovery = Effect.fn("AutomaticSuccessorSessionTest.proveFixedAppendRecovery")(function* (
  store: JournalStore["Service"],
  fixture: ReturnType<typeof makeSuccessorPrefix>,
  loseAppendAcknowledgement: boolean
) {
  const before = yield* store.read(fixture.runId)
  const beforeHistory = reduceWorkflowJournalHistory(fixture.runId, before)
  if (beforeHistory._tag !== "ValidWorkflowJournalHistory") {
    return yield* Effect.die("fixed-session recovery starts from one accepted exact prefix")
  }
  const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, beforeHistory.prefix)
  if (prepared._tag !== "Append") return yield* Effect.die("recovery prefix must prepare exactly one fixed successor")
  if (loseAppendAcknowledgement) {
    return yield* store
      .append(fixture.runId, prepared.key, prepared.event)
      .pipe(Effect.andThen(Effect.die("process lost after the fixed-session append committed")))
  }
  yield* store.append(fixture.runId, prepared.key, prepared.event)
})

const proveFixedAppendRecovered = Effect.fn("AutomaticSuccessorSessionTest.proveFixedAppendRecovered")(function* (
  store: JournalStore["Service"],
  fixture: ReturnType<typeof makeSuccessorPrefix>
) {
  const after = yield* store.read(fixture.runId)
  const history = reduceWorkflowJournalHistory(fixture.runId, after)
  if (history._tag !== "ValidWorkflowJournalHistory") {
    return yield* Effect.die("fixed-session recovery must retain a valid accepted journal")
  }
  expect(existingAutomaticSuccessorCount(after)).toBe(1)
  const expected = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
  if (expected._tag !== "Append")
    return yield* Effect.die("the same original prefix must prepare the exact fixed event")
  const persisted = after.find(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  expect(persisted?.key).toBe(expected.key)
  expect(persisted?.event).toEqual(expected.event)
  expect((yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, history.prefix))._tag).toBe("Existing")
  const state = deriveCurrentIntegratorState(after, fixture.accepted.responsibility)
  expect(state).toMatchObject({ _tag: "RunUnfinished", run: { ordinal: 1 } })
  if (state._tag === "RunUnfinished") {
    expect(state.run.session.acceptedResult.commit).toBe(fixture.input.predecessor.acceptedResult.commit)
    expect(state.run.session.plannedAttempt.baseSha).toBe(fixture.input.predecessor.plannedAttempt.baseSha)
    expect(state.run.session.queuedAt).toBe(fixture.input.predecessor.queuedAt)
    expect(state.run.session.startedAt).toBe(fixture.input.predecessor.startedAt)
    expect(state.run.session.expectedTargetHead).toBe(fixture.input.targetLineage.targetHeadSha)
  }
})

it.effect("projects and fixes one automatic successor after the exact competing-head catch-up and fresh lineage", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
    if (prepared._tag !== "Append")
      return yield* Effect.die("a valid authorized prefix must prepare one successor append")
    const appendEvent: JournalRecord["event"] = prepared.event
    const fixedRecord = fixture.append(appendEvent)
    expect(fixedRecord.key).toBe(prepared.key)
    const reduction = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
    expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
    const state = deriveCurrentIntegratorState(fixture.records(), fixture.accepted.responsibility)
    expect(state).toMatchObject({ _tag: "RunUnfinished", run: { ordinal: 1 } })
    if (state._tag === "RunUnfinished") {
      expect(state.run.session).toEqual(prepared.event.successor)
      expect(state.run.session.acceptedResult.commit).toBe(fixture.input.predecessor.acceptedResult.commit)
      expect(state.run.session.plannedAttempt.baseSha).toBe(fixture.input.predecessor.plannedAttempt.baseSha)
      expect(state.run.session.queuedAt).toBe(fixture.input.predecessor.queuedAt)
      expect(state.run.session.startedAt).toBe(fixture.input.predecessor.startedAt)
    }

    const records = fixture.records()
    const expectNotCurrent = (candidate: ReadonlyArray<JournalRecord>, input = fixture.input) =>
      expect(integratorAutomaticSuccessorPreparationIsCurrent(candidate, input)).toBe(false)
    expect(integratorAutomaticSuccessorPreparationIsCurrent(records, fixture.input)).toBe(true)

    const differentPredecessor = IntegratorSessionCorrelation.make({
      ...fixture.input.predecessor,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:wrong-predecessor")
    })
    expectNotCurrent(records, { ...fixture.input, predecessor: differentPredecessor })

    const withoutAuthorization = records.filter(
      (record) =>
        !(
          record.event._tag === "IntegratorCompetingHeadSuccessorAuthorized" &&
          record.position === fixture.input.authorizationAt
        )
    )
    expectNotCurrent(withoutAuthorization)

    const withoutRetainedHead = records.filter((record) => record.event._tag !== "RemotePublicationRetained")
    expectNotCurrent(withoutRetainedHead)

    const withoutReadyBaseline = records.filter(
      (record) => record.event._tag !== "RemoteBaselineObserved" && record.event._tag !== "LocalTargetCatchUpObserved"
    )
    expectNotCurrent(withoutReadyBaseline)

    const beforeBaselineCompletion = {
      ...fixture.input,
      targetLineageObservedAt: JournalPosition.make(Number(fixture.input.targetLineageObservedAt) - 2)
    }
    expectNotCurrent(records, beforeBaselineCompletion)

    const withoutLineageIntent = records.filter((record) => record.event._tag !== "GitReadIntentRecorded")
    expectNotCurrent(withoutLineageIntent)

    const fixed = records.find(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    if (fixed?.event._tag !== "IntegratorAutomaticSuccessorSessionFixed") {
      return yield* Effect.die("the accepted successor append must be present for chronology validation")
    }
    const fixedEvent = fixed.event
    expect(validateAutomaticSuccessorSessionFixedRecord(records, fixed, fixture.input.predecessor)).toMatchObject({
      _tag: "Valid"
    })
    expect(
      validateAutomaticSuccessorSessionFixedRecord(
        records.filter((record) => record.position !== fixedEvent.successor.targetLineageObservedAt),
        fixed,
        fixture.input.predecessor
      )
    ).toMatchObject({ _tag: "Invalid", detail: "automatic successor lacks its exact fresh target-lineage observation" })
    const unrelatedRecord = records.find(({ event }) => event._tag !== "IntegratorAutomaticSuccessorSessionFixed")
    if (unrelatedRecord === undefined) return yield* Effect.die("accepted prefix must contain an unrelated record")
    expect(
      validateAutomaticSuccessorSessionFixedRecord(records, unrelatedRecord, fixture.input.predecessor)
    ).toMatchObject({ _tag: "Invalid", detail: "automatic successor predecessor does not match the active session" })
    expect(
      validateAutomaticSuccessorSessionFixedRecord(
        records,
        { ...fixed, position: fixed.event.successor.targetLineageObservedAt },
        fixture.input.predecessor
      )
    ).toMatchObject({ _tag: "Invalid" })
  })
)

it.effect("rejects duplicate and foreign fixed-event keys during automatic successor recovery", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
    if (prepared._tag !== "Append") return yield* Effect.die("valid successor prefix must prepare one append")
    const fixed = fixture.append(prepared.event)
    const duplicate = { ...fixed, position: JournalPosition.make(Number(fixed.position) + 1) }
    const duplicateResult = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, [...fixture.records(), duplicate])
    )
    expect(duplicateResult._tag).toBe("Failure")

    const foreignSuccessor = IntegratorSessionCorrelation.make({
      ...prepared.event.successor,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:foreign-fixed-event"),
      sessionId: IntegratorSessionId.make("integrator-session:foreign-fixed-event")
    })
    const foreignEvent = IntegratorAutomaticSuccessorSessionFixedEvent.make({
      ...prepared.event,
      successor: foreignSuccessor
    })
    const foreign = { ...fixed, event: foreignEvent }
    const withoutOriginal = fixture.records().filter((record) => record.key !== prepared.key)
    const foreignResult = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, [...withoutOriginal, foreign])
    )
    expect(foreignResult._tag).toBe("Failure")
  })
)

it.effect("requires the exact fixed predecessor and rejects successor preparation at exhausted capacity", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const withoutAuthorization = fixture.records().filter((record) => record.position !== fixture.input.authorizationAt)
    const stale = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, withoutAuthorization)
    )
    expect(stale._tag).toBe("Failure")

    const withoutFixedPredecessor = fixture.records().filter(({ event }) => event._tag !== "IntegratorSessionFixed")
    const unfixed = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, withoutFixedPredecessor)
    )
    expect(unfixed._tag).toBe("Failure")

    const second = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
    if (second._tag !== "Append") return yield* Effect.die("the initial authorization must fix the second session")
    fixture.append(second.event)
    const thirdPrefix = appendAutomaticSuccessorGeneration(
      fixture,
      second.event.successor,
      GitCommitSha.make("8".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(2)
    )
    const third = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      thirdPrefix.input,
      thirdPrefix.reduction.prefix
    )
    if (third._tag !== "Append") return yield* Effect.die("the second authorization must fix the third session")
    fixture.append(third.event)
    const fourthPrefix = appendAutomaticSuccessorGeneration(
      fixture,
      third.event.successor,
      GitCommitSha.make("9".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(3)
    )
    const exhausted = yield* Effect.exit(
      prepareIntegratorAutomaticSuccessorSessionAppend(fourthPrefix.input, fourthPrefix.reduction.prefix)
    )
    expect(exhausted._tag).toBe("Failure")
  })
)

it.effect(
  "recovers a fixed successor append after memory and reopened SQLite process loss without a duplicate session",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const context = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(context, JournalStore)
        yield* seedStoreWithPrefix(memoryStore, fixture)
        const memoryInterrupted = yield* Effect.exit(proveFixedAppendRecovery(memoryStore, fixture, true))
        expect(memoryInterrupted._tag).toBe("Failure")
        yield* proveFixedAppendRecovered(memoryStore, fixture)

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-automatic-successor-recovery-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          afterAppendCommit?: () => Effect.Effect<void, string>
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                afterAppendCommit === undefined
                  ? sqliteJournalStoreLayer({ filename })
                  : sqliteJournalTestLayer({ afterAppendCommit, filename })
              )
            )
          )
        yield* openSqlite((store) => seedStoreWithPrefix(store, fixture))
        const interrupted = yield* Effect.exit(
          openSqlite(
            (store) => proveFixedAppendRecovery(store, fixture, false),
            () => Effect.fail("simulated host loss after the fixed-session append commit")
          )
        )
        expect(interrupted._tag).toBe("Failure")
        yield* openSqlite((store) => proveFixedAppendRecovered(store, fixture))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect(
  "retries a precommit automatic successor fixation from the exact authorization before provider eligibility",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
          fixture.input,
          fixture.reduction.prefix
        )
        if (prepared._tag !== "Append") {
          return yield* Effect.die("accepted authorization must prepare one deterministic automatic successor")
        }

        const appendFromAcceptedPrefix = (store: JournalStore["Service"], failBeforeCommit: boolean) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag !== "ValidWorkflowJournalHistory") {
                return yield* Effect.die(
                  `reopened automatic successor history is invalid: ${JSON.stringify(history.issues)}`
                )
              }
              const recomputed = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, history.prefix)
              if (
                recomputed._tag !== "Append" ||
                recomputed.key !== prepared.key ||
                JSON.stringify(recomputed.event) !== JSON.stringify(prepared.event)
              ) {
                return yield* Effect.die("recovery must rederive the exact key and event from the accepted prefix")
              }
              const storage: JournalStorageBoundary = {
                append: (runId, key, event) =>
                  failBeforeCommit && key === prepared.key
                    ? Effect.die("process stopped before automatic successor fixation committed")
                    : store.append(runId, key, event),
                read: store.read,
                terminateRun: store.terminateRun
              }
              return yield* Effect.gen(function* () {
                const journal = yield* Journal
                return yield* journal.append(fixture.runId, recomputed.key, recomputed.event)
              }).pipe(Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, storage)))
            })
          )

        const expectUnfixedPrefix = (records: ReadonlyArray<JournalRecord>) => {
          expect(records.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
            0
          )
          expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
          const reduction = reduceWorkflowJournalHistory(fixture.runId, records)
          expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
          if (reduction._tag === "ValidWorkflowJournalHistory") {
            expect(deriveCurrentIntegratorState(records, fixture.accepted.responsibility)).toMatchObject({
              _tag: "GitQualifiedPrepared",
              run: { session: fixture.input.predecessor }
            })
          }
        }

        const expectFixedSuccessor = (records: ReadonlyArray<JournalRecord>) => {
          const fixed = records.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          expect(fixed).toHaveLength(1)
          expect(fixed[0]?.key).toBe(prepared.key)
          expect(fixed[0]?.event).toEqual(prepared.event)
          expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
          const state = deriveCurrentIntegratorState(records, fixture.accepted.responsibility)
          expect(state).toMatchObject({ _tag: "RunUnfinished", run: { session: prepared.event.successor } })
        }

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedStoreWithPrefix(memoryStore, fixture)
        const memoryFailure = yield* Effect.exit(appendFromAcceptedPrefix(memoryStore, true))
        expect(memoryFailure._tag).toBe("Failure")
        expectUnfixedPrefix(yield* memoryStore.read(fixture.runId))
        yield* appendFromAcceptedPrefix(memoryStore, false)
        expectFixedSuccessor(yield* memoryStore.read(fixture.runId))

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-automatic-session-precommit-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          failBeforeCommit = false
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                failBeforeCommit
                  ? sqliteJournalTestLayer({
                      filename,
                      onAppendKeyLookup: (_runId, key) =>
                        key === prepared.key
                          ? Effect.die("process stopped before automatic successor fixation insert")
                          : Effect.void
                    })
                  : sqliteJournalStoreLayer({ filename })
              )
            )
          )

        yield* openSqlite((store) => seedStoreWithPrefix(store, fixture))
        const sqliteFailure = yield* Effect.exit(openSqlite((store) => appendFromAcceptedPrefix(store, false), true))
        expect(sqliteFailure._tag).toBe("Failure")
        expectUnfixedPrefix(yield* openSqlite((store) => store.read(fixture.runId)))
        yield* openSqlite((store) => appendFromAcceptedPrefix(store, false))
        expectFixedSuccessor(yield* openSqlite((store) => store.read(fixture.runId)))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect("authorizes ordinary Retry only from the exact automatically fixed S2 and its own quarantine", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
    if (prepared._tag !== "Append")
      return yield* Effect.die("accepted automatic S2 history must prepare one fixed session")
    fixture.append(prepared.event)

    const session = prepared.event.successor
    const firstRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
    fixture.append(IntegratorRunStartedEvent.make({ run: firstRun, version: workflowJournalEventVersion }))
    const detail = IntegratorNotPreparedDetail.make("automatic successor reports a conclusive no-candidate result")
    const result = fixture.append(
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: firstRun, detail }),
        run: firstRun,
        version: workflowJournalEventVersion
      })
    )
    const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail }),
      evidence: { resultRecordedAt: result.position }
    })
    const quarantine = fixture.append(
      IntegrationQuarantinedEvent.make({
        basis,
        correlation: session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
    const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "Retry",
      quarantineAt: quarantine.position,
      sessionId: session.sessionId
    })
    fixture.append(
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint,
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({
          nonce: "automatic-successor-retry",
          runId: fixture.runId
        }),
        version: workflowJournalEventVersion
      })
    )
    const operationId = OperationId.make("automatic-successor-retry-target-lineage")
    const operation = makeTargetLineageObservationOperation({
      integrationTarget: session.integrationTarget,
      operationId,
      plannedAttempt: session.plannedAttempt,
      predecessorOperationIds: []
    })
    fixture.append(
      GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    )
    fixture.append(
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: session.plannedAttempt.baseSha,
          targetHeadSha: session.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        plannedAttempt: session.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const retryRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(2), session })
    const authorization = evaluateIntegratorRetryAuthorization(fixture.records(), retryRun)
    expect(authorization).toMatchObject({
      _tag: "Authorized",
      authorization: { sessionRecord: { event: { _tag: "IntegratorAutomaticSuccessorSessionFixed" } }, session }
    })

    fixture.append(IntegratorRunStartedEvent.make({ run: retryRun, version: workflowJournalEventVersion }))
    expect(reduceWorkflowJournalHistory(fixture.runId, fixture.records())._tag).toBe("ValidWorkflowJournalHistory")
    expect(deriveCurrentIntegratorState(fixture.records(), fixture.accepted.responsibility)).toMatchObject({
      _tag: "RunUnfinished",
      run: retryRun
    })

    const foreignRetry = evaluateIntegratorRetryAuthorization(
      fixture.records().filter(({ event }) => event._tag !== "IntegratorAutomaticSuccessorSessionFixed"),
      retryRun
    )
    expect(foreignRetry).toMatchObject({ _tag: "Rejected", detail: expect.stringContaining("fixed session") })
  })
)
