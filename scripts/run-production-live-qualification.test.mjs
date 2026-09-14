import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"
import { afterEach, test } from "node:test"

import {
  productionLiveQualificationBin,
  productionLiveQualificationShippedBin,
  captureProductionLiveQualificationDiagnostics,
  requireSuccessfulCandidateCi,
  resolveFormalQualificationJobs,
  runProductionLiveQualification
} from "./run-production-live-qualification.mjs"

const candidateSha = "0123456789abcdef0123456789abcdef01234567"
const reviewedBaseSha = "fedcba9876543210fedcba9876543210fedcba98"
const roots = []

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "dalph-production-live-qualification-"))
  roots.push(root)
  const bin = join(root, productionLiveQualificationBin)
  await mkdir(join(root, "packages", "dalph", "dist", "bin"), { recursive: true })
  await writeFile(bin, "#!/usr/bin/env node\n")
  const shippedEntry = join(root, productionLiveQualificationShippedBin)
  await writeFile(shippedEntry, "#!/usr/bin/env node\n")
  const formal = {}
  for (const name of ["dedicated", "stressed"]) {
    formal[name] = []
    for (const shard of [0, 1]) {
      const directory = join(root, "formal", name, `shard-${shard}`)
      const report = join(directory, "report.json")
      const metadata = join(directory, "provenance.json")
      await mkdir(directory, { recursive: true })
      const reportSource = `${JSON.stringify({ version: 1, profile: name, shard, report: { elapsedMilliseconds: 108000 } })}\n`
      await writeFile(report, reportSource)
      await writeFile(
        metadata,
        `${JSON.stringify({
          profile: name,
          shard,
          condition:
            name === "dedicated"
              ? { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm", effectiveParallelism: 4 }
              : {
                  kind: "cpu-affinity",
                  runnerLabel: "ubuntu-latest",
                  cpuList: "0-1",
                  hostParallelism: 4,
                  effectiveParallelism: 2
                },
          sourceSha: candidateSha,
          reviewedBaseSha,
          nodeVersion: "24.20.0",
          workflowName: "Production live qualification",
          runId: 701,
          runAttempt: 1,
          jobName: "formal",
          report: "report.json",
          reportDigest: createHash("sha256").update(reportSource).digest("hex"),
          setupInstallSeconds: 12,
          formalSeconds: 108
        })}\n`
      )
      formal[name].push({ metadata, report })
    }
  }
  formal.root = join(root, "formal")
  const output = {
    manifest: join(root, "output", "manifest.json"),
    artifact: join(root, "output", "qualification.json"),
    publication: join(root, "output", "publication")
  }
  output.retained = join(output.publication, "retained-locators.json")
  output.diagnostics = join(output.publication, "diagnostics.json")
  await mkdir(join(root, "output"), { recursive: true })
  await mkdir(output.publication, { recursive: true })
  const lockfile = join(root, "pnpm-lock.yaml")
  const codexExecutable = join(root, "node_modules", ".bin", "codex")
  const codexEntry = join(root, "node_modules", "@openai", "codex", "bin", "codex.js")
  await writeFile(lockfile, "lockfileVersion: 9\n")
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true })
  await mkdir(join(root, "node_modules", "@openai", "codex", "bin"), { recursive: true })
  await writeFile(codexExecutable, "#!/usr/bin/env node\n")
  await writeFile(codexEntry, "#!/usr/bin/env node\n")
  return { codexEntry, codexExecutable, lockfile, root, formal, output }
}

const formalCommands = (custodyOffset) =>
  Array.from({ length: 105 }, (_value, position) => ({
    position,
    kind: "test",
    name: `formal command ${position}`,
    args: ["test", `specs/formal-${position}.qnt`],
    verdict: {
      acceptedExitCodes: [0],
      witnesses: [],
      temporal: null,
      collectedReplacementTest: false,
      artifactPreparedAfter: false
    },
    result: "exit:0",
    obligationId: `00000000-0000-4000-8000-${String(custodyOffset * 1_000 + position + 1).padStart(12, "0")}`,
    durationMilliseconds: 1
  }))
