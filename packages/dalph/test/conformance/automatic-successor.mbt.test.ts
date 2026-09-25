import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, quintRun, stateCheck } from "@firfi/quint-connect/effect"
import { Effect, HashSet, Schema } from "effect"
import { expect } from "vitest"
import {
  authorizeIntegratorCompetingHeadSuccessor,
  fixIntegratorAutomaticSuccessorSession
} from "../../../orchestrator/src/coordination/delivery/integrator-delivery-action.js"
import { deliveryProposalsOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import { journalLayer, type JournalStorageBoundary } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import {
  appendLocalTargetCatchUpObservation,
  appendLocalTargetCatchUpIntent,
  appendRemoteBaselineReadIntent
} from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-transition-journal.js"
import { establishRemoteBaseline } from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-protocol-engine.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation
} from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-events.js"
import { InRunJournal, type JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import type { MaterializedDeliveryAction } from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  integratorAutomaticSuccessorPreparationIsCurrent,
  validateAutomaticSuccessorSessionFixedRecord
} from "../../../orchestrator/src/workflow/protocols/integrator/automatic-successor-session.js"
import { integratorSuccessorResponsibilityMatches } from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { makeSuccessorPrefix } from "../../../orchestrator/test/support/automatic-successor-history.js"

const selectedAutomaticSuccessorFields = Schema.Struct({
  authorizationCount: ITFBigInt,
  authorizationJournalPosition: ITFBigInt,
  baselineReadCount: ITFBigInt,
  baselineReadIntentCount: ITFBigInt,
  baselineReadLocalHead: ITFBigInt,
  baselineReadRemoteHead: ITFBigInt,
  catchUpCasCount: ITFBigInt,
  catchUpIntentFrom: ITFBigInt,
  catchUpIntentRecorded: Schema.Boolean,
  catchUpIntentTo: ITFBigInt,
  catchUpResultRecorded: Schema.Boolean,
  baseAncestorOfSuccessorHead: Schema.Boolean,
  successorExpectedHead: ITFBigInt,
  successorFixedWithCurrentAuthority: Schema.Boolean,
  successorResource: ITFBigInt,
  successorSession: ITFBigInt,
  successorSessionCount: ITFBigInt,
  targetLineageObservationCount: ITFBigInt,
  targetLineageObservedBaseCommit: ITFBigInt
})

const projectedModelState = stateCheck(
  (raw) => Schema.decodeUnknownEffect(selectedAutomaticSuccessorFields)(raw),
  (model, production) =>
    model.authorizationCount === production.authorizationCount &&
    model.authorizationJournalPosition === production.authorizationJournalPosition &&
    model.baselineReadCount === production.baselineReadCount &&
    model.baselineReadIntentCount === production.baselineReadIntentCount &&
    model.baselineReadLocalHead === production.baselineReadLocalHead &&
    model.baselineReadRemoteHead === production.baselineReadRemoteHead &&
    model.catchUpCasCount === production.catchUpCasCount &&
    model.catchUpIntentFrom === production.catchUpIntentFrom &&
    model.catchUpIntentRecorded === production.catchUpIntentRecorded &&
    model.catchUpIntentTo === production.catchUpIntentTo &&
    model.catchUpResultRecorded === production.catchUpResultRecorded &&
    model.baseAncestorOfSuccessorHead === production.baseAncestorOfSuccessorHead &&
    model.successorExpectedHead === production.successorExpectedHead &&
    model.successorFixedWithCurrentAuthority === production.successorFixedWithCurrentAuthority &&
    model.successorResource === production.successorResource &&
    model.successorSession === production.successorSession &&
    model.successorSessionCount === production.successorSessionCount &&
    model.targetLineageObservationCount === production.targetLineageObservationCount &&
    model.targetLineageObservedBaseCommit === production.targetLineageObservedBaseCommit
)

const actionPicks = { unused: Schema.Boolean }
const acceptedAutomaticSuccessorActions = {
  init: actionPicks,
  recordInitialPublicationIntent: actionPicks,
  outsidePushBeforeInitialDiscovery: actionPicks,
  discoverCompatibleCompetingHead: actionPicks,
  recordAutomaticSuccessorAuthorization: actionPicks,
  beginNextActivation: actionPicks,
  rereadAuthorityFacts: actionPicks,
  recordRemoteBaselineReadIntent: actionPicks,
  observeAncestorLocalBaseline: actionPicks,
  recordCatchUpIntent: actionPicks,
  compareAndSetLocalTargetToRemoteHead: actionPicks,
  recordCatchUpResult: actionPicks,
  proveBaseAncestorOfSuccessorHead: actionPicks,
  fixAutomaticSuccessorSession: actionPicks
}

