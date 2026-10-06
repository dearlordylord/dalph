import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, quintRun, stateCheck, StateMismatchError } from "@firfi/quint-connect/effect"
import { Cause, Effect, Exit, HashSet, Layer, Option, Schema } from "effect"
import { expect } from "vitest"
import { GitCommitSha } from "@dalph/contracts"
import {
  authorizeIntegratorCompetingHeadSuccessor,
  fixIntegratorAutomaticSuccessorSession
} from "../../../orchestrator/src/coordination/delivery/integrator-delivery-action.js"
import { deliveryProposalsOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import { journalLayer, type JournalStorageBoundary } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../orchestrator/src/coordination/delivery/delivery-action-proposal.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { integratorCompetingHeadSuccessorAuthorizationIdFor } from "../../../orchestrator/src/workflow/protocols/integrator/automatic-successor-events.js"
import {
  appendLocalTargetCatchUpObservation,
  appendLocalTargetCatchUpIntent,
  appendRemoteBaselineReadIntent
} from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-transition-journal.js"
import { establishRemoteBaseline } from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-protocol-engine.js"
import {
  LocalTargetCatchUpResult,
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  initialAutomaticCompetingHeadBaselineRound,
  RemoteBaselineGit,
  RemoteBaselineObservation
} from "../../../orchestrator/src/workflow/protocols/direct-publication/baseline-events.js"
import { integratorResponsibilityFactsFor } from "../../../orchestrator/src/workflow/protocols/integrator/state.js"
import { type JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import type {
  DeliveryActionResult,
  MaterializedDeliveryAction
} from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { makeTargetLineageObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  WorkflowInterpreter,
  observeTargetLineageThrough,
  type WorkflowInterpreterService
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import {
  GitTargetLineageReadFailure,
  TargetLineageObservation,
  type GitTargetLineageService
} from "../../../orchestrator/src/authorities/git/target-lineage.js"
import {
  integratorAutomaticSuccessorPreparationIsCurrent,
  validateAutomaticSuccessorSessionFixedRecord
} from "../../../orchestrator/src/workflow/protocols/integrator/automatic-successor-session.js"
import { integratorSuccessorResponsibilityMatches } from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { makeSuccessorPrefix } from "../../../orchestrator/test/support/automatic-successor-history.js"
import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"

const selectedAutomaticSuccessorFields = Schema.Struct({
  authorizationCount: ITFBigInt,
  authorizationJournalPosition: ITFBigInt,
  baselineReadCount: ITFBigInt,
  baselineReadIntentPosition: ITFBigInt,
  baselineReadIntentCount: ITFBigInt,
  baselineReadLocalHead: ITFBigInt,
  baselineReadRemoteHead: ITFBigInt,
  catchUpCasCount: ITFBigInt,
  catchUpCasPosition: ITFBigInt,
  catchUpIntentPosition: ITFBigInt,
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
    model.baselineReadIntentPosition === production.baselineReadIntentPosition &&
    model.baselineReadIntentCount === production.baselineReadIntentCount &&
    model.baselineReadLocalHead === production.baselineReadLocalHead &&
    model.baselineReadRemoteHead === production.baselineReadRemoteHead &&
    model.catchUpCasCount === production.catchUpCasCount &&
    model.catchUpCasPosition === production.catchUpCasPosition &&
    model.catchUpIntentPosition === production.catchUpIntentPosition &&
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

type CompleteSuccessorFixture = ReturnType<typeof makeSuccessorPrefix>
type AutomaticSuccessorInput = CompleteSuccessorFixture["input"]

type CausalFixture = {
  readonly accepted: CompleteSuccessorFixture["accepted"]
  readonly append: (event: JournalRecord["event"]) => JournalRecord
  readonly boundary: {
    baselineReadCalls: number
    catchUpCalls: number
    currentHead: AutomaticSuccessorInput["predecessor"]["expectedTargetHead"]
    lineageReadCalls: number
    result?: typeof LocalTargetCatchUpResult.Type
  }
  readonly initialPosition: number
  readonly input: Pick<AutomaticSuccessorInput, "predecessor">
  readonly lineageOperationId: typeof OperationId.Type
  readonly records: () => ReadonlyArray<JournalRecord>
  readonly runId: CompleteSuccessorFixture["runId"]
  readonly successorHead: AutomaticSuccessorInput["targetLineage"]["targetHeadSha"]
  freshInput?: AutomaticSuccessorInput
}

const makeCausalFixture = (): CausalFixture => {
  const complete = makeSuccessorPrefix()
  const allRecords = complete.records()
  const retainedIndex = allRecords.findIndex(
    ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "CompatibleCompetingHead"
  )
  if (retainedIndex < 0) throw new Error("fixture must contain the accepted compatible H2 publication")
  const retained = allRecords[retainedIndex]
  if (retained?.event._tag !== "RemotePublicationRetained" || retained.event.cause._tag !== "CompatibleCompetingHead")
    throw new Error("fixture must retain the exact compatible competing-head event")
  let records = allRecords.slice(0, retainedIndex + 1)
  const boundary: CausalFixture["boundary"] = {
    baselineReadCalls: 0,
    catchUpCalls: 0,
    currentHead: complete.input.predecessor.expectedTargetHead,
    lineageReadCalls: 0
  }
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
  return {
    accepted: complete.accepted,
    append,
    boundary,
    initialPosition: Number(records.at(-1)?.position ?? 0),
    input: { predecessor: complete.input.predecessor },
    lineageOperationId: OperationId.make("automatic-successor-fresh-target-lineage"),
    records: () => records,
    runId: complete.runId,
    successorHead: retained.event.cause.remoteHead
  }
}

const modelHeadFor = (head: string): bigint => (head === "6".repeat(40) ? 11n : 10n)

const projectionFor = (fixture: CausalFixture) => {
  const records = fixture.records()
  const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const baselineIntent = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
  const observed = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
  const catchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
  const catchUp = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
  const lineageIntent = records.find(
    ({ event }) =>
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      event.operation.operationId === fixture.lineageOperationId
  )
  const freshLineage = records.find(
    ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId
  )
  const fixed = records.findLast(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  const relativePosition = (record: JournalRecord | undefined) =>
    record === undefined ? 0 : Number(record.position) - fixture.initialPosition
  const modelActionPosition = (record: JournalRecord | undefined) => {
    if (record === undefined) return 0
    const relative = relativePosition(record)
    const priorBaselineObservation =
      observed !== undefined && Number(observed.position) < Number(record.position) ? 1 : 0
    // The model starts its accepted precondition prefix at position 1. Its
    // positions count initiated actions; the baseline observation is a
    // non-action occurrence and therefore does not advance that ordinal.
    return relative + 1 - priorBaselineObservation
  }
  const validation =
    fixed?.event._tag === "IntegratorAutomaticSuccessorSessionFixed" && fixture.freshInput !== undefined
      ? validateAutomaticSuccessorSessionFixedRecord(records, fixed, fixture.freshInput.predecessor)
      : undefined
  const generation =
    fixed?.event._tag === "IntegratorAutomaticSuccessorSessionFixed" ? BigInt(fixed.event.successorGeneration) : 0n
  return {
    authorizationCount: BigInt(
      records.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized").length
    ),
    authorizationJournalPosition: BigInt(modelActionPosition(authorization)),
    baselineReadCount: BigInt(records.filter(({ event }) => event._tag === "RemoteBaselineObserved").length),
    baselineReadIntentCount: BigInt(records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended").length),
    baselineReadIntentPosition: BigInt(modelActionPosition(baselineIntent)),
    baselineReadLocalHead:
      observed?.event._tag === "RemoteBaselineObserved" && observed.event.observation._tag === "LocalAncestor"
        ? modelHeadFor(observed.event.observation.localHead)
        : 0n,
    baselineReadRemoteHead:
      observed?.event._tag === "RemoteBaselineObserved" && observed.event.observation._tag === "LocalAncestor"
        ? modelHeadFor(observed.event.observation.remoteHead)
        : 0n,
    baseAncestorOfSuccessorHead:
      lineageIntent?.event._tag === "GitReadIntentRecorded" &&
      freshLineage?.event._tag === "TargetLineageObserved" &&
      Number(lineageIntent.position) < Number(freshLineage.position) &&
      freshLineage.event.observation.plannedBaseIsAncestorOfTargetHead,
    catchUpCasCount: BigInt(fixture.boundary.catchUpCalls),
    catchUpCasPosition: BigInt(fixture.boundary.catchUpCalls === 0 ? 0 : modelActionPosition(catchUpIntent) + 1),
    catchUpIntentPosition: BigInt(modelActionPosition(catchUpIntent)),
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
    targetLineageObservationCount: BigInt(
      records.filter(
        ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId
      ).length
    ),
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
  if (proposal === undefined || !isIdentityFreeProposal(proposal))
    throw new Error(`expected an identity-free production proposal for ${transition._tag}`)
  return { _tag: "IdentityFreeAction", proposal } satisfies Extract<
    MaterializedDeliveryAction,
    { _tag: "IdentityFreeAction" }
  >
}

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

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

const withJournaledTargetLineage = <A, E, R>(
  fixture: CausalFixture,
  observation: typeof TargetLineageObservation.Type,
  effect: Effect.Effect<A, E, R>
) => {
  const unused = () => Effect.die("unused workflow interpreter operation in the conformance trace")
  const gitTargetLineage: GitTargetLineageService = {
    read: (plannedBaseSha, target) => {
      if (fixture.boundary.currentHead !== observation.targetHeadSha || plannedBaseSha !== observation.plannedBaseSha)
        return Effect.fail(
          new GitTargetLineageReadFailure({
            detail: "controlled target lineage requires the exact post-catch-up head and planned Base",
            plannedBaseSha,
            target
          })
        )
      fixture.boundary.lineageReadCalls += 1
      return Effect.succeed(observation)
    }
  }
  const interpreter = WorkflowInterpreter.of({
    readTaskAttemptBase: () => Effect.die("this fixture does not select a task-attempt Base read"),
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTaskWorktree: unused,
    readTargetLineage: (operation) => observeTargetLineageThrough(gitTargetLineage, operation),
    readTrackerGraph: unused,
    readTaskWorkSpecification: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    releaseTaskClaim: unused
  } satisfies WorkflowInterpreterService)
  const journaled = journaledWorkflowInterpreterLayer(fixture.runId, Layer.succeed(WorkflowInterpreter, interpreter))
  return withJournal(fixture, Effect.scoped(effect.pipe(Effect.provide(journaled))))
}

interface ConformanceCapture {
  readonly actions: Array<string>
  fixture?: CausalFixture
  fixationResult?: DeliveryActionResult
  lineageStateMismatch?: { readonly model: boolean; readonly production: boolean }
}

const productionDriver = (capture: ConformanceCapture, lineageDescendsFromBase = true) =>
  defineDriver(acceptedAutomaticSuccessorActions, () => {
    const fixture = makeCausalFixture()
    capture.fixture = fixture
    const retainedRecord = fixture
      .records()
      .find(({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "CompatibleCompetingHead")
    if (retainedRecord?.event._tag !== "RemotePublicationRetained")
      throw new Error("automatic successor actions require the exact accepted retained-head precondition")
    const retained = retainedRecord.event
    const cause = retained.cause
    if (cause._tag !== "CompatibleCompetingHead")
      throw new Error("automatic successor actions require the exact accepted retained-head precondition")
    const authorizationTransition = RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
      authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
        retained.correlation.requestId,
        retainedRecord.position,
        cause.mergeBase,
        cause.remoteHead
      ),
      correlation: retained.correlation,
      mergeBase: cause.mergeBase,
      remoteHead: cause.remoteHead,
      remotePublicationRetainedAt: retainedRecord.position,
      responsibility: fixture.accepted.responsibility
    })
    let baselineCorrelation: ReturnType<typeof automaticCompetingHeadRemoteBaselineCorrelationFor> | undefined
    let fixationAttempted = false
    const remoteGit = RemoteBaselineGit.of({
      observe: () => {
        fixture.boundary.baselineReadCalls += 1
        return Effect.succeed(
          RemoteBaselineObservation.cases.LocalAncestor.make({
            localHead: fixture.input.predecessor.expectedTargetHead,
            remoteHead: fixture.successorHead
          })
        )
      },
      catchUp: (_correlation, expectedLocal, remoteHead) =>
        Effect.sync(() => {
          if (fixture.boundary.catchUpCalls !== 0) throw new Error("one baseline round admits one catch-up CAS")
          if (fixture.boundary.currentHead !== expectedLocal)
            throw new Error("catch-up CAS must compare-and-set the exact observed local H2")
          if (remoteHead !== fixture.successorHead)
            throw new Error("catch-up CAS must target the exact observed remote H3")
          fixture.boundary.catchUpCalls += 1
          fixture.boundary.currentHead = remoteHead
          const result = LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead })
          fixture.boundary.result = result
          return result
        }),
      reconcileCatchUp: () => Effect.die("the accepted trace has no ambiguous catch-up response")
    })
    const persist = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
      withJournal(fixture, effect).pipe(Effect.tap(() => Effect.sync(() => capture.actions.push(name))))
    const requireBaselineCorrelation = () => {
      if (baselineCorrelation === undefined) throw new Error("baseline requires the committed S2 authorization")
      return baselineCorrelation
    }
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget: fixture.accepted.integrationTarget,
      operationId: fixture.lineageOperationId,
      plannedAttempt: fixture.accepted.plannedAttempt,
      predecessorOperationIds: [fixture.accepted.targetLineageOperation.operationId]
    })
    const lineageTargetHead = lineageDescendsFromBase ? fixture.successorHead : GitCommitSha.make("8".repeat(40))
    const lineageObservation = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: lineageDescendsFromBase,
      plannedBaseSha: lineageOperation.plannedAttempt.baseSha,
      targetHeadSha: lineageTargetHead
    })
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
          ).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                const authorization = fixture
                  .records()
                  .find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
                if (authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized")
                  throw new Error("production authorization seam must append its exact event")
                baselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
                  fixture.runId,
                  integratorResponsibilityFactsFor(fixture.accepted.responsibility),
                  fixture.accepted.integrationTarget,
                  remotePublicationTargetForTest,
                  authorization.position,
                  initialAutomaticCompetingHeadBaselineRound
                )
              })
            )
          )
        ),
      beginNextActivation: () => Effect.sync(() => capture.actions.push("beginNextActivation")),
      rereadAuthorityFacts: () => Effect.sync(() => capture.actions.push("rereadAuthorityFacts")),
      recordRemoteBaselineReadIntent: () =>
        persist("recordRemoteBaselineReadIntent", appendRemoteBaselineReadIntent(requireBaselineCorrelation())),
      observeAncestorLocalBaseline: () =>
        persist(
          "observeAncestorLocalBaseline",
          establishRemoteBaseline(requireBaselineCorrelation()).pipe(
            Effect.provideService(RemoteBaselineGit, remoteGit)
          )
        ),
      recordCatchUpIntent: () => {
        const expected = fixture.input.predecessor.expectedTargetHead
        const remote = fixture.successorHead
        return persist(
          "recordCatchUpIntent",
          appendLocalTargetCatchUpIntent(requireBaselineCorrelation(), expected, remote)
        )
      },
      compareAndSetLocalTargetToRemoteHead: () => {
        const intent = fixture.records().find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        if (
          intent?.event._tag !== "LocalTargetCatchUpIntended" ||
          intent.event.expectedLocalHead !== fixture.input.predecessor.expectedTargetHead ||
          intent.event.remoteHead !== fixture.successorHead
        )
          return Effect.die("catch-up boundary requires its exact durable H2-to-H3 intent")
        return remoteGit
          .catchUp(requireBaselineCorrelation(), intent.event.expectedLocalHead, intent.event.remoteHead)
          .pipe(Effect.tap(() => Effect.sync(() => capture.actions.push("compareAndSetLocalTargetToRemoteHead"))))
      },
      recordCatchUpResult: () => {
        const result = fixture.boundary.result
        if (fixture.boundary.catchUpCalls !== 1 || result?._tag !== "Applied")
          return Effect.die("modeled catch-up result requires one applied compare-and-set boundary")
        return persist(
          "recordCatchUpResult",
          appendLocalTargetCatchUpObservation(
            requireBaselineCorrelation(),
            fixture.input.predecessor.expectedTargetHead,
            fixture.successorHead,
            result
          )
        )
      },
      proveBaseAncestorOfSuccessorHead: () => {
        if (fixture.boundary.catchUpCalls !== 1)
          return Effect.die("fresh lineage requires the exact completed H2-to-H3 catch-up boundary")
        if (lineageDescendsFromBase && fixture.boundary.currentHead !== fixture.successorHead)
          return Effect.die("positive lineage must read the exact head installed by the catch-up CAS")
        if (!lineageDescendsFromBase) {
          // Model a concurrent external ref movement after the valid catch-up.
          // The Git authority reports the new, unrelated head; the Journal
          // records only the coordinator's read intent and its observation.
          fixture.boundary.currentHead = lineageTargetHead
        }
        const read = Effect.gen(function* () {
          const interpreter = yield* WorkflowInterpreter
          return yield* interpreter.readTargetLineage(lineageOperation)
        })
        return withJournaledTargetLineage(fixture, lineageObservation, read).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const authorization = fixture
                .records()
                .find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
              const observed = fixture
                .records()
                .find(
                  ({ event }) =>
                    event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId
                )
              if (authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized")
                throw new Error("fresh lineage requires its exact prior authorization")
              if (observed?.event._tag !== "TargetLineageObserved")
                throw new Error("journaled workflow interpreter must append the lineage observation")
              fixture.freshInput = {
                authorizationAt: authorization.position,
                predecessor: fixture.input.predecessor,
                targetLineage: lineageObservation,
                targetLineageObservedAt: observed.position
              }
              if (lineageDescendsFromBase) {
                expect(integratorAutomaticSuccessorPreparationIsCurrent(fixture.records(), fixture.freshInput)).toBe(
                  true
                )
              } else {
                expect(integratorAutomaticSuccessorPreparationIsCurrent(fixture.records(), fixture.freshInput)).toBe(
                  false
                )
              }
            })
          ),
          Effect.tap(() => Effect.sync(() => capture.actions.push("proveBaseAncestorOfSuccessorHead")))
        )
      },
      fixAutomaticSuccessorSession: () => {
        if (fixture.freshInput === undefined)
          return Effect.die("successor fixation requires the production journaled target-lineage read")
        const fixationTransition = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
          input: fixture.freshInput,
          responsibility: fixture.accepted.responsibility
        })
        return persist(
          "fixAutomaticSuccessorSession",
          fixIntegratorAutomaticSuccessorSession(proposalFor(fixationTransition, fixture), fixationTransition)
        ).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              capture.fixationResult = result
              fixationAttempted = true
            })
          )
        )
      },
      getState: () =>
        Effect.sync(() => {
          const projection = projectionFor(fixture)
          // Let the invalid-lineage trace reach the production fixation action.
          // After that action defers, expose the real false ancestry projection
          // so replay fails specifically on this model/production mismatch.
          return !lineageDescendsFromBase && fixture.freshInput !== undefined && !fixationAttempted
            ? { ...projection, baseAncestorOfSuccessorHead: true }
            : projection
        }),
      config: () => ({ nondetPath: ["replayAction"], statePath: ["state"] })
    }
  })