const formalProfileForManifest = (profileKind, jobStart) => ({
  profileKind,
  sourceSha: candidateSha,
  nodeVersion: "24.20.0",
  runId: 701,
  runAttempt: 1,
  profileDigest: "9".repeat(64),
  formalSeconds: 105,
  completeProfileSeconds: 120,
  shards: [0, 1].map((shard) => ({
    shard,
    condition:
      profileKind === "dedicated"
        ? { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm", effectiveParallelism: 4 }
        : {
            kind: "cpu-affinity",
            runnerLabel: "ubuntu-latest",
            cpuList: "0-1",
            hostParallelism: 4,
            effectiveParallelism: 2
          },
    job: {
      workflow: "Production live qualification",
      runId: 701,
      runAttempt: 1,
      jobId: jobStart + shard,
      name: `${profileKind === "dedicated" ? "Dedicated" : "Stressed"} formal evidence shard ${shard}`
    },
    reportDigest: String(jobStart + shard)
      .slice(-1)
      .repeat(64),
    positions: Array.from({ length: 105 }, (_value, position) => position).filter((position) =>
      shard === 0
        ? position <= 36 ||
          (position >= 42 && position <= 46) ||
          (position >= 60 && position <= 64) ||
          (position >= 86 && position <= 90) ||
          position >= 100
        : (position >= 37 && position <= 41) ||
          (position >= 47 && position <= 59) ||
          (position >= 65 && position <= 85) ||
          (position >= 91 && position <= 99)
    ),
    setupInstallSeconds: 12,
    formalSeconds: 105 - shard,
    completeJobSeconds: 120,
    remainingHostedSeconds: 840,
    hostedLimitSeconds: 960,
    startedAt: "2026-09-13T12:00:00.000Z",
    completedAt: "2026-09-13T12:02:00.000Z"
  })),
  commands: formalCommands(jobStart),
  negativeControls: ["formal negative control"]
})
const formalForManifest = Object.freeze({
  _tag: "DedicatedAndStressed",
  dedicated: formalProfileForManifest("dedicated", 812),
  stressed: formalProfileForManifest("stressed", 814)
})

const decodeWithBuiltRuntimeSchema = async (manifest) => {
  const runtime = await import(
    pathToFileURL(join(process.cwd(), "packages/dalph/dist/src/qualification/live-qualification-runtime.js")).href
  )
  const { Effect } = await import("effect")
  return Effect.runPromise(runtime.decodeProductionLiveQualificationManifest(manifest))
}

const environmentFor = (f, overrides = {}) => ({
  DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION: "1",
  DALPH_CANDIDATE_SHA: candidateSha,
  DALPH_COVERAGE_BASE_SHA: reviewedBaseSha,
  DALPH_LIVE_QUALIFICATION_SOURCE_SHA: candidateSha,
  DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY: f.root,
  DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA: reviewedBaseSha,
  DALPH_LIVE_QUALIFICATION_BUILT_ENTRY: join(f.root, productionLiveQualificationBin),
  DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY: join(f.root, productionLiveQualificationShippedBin),
  DALPH_LIVE_QUALIFICATION_LOCKFILE: f.lockfile,
  DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE: f.codexExecutable,
  DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER: f.output.publication,
  DALPH_LIVE_QUALIFICATION_WORKFLOW: "Production live qualification",
  DALPH_LIVE_QUALIFICATION_RUN_ID: "701",
  DALPH_LIVE_QUALIFICATION_JOB_ID: "qualify",
  DALPH_LIVE_QUALIFICATION_REPOSITORY: "fixture-owner/fixture-repository",
  DALPH_LIVE_QUALIFICATION_MANIFEST: f.output.manifest,
  DALPH_LIVE_QUALIFICATION_ARTIFACT: f.output.artifact,
  DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS: f.output.retained,
  DALPH_LIVE_QUALIFICATION_DIAGNOSTICS: f.output.diagnostics,
  DALPH_LIVE_QUALIFICATION_FORMAL_ROOT: f.formal.root,
  DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT: "production-live-qualification",
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "Production live qualification",
  GITHUB_RUN_ID: "701",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_JOB: "qualify",
  GITHUB_REPOSITORY: "dearlordylord/dalph",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_SHA: candidateSha,
  PATH: process.env.PATH,
  DALPH_LIVE_GITHUB_TOKEN: "github-secret",
  ...overrides
})

const completedFormalJob = (id, name, completeJobSeconds = 120) => ({
  id,
  name,
  run_id: 701,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  started_at: "2026-09-13T12:00:00Z",
  completed_at: new Date(Date.parse("2026-09-13T12:00:00Z") + completeJobSeconds * 1000).toISOString()
})
const completedFormalJobs = (duration = 120) => [
  completedFormalJob(812, "Dedicated formal evidence shard 0", duration),
  completedFormalJob(813, "Dedicated formal evidence shard 1", duration),
  completedFormalJob(814, "Stressed formal evidence shard 0", duration),
  completedFormalJob(815, "Stressed formal evidence shard 1", duration)
]

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})

