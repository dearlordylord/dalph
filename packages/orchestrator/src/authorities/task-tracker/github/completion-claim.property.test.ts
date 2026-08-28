import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import {
  AcceptedResult,
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
// oxlint-disable-next-line import/no-nodejs-modules -- The acceptance oracle must not reuse Effect's Crypto implementation.
import { createHash } from "node:crypto"
import { Crypto, Effect, Schema } from "effect"
import * as fc from "fast-check"
import { ActiveTaskClaim } from "../claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../claim.js"
import { OperationId } from "../../../workflow/identity.js"
import { CompletionTaskClaim } from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import { EvidenceDigest, EvidenceReference } from "../../../workflow/protocols/evidence-store.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorSessionId
} from "../../../workflow/protocols/integrator/events.js"
import { targetPromotionCorrelationFor } from "../../../workflow/protocols/target-promotion/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { githubCompletionClaimFingerprintFor } from "./completion-claim.js"

const CanonicalCompletionTaskClaim = Schema.fromJsonString(Schema.toCodecJson(CompletionTaskClaim))
const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")
const hexadecimalCharacters = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]
const hexStringArbitrary = (length: number) =>
  fc
    .array(fc.constantFrom(...hexadecimalCharacters), { minLength: length, maxLength: length })
    .map((characters) => characters.join(""))

interface CompletionClaimSeed {
  readonly acceptedResultCommit: string
  readonly baseSha: string
  readonly byteLength: number
  readonly candidateCommit: string
  readonly evidenceDigest: string
  readonly expectedTargetHead: string
  readonly ordinal: number
  readonly qualifiedOffset: number
  readonly queuedAt: number
  readonly startedAt: number
  readonly suffix: string
  readonly targetLineageObservedAt: number
}

const completionClaimSeedArbitrary: fc.Arbitrary<CompletionClaimSeed> = fc.record({
  acceptedResultCommit: hexStringArbitrary(40),
  baseSha: hexStringArbitrary(40),
  byteLength: fc.integer({ min: 0, max: 1_000_000 }),
  candidateCommit: hexStringArbitrary(40),
  evidenceDigest: hexStringArbitrary(64),
  expectedTargetHead: hexStringArbitrary(40),
  ordinal: fc.integer({ min: 1, max: 1_000 }),
  qualifiedOffset: fc.integer({ min: 1, max: 1_000 }),
  queuedAt: fc.integer({ min: 1, max: 1_000_000 }),
  startedAt: fc.integer({ min: 1, max: 1_000_000 }),
  suffix: fc.stringMatching(/^[A-Za-z0-9_-]{1,30}$/),
  targetLineageObservedAt: fc.integer({ min: 1, max: 1_000_000 })
})

