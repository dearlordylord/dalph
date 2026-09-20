import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicRecord, digest } from "./gate-custody-records.mjs"
import { readQualityEvidence } from "./gate-quality-evidence.mjs"
import { formalEvidenceContract } from "./formal-evidence-contract.mjs"

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
    formalClassification: {
      version: 1,
      status: "affected",
      baseSha: "base",
      headSha: "head",
      changedPaths: ["specs/model.qnt"],
      affectedPaths: ["specs/model.qnt"]
    },
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
    outputPresentationPolicy: "retained-logs-bounded-console-v1",
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
  const formalSuccess = {
    attemptId: "original-formal",
    runId: "formal-origin",
    identity: { worktree: runDirectory, inputDigest: "formal-input" },
    profileIdentity: "formal-profile"
  }
  const formal = {
    version: 1,
    disposition: "reused",
    classification: logicalInvocation.formalClassification,
    recordPath: "controlled-formal-reference",
    attemptId: formalSuccess.attemptId,
    runId: formalSuccess.runId,
    identity: formalSuccess.identity,
    profileIdentity: formalSuccess.profileIdentity,
    outputLineCount: 0,
    observation: {
      version: formalEvidenceContract.inputPolicyVersion,
      observerVersion: 1,
      ready: true,
      drained: true,
      unchanged: true,
      inputDigest: "formal-input"
    }
  }
  const composite = {
    version: 1,
    runId,
    manifest: [stage],
    logicalInvocation,
    entries: [{ kind: "executed" }],
    successfulOutputLines: 7,
    formalOutputLineCount: 0,
    formal
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
    readFormalSuccess: () => formalSuccess,
    run: { worktree: runDirectory, commandArguments: ["node", "quality"] },
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
void test("complete negative-test stage evidence qualifies without replacing its genuine failed child", () => {
  const f = fixture()
  try {
    assert.equal(readQualityEvidence(f).complete, true)
  } finally {
    f.cleanup()
  }
})
void test("not-applicable formal evidence completes the composite only for the exact unaffected classification", () => {
  const f = fixture()
  try {
    const classification = {
      version: 1,
      status: "unaffected",
      baseSha: "base",
      headSha: "head",
      changedPaths: ["packages/dalph/src/index.ts"],
      affectedPaths: []
    }
    f.composite.logicalInvocation.formalClassification = classification
    f.composite.formal = { version: 1, disposition: "not-applicable", classification, outputLineCount: 0 }
    const contract = {
      ...f.composite,
      manifest: f.composite.manifest,
      outputPresentationPolicy: "retained-logs-bounded-console-v1",
      identityReceiptDigest: digest(
        JSON.stringify({
          version: 2,
          observerVersion: 1,
          inputDigest: "strong-input",
          sourceInputDigest: "source",
          logicalInvocation: f.composite.logicalInvocation
        })
      )
    }
    atomicRecord(join(f.runDirectory, "resume-contract.json"), contract)
    atomicRecord(join(f.runDirectory, "resume-inputs.json"), {
      version: 1,
      identity: {
        version: 2,
        observerVersion: 1,
        inputDigest: "strong-input",
        sourceInputDigest: "source",
        logicalInvocation: f.composite.logicalInvocation
      }
    })
    atomicRecord(join(f.runDirectory, "composite.json"), f.composite)
    assert.equal(readQualityEvidence(f).complete, true)
    f.composite.formal.classification = { ...classification, status: "affected" }
    atomicRecord(join(f.runDirectory, "composite.json"), f.composite)
    assert.throws(() => readQualityEvidence(f), /formal disposition accounting/u)
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
  [
    "missing formal link",
    (f) => atomicRecord(join(f.runDirectory, "composite.json"), { ...f.composite, formal: undefined }),
    false
  ],
  [
    "undrained formal observer",
    (f) =>
      atomicRecord(join(f.runDirectory, "composite.json"), {
        ...f.composite,
        formal: { ...f.composite.formal, observation: { ...f.composite.formal.observation, drained: false } }
      }),
    true
  ],
  [
    "wrong original formal run",
    (f) =>
      atomicRecord(join(f.runDirectory, "composite.json"), {
        ...f.composite,
        formal: { ...f.composite.formal, runId: "other" }
      }),
    true
  ],
  [
    "wrong effective formal profile",
    (f) =>
      atomicRecord(join(f.runDirectory, "composite.json"), {
        ...f.composite,
        formal: { ...f.composite.formal, profileIdentity: "other" }
      }),
    true
  ],
  [
    "wrong current formal output count",
    (f) => atomicRecord(join(f.runDirectory, "composite.json"), { ...f.composite, formalOutputLineCount: 1 }),
    true
  ],
  ["missing suffix receipt", (f) => rmSync(join(f.runDirectory, "quality-stages", "0.json")), true],
  [
    "fabricated skipped execution",
    (f) => atomicRecord(join(f.runDirectory, "composite.json"), { ...f.composite, entries: [{ kind: "pending" }] }),
    true
  ]
])
  void test(`composite refuses ${String(name)}`, () => {
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
  void test(`missing optional contract cannot erase ${kind}`, () => {
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
void test("genuine normal records without resumable intent retain the legacy evidence contract", () => {
  const f = fixture()
  try {
    rmSync(join(f.runDirectory, "resume-contract.json"))
    assert.equal(readQualityEvidence(f), undefined)
  } finally {
    f.cleanup()
  }
})