test("blocks formal qualification unless exact candidate CI is completed and successful", async () => {
  const environment = {
    DALPH_CANDIDATE_SHA: candidateSha,
    GITHUB_REPOSITORY: "dearlordylord/dalph",
    GITHUB_TOKEN: "actions-read-token"
  }
  for (const workflowRun of [
    { name: "CI", head_sha: candidateSha, status: "completed", conclusion: "failure" },
    { name: "CI", head_sha: candidateSha, status: "in_progress", conclusion: null },
    { name: "CI", head_sha: candidateSha, status: "completed", conclusion: "cancelled" },
    { name: "CI", head_sha: reviewedBaseSha, status: "completed", conclusion: "success" },
    { name: "Production live qualification", head_sha: candidateSha, status: "completed", conclusion: "success" }
  ]) {
    await assert.rejects(
      requireSuccessfulCandidateCi({
        environment,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [workflowRun] }) })
      }),
      /exact candidate requires a completed successful CI workflow/u
    )
  }
})

test("blocks formal qualification when the exact candidate has no CI workflow run", async () => {
  await assert.rejects(
    requireSuccessfulCandidateCi({
      environment: {
        DALPH_CANDIDATE_SHA: candidateSha,
        GITHUB_REPOSITORY: "dearlordylord/dalph",
        GITHUB_TOKEN: "actions-read-token"
      },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [] }) })
    }),
    /exact candidate requires a completed successful CI workflow/u
  )
})

test("permits formal qualification after exact candidate CI completed successfully", async () => {
  const requests = []
  const result = await requireSuccessfulCandidateCi({
    environment: {
      DALPH_CANDIDATE_SHA: candidateSha,
      GITHUB_REPOSITORY: "dearlordylord/dalph",
      GITHUB_TOKEN: "actions-read-token"
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: url.href, options })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [{ name: "CI", head_sha: candidateSha, status: "completed", conclusion: "success" }]
        })
      }
    }
  })
  assert.deepEqual(result, { headSha: candidateSha, workflow: "CI" })
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /\/actions\/runs\?head_sha=0123456789abcdef0123456789abcdef01234567&per_page=100$/u)
  assert.equal(requests[0].options.headers.Authorization, "Bearer actions-read-token")
})

test("rejects missing live opt-in before observing or launching anything", async () => {
  const f = await fixture()
  let observed = 0
  let launched = 0

  await assert.rejects(
    runProductionLiveQualification({
      repositoryRoot: f.root,
      environment: environmentFor(f, { DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION: undefined }),
      readCandidateSha: async () => {
        observed++
        return candidateSha
      },
      runCommand: async () => {
        launched++
      }
    }),
    /requires DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION=1/u
  )
  assert.equal(observed, 0)
  assert.equal(launched, 0)
})

