import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const workflow = await readFile(
  new URL("../.github/workflows/production-live-qualification.yml", import.meta.url),
  "utf8"
)
const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

test("production live qualification is a protected manually dispatched workflow", () => {
  assert.match(workflow, /^name: Production live qualification$/mu)
  assert.match(workflow, /^  workflow_dispatch:$/mu)
  assert.doesNotMatch(workflow, /^  (?:pull_request|push):/mu)
  assert.match(workflow, /environment:\s*\n\s+name: production-live-qualification/u)
  assert.match(workflow, /group: production-live-qualification\s*\n\s+cancel-in-progress: false/u)
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+issues: write/u)
})

test("dispatch inputs and worker toolchain are exact and immutable", () => {
  for (const input of ["candidate_sha", "reviewed_base_sha", "repository"]) {
    assert.match(workflow, new RegExp(`^      ${input}:$`, "mu"))
  }
  assert.match(workflow, /candidate_sha:[\s\S]*?required: true/u)
  assert.match(workflow, /reviewed_base_sha:[\s\S]*?required: true/u)
  assert.match(workflow, /actions\/checkout@v7[\s\S]*?ref: \$\{\{ inputs\.candidate_sha \}\}/u)
  assert.match(workflow, /pnpm\/action-setup@v6[\s\S]*?version: 10\.29\.3/u)
  assert.match(workflow, /actions\/setup-node@v7[\s\S]*?node-version: 24\.20\.0/u)
  assert.match(workflow, /pnpm install --frozen-lockfile/u)
  assert.match(workflow, /pnpm build/u)
  for (const field of [
    "DALPH_LIVE_QUALIFICATION_SOURCE_SHA",
    "DALPH_LIVE_QUALIFICATION_WORKFLOW",
    "DALPH_LIVE_QUALIFICATION_RUN_ID",
    "DALPH_LIVE_QUALIFICATION_JOB_ID",
    "DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT",
    "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA",
    "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA"
  ]) {
    assert.match(workflow, new RegExp(field, "u"))
  }
})

test("formal evidence is captured in dedicated and stressed jobs before one live job", () => {
  assert.match(workflow, /^  formal-dedicated:$/mu)
  assert.match(workflow, /^  formal-stressed:$/mu)
  assert.match(workflow, /formal-dedicated[\s\S]*?pnpm check:ci:formal/u)
  assert.match(workflow, /formal-stressed[\s\S]*?pnpm check:ci:formal/u)
  assert.match(workflow, /upload-artifact@v4/u)
  assert.match(workflow, /needs:\s*\[formal-dedicated, formal-stressed\]/u)
  assert.match(workflow, /qualify:production-live/u)
})

test("provider credentials occur only on the one live command and artifacts upload on failure", () => {
  assert.equal((workflow.match(/secrets\.DALPH_LIVE_GITHUB_TOKEN/gu) ?? []).length, 1)
  assert.equal((workflow.match(/secrets\.DALPH_LIVE_CODEX_PROVIDER_CREDENTIAL/gu) ?? []).length, 1)
  assert.match(workflow, /Run one protected live qualification[\s\S]*?DALPH_LIVE_GITHUB_TOKEN/u)
  assert.match(workflow, /Run one protected live qualification[\s\S]*?DALPH_LIVE_CODEX_PROVIDER_CREDENTIAL/u)
  assert.match(workflow, /Upload redacted qualification outputs[\s\S]*?if: always\(\)/u)
  assert.doesNotMatch(workflow, /retry:/u)
  assert.doesNotMatch(workflow, /continue-on-error:/u)
  assert.doesNotMatch(ciWorkflow, /production-live|qualify:production-live/u)
})