it.effect(
  "replays the canonical automatic-successor trace through the journal fixation seam",
  () =>
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
      const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
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
      expect(fixed.event.successor.expectedTargetHead).toBe(fixture.successorHead)
      expect(fixture.freshInput?.targetLineage.targetHeadSha).toBe(fixture.successorHead)
      const baselineIntent = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
      const baselineObserved = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
      const catchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
      const catchUpObserved = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
      const lineageIntent = records.find(
        ({ event }) =>
          event._tag === "GitReadIntentRecorded" &&
          event.operation._tag === "ReadTargetLineage" &&
          event.operation.operationId === fixture.lineageOperationId
      )
      const lineageObserved = records.find(
        ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId
      )
      expect(authorization?.position).toBeDefined()
      expect(baselineIntent?.position).toBeDefined()
      expect(baselineObserved?.position).toBeDefined()
      expect(catchUpIntent?.position).toBeDefined()
      expect(catchUpObserved?.position).toBeDefined()
      expect(lineageIntent?.position).toBeDefined()
      expect(lineageObserved?.position).toBeDefined()
      expect(records.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(1)
      expect(
        records.filter(
          ({ event }) =>
            event._tag === "GitReadIntentRecorded" &&
            event.operation._tag === "ReadTargetLineage" &&
            event.operation.operationId === fixture.lineageOperationId
        )
      ).toHaveLength(1)
      expect(
        records.filter(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId
        )
      ).toHaveLength(1)
      expect(Number(authorization?.position)).toBeLessThan(Number(baselineIntent?.position))
      expect(Number(baselineIntent?.position)).toBeLessThan(Number(baselineObserved?.position))
      expect(Number(baselineObserved?.position)).toBeLessThan(Number(catchUpIntent?.position))
      expect(Number(catchUpIntent?.position)).toBeLessThan(Number(catchUpObserved?.position))
      expect(Number(catchUpObserved?.position)).toBeLessThan(Number(lineageIntent?.position))
      expect(Number(lineageIntent?.position)).toBeLessThan(Number(lineageObserved?.position))
      if (
        baselineObserved?.event._tag !== "RemoteBaselineObserved" ||
        baselineObserved.event.observation._tag !== "LocalAncestor" ||
        catchUpIntent?.event._tag !== "LocalTargetCatchUpIntended" ||
        catchUpObserved?.event._tag !== "LocalTargetCatchUpObserved" ||
        lineageObserved?.event._tag !== "TargetLineageObserved"
      )
        return yield* Effect.die("the accepted successor trace must retain each exact production observation")
      expect(baselineObserved.event.observation.localHead).toBe(fixture.input.predecessor.expectedTargetHead)
      expect(baselineObserved.event.observation.remoteHead).toBe(fixture.successorHead)
      expect(catchUpIntent.event.expectedLocalHead).toBe(fixture.input.predecessor.expectedTargetHead)
      expect(catchUpIntent.event.remoteHead).toBe(fixture.successorHead)
      expect(catchUpObserved.event.result._tag).toBe("Applied")
      if (catchUpObserved.event.result._tag === "Applied")
        expect(catchUpObserved.event.result.newHead).toBe(fixture.successorHead)
      expect(lineageObserved.event.observation.plannedBaseSha).toBe(fixture.accepted.plannedAttempt.baseSha)
      expect(lineageObserved.event.observation.targetHeadSha).toBe(fixture.successorHead)
      expect(lineageObserved.event.observation.plannedBaseIsAncestorOfTargetHead).toBe(true)
      expect(fixture.boundary.baselineReadCalls).toBe(1)
      expect(fixture.boundary.catchUpCalls).toBe(1)
      expect(fixture.boundary.currentHead).toBe(fixture.successorHead)
      expect(fixture.boundary.lineageReadCalls).toBe(1)
      const reduced = reduceWorkflowJournalHistory(fixture.runId, records)
      expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
    }),
  30_000
)