type CausalFixture = ReturnType<typeof makeSuccessorPrefix> & {
  readonly append: (event: JournalRecord["event"]) => JournalRecord
  readonly boundary: { catchUpApplied: boolean }
  readonly initialPosition: number
  readonly records: () => ReadonlyArray<JournalRecord>
}

const makeCausalFixture = (): CausalFixture => {
  const complete = makeSuccessorPrefix()
  const allRecords = complete.records()
  const retainedIndex = allRecords.findIndex(
    ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "CompatibleCompetingHead"
  )
  if (retainedIndex < 0) throw new Error("fixture must contain the accepted compatible H2 publication")
  let records = allRecords.slice(0, retainedIndex + 1)
  const boundary = { catchUpApplied: false }
  const append = (event: JournalRecord["event"]): JournalRecord => {
    const descriptor = describeJournalEvent(event)
    const record: JournalRecord = {
      event,
      key: descriptor.expectedKey,
      position: JournalPosition.make(records.length + 1),
      runId: complete.runId
    }
    records = [...records, record]
    return record
  }
  return { ...complete, append, boundary, initialPosition: records.at(-1)?.position ?? 0, records: () => records }
}

const modelHeadFor = (head: string): bigint => (head === "6".repeat(40) ? 11n : 10n)

const projectionFor = (fixture: CausalFixture) => {
  const records = fixture.records()
  const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const observed = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
  const catchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
  const catchUp = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
  const freshLineage = records.find(
    ({ event }) =>
      event._tag === "TargetLineageObserved" &&
      event.observation.targetHeadSha === fixture.input.targetLineage.targetHeadSha
  )
  const fixed = records.findLast(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  const validation =
    fixed?.event._tag === "IntegratorAutomaticSuccessorSessionFixed"
      ? validateAutomaticSuccessorSessionFixedRecord(records, fixed, fixture.input.predecessor)
      : undefined
  const generation =
    fixed?.event._tag === "IntegratorAutomaticSuccessorSessionFixed" ? BigInt(fixed.event.successorGeneration) : 0n
  return {
    authorizationCount: BigInt(
      records.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized").length
    ),
    authorizationJournalPosition: BigInt(
      authorization === undefined ? 0 : Number(authorization.position) - fixture.initialPosition + 1
    ),
    baselineReadCount: BigInt(observed === undefined ? 0 : 1),
    baselineReadIntentCount: BigInt(records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended").length),
    baselineReadLocalHead:
      observed?.event._tag === "RemoteBaselineObserved" && observed.event.observation._tag === "LocalAncestor"
        ? modelHeadFor(observed.event.observation.localHead)
        : 0n,
    baselineReadRemoteHead:
      observed?.event._tag === "RemoteBaselineObserved" && observed.event.observation._tag === "LocalAncestor"
        ? modelHeadFor(observed.event.observation.remoteHead)
        : 0n,
    baseAncestorOfSuccessorHead:
      freshLineage?.event._tag === "TargetLineageObserved" &&
      freshLineage.event.observation.plannedBaseIsAncestorOfTargetHead,
    catchUpCasCount: BigInt(
      catchUp?.event._tag === "LocalTargetCatchUpObserved" && catchUp.event.result._tag === "Applied"
        ? 1
        : fixture.boundary.catchUpApplied
          ? 1
          : 0
    ),
    catchUpIntentFrom:
      catchUpIntent?.event._tag === "LocalTargetCatchUpIntended"
        ? modelHeadFor(catchUpIntent.event.expectedLocalHead)
        : 0n,
    catchUpIntentRecorded: catchUpIntent !== undefined,
    catchUpIntentTo:
      catchUpIntent?.event._tag === "LocalTargetCatchUpIntended" ? modelHeadFor(catchUpIntent.event.remoteHead) : 0n,
    catchUpResultRecorded:
      catchUp?.event._tag === "LocalTargetCatchUpObserved" && catchUp.event.result._tag === "Applied",
    successorExpectedHead:
      fixed?.event._tag === "IntegratorAutomaticSuccessorSessionFixed"
        ? modelHeadFor(fixed.event.successor.expectedTargetHead)
        : 0n,
    successorFixedWithCurrentAuthority: validation?._tag === "Valid",
    successorResource: generation === 0n ? 0n : 101n + generation,
    successorSession: generation,
    successorSessionCount: generation === 0n ? 0n : 1n,
    targetLineageObservationCount: BigInt(freshLineage === undefined ? 0 : 1),
    targetLineageObservedBaseCommit: freshLineage === undefined ? 0n : 5n
  }
}

const proposalFor = (transition: RunnableFrontierTransition, fixture: CausalFixture) => {
  const proposals = deliveryProposalsOf({
    acceptedOperationIds: HashSet.empty(),
    fresh: [],
    integrationResponsibilities: [fixture.accepted.responsibility],
    responsibilities: [],
    runId: fixture.runId,
    transitions: [transition]
  })
  const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
  if (proposal === undefined || proposal.actionIdentity._tag !== "NoWorkflowOperationIdentity")
    throw new Error(`expected an identity-free production proposal for ${transition._tag}`)
  return { _tag: "IdentityFreeAction", proposal } satisfies Extract<
    MaterializedDeliveryAction,
    { _tag: "IdentityFreeAction" }
  >
}

const withJournal = <A, E, R>(fixture: CausalFixture, effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const history = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
      if (history._tag !== "ValidWorkflowJournalHistory")
        return yield* Effect.die("causal model prefix must be accepted")
      const storage: JournalStorageBoundary = {
        append: (runId, key, event) =>
          Effect.sync(() => {
            if (runId !== fixture.runId) throw new Error("production seam changed the modeled Run")
            const record = fixture.append(event)
            if (record.key !== key) throw new Error("production seam supplied a noncanonical record key")
            return record
          }),
        read: (runId) => Effect.succeed(runId === fixture.runId ? fixture.records() : []),
        terminateRun: () => Effect.die("conformance trace must not terminate its Run")
      }
      return yield* effect.pipe(
        Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, storage))
      )
    })
  )