test("rejects a candidate HEAD mismatch before the live child launch", async () => {
  const f = await fixture()
  let launched = 0

  await assert.rejects(
    runProductionLiveQualification({
      repositoryRoot: f.root,
      environment: environmentFor(f),
      readCandidateSha: async () => reviewedBaseSha,
      runCommand: async () => {
        launched++
      }
    }),
    /candidate HEAD does not match the exact requested candidate SHA/u
  )
  assert.equal(launched, 0)
})

test("rejects a missing derived Codex entry before the live child launch", async () => {
  const f = await fixture()
  await rm(join(f.root, "node_modules", "@openai", "codex", "bin", "codex.js"))
  let launched = 0
  await assert.rejects(
    runProductionLiveQualification({
      repositoryRoot: f.root,
      environment: environmentFor(f),
      readCandidateSha: async () => candidateSha,
      runCommand: async () => {
        launched++
      }
    }),
    /locked Codex JavaScript entry is not a readable file/u
  )
  assert.equal(launched, 0)
})

test("launches the built controller exactly once with one manifest locator and only the GitHub secret", async () => {
  const f = await fixture()
  const requests = []
  const result = await runProductionLiveQualification({
    repositoryRoot: f.root,
    environment: environmentFor(f, {
      UNRELATED_SECRET: "secret-not-for-child",
      UNRELATED_TOKEN: "token-not-for-child",
      DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL: "must-be-generated-by-controller"
    }),
    readCandidateSha: async () => candidateSha,
    buildFormal: async () => formalForManifest,
    runCommand: async (request) => {
      requests.push(request)
      return { exitCode: 0, signal: undefined }
    }
  })

  assert.equal(result.exitCode, 0)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].args, [join(f.root, productionLiveQualificationBin), "--manifest", f.output.manifest])
  assert.equal(requests[0].environment.DALPH_LIVE_GITHUB_TOKEN, "github-secret")
  assert.equal(requests[0].environment.GITHUB_TOKEN, undefined)
  assert.equal(requests[0].environment.DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL, undefined)
  assert.equal(requests[0].environment.UNRELATED_SECRET, undefined)
  assert.equal(requests[0].environment.UNRELATED_TOKEN, undefined)
  assert.equal(requests[0].args.includes("github-secret"), false)
  assert.equal(requests[0].args.includes("must-be-generated-by-controller"), false)
  const manifest = JSON.parse(await readFile(f.output.manifest, "utf8"))
  assert.equal(manifest.builtEntry, join(f.root, productionLiveQualificationShippedBin))
  assert.equal(manifest.codexJavaScriptEntry, f.codexEntry)
  assert.equal(manifest.retentionReport, f.output.retained)
  assert.equal(manifest.publicationContainer, f.output.publication)
  assert.notEqual(manifest.artifact, manifest.retentionReport)
  assert.equal(manifest.hosted.sourceSha, candidateSha)
  assert.equal(manifest.formal._tag, "DedicatedAndStressed")
  assert.equal(JSON.stringify(manifest).includes("github-secret"), false)
  assert.equal(JSON.stringify(manifest).includes("must-be-generated-by-controller"), false)
})

test("the exact written manifest decodes with the built runtime schema without secrets", async (t) => {
  const f = await fixture()
  const environment = environmentFor(f)
  await runProductionLiveQualification({
    repositoryRoot: f.root,
    environment,
    readCandidateSha: async () => candidateSha,
    buildFormal: async () => formalForManifest,
    runCommand: async () => ({ exitCode: 0, signal: undefined })
  })
  const manifest = JSON.parse(await readFile(f.output.manifest, "utf8"))
  assert.equal(JSON.stringify(manifest).includes("github-secret"), false)
  assert.equal(JSON.stringify(manifest).includes("must-be-generated-by-controller"), false)
  try {
    assert.deepEqual(await decodeWithBuiltRuntimeSchema(manifest), manifest)
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("built runtime schema is not available until the runtime package build includes test-support")
      return
    }
    throw error
  }
})