/** Builds a valid claim while varying every non-derived canonical evidence field. */
const completionClaimFor = (seed: CompletionClaimSeed): CompletionTaskClaim => {
  const taskId = TaskId.make(`task-${seed.suffix}`)
  const expectedTargetHead = GitCommitSha.make(seed.expectedTargetHead)
  const acceptedResultCommit = GitCommitSha.make(seed.acceptedResultCommit)
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt-${seed.suffix}`),
    baseSha: GitCommitSha.make(seed.baseSha),
    branch: TaskBranchRef.make(`refs/heads/generated/${seed.suffix}`),
    executor: TaskExecutorLocator.make(`executor:${seed.suffix}`),
    runId: RunId.make(`run-${seed.suffix}`),
    taskId,
    taskRevision: TaskRevision.make(`revision-${seed.suffix}`),
    worktree: WorktreeLocator.make(`/worktrees/${seed.suffix}`)
  })
  const acceptedResult = AcceptedResult.make({
    commit: acceptedResultCommit,
    evidenceManifest: EvidenceReference.make({
      byteLength: seed.byteLength,
      digest: EvidenceDigest.make(seed.evidenceDigest)
    })
  })
  const targetLineageObservedAt = JournalPosition.make(seed.targetLineageObservedAt)
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: GitCommitSha.make(seed.candidateCommit),
    candidateText: IntegratorCandidateText.make(`candidate-${seed.suffix}`),
    directParents: [expectedTargetHead, acceptedResultCommit],
    qualifiedAt: JournalPosition.make(seed.targetLineageObservedAt + seed.qualifiedOffset),
    run: {
      ordinal: IntegratorRunOrdinal.make(seed.ordinal),
      session: {
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make(`/candidates/${seed.suffix}`),
        expectedTargetHead,
        integrationTarget: IntegrationTarget.make({
          ref: IntegrationTargetRef.make(`refs/heads/target/${seed.suffix}`),
          repository: GitRepositoryLocator.make(`/repositories/${seed.suffix}.git`)
        }),
        plannedAttempt,
        queuedAt: JournalPosition.make(seed.queuedAt),
        sessionId: IntegratorSessionId.make(`session-${seed.suffix}`),
        startedAt: JournalPosition.make(seed.startedAt),
        targetLineageObservedAt
      }
    }
  })
  return CompletionTaskClaim.make({
    originalClaim: ActiveTaskClaim.make({
      operationId: OperationId.make(`claim-operation-${seed.suffix}`),
      owner: ClaimOwner.make(`owner:${seed.suffix}`),
      taskId,
      token: ClaimToken.make(`token-${seed.suffix}`)
    }),
    plannedAttempt,
    promotionCorrelation: targetPromotionCorrelationFor(qualifiedCandidate)
  })
}

const oracleFingerprintFor = async (claim: CompletionTaskClaim): Promise<string> => {
  const canonical = await Effect.runPromise(Schema.encodeUnknownEffect(CanonicalCompletionTaskClaim)(claim))
  return sha256Hex(canonical)
}

const productionFingerprintFor = (claim: CompletionTaskClaim) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* githubCompletionClaimFingerprintFor(yield* Crypto.Crypto, claim)
    }).pipe(Effect.provide(NodeCrypto.layer))
  )

it("matches an independent SHA-256 oracle across fully generated canonical evidence", async () => {
  await fc.assert(
    fc.asyncProperty(completionClaimSeedArbitrary, async (seed) => {
      const generated = completionClaimFor(seed)
      const canonicalJson = await Effect.runPromise(
        Schema.encodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(generated)
      )
      const decoded = await Effect.runPromise(
        Schema.decodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(canonicalJson)
      )
      const [fingerprint, decodedFingerprint, oracleFingerprint] = await Promise.all([
        productionFingerprintFor(generated),
        productionFingerprintFor(decoded),
        oracleFingerprintFor(generated)
      ])
      expect(decoded).toEqual(generated)
      expect(decodedFingerprint).toBe(fingerprint)
      expect(fingerprint).toBe(oracleFingerprint)
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    })
  )
})

it("changes the fingerprint when any canonical claim evidence family changes", async () => {
  const original = integrationFinalityFixture.claim
  const originalClaimMutation = CompletionTaskClaim.make({
    ...original,
    originalClaim: ActiveTaskClaim.make({
      ...original.originalClaim,
      token: ClaimToken.make("different-completion-token")
    })
  })
  const changedPlan = PlannedTaskAttempt.make({
    ...original.plannedAttempt,
    worktree: WorktreeLocator.make("/worktrees/different-completion-attempt")
  })
  const plannedAttemptMutation = CompletionTaskClaim.make({
    ...original,
    plannedAttempt: changedPlan,
    promotionCorrelation: targetPromotionCorrelationFor(
      IntegratorRunQualifiedCandidate.make({
        ...original.promotionCorrelation.qualifiedCandidate,
        run: {
          ...original.promotionCorrelation.qualifiedCandidate.run,
          session: { ...original.promotionCorrelation.qualifiedCandidate.run.session, plannedAttempt: changedPlan }
        }
      })
    )
  })
  const promotionCorrelationMutation = CompletionTaskClaim.make({
    ...original,
    promotionCorrelation: targetPromotionCorrelationFor(
      IntegratorRunQualifiedCandidate.make({
        ...original.promotionCorrelation.qualifiedCandidate,
        candidateText: IntegratorCandidateText.make("different-completion-candidate")
      })
    )
  })
  const [originalFingerprint, originalClaimFingerprint, plannedAttemptFingerprint, promotionFingerprint] =
    await Promise.all(
      [original, originalClaimMutation, plannedAttemptMutation, promotionCorrelationMutation].map(
        productionFingerprintFor
      )
    )

  expect(originalClaimFingerprint).not.toBe(originalFingerprint)
  expect(plannedAttemptFingerprint).not.toBe(originalFingerprint)
  expect(promotionFingerprint).not.toBe(originalFingerprint)
})