interface ConformanceCapture {
  readonly actions: Array<string>
  fixture?: CausalFixture
}

const productionDriver = (capture: ConformanceCapture) =>
  defineDriver(acceptedAutomaticSuccessorActions, () => {
    const fixture = makeCausalFixture()
    capture.fixture = fixture
    const all = makeSuccessorPrefix().records()
    const future = (tag: JournalRecord["event"]["_tag"]) => {
      const record = all.find(({ event }) => event._tag === tag)
      if (record === undefined) throw new Error(`missing accepted fixture event ${tag}`)
      return record
    }
    const baselineIntent = future("RemoteBaselineReadIntended")
    if (baselineIntent.event._tag !== "RemoteBaselineReadIntended") throw new Error("expected baseline intent")
    const correlation = baselineIntent.event.correlation
    const authorizationRecord = future("IntegratorCompetingHeadSuccessorAuthorized")
    if (authorizationRecord.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized")
      throw new Error("expected authorization")
    const authorizationTransition = RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
      authorizationId: authorizationRecord.event.authorizationId,
      correlation: authorizationRecord.event.correlation,
      mergeBase: authorizationRecord.event.mergeBase,
      remoteHead: authorizationRecord.event.remoteHead,
      remotePublicationRetainedAt: authorizationRecord.event.remotePublicationRetainedAt,
      responsibility: fixture.accepted.responsibility
    })
    const fixationTransition = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
      input: fixture.input,
      responsibility: fixture.accepted.responsibility
    })
    const remoteGit = RemoteBaselineGit.of({
      observe: () =>
        Effect.succeed(
          RemoteBaselineObservation.cases.LocalAncestor.make({
            localHead: fixture.input.predecessor.expectedTargetHead,
            remoteHead: fixture.input.targetLineage.targetHeadSha
          })
        ),
      catchUp: (_correlation, _expectedLocal, remoteHead) =>
        Effect.succeed(LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead })),
      reconcileCatchUp: (_correlation, _expectedLocal, remoteHead) =>
        Effect.succeed(LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead }))
    })
    let caughtUp: ReturnType<typeof LocalTargetCatchUpResult.cases.Applied.make> | undefined
    const persist = (name: string, effect: Effect.Effect<unknown, unknown, never>) =>
      withJournal(fixture, effect).pipe(Effect.tap(() => Effect.sync(() => capture.actions.push(name))))
    return {
      init: () => Effect.sync(() => capture.actions.push("init")),
      recordInitialPublicationIntent: () => Effect.sync(() => capture.actions.push("recordInitialPublicationIntent")),
      outsidePushBeforeInitialDiscovery: () =>
        Effect.sync(() => capture.actions.push("outsidePushBeforeInitialDiscovery")),
      discoverCompatibleCompetingHead: () => Effect.sync(() => capture.actions.push("discoverCompatibleCompetingHead")),
      recordAutomaticSuccessorAuthorization: () =>
        persist(
          "recordAutomaticSuccessorAuthorization",
          authorizeIntegratorCompetingHeadSuccessor(
            proposalFor(authorizationTransition, fixture),
            authorizationTransition
          )
        ),
      beginNextActivation: () => Effect.sync(() => capture.actions.push("beginNextActivation")),
      rereadAuthorityFacts: () => Effect.sync(() => capture.actions.push("rereadAuthorityFacts")),
      recordRemoteBaselineReadIntent: () =>
        persist("recordRemoteBaselineReadIntent", appendRemoteBaselineReadIntent(correlation)),
      observeAncestorLocalBaseline: () =>
        persist(
          "observeAncestorLocalBaseline",
          establishRemoteBaseline(correlation).pipe(Effect.provideService(RemoteBaselineGit, remoteGit))
        ),
      recordCatchUpIntent: () => {
        const expected = fixture.input.predecessor.expectedTargetHead
        const remote = fixture.input.targetLineage.targetHeadSha
        return persist("recordCatchUpIntent", appendLocalTargetCatchUpIntent(correlation, expected, remote))
      },
      compareAndSetLocalTargetToRemoteHead: () =>
        remoteGit
          .catchUp(correlation, fixture.input.predecessor.expectedTargetHead, fixture.input.targetLineage.targetHeadSha)
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                caughtUp = result._tag === "Applied" ? result : undefined
                fixture.boundary.catchUpApplied = caughtUp !== undefined
              })
            ),
            Effect.tap(() => Effect.sync(() => capture.actions.push("compareAndSetLocalTargetToRemoteHead")))
          ),
      recordCatchUpResult: () => {
        if (caughtUp === undefined) return Effect.die("modeled catch-up result requires one Applied boundary result")
        return persist(
          "recordCatchUpResult",
          appendLocalTargetCatchUpObservation(
            correlation,
            fixture.input.predecessor.expectedTargetHead,
            fixture.input.targetLineage.targetHeadSha,
            caughtUp
          )
        )
      },
      proveBaseAncestorOfSuccessorHead: () => {
        const intent = all.find(
          ({ event, position }) => event._tag === "GitReadIntentRecorded" && Number(position) > fixture.initialPosition
        )
        const observed = all.find(
          ({ event }) =>
            event._tag === "TargetLineageObserved" &&
            event.observation.targetHeadSha === fixture.input.targetLineage.targetHeadSha
        )
        if (intent === undefined || observed === undefined) throw new Error("accepted S2 must include fresh H2 lineage")
        return persist(
          "proveBaseAncestorOfSuccessorHead",
          Effect.gen(function* () {
            yield* InRunJournal.pipe(
              Effect.flatMap((journal) => journal.append(fixture.runId, intent.key, intent.event))
            )
            yield* InRunJournal.pipe(
              Effect.flatMap((journal) => journal.append(fixture.runId, observed.key, observed.event))
            )
            expect(integratorAutomaticSuccessorPreparationIsCurrent(fixture.records(), fixture.input)).toBe(true)
          })
        )
      },
      fixAutomaticSuccessorSession: () =>
        persist(
          "fixAutomaticSuccessorSession",
          fixIntegratorAutomaticSuccessorSession(proposalFor(fixationTransition, fixture), fixationTransition)
        ),
      getState: () => Effect.sync(() => projectionFor(fixture)),
      config: () => ({ nondetPath: ["replayAction"], statePath: ["state"] })
    }
  })

