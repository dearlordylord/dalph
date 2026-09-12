import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicRecord, digest } from "./gate-custody-records.mjs"
import { readQualityEvidence } from "./gate-quality-evidence.mjs"

const fixture = () => {
  const runDirectory = mkdtempSync(join(tmpdir(), "dalph-quality-proof-"))
  const runId = "exact-run"
  const stage = {
    execution: { executable: "node", args: ["test"] },
    id: "negative-test",
    args: ["test"],
    artifactRoots: [],
    timeout: 100
  }
  const logicalInvocation = {
    mode: "check:all",
    baseSha: "base",
    commandArguments: ["node", "quality"],
    stageManifest: [stage]
  }
  const identity = {
    version: 2,
    observerVersion: 1,
    inputDigest: "strong-input",
    sourceInputDigest: "source",
    logicalInvocation
  }
  atomicRecord(join(runDirectory, "resume-contract.json"), {
    version: 1,
    runId,
    manifest: [stage],
    logicalInvocation,
    maximumSuccessfulOutputLines: 550,
    identityReceiptDigest: digest(JSON.stringify(identity))
  })
  atomicRecord(join(runDirectory, "resume-inputs.json"), { version: 1, identity })
  atomicRecord(join(runDirectory, "input-guard.json"), {
    version: 1,
    observerVersion: 1,
    inputDigest: identity.inputDigest,
    sourceInputDigest: identity.sourceInputDigest,
    ready: true,
    drained: true,
    unchanged: true
  })
  mkdirSync(join(runDirectory, "quality-stages"))
  const record = {
    version: 1,
    runId,
    ordinal: 0,
    stageId: stage.id,
    contract: stage,
    obligationId: "test-command",
    outcome: "passed",
    outputLineCount: 7,
    artifacts: {}
  }
  atomicRecord(join(runDirectory, "quality-stages", "0.json"), record)
  const composite = {
    version: 1,
    runId,
    manifest: [stage],
    logicalInvocation,
    entries: [{ kind: "executed" }],
    successfulOutputLines: 7
  }
  atomicRecord(join(runDirectory, "composite.json"), composite)
  const stages = [
    {
      obligationId: "test-command",
      parentId: "root",
      command: stage.execution,
      outcome: "passed",
      groupAbsent: true,
      outputLineCount: 7
    },
    { obligationId: "expected-failure", parentId: "test-command", outcome: "exit:23", groupAbsent: true }
  ]
  return {
    baseSha: "base",
    run: { commandArguments: ["node", "quality"] },
    runDirectory,
    runId,
    stages,
    readPrior: () => {
      throw Error("unexpected prior read")
    },
    record,
    composite,
    cleanup: () => rmSync(runDirectory, { recursive: true, force: true })
  }
}
test("complete negative-test stage evidence qualifies without replacing its genuine failed child", () => {
  const f = fixture()
  try {
    assert.equal(readQualityEvidence(f).complete, true)
  } finally {
    f.cleanup()
  }
})
for (const [name, mutate, rejects] of [
  ["missing composite", (f) => rmSync(join(f.runDirectory, "composite.json")), false],
  ["missing observer proof", (f) => rmSync(join(f.runDirectory, "input-guard.json")), false],
  [
    "missing child receipt",
    (f) => {
      f.stages[1].outcome = "UNPROVEN"
    },
    true
  ],
  [
    "surviving child",
    (f) => {
      f.stages[1].groupAbsent = false
    },
    true
  ],
  [
    "wrong stage identity",
    (f) => atomicRecord(join(f.runDirectory, "quality-stages", "0.json"), { ...f.record, stageId: "other" }),
    true
  ],
  [
    "wrong output accounting",
    (f) => atomicRecord(join(f.runDirectory, "composite.json"), { ...f.composite, successfulOutputLines: 0 }),
    true
  ],
  ["missing suffix receipt", (f) => rmSync(join(f.runDirectory, "quality-stages", "0.json")), true],
  [
    "fabricated skipped execution",
    (f) => atomicRecord(join(f.runDirectory, "composite.json"), { ...f.composite, entries: [{ kind: "pending" }] }),
    true
  ]
])
  test(`composite refuses ${String(name)}`, () => {
    const f = fixture()
    try {
      mutate(f)
      if (rejects) assert.throws(() => readQualityEvidence(f))
      else assert.equal(readQualityEvidence(f).complete, false)
    } finally {
      f.cleanup()
    }
  })

for (const kind of ["recorded fresh intent", "explicit resumed invocation"]) {
  test(`missing optional contract cannot erase ${kind}`, () => {
    const f = fixture()
    try {
      if (kind === "recorded fresh intent") f.run.requiresQualityComposite = true
      else f.run.commandArguments.push("--resume=prior-run")
      rmSync(join(f.runDirectory, "resume-contract.json"))
      assert.throws(() => readQualityEvidence(f), /Missing required resumable gate contract/u)
    } finally {
      f.cleanup()
    }
  })
}
test("genuine normal records without resumable intent retain the legacy evidence contract", () => {
  const f = fixture()
  try {
    rmSync(join(f.runDirectory, "resume-contract.json"))
    assert.equal(readQualityEvidence(f), undefined)
  } finally {
    f.cleanup()
  }
})
