import { Match, Schema } from "effect"
import {
  OperationId,
  ProviderObservationId,
  ProviderRequestId,
  TaskId,
  TaskRevision,
  TaskWorkSessionId
} from "./domain.js"

const firstModelIdentity = 0n
const ModelIdentity = Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(firstModelIdentity))

/** Identifies the coordinator activation that obtained one fresh authority observation. */
export const RecoveryActivationOrdinal = ModelIdentity.pipe(Schema.brand("RecoveryActivationOrdinal"))
export type RecoveryActivationOrdinal = typeof RecoveryActivationOrdinal.Type

export const ModelIdentityMapping = Schema.TaggedUnion({
  Operation: { modelIdentity: ModelIdentity, value: OperationId },
  ProviderObservation: { modelIdentity: ModelIdentity, value: ProviderObservationId },
  ProviderRequest: { modelIdentity: ModelIdentity, value: ProviderRequestId },
  Session: { modelIdentity: ModelIdentity, value: TaskWorkSessionId },
  Subject: { modelIdentity: ModelIdentity, value: TaskId },
  TaskRevision: { modelIdentity: ModelIdentity, value: TaskRevision }
})
export type ModelIdentityMapping = typeof ModelIdentityMapping.Type

export const ModelRequestAttempt = Schema.TaggedUnion({
  Acknowledged: { observation: ModelIdentity, providerRequest: ModelIdentity },
  Failed: { detail: Schema.String, observation: ModelIdentity },
  Pending: { observation: ModelIdentity }
})

export const ModelFreshCheck = Schema.TaggedUnion({
  Absent: { observation: ModelIdentity },
  Conflict: {
    conflicts: Schema.NonEmptyArray(Schema.Struct({
      detail: Schema.NonEmptyString,
      session: ModelIdentity
    })),
    observation: ModelIdentity
  },
  Matching: { observation: ModelIdentity, session: ModelIdentity },
  Pending: { observation: ModelIdentity },
  Unreadable: { detail: Schema.NonEmptyString, observation: ModelIdentity }
})

export const ModelDisposition = Schema.TaggedUnion({
  Active: {},
  CorrelationConflict: {},
  Established: { session: ModelIdentity },
  EstablishmentDidNotConverge: {},
  LookupDidNotConverge: {}
})

const ModelAuthorityEvidence = Schema.Struct({
  activation: ModelIdentity,
  observation: ModelIdentity,
  revision: Schema.TaggedStruct("NoProviderRevisionClaimed", {})
})

interface AmbiguityBoundaryConsistency {
  readonly activation: unknown
  readonly authorityEffectIdentities: ReadonlyArray<unknown>
  readonly authorityEvidence: ReadonlyArray<{
    readonly activation: unknown
    readonly observation: unknown
  }>
  readonly causalPredecessors: ReadonlyArray<unknown>
  readonly disposition:
    | { readonly _tag: "Active" }
    | { readonly _tag: "CorrelationConflict" }
    | { readonly _tag: "Established"; readonly session: unknown }
    | { readonly _tag: "EstablishmentDidNotConverge" }
    | { readonly _tag: "LookupDidNotConverge" }
  readonly freshChecks: ReadonlyArray<{
    readonly _tag: string
    readonly observation: unknown
    readonly session?: unknown
  }>
  readonly intentCommitted: boolean
  readonly requestAttempts: ReadonlyArray<{
    readonly _tag: string
    readonly providerRequest?: unknown
  }>
}

const lookupAttemptBound = 3
const establishmentRequestBound = 2
const hasAuthorityEvidence = (
  boundary: AmbiguityBoundaryConsistency,
  observation: unknown
) =>
  boundary.authorityEvidence.some((evidence) =>
    evidence.activation === boundary.activation && evidence.observation === observation
  )

const distinctEvidencedChecks = (
  boundary: AmbiguityBoundaryConsistency,
  tag: string
) => {
  const observations = boundary.freshChecks
    .filter((check) => check._tag === tag && hasAuthorityEvidence(boundary, check.observation))
    .map((check) => check.observation)
  return new Set(observations).size
}

const authorityEffectsMatchAcknowledgements = (
  boundary: AmbiguityBoundaryConsistency
) => {
  const acknowledged = boundary.requestAttempts.flatMap((attempt) =>
    attempt._tag === "Acknowledged" && attempt.providerRequest !== undefined
      ? [attempt.providerRequest]
      : []
  )
  return boundary.authorityEffectIdentities.every((identity) =>
    acknowledged.some((candidate) => candidate === identity)
  )
    && acknowledged.every((identity) => boundary.authorityEffectIdentities.some((candidate) => candidate === identity))
}

const validEstablishedDisposition = (
  boundary: AmbiguityBoundaryConsistency,
  session: unknown
) =>
  boundary.freshChecks.some((check) =>
    check._tag === "Matching"
    && check.session === session
    && hasAuthorityEvidence(boundary, check.observation)
  )

const validEstablishmentNonConvergence = (boundary: AmbiguityBoundaryConsistency) =>
  distinctEvidencedChecks(boundary, "Absent") === lookupAttemptBound
  && boundary.authorityEffectIdentities.length === establishmentRequestBound
  && new Set(boundary.authorityEffectIdentities).size === establishmentRequestBound
  && authorityEffectsMatchAcknowledgements(boundary)

