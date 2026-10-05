import assert from "node:assert/strict"
import test from "node:test"
import { createAffectedQuintSelection, selectAffectedQuintFamilies } from "./quint-affected-selection.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { quintHostedModelFamilies } from "./quint-hosted-shards.mjs"

const profile = createQuintEffectiveProfile()
void test("each selected family retains all canonical negative controls and deep commands", () => {
  for (const family of quintHostedModelFamilies) {
    const selection = createAffectedQuintSelection(profile, [family.name])
    assert.deepEqual(
      selection.positions,
      Array.from({ length: family.last - family.first + 1 }, (_, i) => i + family.first)
    )
    assert.deepEqual(
      selection.steps.filter((step) => step.kind === "commands").flatMap((step) => step.positions),
      selection.positions
    )
    assert.equal(selection.steps.filter((step) => step.kind === "evaluator-provenance").length, 1)
    assert.ok(selection.positions.some((position) => profile.commands[position].kind === "verify"))
  }
})
void test("Quint source changes retain importing proof families", async () => {
  const selected = await selectAffectedQuintFamilies({
    profile,
    changedPaths: ["specs/plannedAttemptExecutor.qnt"],
    worktree: process.cwd()
  })
  assert.ok(selected.includes("planned-attempt executor"))
  assert.ok(selected.length < quintHostedModelFamilies.length)
})
void test("unknown inputs conservatively retain the full portfolio and invalid families fail", async () => {
  for (const changedPaths of [
    undefined,
    [],
    ["scripts/quint-effective-profile.mjs"],
    ["packages/orchestrator/src/run.ts"],
    ["specs/unregistered.qnt"]
  ])
    assert.equal(await selectAffectedQuintFamilies({ profile, changedPaths, worktree: process.cwd() }), undefined)
  for (const names of [[], ["unknown"], ["Run activation", "Run activation"]])
    assert.throws(() => createAffectedQuintSelection(profile, names))
})

void test("private response-cycle changes retain every correction check and native-free proof", async () => {
  for (const path of ["specs/providerResultCorrection.qnt", "specs/providerResultCorrection_negative_test.qnt"]) {
    const selected = await selectAffectedQuintFamilies({ profile, changedPaths: [path], worktree: process.cwd() })
    assert.deepEqual(selected, ["provider result correction"])
    assert.deepEqual(createAffectedQuintSelection(profile, selected).positions, [127, 128, 129, 130, 131])
  }
})

void test("result recovery direction changes retain admission controls and the complete proof family", async () => {
  for (const path of ["specs/resultRecoveryDirection.qnt", "specs/resultRecoveryDirection_negative_test.qnt"]) {
    const selected = await selectAffectedQuintFamilies({ profile, changedPaths: [path], worktree: process.cwd() })
    assert.deepEqual(selected, ["result recovery direction"])
    assert.deepEqual(createAffectedQuintSelection(profile, selected).positions, [132, 133, 134, 135, 136])
  }
})
