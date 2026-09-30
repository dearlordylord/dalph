import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { startInputGuard } from "./gate-resume-inputs.mjs"
import { startInputObserver } from "./gate-input-observer.mjs"
import assert from "node:assert/strict"
import test from "node:test"
import {
  candidateInputContract,
  executeCandidateChecks,
  localCandidateCheckPlan,
  materializeCandidateManifest
} from "./run-candidate-checks.mjs"

const unchanged = { assertUnchanged: async () => {}, finish: async () => {} }

const manifest = [
  { id: "candidate-proof", args: ["candidate-command"] },
  { id: "application", args: ["test"] }
]

void test("local candidate policy preserves formal relevance and never schedules a formal stage", async () => {
  const stages = [
    { id: "preflight", name: "preflight", boundary: "preflight", args: ["check:preflight"], timeout: 30_000 },
    { id: "application", name: "application", boundary: "qualification", args: ["test"], timeout: 30_000 },
    { id: "formal-proof", name: "formal proof", boundary: "formal", args: ["check:quint"], timeout: 30_000 }
  ]
  const classifications = [
    {
      version: 1,
      status: "affected",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      changedPaths: ["specs/model.qnt"],
      affectedPaths: ["specs/model.qnt"]
    },
    {
      version: 1,
      status: "unaffected",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      changedPaths: ["docs/note.md"],
      affectedPaths: []
    }
  ]

  for (const classification of classifications) {
    const plan = localCandidateCheckPlan(classification, stages)
    assert.strictEqual(plan.identity.formal, classification)
    assert.equal(plan.identity.formalDisposition, "not-requested")
    assert.deepEqual(plan.stages.map(({ id }) => id), ["preflight", "application"])

    const manifest = materializeCandidateManifest(plan.stages, "/pnpm.cjs", "/candidate")
    assert.ok(
      manifest.every(({ id, execution }) => id !== "formal-proof" && !execution.args.includes("check:quint"))
    )

    const executed = []
    await executeCandidateChecks({
      guard: unchanged,
      manifest,
      record: () => undefined,
      runStage: async (stage) => {
        executed.push(stage.id)
        return { exitCode: 0 }
      }
    })
    assert.deepEqual(executed, ["preflight", "application"])
  }
})

void test("candidate runner records and executes the same chosen manifest without reader substitution", async () => {
  const calls = []
  const records = []
  await executeCandidateChecks({
    guard: unchanged,
    manifest,
    record: (result) => records.push(structuredClone(result)),
    runStage: async (stage) => {
      calls.push(stage)
      return { exitCode: 0 }
    }
  })
  assert.deepEqual(calls, manifest)
  assert.deepEqual(records[0], { manifest, results: [], status: "running" })
  assert.deepEqual(
    records.at(-1).results,
    manifest.map(({ id }) => ({ id, status: "passed" }))
  )
  assert.equal(records.at(-1).status, "passed")
})

void test("actual failure remains a failure and never manufactures a repair permit", async () => {
  const records = []
  const calls = []
  await assert.rejects(
    executeCandidateChecks({
      guard: unchanged,
      manifest,
      record: (result) => records.push(structuredClone(result)),
      runStage: async (stage) => {
        calls.push(stage)
        return { exitCode: 9 }
      }
    }),
    /exited 9/
  )
  assert.deepEqual(calls, [manifest[0]])
  assert.equal(records.at(-1).status, "failed")
  assert.equal(records.at(-1).results.length, 0)
})

void test("candidate runner rejects an edit restored while a stage executes", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-candidate-observation-"))
  const source = join(root, "source.mjs")
  writeFileSync(source, "original")
  const observer = await startInputObserver({ roots: [root] })
  const records = []
  try {
    await assert.rejects(
      executeCandidateChecks({
        guard: { assertUnchanged: observer.assertUnchanged, finish: observer.assertUnchanged },
        manifest,
        record: (result) => records.push(structuredClone(result)),
        runStage: async () => {
          writeFileSync(source, "changed")
          writeFileSync(source, "original")
          return { exitCode: 0 }
        }
      }),
      /dirty|changed/u
    )
    assert.equal(records.at(-1).status, "failed")
    assert.ok(records.every((record) => record.status !== "passed"))
  } finally {
    await observer.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("smoke materialization removes stale deep-repetition command fields", () => {
  const [stage] = materializeCandidateManifest(
    [
      {
        id: "smoke",
        name: "smoke",
        args: ["test:delivery-smoke"],
        timeout: 300000,
        execution: { args: ["test:delivery-repeatability"], timeoutMilliseconds: 1140000 }
      }
    ],
    "/pnpm.cjs",
    "/candidate"
  )
  assert.deepEqual(stage.execution.args, ["/pnpm.cjs", "--silent", "test:delivery-smoke"])
  assert.equal(stage.execution.timeoutMilliseconds, 300000)
})

void test("production guard contract starts and protects completed artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-candidate-guard-"))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  let guard
  try {
    git("init", "-q")
    writeFileSync(join(root, "source.mjs"), "original")
    git("add", ".")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
    const artifact = join(root, "built.mjs")
    writeFileSync(artifact, "built")
    guard = await startInputGuard({
      worktree: root,
      logicalInvocation: candidateInputContract({
        candidateHeadSha: git("rev-parse", "HEAD"),
        manifest: materializeCandidateManifest(
          [
            {
              id: "secrets",
              name: "secrets",
              args: ["check:secrets", `--log-opts=--full-history --diff-filter=tuxdb ${git("rev-parse", "HEAD")} --`],
              timeout: 300000
            }
          ],
          "/fixture/pnpm.cjs",
          root
        )
      }),
      effectiveEnvironment: {
        ...process.env,
        DALPH_DPRINT_INCREMENTAL: "disabled",
        DALPH_GATE_GIT_HISTORY: "candidate-ancestry",
        GIT_OPTIONAL_LOCKS: "0"
      },
      generatedOutputRoots: [artifact]
    })
    const records = []
    await assert.rejects(
      executeCandidateChecks({
        guard,
        manifest: [{ id: "build", artifactRoots: [artifact] }, { id: "consumer" }],
        record: (result) => records.push(structuredClone(result)),
        runStage: async (stage) => {
          if (stage.id === "consumer") {
            writeFileSync(artifact, "changed")
            writeFileSync(artifact, "built")
          }
          return { exitCode: 0 }
        }
      }),
      /dirty|changed/u
    )
    assert.equal(records.at(-1).status, "failed")
  } finally {
    if (guard) await guard.close()
    rmSync(root, { recursive: true, force: true })
  }
})