it.effect("replays the canonical automatic-successor trace through the journal fixation seam", () =>
  Effect.gen(function* () {
    const capture: ConformanceCapture = { actions: [] }
    const result = yield* quintRun({
      backend: "typescript",
      driverFactory: productionDriver(capture),
      generation: { mode: "test", test: "automaticSuccessorProductionConformanceTest" },
      maxSamples: 1,
      seed: "385",
      spec: "specs/acceptedResultIntegration_automaticSuccessor_conformance.qnt",
      stateCheck: projectedModelState
    })
    expect(result.tracesReplayed).toBe(1)
    expect(capture.actions.at(-1)).toBe("fixAutomaticSuccessorSession")
    const fixture = capture.fixture
    if (fixture === undefined) return yield* Effect.die("Quint replay must create one production journal fixture")
    const records = fixture.records()
    const fixed = records.find((record) => record.event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    expect(fixed?.event._tag).toBe("IntegratorAutomaticSuccessorSessionFixed")
    if (fixed?.event._tag !== "IntegratorAutomaticSuccessorSessionFixed")
      return yield* Effect.die("S2 fixation must persist")
    expect(fixed.event.successorGeneration).toBe(2)
    expect(integratorSuccessorResponsibilityMatches(fixed.event.predecessor, fixed.event.successor)).toBe(true)
    expect(fixed.event.successor.acceptedResult.commit).toBe(fixture.input.predecessor.acceptedResult.commit)
    expect(fixed.event.successor.plannedAttempt.taskId).toBe(fixture.input.predecessor.plannedAttempt.taskId)
    expect(fixed.event.successor.sessionId).not.toBe(fixture.input.predecessor.sessionId)
    expect(fixed.event.successor.candidateResource).not.toBe(fixture.input.predecessor.candidateResource)
    expect(fixed.event.successor.expectedTargetHead).toBe(fixture.input.targetLineage.targetHeadSha)
    const reduced = reduceWorkflowJournalHistory(fixture.runId, records)
    expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
  })
)
