import { formalGatePolicy } from "./formal-gate-policy.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { arch, platform, tmpdir } from "node:os"
import { join } from "node:path"
import { createFormalEnvironment, formalInputPolicyVersion, startFormalInputGuard } from "./formal-input-policy.mjs"
import { createFormalControlDeadline, createRetainedFormalLifecycle } from "./run-formal-workflow.mjs"

const fixture = async () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-formal-lifecycle-"))
  const root = join(outer, "repo")
  const tools = join(outer, "tools")
  for (const directory of ["specs", "scripts", ".github/workflows", "source"])
    mkdirSync(join(root, directory), { recursive: true })
  mkdirSync(tools)
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    "scripts/with-gate-slot.mjs",
    "scripts/run-admitted-gate.mjs",
    "scripts/run-formal-gate.mjs",
    "scripts/run-formal-workflow.mjs",
    "scripts/run-formal-profile.mjs",
    "scripts/check-quint-models.mjs",
    "source/app.ts"
  ])
    writeFileSync(join(root, file), "original\n")
  writeFileSync(join(root, "specs/model.qnt"), "module fixture {}\n")
  const runtime = join(tools, "runtime.so")
  writeFileSync(runtime, "original\n")
  const guard = await startFormalInputGuard({
    worktree: root,
    profile: {
      obligations: ["controlled fixture"],
      seed: 153000,
      commands: [{ args: ["typecheck", "specs/model.qnt"] }]
    },
    effectiveEnvironment: createFormalEnvironment({ PATH: process.env.PATH, HOME: outer }),
    toolchain: {
      version: formalInputPolicyVersion,
      platform: platform(),
      architecture: arch(),
      roots: [tools],
      allowedRoots: [tools],
      requiredRoots: [tools],
      pythonExecutable: "/usr/bin/python3",
      javaUserHome: join(outer, "java-home"),
      versions: { fixture: "1" }
    }
  })
  const result = { status: "reused", success: { identity: guard.identity }, evidencePath: "original-evidence" }
  let latest = { status: "hit", success: result.success, evidencePath: result.evidencePath }
  const lifecycle = createRetainedFormalLifecycle({
    finalValidationMilliseconds: 5_000,
    guard,
    lookup: {},
    result,
    readSuccess: () => latest
  })
  return {
    root,
    runtime,
    lifecycle,
    invalidateLatest: () => {
      latest = { status: "miss", reason: "later force attempt failed" }
    },
    cleanup: async () => {
      await lifecycle.close()
      rmSync(outer, { recursive: true, force: true })
    }
  }
}

test("retained formal observation permits unrelated application work and final full fingerprint without checker launch", async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.root, "source/app.ts"), "application changed\n")
    const final = await f.lifecycle.finalizeApplicability()
    assert.equal(final.evidencePath, "original-evidence")
    assert.equal(final.observation.unchanged, true)
    assert.equal(final.observation.drained, true)
    await f.lifecycle.assertUnchanged()
    await f.lifecycle.close()
    await f.lifecycle.close()
    await assert.rejects(f.lifecycle.finalizeApplicability(), /closed/u)
  } finally {
    await f.cleanup()
  }
})

test("continuous external tool edit and revert after formal stage rejects final handoff", async () => {
  const f = await fixture()
  try {
    writeFileSync(f.runtime, "changed\n")
    writeFileSync(f.runtime, "original\n")
    await assert.rejects(f.lifecycle.finalizeApplicability(), /input filesystem event/u)
  } finally {
    await f.cleanup()
  }
})

test("fully resumed application prefix still rejects missing current formal applicability without launching checkers", async () => {
  const f = await fixture()
  try {
    f.invalidateLatest()
    await assert.rejects(f.lifecycle.finalizeApplicability(), /applicability changed/u)
  } finally {
    await f.cleanup()
  }
})

test("control phases consume the remaining allowance and reject expiration without restarting a deadline", () => {
  let elapsed = 0
  const remaining = createFormalControlDeadline({ allowanceMilliseconds: 100, now: () => elapsed })
  assert.equal(remaining("setup", 60), 60)
  elapsed = 70
  assert.equal(remaining("qualification", 60), 30)
  elapsed = 100
  assert.throws(() => remaining("publication"), /allowance exceeded/u)
  assert.throws(() => createFormalControlDeadline({ allowanceMilliseconds: Infinity }), /finite positive/u)
})

test("external tool edit and revert during the final candidate drain rejects the last formal drain", async () => {
  const f = await fixture()
  try {
    await f.lifecycle.finalizeApplicability()
    writeFileSync(f.runtime, "changed after final snapshot\n")
    writeFileSync(f.runtime, "original\n")
    await assert.rejects(f.lifecycle.assertUnchanged(), /input filesystem event/u)
  } finally {
    await f.cleanup()
  }
})

test("local acquisition retains phase caps inside one finite extended execution allowance", () => {
  assert.equal(formalGatePolicy.outerMilliseconds, 2100000)
  assert.equal(formalGatePolicy.executionEnvelopeMilliseconds, 1857000)
  assert.equal(formalGatePolicy.preparationMilliseconds, 60000)
  assert.equal(formalGatePolicy.inputSetupMilliseconds, 60000)
  assert.equal(formalGatePolicy.inputQualificationMilliseconds, 60000)
  assert.equal(formalGatePolicy.finalValidationMilliseconds, 30000)
  let now = 0
  const remaining = createFormalControlDeadline({
    allowanceMilliseconds: formalGatePolicy.outerMilliseconds,
    now: () => now
  })
  assert.equal(remaining("preparation", formalGatePolicy.preparationMilliseconds), 60000)
  now += 60000
  assert.equal(remaining("input setup", formalGatePolicy.inputSetupMilliseconds), 60000)
  now += 60000
  assert.equal(Math.min(formalGatePolicy.executionEnvelopeMilliseconds, remaining("profile execution") - 7000), 1857000)
  now += 1857000
  assert.equal(remaining("execution qualification", formalGatePolicy.inputQualificationMilliseconds), 60000)
  now = 2100000
  assert.throws(() => remaining("publication"), /allowance exceeded/)
})