test("does not retry after a live child failure and does not expose secret bytes in its error", async () => {
  const f = await fixture()
  const requests = []
  await assert.rejects(
    runProductionLiveQualification({
      repositoryRoot: f.root,
      environment: environmentFor(f),
      readCandidateSha: async () => candidateSha,
      buildFormal: async () => formalForManifest,
      runCommand: async (request) => {
        requests.push(request)
        return { exitCode: 17, signal: undefined }
      }
    }),
    (error) => {
      assert.match(error.message, /exited with status 17/u)
      assert.equal(error.message.includes("github-secret"), false)
      assert.equal(error.message.includes("must-be-generated-by-controller"), false)
      return true
    }
  )
  assert.equal(requests.length, 1)
})

test("hosted cancellation diagnostics retain progress without locators, payloads, prompts, or credentials", async () => {
  const f = await fixture()
  const container = join(f.root, "dalph-live-fixture")
  const journal = join(container, "journal.sqlite")
  const privateState = join(container, "codex-executor-private")
  await mkdir(privateState, { recursive: true })
  const database = new DatabaseSync(journal)
  database.exec(`
    CREATE TABLE journal_records (
      run_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      event_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE journal_records_cold (
      run_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      event_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
  `)
  database
    .prepare("INSERT INTO journal_records VALUES (?, ?, ?, ?)")
    .run("private-run-id", 1, "WorkflowRunStarted", '{"prompt":"private user prompt","token":"github-secret"}')
  database
    .prepare("INSERT INTO journal_records VALUES (?, ?, ?, ?)")
    .run("private-run-id", 2, "TaskAttemptPlanned", '{"worktree":"/private/attempt"}')
  database.close()
  await writeFile(join(privateState, "app-server-processes"), "linux:12345:pid:123\nlinux:23456:pid:456\n")
  await writeFile(
    f.output.retained,
    JSON.stringify({
      schemaVersion: 1,
      invocationId: "live-q-private",
      outcome: "NotQualified",
      phase: "Execution",
      progress: { _tag: "PrivateFutureField", prompt: "private user prompt" },
      github: [{ _tag: "Issue", nodeId: "private-node-id", disposition: "Retained", manualCommand: "private" }],
      local: [
        { locator: container, disposition: "Retained", manualCommand: "private" },
        { locator: journal, disposition: "Retained", manualCommand: "private" },
        { locator: privateState, disposition: "Retained", manualCommand: "private" }
      ]
    })
  )

  const result = await captureProductionLiveQualificationDiagnostics({ environment: environmentFor(f) })
  assert.deepEqual(result.journal, {
    _tag: "Observed",
    hotEventKinds: ["WorkflowRunStarted", "TaskAttemptPlanned"],
    coldEventKinds: []
  })
  assert.deepEqual(result.applicationServerStarts, { _tag: "Observed", count: 2 })
  assert.deepEqual(result.checkpoint, {
    _tag: "Observed",
    phase: "Execution",
    githubResourceCount: 1,
    githubDispositions: { Retained: 1 },
    localResourceCount: 3,
    localDispositions: { Retained: 3 }
  })
  const serialized = await readFile(f.output.diagnostics, "utf8")
  for (const privateValue of [
    f.root,
    container,
    journal,
    privateState,
    "private-run-id",
    "private-node-id",
    "private user prompt",
    "github-secret"
  ]) {
    assert.equal(serialized.includes(privateValue), false, `published private value: ${privateValue}`)
  }
})

test("hosted diagnostics distinguish a missing checkpoint and do not misreport successful qualification", async () => {
  const f = await fixture()
  const environment = environmentFor(f)
  const missing = await captureProductionLiveQualificationDiagnostics({ environment })
  assert.deepEqual(missing.checkpoint, { _tag: "Unavailable", reason: "Absent" })
  assert.deepEqual(missing.journal, { _tag: "Unavailable", reason: "CheckpointUnavailable" })

  await rm(f.output.diagnostics)
  await writeFile(f.output.retained, "not JSON")
  const unreadable = await captureProductionLiveQualificationDiagnostics({ environment })
  assert.deepEqual(unreadable.checkpoint, { _tag: "Unavailable", reason: "Unreadable" })

  await rm(f.output.retained)
  await rm(f.output.diagnostics)
  await writeFile(f.output.artifact, JSON.stringify({ schemaVersion: 1, artifactStage: "Final" }))
  assert.equal(await captureProductionLiveQualificationDiagnostics({ environment }), undefined)
  await assert.rejects(readFile(f.output.diagnostics), /ENOENT/u)
})

