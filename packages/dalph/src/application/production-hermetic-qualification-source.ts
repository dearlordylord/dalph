import type { EvidenceDigest, RunId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  completionTaskRequestFor,
  JournaledRunTermination,
  ProductionRunSelection,
  type TraceAtCursor,
  type CurrentDeliveryStatus,
  type DeliveryRuntimeObservationState
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { validateHermeticQualificationHistoricalSource } from "./production-hermetic-qualification-history.js"
import {
  applicationExitDispositionRecord,
  currentDeliveryStatusRecord,
  productionCliFailureRecord,
  ProductionCliDeliveryError,
  runDispositionRecord,
  type ProductionCliRecord
} from "./production-cli.js"
import { hermeticCanonicalRecordDigest } from "./production-hermetic-provider-bridge.js"
import type { HermeticFixtureManifest } from "./production-hermetic-contract.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"

import {
  sourceRejected,
  strictSource,
  contextFor,
  type HermeticQualificationSourceRejected
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateCompletionClaim,
  completionClaimOfProposal
} from "./production-hermetic-qualification-fixture-source.js"

import {
  readyObservationOf,
  validateHermeticQualificationCurrentSource
} from "./production-hermetic-qualification-status-source.js"

const validatedRecordTypeId: unique symbol = Symbol("HermeticValidatedRecord")
/** One canonical record digest constructed only after this module checks its original source atoms. */
export interface ValidatedHermeticRecordToken {
  readonly [validatedRecordTypeId]: typeof validatedRecordTypeId
  readonly digest: EvidenceDigest
}
const validatedRecordToken = (
  record: ProductionCliRecord
): Effect.Effect<ValidatedHermeticRecordToken, HermeticQualificationSourceRejected> =>
  Effect.try({
    try: (): ValidatedHermeticRecordToken => ({
      [validatedRecordTypeId]: validatedRecordTypeId,
      digest: hermeticCanonicalRecordDigest(record)
    }),
    catch: sourceRejected
  })

export const validateHermeticQualificationStatus = Effect.fn("HermeticQualification.validateStatus")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  state: DeliveryRuntimeObservationState,
  selectedRunId: RunId
): Effect.fn.Return<
  { readonly status: CurrentDeliveryStatus; readonly registration: ValidatedHermeticRecordToken },
  HermeticQualificationSourceRejected
> {
  const context = yield* contextFor(manifest, configuration, selectedRunId)
  const status = yield* validateHermeticQualificationCurrentSource(state, context)
  return { status, registration: yield* validatedRecordToken(currentDeliveryStatusRecord(status)) }
})

/** Checks the original mapped throttle evidence before the ordinary CLI emits its literal failure record. */
export const validateHermeticQualificationDeliveryFailure = Effect.fn("HermeticQualification.validateDeliveryFailure")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    failure: ProductionCliDeliveryError,
    selectedRunId: RunId,
    state: DeliveryRuntimeObservationState
  ): Effect.fn.Return<
    { readonly error: ProductionCliDeliveryError; readonly registration: ValidatedHermeticRecordToken },
    HermeticQualificationSourceRejected
  > {
    const context = yield* contextFor(manifest, configuration, selectedRunId)
    const publicFailure = yield* Schema.decodeUnknownEffect(
      Schema.Struct(ProductionCliDeliveryError.fields),
      strictSource
    )({ _tag: failure._tag, code: failure.code, detail: failure.detail, subject: failure.subject }).pipe(
      Effect.mapError(sourceRejected)
    )
    const subject = publicFailure.subject
    if (subject.runId !== selectedRunId || subject.operation !== "CompleteTask") return yield* sourceRejected()
    const ready = readyObservationOf(state)
    if (ready === null || ready.evaluation.current.runId !== selectedRunId) return yield* sourceRejected()
    const proposed =
      ready.evaluation.proposedActions._tag === "DeliveryProposalsAvailable"
        ? ready.evaluation.proposedActions.proposals
        : []
    const proposals = [...proposed, ...ready.liveOwners.map((owner) => owner.proposal)]
    const requests = yield* Effect.forEach(proposals, (proposal) =>
      Effect.gen(function* () {
        const claim = completionClaimOfProposal(proposal)
        if (claim === null) return null
        return completionTaskRequestFor(yield* validateCompletionClaim(claim, context))
      })
    )
    if (!requests.some((request) => request?.operationId === subject.operationId)) return yield* sourceRejected()
    return { error: failure, registration: yield* validatedRecordToken(productionCliFailureRecord(failure)) }
  }
)

/** The actual host selection is checked before the ordinary presenter publishes its RunSelected record. */
export const validateHermeticQualificationSelection = Effect.fn("HermeticQualification.validateSelection")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  selection: ProductionRunSelection
) {
  const original = yield* Schema.decodeUnknownEffect(
    ProductionRunSelection,
    strictSource
  )(selection).pipe(Effect.mapError(sourceRejected))
  yield* contextFor(manifest, configuration, original.runId)
  return {
    selection,
    registration: yield* validatedRecordToken({
      _tag: "RunSelected",
      runId: original.runId,
      selection: original._tag,
      version: 1
    })
  }
})

/** One real acknowledged terminal cursor supplies the disposition; status closure cannot create it. */
export const validateHermeticQualificationRunDisposition = Effect.fn("HermeticQualification.validateRunDisposition")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    selectedRunId: RunId,
    termination: JournaledRunTermination
  ) {
    yield* contextFor(manifest, configuration, selectedRunId)
    const original = yield* Schema.decodeUnknownEffect(
      JournaledRunTermination,
      strictSource
    )(termination).pipe(Effect.mapError(sourceRejected))
    if (original.terminatedAt.runId !== selectedRunId) return yield* sourceRejected()
    return {
      termination,
      registration: yield* validatedRecordToken(runDispositionRecord(selectedRunId, original.disposition))
    }
  }
)

/** The ordinary Exit projector drops its private diagnostics, retaining only the closed result and status. */
export const validateHermeticQualificationApplicationExit = Effect.fn("HermeticQualification.validateApplicationExit")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    selectedRunId: RunId,
    disposition: ApplicationExitResult
  ) {
    yield* contextFor(manifest, configuration, selectedRunId)
    const original = yield* Schema.decodeUnknownEffect(
      ApplicationExitResult,
      strictSource
    )(disposition).pipe(Effect.mapError(sourceRejected))
    return {
      disposition,
      registration: yield* validatedRecordToken(applicationExitDispositionRecord(selectedRunId, original))
    }
  }
)

/** Returns the same original history view after fixture-bound checks and construction of its exact publication token. */
export const validateHermeticQualificationHistory = Effect.fn("HermeticQualification.validateHistory")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  snapshot: TraceAtCursor,
  selectedRunId: RunId
): Effect.fn.Return<
  { readonly snapshot: TraceAtCursor; readonly registration: ValidatedHermeticRecordToken },
  HermeticQualificationSourceRejected
> {
  const context = yield* contextFor(manifest, configuration, selectedRunId)
  yield* validateHermeticQualificationHistoricalSource(snapshot, context)
  return { snapshot, registration: yield* validatedRecordToken({ _tag: "HistoricalSnapshot", snapshot, version: 1 }) }
})
