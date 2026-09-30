import assert from "node:assert/strict"
import { test } from "node:test"
import { selectResumePrefix } from "./gate-resume-policy.mjs"

const inputs = () => {
  const stageManifest = [
    { id: "types", artifactRoots: ["dist"], timeout: 100, args: ["typecheck"] },
    { id: "tests", artifactRoots: [], timeout: 200, args: ["test"] },
    { id: "coverage", artifactRoots: [], timeout: 300, args: ["coverage"] }
  ]
  const identity = {
    version: 2,
    observerVersion: 1,
    inputDigest: "complete-input",
    sourceInputDigest: "source",
    worktree: "/exact/worktree"
  }
  const artifact = { exists: true, entries: [{ path: "dist/a", mode: 493, sha256: "bytes", bytes: 5 }] }
  return {
    currentIdentity: identity,
    stageManifest,
    currentArtifacts: { dist: artifact },
    priorEvidence: {
      worktree: identity.worktree,
      registration: "closed",
      custody: "stopped",
      resume: {
        version: 1,
        identity,
        manifest: stageManifest,
        outputPresentationPolicy: "retained-logs-bounded-console-v1",
        guard: {
          version: 1,
          observerVersion: 1,
          unchanged: true,
          ready: true,
          drained: true,
          inputDigest: identity.inputDigest,
          sourceInputDigest: identity.sourceInputDigest
        },
        stages: stageManifest.map((contract, ordinal) => ({
          stageId: contract.id,
          ordinal,
          contract,
          outcome: ordinal === 1 ? "failed" : "passed",
          outputLineCount: 12,
          subtreeProven: true,
          runId: "original",
          obligationId: `command-${ordinal}`,
          artifacts: ordinal === 0 ? { dist: artifact } : {}
        }))
      }
    }
  }
}
void test("late failure reuses only the contiguous proven prefix and retains original output counts", () => {
  const result = selectResumePrefix(inputs())
  assert.equal(result.status, "selected")
  assert.deepEqual(
    result.prefix.map((stage) => stage.stageId),
    ["types"]
  )
  assert.equal(result.successfulOutputLines, 12)
  assert.equal(result.prefix[0].runId, "original")
})
void test("an interrupted run reuses only stages with exact input checkpoints", () => {
  const args = inputs()
  delete args.priorEvidence.resume.guard
  const first = args.priorEvidence.resume.stages[0]
  first.inputGuard = {
    version: 1,
    observerVersion: 1,
    unchanged: true,
    ready: true,
    drained: true,
    inputDigest: args.priorEvidence.resume.identity.inputDigest,
    sourceInputDigest: args.priorEvidence.resume.identity.sourceInputDigest,
    stageId: first.stageId,
    ordinal: first.ordinal,
    obligationId: first.obligationId
  }
  const result = selectResumePrefix(args)
  assert.equal(result.status, "selected")
  assert.deepEqual(
    result.prefix.map((stage) => stage.stageId),
    ["types"]
  )
})
for (const [name, mutate] of [
  ["stage identity", (guard) => (guard.stageId = "other")],
  ["stage ordinal", (guard) => (guard.ordinal = 2)],
  ["stage obligation", (guard) => (guard.obligationId = "other")]
])
  void test(`an interrupted run refuses a checkpoint with mismatched ${String(name)}`, () => {
    const args = inputs()
    delete args.priorEvidence.resume.guard
    const first = args.priorEvidence.resume.stages[0]
    first.inputGuard = {
      version: 1,
      observerVersion: 1,
      unchanged: true,
      ready: true,
      drained: true,
      inputDigest: args.priorEvidence.resume.identity.inputDigest,
      sourceInputDigest: args.priorEvidence.resume.identity.sourceInputDigest,
      stageId: first.stageId,
      ordinal: first.ordinal,
      obligationId: first.obligationId
    }
    mutate(first.inputGuard)
    assert.deepEqual(selectResumePrefix(args).prefix, [])
  })
void test("an interrupted run cannot credit a passed stage without its checkpoint", () => {
  const args = inputs()
  delete args.priorEvidence.resume.guard
  const result = selectResumePrefix(args)
  assert.equal(result.status, "selected")
  assert.deepEqual(result.prefix, [])
})
void test("earlier census failure never turns later successes into reusable islands", () => {
  const args = inputs()
  args.priorEvidence.resume.stages[0].outcome = "failed"
  assert.deepEqual(selectResumePrefix(args).prefix, [])
})
void test("out-of-order completion preserves canonical contiguous-prefix credit", () => {
  const args = inputs()
  args.priorEvidence.resume.stages[0].outcome = "passed"
  args.priorEvidence.resume.stages[1].outcome = "passed"
  args.priorEvidence.resume.stages[2].outcome = "failed"
  args.priorEvidence.resume.stages[0].completionOrdinal = 2
  args.priorEvidence.resume.stages[1].completionOrdinal = 3
  args.priorEvidence.resume.stages[2].completionOrdinal = 1
  assert.deepEqual(
    selectResumePrefix(args).prefix.map((stage) => stage.stageId),
    ["types", "tests"]
  )
})
for (const [name, mutate] of [
  [
    "old schema",
    (a) => {
      a.priorEvidence.resume.identity.version = 1
    }
  ],
  [
    "unknown custody",
    (a) => {
      a.priorEvidence.custody = "UNRESOLVED"
    }
  ],
  [
    "open registry",
    (a) => {
      a.priorEvidence.registration = "open"
    }
  ],
  [
    "changed original inputs",
    (a) => {
      a.priorEvidence.resume.guard.unchanged = false
    }
  ],
  [
    "missing readiness",
    (a) => {
      delete a.priorEvidence.resume.guard.ready
    }
  ],
  [
    "missing drain",
    (a) => {
      delete a.priorEvidence.resume.guard.drained
    }
  ],
  [
    "different worktree",
    (a) => {
      a.priorEvidence.worktree = "/another"
    }
  ],
  [
    "complete input mismatch",
    (a) => {
      a.currentIdentity = { ...a.currentIdentity, inputDigest: "changed" }
    }
  ],
  [
    "changed limits",
    (a) => {
      a.stageManifest = structuredClone(a.stageManifest)
      a.stageManifest[0].timeout++
    }
  ],
  [
    "missing child evidence",
    (a) => {
      a.priorEvidence.resume.stages[0].subtreeProven = false
    }
  ],
  [
    "wrong stage identity",
    (a) => {
      a.priorEvidence.resume.stages[0].stageId = "another"
    }
  ],
  [
    "missing artifact",
    (a) => {
      a.currentArtifacts = {}
    }
  ],
  [
    "deleted artifact",
    (a) => {
      a.currentArtifacts = { dist: { exists: false, entries: [] } }
    }
  ],
  [
    "extra artifact",
    (a) => {
      a.currentArtifacts = structuredClone(a.currentArtifacts)
      a.currentArtifacts.dist.entries.push({ path: "dist/extra" })
    }
  ],
  [
    "changed artifact bytes",
    (a) => {
      a.currentArtifacts = structuredClone(a.currentArtifacts)
      a.currentArtifacts.dist.entries[0].sha256 = "changed"
    }
  ],
  [
    "missing root inventory",
    (a) => {
      a.priorEvidence.resume.stages[0].artifacts = {}
    }
  ],
  [
    "negative reused output count",
    (a) => {
      a.priorEvidence.resume.stages[0].outputLineCount = -1
    }
  ]
])
  void test(`refuses ${String(name)} before any prefix is credited`, () => {
    const args = inputs()
    mutate(args)
    assert.equal(selectResumePrefix(args).status, "refused")
  })