test("fails closed for a malformed reviewed base or non-absolute manifest locator", async () => {
  const f = await fixture()
  for (const overrides of [
    { DALPH_COVERAGE_BASE_SHA: "not-a-sha" },
    { DALPH_LIVE_QUALIFICATION_MANIFEST: "relative/manifest.json" },
    { DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY: `${f.root}/another-checkout` },
    { DALPH_LIVE_QUALIFICATION_JOB_ID: "another-job" },
    { DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS: join(f.root, "output", "retained.json") },
    { DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY: join(f.root, productionLiveQualificationBin) }
  ]) {
    let launched = 0
    await assert.rejects(
      runProductionLiveQualification({
        repositoryRoot: f.root,
        environment: environmentFor(f, overrides),
        readCandidateSha: async () => candidateSha,
        runCommand: async () => {
          launched++
        }
      })
    )
    assert.equal(launched, 0)
  }
})

test("resolves four unique numeric shard job IDs and retains truthful per-shard timing", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const apiPayload = {
    jobs: [{ ...completedFormalJobs()[0], rawPayloadSecret: "must-not-be-written" }, ...completedFormalJobs().slice(1)]
  }
  let request
  const result = await resolveFormalQualificationJobs({
    environment,
    fetchImpl: async (url, options) => {
      const requestUrl = url instanceof URL ? url.href : typeof url === "string" ? url : JSON.stringify(url)
      request = { options, url: requestUrl }
      return { ok: true, status: 200, json: async () => apiPayload }
    }
  })

  assert.deepEqual(result, {
    dedicated: [
      {
        completeJobSeconds: 120,
        completedAt: "2026-09-13T12:02:00.000Z",
        id: 812,
        name: "Dedicated formal evidence shard 0",
        startedAt: "2026-09-13T12:00:00Z"
      },
      {
        completeJobSeconds: 120,
        completedAt: "2026-09-13T12:02:00.000Z",
        id: 813,
        name: "Dedicated formal evidence shard 1",
        startedAt: "2026-09-13T12:00:00Z"
      }
    ],
    stressed: [
      {
        completeJobSeconds: 120,
        completedAt: "2026-09-13T12:02:00.000Z",
        id: 814,
        name: "Stressed formal evidence shard 0",
        startedAt: "2026-09-13T12:00:00Z"
      },
      {
        completeJobSeconds: 120,
        completedAt: "2026-09-13T12:02:00.000Z",
        id: 815,
        name: "Stressed formal evidence shard 1",
        startedAt: "2026-09-13T12:00:00Z"
      }
    ]
  })
  assert.match(request.url, /\/actions\/runs\/701\/attempts\/1\/jobs\?per_page=100$/u)
  assert.equal(request.options.headers.Authorization, "Bearer github-secret")
  for (const [profileIndex, name] of ["dedicated", "stressed"].entries()) {
    for (const shard of [0, 1]) {
      const metadata = JSON.parse(await readFile(f.formal[name][shard].metadata, "utf8"))
      assert.equal(metadata.job.jobId, 812 + profileIndex * 2 + shard)
      assert.equal(typeof metadata.job.jobId, "number")
      assert.equal(metadata.job.workflow, "Production live qualification")
      assert.equal(metadata.job.runAttempt, 1)
      assert.equal(metadata.jobName, "formal")
      assert.equal(metadata.reviewedBaseSha, reviewedBaseSha)
      assert.equal(metadata.runId, 701)
      assert.equal(metadata.setupInstallSeconds, 12)
      assert.equal(metadata.completeJobSeconds, 120)
      assert.equal(metadata.report, "report.json")
      assert.match(metadata.reportDigest, /^[0-9a-f]{64}$/u)
      assert.equal(metadata.profile, name)
      assert.equal(metadata.shard, shard)
      assert.equal(metadata.condition.kind, name === "dedicated" ? "dedicated-hosted-job" : "cpu-affinity")
      if (name === "stressed") {
        assert.equal(metadata.condition.cpuList, "0-1")
        assert.equal(metadata.condition.hostParallelism, 4)
        assert.equal(metadata.condition.effectiveParallelism, 2)
      }
      assert.equal(metadata.rawPayloadSecret, undefined)
      assert.equal(JSON.stringify(metadata).includes("must-not-be-written"), false)
      assert.equal(JSON.stringify(metadata).includes(f.root), false)
    }
  }
  await resolveFormalQualificationJobs({
    environment,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => apiPayload })
  })
})

