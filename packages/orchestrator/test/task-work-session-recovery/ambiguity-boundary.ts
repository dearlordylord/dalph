import { Effect, Match, Schema } from "effect"
import {
  OperationId,
  ProviderObservationId,
  ProviderRequestId,
  TaskId,
  TaskRevision,
  TaskWorkSessionId
} from "../../src/domain.js"
import {
  AmbiguityBoundaryDispositionV1,
  AmbiguityBoundaryV1,
  FreshCheck,
  ModelAmbiguityBoundaryV1,
  ModelDisposition,
  ModelFreshCheck,
  ModelIdentityMapping,
  ModelRequestAttempt,
  RecoveryActivationOrdinal,
  RequestAttempt
} from "./ambiguity-boundary-schema.js"
import { TaskWorkSessionRecoveryConformanceIssue } from "./task-work-session-recovery-conformance.js"

export * from "./ambiguity-boundary-schema.js"

type MappingTag = ModelIdentityMapping["_tag"]

interface IdentityMaps {
  readonly mappings: ReadonlyArray<ModelIdentityMapping>
}

const identityKey = (tag: MappingTag, identity: bigint | string): string => `${tag}:${String(identity)}`

const makeIdentityMaps = (
  input: unknown
): Effect.Effect<IdentityMaps, TaskWorkSessionRecoveryConformanceIssue> =>
  Schema.decodeUnknownEffect(Schema.Array(ModelIdentityMapping))(input).pipe(
    Effect.mapError((cause) =>
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `invalid AmbiguityBoundaryV1 identity mapping: ${String(cause)}`,
        reason: "LossyProjection"
      })
    ),
    Effect.flatMap((mappings) =>
      Effect.gen(function*() {
        for (const [index, mapping] of mappings.entries()) {
          const priorMappings = mappings.slice(0, index)
          const modelKey = identityKey(mapping._tag, mapping.modelIdentity)
          if (priorMappings.some((prior) => identityKey(prior._tag, prior.modelIdentity) === modelKey)) {
            return yield* new TaskWorkSessionRecoveryConformanceIssue({
              detail: `duplicate ${mapping._tag} model identity ${mapping.modelIdentity}`,
              reason: "DuplicateModelIdentity"
            })
          }
          const valueKey = identityKey(mapping._tag, mapping.value)
          if (priorMappings.some((prior) => identityKey(prior._tag, prior.value) === valueKey)) {
            return yield* new TaskWorkSessionRecoveryConformanceIssue({
              detail: `duplicate ${mapping._tag} branded identity ${mapping.value}`,
              reason: "DuplicateBrandedIdentity"
            })
          }
        }
        return { mappings }
      })
    )
  )

const findModelIdentity = (
  maps: IdentityMaps,
  tag: MappingTag,
  modelIdentity: bigint
): Effect.Effect<ModelIdentityMapping, TaskWorkSessionRecoveryConformanceIssue> => {
  const mapping = maps.mappings.find((candidate) =>
    identityKey(candidate._tag, candidate.modelIdentity) === identityKey(tag, modelIdentity)
  )
  return mapping !== undefined
    ? Effect.succeed(mapping)
    : Effect.fail(
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `unknown ${tag} model identity ${modelIdentity}`,
        reason: "UnknownModelIdentity"
      })
    )
}

const findBrandedIdentity = (
  maps: IdentityMaps,
  tag: MappingTag,
  value: string
): Effect.Effect<ModelIdentityMapping, TaskWorkSessionRecoveryConformanceIssue> => {
  const mapping = maps.mappings.find((candidate) =>
    identityKey(candidate._tag, candidate.value) === identityKey(tag, value)
  )
  return mapping !== undefined
    ? Effect.succeed(mapping)
    : Effect.fail(
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `branded ${tag} identity ${value} has no lossless model mapping`,
        reason: "LossyProjection"
      })
    )
}

const resolveOperation = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "Operation", identity).pipe(
    Effect.map((mapping) => OperationId.make(mapping.value))
  )

const resolveProviderObservation = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "ProviderObservation", identity).pipe(
    Effect.map((mapping) => ProviderObservationId.make(mapping.value))
  )

