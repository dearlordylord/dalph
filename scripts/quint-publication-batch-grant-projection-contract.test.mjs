import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import {
  assertDirectPublicationBatchGrantProjectionContract,
  assertDirectPublicationBatchGrantProjectionCommands,
  directPublicationBatchGrantProjectionContract as contract
} from "./quint-publication-batch-grant-projection-contract.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))

void test("maps every canonical action and the full invariant set across both projections", async () => {
  const result = await assertDirectPublicationBatchGrantProjectionContract(root)
  assert.equal(result.invariantCount, 19)
  assert.ok(result.canonicalActions.length >= 30)
})

void test("keeps the complete GrantBatchReady selector family in both projections", () => {
  assert.deepEqual(
    contract.profiles.grantControl.transitions.filter((action) => contract.grantBatchReadySelectors.includes(action)),
    contract.grantBatchReadySelectors
  )
  assert.deepEqual(
    contract.profiles.batchFinality.transitions.filter((action) => contract.grantBatchReadySelectors.includes(action)),
    contract.grantBatchReadySelectors
  )
})

void test("assigns each invariant one reachable negative-control owner", () => {
  const owned = [...contract.profiles.grantControl.invariantOwners, ...contract.profiles.batchFinality.invariantOwners]
  assert.equal(new Set(owned).size, contract.invariants.length)
  assert.deepEqual([...owned].sort(), [...contract.invariants].sort())
  for (const invariant of contract.invariants) {
    const control = contract.invariantNegativeControls[invariant]
    const owner = contract.profiles.grantControl.invariantOwners.includes(invariant)
      ? contract.profiles.grantControl
      : contract.profiles.batchFinality
    assert.equal(control.profile, owner === contract.profiles.grantControl ? "grantControl" : "batchFinality")
    assert.ok(control.test.endsWith("Test"))
    assert.ok(control.mutant.length > 0)
    assert.ok(owner.invariantOwners.includes(invariant))
  }
})

void test("binds generated sample and verify CLI invariant/witness lists to the profiles", () => {
  const profile = createQuintEffectiveProfile()
  assert.doesNotThrow(() => assertDirectPublicationBatchGrantProjectionCommands(profile.commands))

  const mutated = structuredClone(profile.commands)
  const verify = mutated.find(({ name }) => name === contract.profiles.grantControl.verifyCommand)
  assert.ok(verify)
  verify.args.splice(verify.args.indexOf("--invariants") + 1, 1)
  assert.throws(() => assertDirectPublicationBatchGrantProjectionCommands(mutated), /invariant list differs/u)
})

void test("requires complete TLC exploration for batch/finality without a depth limit", () => {
  const profile = createQuintEffectiveProfile()
  const name = "publication exhaustion batch grant batch/finality projection exhaustive model"
  const verify = profile.commands.find((command) => command.name === name)
  assert.ok(verify)
  assert.equal(verify.kind, "verify")
  assert.equal(verify.args[verify.args.indexOf("--backend") + 1], "tlc")
  assert.ok(!verify.args.includes("--max-steps"))
  assert.throws(
    () =>
      assertDirectPublicationBatchGrantProjectionCommands(profile.commands.filter((command) => command.name !== name)),
    /differs from its model source/u
  )
  for (const mutation of ["bounded", "apalache"]) {
    const commands = structuredClone(profile.commands)
    const command = commands.find((candidate) => candidate.name === name)
    if (mutation === "bounded") command.args.push("--max-steps", "32")
    else command.args[command.args.indexOf("--backend") + 1] = "apalache"
    assert.throws(() => assertDirectPublicationBatchGrantProjectionCommands(commands), /complete TLC exploration/u)
  }
})

void test("rejects an omitted exhaustion transition instead of accepting a vacuous projection", async () => {
  const original = contract.profiles.grantControl.transitions
  const withoutExhaustion = original.filter((action) => action !== "retainInitialPublicationExhaustion")
  const omitted = {
    ...contract,
    profiles: {
      ...contract.profiles,
      grantControl: { ...contract.profiles.grantControl, transitions: withoutExhaustion }
    }
  }
  assert.notEqual(withoutExhaustion, original)
  assert.ok(!omitted.profiles.grantControl.transitions.includes("retainInitialPublicationExhaustion"))
  await assert.rejects(assertDirectPublicationBatchGrantProjectionContractWith(omitted, root), /action map mismatch/u)
})

void test("rejects a split GrantBatchReady selector family", async () => {
  const omittedSelector = {
    ...contract,
    profiles: {
      ...contract.profiles,
      batchFinality: {
        ...contract.profiles.batchFinality,
        transitions: contract.profiles.batchFinality.transitions.filter(
          (action) => action !== "reconcileAlreadyPublishedCandidate"
        )
      }
    }
  }
  await assert.rejects(
    assertDirectPublicationBatchGrantProjectionContractWith(omittedSelector, root),
    /splits or omits a GrantBatchReady selector/u
  )
})

async function assertDirectPublicationBatchGrantProjectionContractWith(value, base) {
  return assertDirectPublicationBatchGrantProjectionContract(base, value)
}
