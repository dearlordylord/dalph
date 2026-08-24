import { Effect } from "effect"
import { expect } from "vitest"
import { CleanupMutationOrdinal } from "../../src/workflow/protocols/disposition-cleanup/disposition.js"

interface TaggedCleanupResult {
  readonly _tag: string
}

interface CleanupBoundary<Authorization> {
  readonly observe: (authorization: Authorization) => Effect.Effect<TaggedCleanupResult, unknown>
  readonly remove: (
    authorization: Authorization,
    ordinal: CleanupMutationOrdinal
  ) => Effect.Effect<TaggedCleanupResult, unknown>
}

interface DispositionCleanupContractInput<Authorization> {
  readonly authorization: Authorization
  readonly boundary: CleanupBoundary<Authorization>
}

/**
 * Shared provider-neutral cleanup contract. Each implementation must observe
 * the exact authorized resource, remove it, and observe its absence again.
 */
export const dispositionCleanupContract = <Authorization>({
  authorization,
  boundary
}: DispositionCleanupContractInput<Authorization>): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    expect((yield* boundary.observe(authorization))._tag).toBe("Present")
    expect((yield* boundary.remove(authorization, CleanupMutationOrdinal.make(1)))._tag).toBe("Removed")
    expect((yield* boundary.observe(authorization))._tag).toBe("Absent")
  })