const resolveProviderRequest = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "ProviderRequest", identity).pipe(
    Effect.map((mapping) => ProviderRequestId.make(mapping.value))
  )

const resolveSession = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "Session", identity).pipe(
    Effect.map((mapping) => TaskWorkSessionId.make(mapping.value))
  )

const resolveSubject = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "Subject", identity).pipe(
    Effect.map((mapping) => TaskId.make(mapping.value))
  )

const resolveTaskRevision = (maps: IdentityMaps, identity: bigint) =>
  findModelIdentity(maps, "TaskRevision", identity).pipe(
    Effect.map((mapping) => TaskRevision.make(mapping.value))
  )

const encodeOperation = (maps: IdentityMaps, value: OperationId) =>
  findBrandedIdentity(maps, "Operation", value).pipe(Effect.map((mapping) => mapping.modelIdentity))

const encodeProviderObservation = (maps: IdentityMaps, value: ProviderObservationId) =>
  findBrandedIdentity(maps, "ProviderObservation", value).pipe(
    Effect.map((mapping) => mapping.modelIdentity)
  )

const encodeProviderRequest = (maps: IdentityMaps, value: ProviderRequestId) =>
  findBrandedIdentity(maps, "ProviderRequest", value).pipe(
    Effect.map((mapping) => mapping.modelIdentity)
  )

const encodeSession = (maps: IdentityMaps, value: TaskWorkSessionId) =>
  findBrandedIdentity(maps, "Session", value).pipe(Effect.map((mapping) => mapping.modelIdentity))

const encodeSubject = (maps: IdentityMaps, value: TaskId) =>
  findBrandedIdentity(maps, "Subject", value).pipe(Effect.map((mapping) => mapping.modelIdentity))

const encodeTaskRevision = (maps: IdentityMaps, value: TaskRevision) =>
  findBrandedIdentity(maps, "TaskRevision", value).pipe(
    Effect.map((mapping) => mapping.modelIdentity)
  )

const decodeDisposition = (
  maps: IdentityMaps,
  disposition: typeof ModelDisposition.Type
) =>
  Match.valueTags(disposition, {
    Active: () => Effect.succeed(AmbiguityBoundaryDispositionV1.cases.Active.make({})),
    CorrelationConflict: () => Effect.succeed(AmbiguityBoundaryDispositionV1.cases.CorrelationConflict.make({})),
    Established: ({ session }) =>
      resolveSession(maps, session).pipe(
        Effect.map((resolved) => AmbiguityBoundaryDispositionV1.cases.Established.make({ session: resolved }))
      ),
    EstablishmentDidNotConverge: () =>
      Effect.succeed(AmbiguityBoundaryDispositionV1.cases.EstablishmentDidNotConverge.make({})),
    LookupDidNotConverge: () => Effect.succeed(AmbiguityBoundaryDispositionV1.cases.LookupDidNotConverge.make({}))
  })

const encodeDisposition = (
  maps: IdentityMaps,
  disposition: typeof AmbiguityBoundaryDispositionV1.Type
) =>
  Match.valueTags(disposition, {
    Active: () => Effect.succeed(ModelDisposition.cases.Active.make({})),
    CorrelationConflict: () => Effect.succeed(ModelDisposition.cases.CorrelationConflict.make({})),
    Established: ({ session }) =>
      encodeSession(maps, session).pipe(
        Effect.map((encoded) => ModelDisposition.cases.Established.make({ session: encoded }))
      ),
    EstablishmentDidNotConverge: () => Effect.succeed(ModelDisposition.cases.EstablishmentDidNotConverge.make({})),
    LookupDidNotConverge: () => Effect.succeed(ModelDisposition.cases.LookupDidNotConverge.make({}))
  })

