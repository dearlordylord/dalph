import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

import { productionLiveQualificationBin, runProductionLiveQualification } from "./run-production-live-qualification.mjs"

const candidateSha = "0123456789abcdef0123456789abcdef01234567"
const reviewedBaseSha = "fedcba9876543210fedcba9876543210fedcba98"
const roots = []

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "dalph-production-live-qualification-"))
  roots.push(root)
  const bin = join(root, productionLiveQualificationBin)
  await mkdir(join(root, "packages", "dalph", "dist", "bin"), { recursive: true })
  await writeFile(bin, "#!/usr/bin/env node\n")
  const formal = {}
  for (const name of ["dedicated", "stressed"]) {
    formal[name] = join(root, "formal", `${name}.log`)
    formal[`${name}Metadata`] = join(root, "formal", `${name}.json`)
    await mkdir(join(root, "formal"), { recursive: true })
    await writeFile(formal[name], `${name} formal evidence\n`)
    await writeFile(formal[`${name}Metadata`], `${name} formal provenance\n`)
  }
  const output = {
    manifest: join(root, "output", "manifest.json"),
    artifact: join(root, "output", "qualification.json"),
    retained: join(root, "output", "retained-locators.json"),
    publication: join(root, "output", "publication")
  }
  await mkdir(join(root, "output"), { recursive: true })
  await mkdir(output.publication, { recursive: true })
  const lockfile = join(root, "pnpm-lock.yaml")
  const codexExecutable = join(root, "node_modules", ".bin", "codex")
  await writeFile(lockfile, "lockfileVersion: 9\n")
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true })
  await writeFile(codexExecutable, "#!/usr/bin/env node\n")
  return { codexExecutable, lockfile, root, formal, output }
}

const environmentFor = (f, overrides = {}) => ({
  DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION: "1",
  DALPH_CANDIDATE_SHA: candidateSha,
  DALPH_COVERAGE_BASE_SHA: reviewedBaseSha,
  DALPH_LIVE_QUALIFICATION_SOURCE_SHA: candidateSha,
  DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY: f.root,
  DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA: reviewedBaseSha,
  DALPH_LIVE_QUALIFICATION_BUILT_ENTRY: join(f.root, productionLiveQualificationBin),
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
  GITHUB_TOKEN: "github-secret",
  DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
  ...overrides
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
    runCommand: async (request) => {
      requests.push(request)
      return { exitCode: 0, signal: undefined }
    }
  })

  assert.equal(result.exitCode, 0)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].args, [join(f.root, productionLiveQualificationBin), "--manifest", f.output.manifest])
  assert.equal(requests[0].environment.GITHUB_TOKEN, "github-secret")
  assert.equal(requests[0].environment.DALPH_CODEX_PROVIDER_CREDENTIAL, "codex-secret")
  assert.equal(requests[0].environment.UNRELATED_SECRET, undefined)
  assert.equal(requests[0].environment.UNRELATED_TOKEN, undefined)
  assert.equal(requests[0].args.includes("github-secret"), false)
  assert.equal(requests[0].args.includes("codex-secret"), false)
})

test("does not retry after a live child failure and does not expose secret bytes in its error", async () => {
  const f = await fixture()
  const requests = []
  await assert.rejects(
    runProductionLiveQualification({
      repositoryRoot: f.root,
      environment: environmentFor(f),
      readCandidateSha: async () => candidateSha,
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
    { DALPH_LIVE_QUALIFICATION_JOB_ID: "another-job" }
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
