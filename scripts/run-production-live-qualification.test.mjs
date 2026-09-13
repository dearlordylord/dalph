import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, test } from "node:test"

import {
  productionLiveQualificationBin,
  productionLiveQualificationShippedBin,
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
    formal[name] = join(root, "formal", name, "formal.log")
    formal[`${name}Metadata`] = join(root, "formal", name, "provenance.json")
    await mkdir(join(root, "formal", name), { recursive: true })
    await writeFile(formal[name], `${name} formal evidence\n`)
    await writeFile(
      formal[`${name}Metadata`],
      `${JSON.stringify({
        profile: name,
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
        jobName: `formal-${name}`,
        log: "formal.log",
        setupInstallSeconds: 12,
        formalSeconds: 108,
        negativeControls: ["formal negative control"]
      })}\n`
    )
  }
  const output = {
    manifest: join(root, "output", "manifest.json"),
    artifact: join(root, "output", "qualification.json"),
    publication: join(root, "output", "publication")
  }
  output.retained = join(output.publication, "retained-locators.json")
  await mkdir(join(root, "output"), { recursive: true })
  await mkdir(output.publication, { recursive: true })
  const lockfile = join(root, "pnpm-lock.yaml")
  const codexExecutable = join(root, "node_modules", ".bin", "codex")
  await writeFile(lockfile, "lockfileVersion: 9\n")
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true })
  await writeFile(codexExecutable, "#!/usr/bin/env node\n")
  return { codexExecutable, lockfile, root, formal, output }
}