const decodeRequestAttempt = (
  maps: IdentityMaps,
  attempt: typeof ModelRequestAttempt.Type
) =>
  Match.valueTags(attempt, {
    Acknowledged: ({ observation, providerRequest }) =>
      Effect.all({
        observation: resolveProviderObservation(maps, observation),
        providerRequest: resolveProviderRequest(maps, providerRequest)
      }).pipe(
        Effect.map(RequestAttempt.cases.Acknowledged.make)
      ),
    Failed: ({ detail, observation }) =>
      resolveProviderObservation(maps, observation).pipe(
        Effect.map((resolved) => RequestAttempt.cases.Failed.make({ detail, observation: resolved }))
      ),
    Pending: ({ observation }) =>
      resolveProviderObservation(maps, observation).pipe(
        Effect.map((resolved) => RequestAttempt.cases.Pending.make({ observation: resolved }))
      )
  })

const encodeRequestAttempt = (
  maps: IdentityMaps,
  attempt: typeof RequestAttempt.Type
) =>
  Match.valueTags(attempt, {
    Acknowledged: ({ observation, providerRequest }) =>
      Effect.all({
        observation: encodeProviderObservation(maps, observation),
        providerRequest: encodeProviderRequest(maps, providerRequest)
      }).pipe(
        Effect.map(ModelRequestAttempt.cases.Acknowledged.make)
      ),
    Failed: ({ detail, observation }) =>
      encodeProviderObservation(maps, observation).pipe(
        Effect.map((encoded) => ModelRequestAttempt.cases.Failed.make({ detail, observation: encoded }))
      ),
    Pending: ({ observation }) =>
      encodeProviderObservation(maps, observation).pipe(
        Effect.map((encoded) => ModelRequestAttempt.cases.Pending.make({ observation: encoded }))
      )
  })

const decodeFreshCheck = (
  maps: IdentityMaps,
  check: typeof ModelFreshCheck.Type
) =>
  Match.valueTags(check, {
    Absent: ({ observation }) =>
      resolveProviderObservation(maps, observation).pipe(
        Effect.map((resolved) => FreshCheck.cases.Absent.make({ observation: resolved }))
      ),
    Conflict: ({ conflicts, observation }) =>
      Effect.all({
        conflicts: Effect.forEach(
          conflicts,
          ({ detail, session }) =>
            resolveSession(maps, session).pipe(Effect.map((resolved) => ({ detail, session: resolved })))
        ),
        observation: resolveProviderObservation(maps, observation)
      }).pipe(Effect.map(FreshCheck.cases.Conflict.make)),
    Matching: ({ observation, session }) =>
      Effect.all({
        observation: resolveProviderObservation(maps, observation),
        session: resolveSession(maps, session)
      }).pipe(Effect.map(FreshCheck.cases.Matching.make)),
    Pending: ({ observation }) =>
      resolveProviderObservation(maps, observation).pipe(
        Effect.map((resolved) => FreshCheck.cases.Pending.make({ observation: resolved }))
      ),
    Unreadable: ({ detail, observation }) =>
      resolveProviderObservation(maps, observation).pipe(
        Effect.map((resolved) => FreshCheck.cases.Unreadable.make({ detail, observation: resolved }))
      )
  })

const encodeFreshCheck = (
  maps: IdentityMaps,
  check: typeof FreshCheck.Type
) =>
  Match.valueTags(check, {
    Absent: ({ observation }) =>
      encodeProviderObservation(maps, observation).pipe(
        Effect.map((encoded) => ModelFreshCheck.cases.Absent.make({ observation: encoded }))
      ),
    Conflict: ({ conflicts, observation }) =>
      Effect.all({
        conflicts: Effect.forEach(
          conflicts,
          ({ detail, session }) =>
            encodeSession(maps, session).pipe(Effect.map((encoded) => ({ detail, session: encoded })))
        ),
        observation: encodeProviderObservation(maps, observation)
      }).pipe(Effect.map(ModelFreshCheck.cases.Conflict.make)),
    Matching: ({ observation, session }) =>
      Effect.all({
        observation: encodeProviderObservation(maps, observation),
        session: encodeSession(maps, session)
      }).pipe(Effect.map(ModelFreshCheck.cases.Matching.make)),
    Pending: ({ observation }) =>
      encodeProviderObservation(maps, observation).pipe(
        Effect.map((encoded) => ModelFreshCheck.cases.Pending.make({ observation: encoded }))
      ),
    Unreadable: ({ detail, observation }) =>
      encodeProviderObservation(maps, observation).pipe(
        Effect.map((encoded) => ModelFreshCheck.cases.Unreadable.make({ detail, observation: encoded }))
      )
  })

