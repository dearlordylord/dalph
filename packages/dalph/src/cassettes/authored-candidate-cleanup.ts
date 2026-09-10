import { Context, Effect, Layer } from "effect"
import {
  CoordinatorOwnership,
  IntegratorCandidateCleanupBoundary,
  preservingDispositionCleanupBoundaryLayer
} from "@dalph/orchestrator"
import type { StoryCursor } from "./authored-cursor.js"

/**
 * Installs the authored provider authority only for cassettes that explicitly
 * script predecessor-candidate cleanup. Worktree and branch cleanup retain
 * their preserving defaults.
 */
export const authoredCandidateCleanupBoundaryLayer = (cursor: StoryCursor) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const ownership = yield* CoordinatorOwnership
      const preserving = yield* Layer.build(preservingDispositionCleanupBoundaryLayer)
      const candidate = IntegratorCandidateCleanupBoundary.of({
        readEvidenceRevision: (subject) =>
          cursor.consumeIntegratorCandidateCleanupEvidenceRevision.pipe(
            Effect.flatMap((authored) =>
              authored.subject.locator === subject.locator &&
              authored.subject.predecessor.sessionId === subject.predecessor.sessionId
                ? Effect.succeed(authored.revision)
                : Effect.fail("authored candidate evidence revision subject does not match the production predecessor")
            )
          ),
        observe: () =>
          cursor.consumeIntegratorCandidateCleanupObservation.pipe(
            Effect.map(({ observation }) => observation),
            Effect.orDie
          ),
        remove: () =>
          ownership.runMutation(
            cursor.consumeIntegratorCandidateCleanupRemoval.pipe(
              Effect.map(({ result }) => result),
              Effect.orDie
            )
          )
      })
      return Context.add(preserving, IntegratorCandidateCleanupBoundary, candidate)
    })
  )
