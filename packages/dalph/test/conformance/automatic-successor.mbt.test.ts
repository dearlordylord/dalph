import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, quintRun, stateCheck } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import {
  integratorAutomaticSuccessorPreparationIsCurrent,
  prepareIntegratorAutomaticSuccessorSessionAppend,
  validateAutomaticSuccessorSessionFixedRecord
} from "../../../orchestrator/src/workflow/protocols/integrator/automatic-successor-session.js"
import { integratorSuccessorResponsibilityMatches } from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { makeSuccessorPrefix } from "../../../orchestrator/test/support/automatic-successor-history.js"

const selectedAutomaticSuccessorFields = Schema.Struct({
  successorExpectedHead: ITFBigInt,
  successorFixedWithCurrentAuthority: Schema.Boolean,
  successorResource: ITFBigInt,
  successorSession: ITFBigInt,
  successorSessionCount: ITFBigInt
})

const projectedModelState = stateCheck(
  (raw) => Schema.decodeUnknownEffect(selectedAutomaticSuccessorFields)(raw),
  (model, production) =>
    model.successorExpectedHead === production.successorExpectedHead &&
    model.successorFixedWithCurrentAuthority === production.successorFixedWithCurrentAuthority &&
    model.successorResource === production.successorResource &&
    model.successorSession === production.successorSession &&
    model.successorSessionCount === production.successorSessionCount
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

const modelHeadFor = (fixture: ReturnType<typeof makeSuccessorPrefix>, head: string): bigint =>
  head === fixture.input.targetLineage.targetHeadSha ? 11n : 0n

const projectionFor = (fixture: ReturnType<typeof makeSuccessorPrefix>) => {
  const records = fixture.records()
  const fixed = records.findLast((record) => record.event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  if (fixed === undefined || fixed.event._tag !== "IntegratorAutomaticSuccessorSessionFixed") {
    return {
      successorExpectedHead: 0n,
      successorFixedWithCurrentAuthority: false,
      successorResource: 0n,
      successorSession: 0n,
      successorSessionCount: 0n
    }
  }
  const validation = validateAutomaticSuccessorSessionFixedRecord(records, fixed, fixture.input.predecessor)
  const generation = BigInt(fixed.event.successorGeneration)
  return {
    successorExpectedHead: modelHeadFor(fixture, fixed.event.successor.expectedTargetHead),
    successorFixedWithCurrentAuthority: validation._tag === "Valid",
    successorResource: 101n + generation,
    successorSession: generation,
    successorSessionCount: 1n
  }
}

interface ConformanceCapture {
  readonly actions: Array<string>
  fixture?: ReturnType<typeof makeSuccessorPrefix>
}

const productionDriver = (capture: ConformanceCapture) =>
  defineDriver(acceptedAutomaticSuccessorActions, () => {
    const fixture = makeSuccessorPrefix()
    capture.fixture = fixture
    const observe = (action: string) => Effect.sync(() => capture.actions.push(action))
    const requireRecords = (
      predicate: (record: ReturnType<typeof fixture.records>[number]) => boolean,
      detail: string
    ) =>
      Effect.sync(() => {
        expect(fixture.records().some(predicate), detail).toBe(true)
      })
    return {
      init: () => observe("init"),
      recordInitialPublicationIntent: () =>
        requireRecords(
          (record) => record.event._tag === "RemotePublicationIntended",
          "model publication intent is durable"
        ),
      outsidePushBeforeInitialDiscovery: () => observe("outsidePushBeforeInitialDiscovery"),
      discoverCompatibleCompetingHead: () =>
        requireRecords(
          (record) =>
            record.event._tag === "RemotePublicationRetained" && record.event.cause._tag === "CompatibleCompetingHead",
          "the competing H2 publication is retained"
        ),
      recordAutomaticSuccessorAuthorization: () =>
        Effect.sync(() => {
          const authorization = fixture
            .records()
            .find((record) => record.event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          expect(authorization?.event._tag).toBe("IntegratorCompetingHeadSuccessorAuthorized")
          if (authorization?.event._tag === "IntegratorCompetingHeadSuccessorAuthorized") {
            expect(authorization.event.correlation.qualifiedCandidate.run.session).toEqual(fixture.input.predecessor)
          }
          capture.actions.push("recordAutomaticSuccessorAuthorization")
        }),
      beginNextActivation: () => observe("beginNextActivation"),
      rereadAuthorityFacts: () => observe("rereadAuthorityFacts"),
      recordRemoteBaselineReadIntent: () =>
        requireRecords(
          (record) => record.event._tag === "RemoteBaselineReadIntended",
          "H2 baseline read intent is durable"
        ),
      observeAncestorLocalBaseline: () =>
        requireRecords(
          (record) =>
            record.event._tag === "RemoteBaselineObserved" && record.event.observation._tag === "LocalAncestor",
          "Git observed local H1 as an ancestor of remote H2"
        ),
      recordCatchUpIntent: () =>
        requireRecords(
          (record) => record.event._tag === "LocalTargetCatchUpIntended",
          "the exact H1 to H2 CAS intent is durable"
        ),
      compareAndSetLocalTargetToRemoteHead: () =>
        requireRecords(
          (record) => record.event._tag === "LocalTargetCatchUpObserved" && record.event.result._tag === "Applied",
          "the exact H1 to H2 CAS result is durable"
        ),
      recordCatchUpResult: () => observe("recordCatchUpResult"),
      proveBaseAncestorOfSuccessorHead: () =>
        Effect.sync(() => {
          const records = fixture.records()
          expect(
            records.some(
              (record) =>
                record.event._tag === "TargetLineageObserved" &&
                record.event.observation.targetHeadSha === fixture.input.targetLineage.targetHeadSha
            )
          ).toBe(true)
          expect(integratorAutomaticSuccessorPreparationIsCurrent(records, fixture.input)).toBe(true)
          capture.actions.push("proveBaseAncestorOfSuccessorHead")
        }),
      fixAutomaticSuccessorSession: () =>
        Effect.gen(function* () {
          const before = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
          if (before._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("accepted S2 prefix must reduce before fixation")
          const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, before.prefix)
          if (prepared._tag !== "Append")
            return yield* Effect.die("canonical model fixation must prepare one production append")
          fixture.append(prepared.event)
          capture.actions.push("fixAutomaticSuccessorSession")
        }),
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
