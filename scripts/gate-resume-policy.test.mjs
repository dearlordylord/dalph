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
        maximumSuccessfulOutputLines: 550,
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
test("late failure reuses only the contiguous proven prefix and charges original console output", () => {
  const result = selectResumePrefix(inputs())
  assert.equal(result.status, "selected")
  assert.deepEqual(
    result.prefix.map((stage) => stage.stageId),
    ["types"]
  )
  assert.equal(result.successfulOutputLines, 12)
  assert.equal(result.prefix[0].runId, "original")
})
test("earlier census failure never turns later successes into reusable islands", () => {
  const args = inputs()
  args.priorEvidence.resume.stages[0].outcome = "failed"
  assert.deepEqual(selectResumePrefix(args).prefix, [])
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
    "reused output exceeds budget",
    (a) => {
      a.priorEvidence.resume.stages[0].outputLineCount = 551
    }
  ]
])
  test(`refuses ${String(name)} before any prefix is credited`, () => {
    const args = inputs()
    mutate(args)
    assert.equal(selectResumePrefix(args).status, "refused")
  })
