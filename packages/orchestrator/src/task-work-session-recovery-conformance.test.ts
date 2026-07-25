import { it } from "@effect/vitest"
import { Effect, Match } from "effect"
import { expect } from "vitest"
import { decodeAmbiguityBoundaryV1, encodeAmbiguityBoundaryV1, ModelAmbiguityBoundaryV1 } from "./ambiguity-boundary.js"
import {
  OperationId,
  ProviderObservationId,
  ProviderRequestId,
  TaskId,
  TaskRevision,
  TaskWorkSessionId
} from "./domain.js"
import {
  mapTaskWorkSessionRecoveryControls,
  runTaskWorkSessionRecoveryAction,
  taskWorkSessionRecoveryActions
} from "./task-work-session-recovery-conformance.js"

const mappings = [
  { _tag: "Subject", modelIdentity: 1n, value: TaskId.make("task-41") },
  { _tag: "Operation", modelIdentity: 2n, value: OperationId.make("operation-session") },
  { _tag: "TaskRevision", modelIdentity: 3n, value: TaskRevision.make("revision-fingerprint") },
  { _tag: "Operation", modelIdentity: 4n, value: OperationId.make("operation-plan") },
  { _tag: "Operation", modelIdentity: 5n, value: OperationId.make("operation-worktree") },
  {
    _tag: "ProviderObservation",
    modelIdentity: 6n,
    value: ProviderObservationId.make("request-observation")
  },
  {
    _tag: "ProviderRequest",
    modelIdentity: 7n,
    value: ProviderRequestId.make("provider-request")
  },
  {
    _tag: "ProviderObservation",
    modelIdentity: 8n,
    value: ProviderObservationId.make("lookup-observation")
  },
  { _tag: "Session", modelIdentity: 9n, value: TaskWorkSessionId.make("provider-session") },
  {
    _tag: "ProviderObservation",
    modelIdentity: 10n,
    value: ProviderObservationId.make("lookup-observation-2")
  },
  {
    _tag: "ProviderObservation",
    modelIdentity: 11n,
    value: ProviderObservationId.make("lookup-observation-3")
  },
  {
    _tag: "ProviderRequest",
    modelIdentity: 12n,
    value: ProviderRequestId.make("provider-request-2")
  }
]

const modelBoundary = ModelAmbiguityBoundaryV1.make({
  activation: 0n,
  authorityEffectIdentities: [7n],
  authorityEvidence: [
    {
      activation: 0n,
      observation: 6n,
      revision: { _tag: "NoProviderRevisionClaimed" }
    },
    {
      activation: 0n,
      observation: 8n,
      revision: { _tag: "NoProviderRevisionClaimed" }
    },
    {
      activation: 0n,
      observation: 10n,
      revision: { _tag: "NoProviderRevisionClaimed" }
    },
    {
      activation: 0n,
      observation: 11n,
      revision: { _tag: "NoProviderRevisionClaimed" }
    }
  ],
  causalPredecessors: [4n, 5n],
  disposition: { _tag: "Established", session: 9n },
  freshChecks: [{ _tag: "Matching", observation: 8n, session: 9n }],
  immutableRequestFingerprint: 3n,
  intentCommitted: true,
  operationIdentity: 2n,
  requestAttempts: [{ _tag: "Acknowledged", observation: 6n, providerRequest: 7n }],
  subject: 1n,
  version: 1
})

it.effect("rejects an unknown M1 action before a control is invoked", () =>
  Effect.gen(function*() {
    let invoked = false
    const control = () =>
      Effect.sync(() => {
        invoked = true
      })
    const failure = yield* runTaskWorkSessionRecoveryAction("inventExpectedState", {
      commitIntent: control,
      crash: control,
      init: control,
      lookupAbsent: control,
      lookupConflict: control,
      lookupContradictoryAbsence: control,
      lookupMatching: control,
      lookupUnreadable: control,
      recordLookup: control,
      recordOutcome: control,
      requestCreatesNothing: control,
      requestCreatesSession: control,
      restart: control,
      selectIdentity: control
    }).pipe(Effect.flip)

    expect(failure).toMatchObject({ reason: "UnknownAction" })
    expect(invoked).toBe(false)
  }))

