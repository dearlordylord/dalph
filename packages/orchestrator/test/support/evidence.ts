import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  EvidenceReference,
  type GitCommitSha,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Context, Effect, Layer, Ref } from "effect"
import {
  EvidenceStore,
  EvidenceStoreFailure,
  type EvidenceStoreService
} from "../../src/workflow/protocols/target-verification/evidence-store.js"

const evidenceDigestLength = 64
const evidenceCommitPaddingLength = 24

/** Stable sealed-evidence identity for tests whose subject is not evidence contents. */
export const evidenceReferenceFixture = EvidenceReference.make({
  byteLength: 1,
  digest: EvidenceDigest.make("e".repeat(evidenceDigestLength))
})

/** Accepted-result fixture that keeps the required sealed-evidence boundary explicit. */
export const acceptedResultFixture = (commit: GitCommitSha): AcceptedResult =>
  AcceptedResult.make({
    commit,
    evidenceManifest: EvidenceReference.make({
      byteLength: evidenceReferenceFixture.byteLength,
      digest: EvidenceDigest.make(`${commit}${"0".repeat(evidenceCommitPaddingLength)}`)
    })
  })

/** Registry used by journal-only protocol tests to publish exact acceptance envelopes. */
export interface AcceptedResultEvidenceRegistryService {
  readonly register: (plannedAttempt: PlannedTaskAttempt, acceptedResult: AcceptedResult) => Effect.Effect<void>
}

export class AcceptedResultEvidenceRegistry extends Context.Service<
  AcceptedResultEvidenceRegistry,
  AcceptedResultEvidenceRegistryService
>()("@dalph/test/AcceptedResultEvidenceRegistry") {}

const encodedAcceptedResultEvidence = (
  plannedAttempt: PlannedTaskAttempt,
  acceptedResult: AcceptedResult
): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify(
      AcceptedResultEvidenceManifest.make({
        commit: acceptedResult.commit,
        correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId },
        formatVersion: 1,
        outcome: "Accepted"
      })
    )
  )

/** In-memory evidence boundary for tests that journal an accepted terminal directly. */
export const acceptedResultEvidenceLayer = Layer.effectContext(
  Effect.gen(function* () {
    const entries = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map())
    const register = (plannedAttempt: PlannedTaskAttempt, acceptedResult: AcceptedResult) =>
      Ref.update(entries, (current) =>
        new Map(current).set(
          acceptedResult.evidenceManifest.digest,
          encodedAcceptedResultEvidence(plannedAttempt, acceptedResult)
        )
      )
    const read = (reference: EvidenceReference) =>
      Effect.gen(function* () {
        const bytes = (yield* Ref.get(entries)).get(reference.digest)
        return bytes === undefined
          ? yield* new EvidenceStoreFailure({
              detail: `acceptance evidence ${reference.digest} is unavailable`,
              operation: "EvidenceStore.read"
            })
          : bytes.slice()
      })
    const service: EvidenceStoreService = {
      put: () => Effect.die("test registry does not publish arbitrary bytes"),
      read
    }
    return Context.empty().pipe(
      Context.add(AcceptedResultEvidenceRegistry, { register }),
      Context.add(EvidenceStore, service)
    )
  })
)

/** Registers accepted evidence when the optional protocol-test registry is installed. */
export const registerAcceptedResultEvidence = (plannedAttempt: PlannedTaskAttempt, acceptedResult: AcceptedResult) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>()
    const registry = Context.getOption(context, AcceptedResultEvidenceRegistry)
    if (registry._tag === "Some") yield* registry.value.register(plannedAttempt, acceptedResult)
  })