const formalForManifest = Object.freeze({
  _tag: "DedicatedAndStressed",
  dedicated: {
    profileKind: "dedicated",
    condition: { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm", effectiveParallelism: 4 },
    sourceSha: candidateSha,
    nodeVersion: "24.20.0",
    job: { workflow: "Production live qualification", runId: 701, jobId: 812 },
    logDigest: "0".repeat(64),
    setupInstallSeconds: 12,
    formalSeconds: 105,
    completeJobSeconds: 120,
    remainingHostedSeconds: 840,
    hostedLimitSeconds: 960,
    commands: [],
    negativeControls: ["formal negative control"]
  },
  stressed: {
    profileKind: "stressed",
    condition: {
      kind: "cpu-affinity",
      runnerLabel: "ubuntu-latest",
      cpuList: "0-1",
      hostParallelism: 4,
      effectiveParallelism: 2
    },
    sourceSha: candidateSha,
    nodeVersion: "24.20.0",
    job: { workflow: "Production live qualification", runId: 701, jobId: 813 },
    logDigest: "1".repeat(64),
    setupInstallSeconds: 12,
    formalSeconds: 105,
    completeJobSeconds: 120,
    remainingHostedSeconds: 840,
    hostedLimitSeconds: 960,
    commands: [],
    negativeControls: ["formal negative control"]
  }
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
  DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED: f.formal.dedicated,
  DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED: f.formal.stressed,
  DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA: f.formal.dedicatedMetadata,
  DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA: f.formal.stressedMetadata,
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
  DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
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

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
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

test("launches the built controller exactly once with one manifest locator and both secrets", async () => {
  const f = await fixture()
  const requests = []
  const result = await runProductionLiveQualification({
    repositoryRoot: f.root,
    environment: environmentFor(f, {
      UNRELATED_SECRET: "secret-not-for-child",
      UNRELATED_TOKEN: "token-not-for-child"
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
  assert.equal(requests[0].environment.DALPH_CODEX_PROVIDER_CREDENTIAL, "codex-secret")
  assert.equal(requests[0].environment.UNRELATED_SECRET, undefined)
  assert.equal(requests[0].environment.UNRELATED_TOKEN, undefined)
  assert.equal(requests[0].args.includes("github-secret"), false)
  assert.equal(requests[0].args.includes("codex-secret"), false)
  const manifest = JSON.parse(await readFile(f.output.manifest, "utf8"))
  assert.equal(manifest.builtEntry, join(f.root, productionLiveQualificationShippedBin))
  assert.equal(manifest.retentionReport, f.output.retained)
  assert.equal(manifest.publicationContainer, f.output.publication)
  assert.notEqual(manifest.artifact, manifest.retentionReport)
  assert.equal(manifest.hosted.sourceSha, candidateSha)
  assert.equal(manifest.formal._tag, "DedicatedAndStressed")
  assert.equal(JSON.stringify(manifest).includes("github-secret"), false)
  assert.equal(JSON.stringify(manifest).includes("codex-secret"), false)
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
  assert.equal(JSON.stringify(manifest).includes("codex-secret"), false)
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
      assert.equal(error.message.includes("codex-secret"), false)
      return true
    }
  )
  assert.equal(requests.length, 1)
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

test("resolves unique numeric formal job IDs and enriches only safe profile fields", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const apiPayload = {
    jobs: [
      { ...completedFormalJob(812, "Dedicated formal evidence"), rawPayloadSecret: "must-not-be-written" },
      completedFormalJob(813, "Stressed formal evidence")
    ]
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
    dedicated: { completeJobSeconds: 120, id: 812, name: "Dedicated formal evidence" },
    stressed: { completeJobSeconds: 120, id: 813, name: "Stressed formal evidence" }
  })
  assert.match(request.url, /\/actions\/runs\/701\/attempts\/1\/jobs\?per_page=100$/u)
  assert.equal(request.options.headers.Authorization, "Bearer github-secret")
  for (const name of ["dedicated", "stressed"]) {
    const metadata = JSON.parse(await readFile(f.formal[`${name}Metadata`], "utf8"))
    assert.equal(metadata.job.jobId, name === "dedicated" ? 812 : 813)
    assert.equal(typeof metadata.job.jobId, "number")
    assert.equal(metadata.job.workflow, "Production live qualification")
    assert.equal(metadata.setupInstallSeconds, 12)
    assert.equal(metadata.completeJobSeconds, 120)
    assert.equal(metadata.log, "formal.log")
    assert.equal(metadata.profile, name)
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
})

test("fails closed for duplicate or nonnumeric formal Actions job identities", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  for (const jobs of [
    [
      {
        id: 812,
        name: "Dedicated formal evidence",
        run_id: 701,
        run_attempt: 1,
        status: "completed",
        conclusion: "success"
      },
      {
        id: 813,
        name: "Dedicated formal evidence",
        run_id: 701,
        run_attempt: 1,
        status: "completed",
        conclusion: "success"
      },
      {
        id: 814,
        name: "Stressed formal evidence",
        run_id: 701,
        run_attempt: 1,
        status: "completed",
        conclusion: "success"
      }
    ],
    [
      {
        id: "812",
        name: "Dedicated formal evidence",
        run_id: 701,
        run_attempt: 1,
        status: "completed",
        conclusion: "success"
      },
      {
        id: 814,
        name: "Stressed formal evidence",
        run_id: 701,
        run_attempt: 1,
        status: "completed",
        conclusion: "success"
      }
    ]
  ]) {
    await assert.rejects(
      resolveFormalQualificationJobs({
        environment,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs }) })
      })
    )
  }
})

test("rejects an Actions-reported formal job duration at the 16-minute cutoff", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            completedFormalJob(812, "Dedicated formal evidence", 960),
            completedFormalJob(813, "Stressed formal evidence")
          ]
        })
      })
    }),
    /Actions job duration does not satisfy the hosted timing contract/u
  )
})

test("rejects an absolute formal log path from uploaded provenance", async () => {
  const f = await fixture()
  const environment = { ...environmentFor(f), GITHUB_TOKEN: "github-secret" }
  const metadata = JSON.parse(await readFile(f.formal.dedicatedMetadata, "utf8"))
  await writeFile(f.formal.dedicatedMetadata, `${JSON.stringify({ ...metadata, log: f.formal.dedicated })}\n`)
  await assert.rejects(
    resolveFormalQualificationJobs({
      environment,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            completedFormalJob(812, "Dedicated formal evidence"),
            completedFormalJob(813, "Stressed formal evidence")
          ]
        })
      })
    }),
    /formal provenance log name is not the downloaded formal log/u
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
    const metadata = JSON.parse(await readFile(f.formal.stressedMetadata, "utf8"))
    await writeFile(f.formal.stressedMetadata, `${JSON.stringify(mutate(metadata))}\n`)
    await assert.rejects(
      resolveFormalQualificationJobs({
        environment,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            jobs: [
              completedFormalJob(812, "Dedicated formal evidence"),
              completedFormalJob(813, "Stressed formal evidence")
            ]
          })
        })
      }),
      /stressed formal provenance/u
    )
  }
})