it.effect("maps every closed M1 action to exactly one public control", () =>
  Effect.gen(function*() {
    const invoked = new Array<string>()
    const control = (action: string) => () => Effect.sync(() => invoked.push(action))
    const mapped = mapTaskWorkSessionRecoveryControls({
      commitIntent: control("commitIntent"),
      crash: control("crash"),
      init: control("init"),
      lookupAbsent: control("lookupAbsent"),
      lookupConflict: control("lookupConflict"),
      lookupContradictoryAbsence: control("lookupContradictoryAbsence"),
      lookupMatching: control("lookupMatching"),
      lookupUnreadable: control("lookupUnreadable"),
      recordLookup: control("recordLookup"),
      recordOutcome: control("recordOutcome"),
      requestCreatesNothing: control("requestCreatesNothing"),
      requestCreatesSession: control("requestCreatesSession"),
      restart: control("restart"),
      selectIdentity: control("selectIdentity")
    })
    for (const action of taskWorkSessionRecoveryActions) yield* mapped[action]()
    expect(invoked).toEqual(taskWorkSessionRecoveryActions)
  }))

it.effect("round-trips AmbiguityBoundaryV1 through branded identities without loss", () =>
  Effect.gen(function*() {
    const branded = yield* decodeAmbiguityBoundaryV1(modelBoundary, mappings)
    expect(branded).toMatchObject({
      disposition: { _tag: "Established", session: "provider-session" },
      operationIdentity: "operation-session",
      subject: "task-41"
    })
    expect(yield* encodeAmbiguityBoundaryV1(branded, mappings)).toEqual(modelBoundary)
  }))

it.effect("round-trips request failures, pending returns, and every exact nonterminal disposition", () =>
  Effect.gen(function*() {
    const requestAttempts = [
      { _tag: "Failed", detail: "provider return unreadable", observation: 6n },
      { _tag: "Pending", observation: 8n }
    ] as const
    const dispositions = [
      { _tag: "Active" },
      { _tag: "CorrelationConflict" },
      { _tag: "EstablishmentDidNotConverge" },
      { _tag: "LookupDidNotConverge" }
    ] as const

    for (const disposition of dispositions) {
      const freshChecks = Match.valueTags(disposition, {
        Active: () => [{ _tag: "Pending" as const, observation: 8n }],
        CorrelationConflict: () => [{
          _tag: "Conflict" as const,
          conflicts: [{ detail: "provider session conflicts", session: 9n }] as const,
          observation: 8n
        }],
        EstablishmentDidNotConverge: () => [
          { _tag: "Absent" as const, observation: 8n },
          { _tag: "Absent" as const, observation: 10n },
          { _tag: "Absent" as const, observation: 11n }
        ],
        LookupDidNotConverge: () => [
          { _tag: "Unreadable" as const, detail: "provider unreadable", observation: 8n },
          { _tag: "Unreadable" as const, detail: "provider unreadable", observation: 10n },
          { _tag: "Unreadable" as const, detail: "provider unreadable", observation: 11n }
        ]
      })
      const boundedEstablishment = disposition._tag === "EstablishmentDidNotConverge"
      const candidate = ModelAmbiguityBoundaryV1.make({
        ...modelBoundary,
        authorityEffectIdentities: boundedEstablishment ? [7n, 12n] : [],
        disposition,
        freshChecks,
        requestAttempts: boundedEstablishment
          ? [
            { _tag: "Acknowledged", observation: 6n, providerRequest: 7n },
            { _tag: "Acknowledged", observation: 10n, providerRequest: 12n },
            ...requestAttempts
          ]
          : requestAttempts
      })
      const branded = yield* decodeAmbiguityBoundaryV1(candidate, mappings)
      expect(yield* encodeAmbiguityBoundaryV1(branded, mappings)).toEqual(candidate)
    }
  }))