it.effect(
  "rejects a model fixation when the journaled Git lineage result is not descended from the planned Base",
  () =>
    Effect.gen(function* () {
      const capture: ConformanceCapture = { actions: [] }
      const replayExit = yield* Effect.exit(
        quintRun({
          backend: "typescript",
          driverFactory: productionDriver(capture, false),
          generation: { mode: "test", test: "automaticSuccessorProductionConformanceTest" },
          maxSamples: 1,
          seed: "385385",
          spec: "specs/acceptedResultIntegration_automaticSuccessor_conformance.qnt",
          stateCheck: stateCheck(
            (raw) => Schema.decodeUnknownEffect(selectedAutomaticSuccessorFields)(raw),
            (model, production) => {
              const matches = model.baseAncestorOfSuccessorHead === production.baseAncestorOfSuccessorHead
              if (!matches) {
                capture.lineageStateMismatch = {
                  model: model.baseAncestorOfSuccessorHead,
                  production: production.baseAncestorOfSuccessorHead
                }
              }
              return matches
            }
          )
        })
      )
      expect(replayExit._tag).toBe("Failure")
      if (!Exit.isFailure(replayExit)) return yield* Effect.die("invalid lineage must fail model/production replay")
      const replayError = Cause.findErrorOption(replayExit.cause)
      expect(Option.isSome(replayError)).toBe(true)
      if (Option.isNone(replayError)) return yield* Effect.die("replay failure must retain its typed state mismatch")
      expect(replayError.value).toBeInstanceOf(StateMismatchError)
      if (!(replayError.value instanceof StateMismatchError))
        return yield* Effect.die("invalid lineage replay must fail with StateMismatchError")
      expect(replayError.value.message).toContain('action "fixAutomaticSuccessorSession"')
      expect(replayError.value.expected).toMatchObject({ baseAncestorOfSuccessorHead: true })
      expect(replayError.value.actual).toMatchObject({ baseAncestorOfSuccessorHead: false })
      const fixture = capture.fixture
      if (fixture === undefined) return yield* Effect.die("negative Quint replay must create its fixture")
      const observed = fixture
        .records()
        .find(({ event }) => event._tag === "TargetLineageObserved" && event.operationId === fixture.lineageOperationId)
      expect(observed?.event._tag).toBe("TargetLineageObserved")
      if (observed?.event._tag !== "TargetLineageObserved")
        return yield* Effect.die("negative control must persist the controlled Git lineage observation")
      expect(observed.event.observation.plannedBaseIsAncestorOfTargetHead).toBe(false)
      expect(observed.event.observation.targetHeadSha).toBe(fixture.boundary.currentHead)
      expect(observed.event.observation.targetHeadSha).not.toBe(fixture.successorHead)
      expect(fixture.boundary.lineageReadCalls).toBe(1)
      expect(fixture.boundary.baselineReadCalls).toBe(1)
      expect(fixture.boundary.catchUpCalls).toBe(1)
      expect(capture.fixationResult?._tag).toBe("ActionDeferred")
      if (capture.fixationResult?._tag !== "ActionDeferred")
        return yield* Effect.die("production fixation must defer a stale lineage observation")
      expect(capture.fixationResult.reason).toBe("ContinuationAuthorizationStale")
      expect(capture.lineageStateMismatch).toEqual({ model: true, production: false })
      expect(
        fixture.records().filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      ).toHaveLength(1)
      expect(
        fixture.records().filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
      ).toHaveLength(0)
      expect(capture.actions.at(-1)).toBe("fixAutomaticSuccessorSession")
      expect(reduceWorkflowJournalHistory(fixture.runId, fixture.records())._tag).toBe("ValidWorkflowJournalHistory")
    }),
  30_000
)