test("fails closed for duplicate or nonnumeric formal Actions job identities", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  for (const jobs of [
    [...completedFormalJobs(), completedFormalJob(816, "Dedicated formal evidence shard 0")],
    completedFormalJobs().map((job, index) => (index === 0 ? { ...job, id: "812" } : job)),
    completedFormalJobs().map((job, index) => (index === 1 ? { ...job, id: 812 } : job))
  ]) {
    await assert.rejects(
      resolveFormalQualificationJobs({
        environment,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs }) })
      })
    )
  }
})

test("fails closed when a formal report is moved between physical profile artifacts", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const dedicated = await readFile(f.formal.dedicated[0].report, "utf8")
  const stressed = await readFile(f.formal.stressed[0].report, "utf8")
  await writeFile(f.formal.dedicated[0].report, stressed)
  await writeFile(f.formal.stressed[0].report, dedicated)
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: completedFormalJobs() }) })
    }),
    /report digest/u
  )
})

test("rejects an Actions-reported formal job duration at the 16-minute cutoff", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: [...completedFormalJobs(960)] }) })
    }),
    /Actions job duration does not satisfy the hosted timing contract/u
  )
})

test("rejects an absolute formal report path from uploaded provenance", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const metadata = JSON.parse(await readFile(f.formal.dedicated[0].metadata, "utf8"))
  await writeFile(
    f.formal.dedicated[0].metadata,
    `${JSON.stringify({ ...metadata, report: f.formal.dedicated[0].report })}\n`
  )
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: completedFormalJobs() }) })
    }),
    /formal report name is incorrect/u
  )
})

test("rejects the v-prefixed process.version metadata emitted by the failed hosted run", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const metadata = JSON.parse(await readFile(f.formal.dedicated[0].metadata, "utf8"))
  await writeFile(f.formal.dedicated[0].metadata, `${JSON.stringify({ ...metadata, nodeVersion: "v24.20.0" })}\n`)
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: completedFormalJobs() }) })
    }),
    /dedicated shard 0 formal provenance Node version is unsupported/u
  )
})

test("rejects mislabeled or non-constraining formal profile conditions", async () => {
  for (const mutate of [
    (metadata) => ({ ...metadata, profile: "dedicated" }),
    (metadata) => ({
      ...metadata,
      condition: { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm", effectiveParallelism: 4 }
    }),
    (metadata) => ({ ...metadata, condition: { ...metadata.condition, hostParallelism: 2 } }),
    (metadata) => ({ ...metadata, condition: { ...metadata.condition, effectiveParallelism: 3 } })
  ]) {
    const f = await fixture()
    const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
    const metadata = JSON.parse(await readFile(f.formal.stressed[0].metadata, "utf8"))
    await writeFile(f.formal.stressed[0].metadata, `${JSON.stringify(mutate(metadata))}\n`)
    await assert.rejects(
      resolveFormalQualificationJobs({
        environment,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: completedFormalJobs() }) })
      }),
      /stressed shard 0 formal provenance/u
    )
  }
})