it.effect("rejects an impossible established boundary without matching fresh evidence", () =>
  Effect.gen(function*() {
    const failure = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      freshChecks: []
    }, mappings).pipe(Effect.flip)

    expect(failure).toMatchObject({ reason: "LossyProjection" })
  }))

it.effect("rejects repeated or stale observations as bounded fresh evidence", () =>
  Effect.gen(function*() {
    const repeated = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      authorityEffectIdentities: [],
      disposition: { _tag: "LookupDidNotConverge" },
      freshChecks: [
        { _tag: "Unreadable", detail: "provider unreadable", observation: 8n },
        { _tag: "Unreadable", detail: "provider unreadable", observation: 8n },
        { _tag: "Unreadable", detail: "provider unreadable", observation: 8n }
      ],
      requestAttempts: []
    }, mappings).pipe(Effect.flip)
    expect(repeated).toMatchObject({ reason: "LossyProjection" })

    const stale = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      activation: 1n
    }, mappings).pipe(Effect.flip)
    expect(stale).toMatchObject({ reason: "LossyProjection" })
  }))

it.effect("rejects uncommitted facts and authority effects without acknowledgements", () =>
  Effect.gen(function*() {
    const uncommitted = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      intentCommitted: false
    }, mappings).pipe(Effect.flip)
    expect(uncommitted).toMatchObject({ reason: "LossyProjection" })

    const unacknowledged = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      requestAttempts: []
    }, mappings).pipe(Effect.flip)
    expect(unacknowledged).toMatchObject({ reason: "LossyProjection" })

    const uncommittedEmpty = yield* decodeAmbiguityBoundaryV1({
      ...modelBoundary,
      authorityEffectIdentities: [],
      authorityEvidence: [],
      causalPredecessors: [],
      disposition: { _tag: "Active" },
      freshChecks: [],
      intentCommitted: false,
      requestAttempts: []
    }, mappings)
    expect(uncommittedEmpty).toMatchObject({
      disposition: { _tag: "Active" },
      intentCommitted: false
    })
  }))

it.effect("rejects unknown, duplicate, and lossy AmbiguityBoundaryV1 mappings", () =>
  Effect.gen(function*() {
    const invalidMapping = yield* decodeAmbiguityBoundaryV1(modelBoundary, [{}]).pipe(Effect.flip)
    expect(invalidMapping).toMatchObject({ reason: "LossyProjection" })

    const unknown = yield* decodeAmbiguityBoundaryV1(
      modelBoundary,
      mappings.filter(
        (mapping) => mapping._tag !== "Session"
      )
    ).pipe(
      Effect.flip
    )
    expect(unknown).toMatchObject({ reason: "UnknownModelIdentity" })

    const duplicateModel = yield* decodeAmbiguityBoundaryV1(modelBoundary, [
      ...mappings,
      { _tag: "Session", modelIdentity: 9n, value: TaskWorkSessionId.make("other-session") }
    ]).pipe(Effect.flip)
    expect(duplicateModel).toMatchObject({ reason: "DuplicateModelIdentity" })

    const duplicateBranded = yield* decodeAmbiguityBoundaryV1(modelBoundary, [
      ...mappings,
      { _tag: "Session", modelIdentity: 10n, value: TaskWorkSessionId.make("provider-session") }
    ]).pipe(Effect.flip)
    expect(duplicateBranded).toMatchObject({ reason: "DuplicateBrandedIdentity" })

    const branded = yield* decodeAmbiguityBoundaryV1(modelBoundary, mappings)
    const lossy = yield* encodeAmbiguityBoundaryV1({
      ...branded,
      operationIdentity: OperationId.make("unmapped-operation")
    }, mappings).pipe(Effect.flip)
    expect(lossy).toMatchObject({ reason: "LossyProjection" })

    const invalidBoundary = yield* encodeAmbiguityBoundaryV1({
      ...branded,
      activation: -1n
    }, mappings).pipe(Effect.flip)
    expect(invalidBoundary).toMatchObject({ reason: "LossyProjection" })
  }))