/** Decodes the model projection through an explicit, injective branded identity table. */
export const decodeAmbiguityBoundaryV1 = Effect.fn(
  "TaskWorkSessionRecoveryConformance.decodeAmbiguityBoundaryV1"
)(function*(input: unknown, identityMappings: unknown) {
  const model = yield* Schema.decodeUnknownEffect(ModelAmbiguityBoundaryV1)(input).pipe(
    Effect.mapError((cause) =>
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `invalid model AmbiguityBoundaryV1: ${String(cause)}`,
        reason: "LossyProjection"
      })
    )
  )
  const maps = yield* makeIdentityMaps(identityMappings)
  return AmbiguityBoundaryV1.make({
    activation: RecoveryActivationOrdinal.make(model.activation),
    authorityEffectIdentities: yield* Effect.forEach(
      model.authorityEffectIdentities,
      (identity) => resolveProviderRequest(maps, identity)
    ),
    authorityEvidence: yield* Effect.forEach(
      model.authorityEvidence,
      (evidence) =>
        resolveProviderObservation(maps, evidence.observation).pipe(
          Effect.map((observation) => ({
            ...evidence,
            activation: RecoveryActivationOrdinal.make(evidence.activation),
            observation
          }))
        )
    ),
    causalPredecessors: yield* Effect.forEach(
      model.causalPredecessors,
      (identity) => resolveOperation(maps, identity)
    ),
    disposition: yield* decodeDisposition(maps, model.disposition),
    freshChecks: yield* Effect.forEach(model.freshChecks, (check) => decodeFreshCheck(maps, check)),
    immutableRequestFingerprint: yield* resolveTaskRevision(maps, model.immutableRequestFingerprint),
    intentCommitted: model.intentCommitted,
    operationIdentity: yield* resolveOperation(maps, model.operationIdentity),
    requestAttempts: yield* Effect.forEach(
      model.requestAttempts,
      (attempt) => decodeRequestAttempt(maps, attempt)
    ),
    subject: yield* resolveSubject(maps, model.subject),
    version: 1
  })
})

/** Encodes the branded projection and proves that no identity information was lost. */
export const encodeAmbiguityBoundaryV1 = Effect.fn(
  "TaskWorkSessionRecoveryConformance.encodeAmbiguityBoundaryV1"
)(function*(input: unknown, identityMappings: unknown) {
  const boundary = yield* Schema.decodeUnknownEffect(AmbiguityBoundaryV1)(input).pipe(
    Effect.mapError((cause) =>
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `invalid branded AmbiguityBoundaryV1: ${String(cause)}`,
        reason: "LossyProjection"
      })
    )
  )
  const maps = yield* makeIdentityMaps(identityMappings)
  return ModelAmbiguityBoundaryV1.make({
    activation: boundary.activation,
    authorityEffectIdentities: yield* Effect.forEach(
      boundary.authorityEffectIdentities,
      (identity) => encodeProviderRequest(maps, identity)
    ),
    authorityEvidence: yield* Effect.forEach(
      boundary.authorityEvidence,
      (evidence) =>
        encodeProviderObservation(maps, evidence.observation).pipe(
          Effect.map((observation) => ({ ...evidence, observation }))
        )
    ),
    causalPredecessors: yield* Effect.forEach(
      boundary.causalPredecessors,
      (identity) => encodeOperation(maps, identity)
    ),
    disposition: yield* encodeDisposition(maps, boundary.disposition),
    freshChecks: yield* Effect.forEach(boundary.freshChecks, (check) => encodeFreshCheck(maps, check)),
    immutableRequestFingerprint: yield* encodeTaskRevision(maps, boundary.immutableRequestFingerprint),
    intentCommitted: boundary.intentCommitted,
    operationIdentity: yield* encodeOperation(maps, boundary.operationIdentity),
    requestAttempts: yield* Effect.forEach(
      boundary.requestAttempts,
      (attempt) => encodeRequestAttempt(maps, attempt)
    ),
    subject: yield* encodeSubject(maps, boundary.subject),
    version: 1
  })
})
