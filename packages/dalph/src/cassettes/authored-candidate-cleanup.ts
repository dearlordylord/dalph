import { Context, Effect, Layer, Schema } from "effect"
import type { RunId } from "@dalph/contracts"
import {
  CoordinatorOwnership,
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupMutationResult,
  preservingDispositionCleanupBoundaryLayer
} from "@dalph/orchestrator"
import type { StoryCursor } from "./authored-cursor.js"

/**
 * Installs the authored provider authority only for cassettes that explicitly
 * script predecessor-candidate cleanup. Worktree and branch cleanup retain
 * their preserving defaults.
 */
export const authoredCandidateCleanupBoundaryLayer = (cursor: StoryCursor, runId?: RunId) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const ownership = yield* CoordinatorOwnership
      const preserving = yield* Layer.build(preservingDispositionCleanupBoundaryLayer)
      const resolveIdentity = (identity: string) =>
        runId === undefined ? identity : identity.replaceAll("$authored-run", runId)
      const resolveObservation = (value: unknown): unknown =>
        runId === undefined ? value : JSON.parse(resolveIdentity(JSON.stringify(value)))
      const candidate = IntegratorCandidateCleanupBoundary.of({
        readEvidenceRevision: (subject) =>
          cursor.consumeIntegratorCandidateCleanupEvidenceRevision.pipe(
            Effect.flatMap((authored) =>
              resolveIdentity(authored.subject.locator) === subject.locator &&
              resolveIdentity(authored.subject.predecessor.sessionId) === subject.predecessor.sessionId
                ? Effect.succeed(authored.revision)
                : Effect.fail("authored candidate evidence revision subject does not match the production predecessor")
            )
          ),
        observe: () =>
          cursor.consumeIntegratorCandidateCleanupObservation.pipe(
            Effect.flatMap(({ observation }) =>
              Schema.decodeUnknownEffect(IntegratorCandidateCleanupObservation)(resolveObservation(observation))
            ),
            Effect.orDie
          ),
        remove: () =>
          ownership.runMutation(
            cursor.consumeIntegratorCandidateCleanupRemoval.pipe(
              Effect.flatMap(({ result }) =>
                Schema.decodeUnknownEffect(IntegratorCandidateCleanupMutationResult)(resolveObservation(result))
              ),
              Effect.orDie
            )
          )
      })
      return Context.add(preserving, IntegratorCandidateCleanupBoundary, candidate)
    })
  )