const intentConsistency = Schema.makeFilter((boundary: AmbiguityBoundaryConsistency) =>
  boundary.intentCommitted
    || (
      boundary.disposition._tag === "Active"
      && boundary.authorityEffectIdentities.length === 0
      && boundary.authorityEvidence.length === 0
      && boundary.freshChecks.length === 0
      && boundary.requestAttempts.length === 0
    )
    ? undefined
    : {
      path: ["intentCommitted"],
      issue: "an uncommitted ambiguity boundary cannot contain request, evidence, or disposition facts"
    }
)

const establishedConsistency = Schema.makeFilter((boundary: AmbiguityBoundaryConsistency) =>
  boundary.disposition._tag !== "Established"
    || (
      boundary.intentCommitted
      && boundary.causalPredecessors.length > 0
      && validEstablishedDisposition(boundary, boundary.disposition.session)
    )
    ? undefined
    : {
      path: ["disposition"],
      issue: "an established ambiguity boundary requires intent, causal predecessors, and matching fresh evidence"
    }
)

const authorityEffectConsistency = Schema.makeFilter((boundary: AmbiguityBoundaryConsistency) =>
  authorityEffectsMatchAcknowledgements(boundary)
    ? undefined
    : {
      path: ["authorityEffectIdentities"],
      issue: "every authority effect identity must correspond to one acknowledged request attempt"
    }
)

const terminalDispositionIsConsistent = (boundary: AmbiguityBoundaryConsistency) =>
  Match.valueTags(boundary.disposition, {
    Active: () => true,
    CorrelationConflict: () => distinctEvidencedChecks(boundary, "Conflict") > 0,
    Established: ({ session }) => validEstablishedDisposition(boundary, session),
    EstablishmentDidNotConverge: () => validEstablishmentNonConvergence(boundary),
    LookupDidNotConverge: () => distinctEvidencedChecks(boundary, "Unreadable") === lookupAttemptBound
  })

const terminalDispositionConsistency = Schema.makeFilter((boundary: AmbiguityBoundaryConsistency) => {
  const valid = terminalDispositionIsConsistent(boundary)
  return valid
    ? undefined
    : {
      path: ["disposition"],
      issue: "a terminal ambiguity disposition requires its exact bounded fresh authority evidence"
    }
})

/**
 * The versioned model-side M1/M2 overlap. Bigint identities are intentionally
 * meaningless until decoded through the explicit branded identity table.
 */
export const ModelAmbiguityBoundaryV1 = Schema.Struct({
  activation: ModelIdentity,
  authorityEffectIdentities: Schema.Array(ModelIdentity),
  authorityEvidence: Schema.Array(ModelAuthorityEvidence),
  causalPredecessors: Schema.Array(ModelIdentity),
  disposition: ModelDisposition,
  freshChecks: Schema.Array(ModelFreshCheck),
  immutableRequestFingerprint: ModelIdentity,
  intentCommitted: Schema.Boolean,
  operationIdentity: ModelIdentity,
  requestAttempts: Schema.Array(ModelRequestAttempt),
  subject: ModelIdentity,
  version: Schema.Literal(1)
}).check(
  intentConsistency,
  establishedConsistency,
  authorityEffectConsistency,
  terminalDispositionConsistency
)
export type ModelAmbiguityBoundaryV1 = typeof ModelAmbiguityBoundaryV1.Type

export const RequestAttempt = Schema.TaggedUnion({
  Acknowledged: { observation: ProviderObservationId, providerRequest: ProviderRequestId },
  Failed: { detail: Schema.String, observation: ProviderObservationId },
  Pending: { observation: ProviderObservationId }
})

export const FreshCheck = Schema.TaggedUnion({
  Absent: { observation: ProviderObservationId },
  Conflict: {
    conflicts: Schema.NonEmptyArray(Schema.Struct({
      detail: Schema.NonEmptyString,
      session: TaskWorkSessionId
    })),
    observation: ProviderObservationId
  },
  Matching: { observation: ProviderObservationId, session: TaskWorkSessionId },
  Pending: { observation: ProviderObservationId },
  Unreadable: { detail: Schema.NonEmptyString, observation: ProviderObservationId }
})

export const AmbiguityBoundaryDispositionV1 = Schema.TaggedUnion({
  Active: {},
  CorrelationConflict: {},
  Established: { session: TaskWorkSessionId },
  EstablishmentDidNotConverge: {},
  LookupDidNotConverge: {}
})

const AuthorityEvidence = Schema.Struct({
  activation: RecoveryActivationOrdinal,
  observation: ProviderObservationId,
  revision: Schema.TaggedStruct("NoProviderRevisionClaimed", {})
})

/**
 * Branded Dalph projection shared by model adapters at session establishment.
 * Provider evidence explicitly reports that the current task-runner contract
 * claims no provider revision; observation identity and activation prove freshness.
 */
export const AmbiguityBoundaryV1 = Schema.Struct({
  activation: RecoveryActivationOrdinal,
  authorityEffectIdentities: Schema.Array(ProviderRequestId),
  authorityEvidence: Schema.Array(AuthorityEvidence),
  causalPredecessors: Schema.Array(OperationId),
  disposition: AmbiguityBoundaryDispositionV1,
  freshChecks: Schema.Array(FreshCheck),
  immutableRequestFingerprint: TaskRevision,
  intentCommitted: Schema.Boolean,
  operationIdentity: OperationId,
  requestAttempts: Schema.Array(RequestAttempt),
  subject: TaskId,
  version: Schema.Literal(1)
}).check(
  intentConsistency,
  establishedConsistency,
  authorityEffectConsistency,
  terminalDispositionConsistency
)
export type AmbiguityBoundaryV1 = typeof AmbiguityBoundaryV1.Type
