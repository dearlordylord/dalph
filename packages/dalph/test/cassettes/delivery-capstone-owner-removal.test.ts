import { expect, it } from "vitest"
import { DeliveryProposalId } from "@dalph/orchestrator"
import { AuthoredRunActivationOrdinal } from "../../src/cassettes/authored-domain.js"
import { assertExactOwnerRemoved } from "./delivery-capstone-owner-removal.test-support.js"

const originalOrdinal = 1
const replacementOrdinal = 2
const activationOrdinal = AuthoredRunActivationOrdinal.make(originalOrdinal)
const ownerId = DeliveryProposalId.make("settlement-owner")
const foreignId = DeliveryProposalId.make("foreign-owner")
const admitted = { activationOrdinal, liveOwners: [{ _tag: "AdmittedDeliveryAction", proposal: { id: ownerId } }] }
const settled = { activationOrdinal, liveOwners: [{ _tag: "SettledBeforeMaterialization", proposal: { id: ownerId } }] }
const removed = { activationOrdinal, liveOwners: [] }

it("selects exact removal after the same owner's settled snapshot", () => {
  expect(assertExactOwnerRemoved([admitted, settled, removed], ownerId, activationOrdinal)).toBe(removed)
})

it("does not mistake same-ID settled lifecycle for owner removal", () => {
  expect(() => assertExactOwnerRemoved([settled], ownerId, activationOrdinal)).toThrow("never removed")
})

it("fails closed when no removal capture exists", () => {
  expect(() => assertExactOwnerRemoved([], ownerId, activationOrdinal)).toThrow("never removed")
})

it("does not skip a foreign remaining owner to find a later empty capture", () => {
  const foreign = { activationOrdinal, liveOwners: [{ proposal: { id: foreignId } }] }
  expect(() => assertExactOwnerRemoved([foreign, removed], ownerId, activationOrdinal)).toThrow()
})

it("does not accept removal from a replacement activation", () => {
  const replacement = { ...removed, activationOrdinal: AuthoredRunActivationOrdinal.make(replacementOrdinal) }
  expect(() => assertExactOwnerRemoved([replacement], ownerId, activationOrdinal)).toThrow()
})
