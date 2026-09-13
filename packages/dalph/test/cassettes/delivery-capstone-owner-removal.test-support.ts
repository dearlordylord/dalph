import { expect } from "vitest"
import type { DeliveryProposalId } from "@dalph/orchestrator"
import type { AuthoredObservationCapture } from "../../src/cassettes/authored-runner.js"

/** Actual owner snapshots expose exact proposal membership; settled lifecycle is not removal. */
export interface DeliveryCapstoneOwnerCaptureProjection {
  readonly activationOrdinal: AuthoredObservationCapture["activationOrdinal"]
  readonly liveOwners: ReadonlyArray<{ readonly proposal: { readonly id: DeliveryProposalId } }>
}

/** Selects the exact owner's first disappearance, then checks every remaining owner, without searching for emptiness. */
export const assertExactOwnerRemoved = <Capture extends DeliveryCapstoneOwnerCaptureProjection>(
  captures: ReadonlyArray<Capture>,
  ownerId: DeliveryProposalId,
  activationOrdinal: AuthoredObservationCapture["activationOrdinal"]
): Capture => {
  const removed = captures.find((capture) => !capture.liveOwners.some(({ proposal }) => proposal.id === ownerId))
  if (removed === undefined)
    return expect.fail("DS22: exact settlement owner never removed before final tracker response")
  expect(removed.activationOrdinal).toBe(activationOrdinal)
  expect(removed.liveOwners).toEqual([])
  return removed
}
