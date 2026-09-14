import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const workflow = await readFile(
  new URL("../.github/workflows/production-live-qualification.yml", import.meta.url),
  "utf8"
)
const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const qualificationResolver = await readFile(
  new URL("./run-production-live-qualification.mjs", import.meta.url),
  "utf8"
)
const dedicatedFormalJob = workflow.slice(
  workflow.indexOf("  formal-dedicated:\n"),
  workflow.indexOf("  formal-stressed:\n")
)
const stressedFormalJob = workflow.slice(workflow.indexOf("  formal-stressed:\n"), workflow.indexOf("  qualify:\n"))

const jobEnvironment = (job) => job.slice(job.indexOf("    env:\n"), job.indexOf("    steps:\n"))

test("production live qualification is a protected manually dispatched workflow", () => {
  assert.match(workflow, /^name: Production live qualification$/mu)
  assert.match(workflow, /^  workflow_dispatch:$/mu)
  assert.doesNotMatch(workflow, /^  (?:pull_request|push):/mu)
  assert.match(workflow, /environment:\s*\n\s+name: production-live-qualification/u)
  assert.match(workflow, /group: production-live-qualification\s*\n\s+cancel-in-progress: false/u)
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/u)
  assert.doesNotMatch(workflow, /issues:\s*(?:write|read)/u)
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
    "DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY",
    "DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT",
    "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA",
    "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA",
    "setupInstallSeconds",
    "negativeControls",
    "condition"
  ]) {
    assert.match(workflow, new RegExp(field, "u"))
  }
})

test("job environments do not read runner context before GitHub assigns a runner", () => {
  const qualifyJob = workflow.slice(workflow.indexOf("  qualify:\n"))
  const qualificationPaths = qualifyJob.slice(
    qualifyJob.indexOf("      - name: Prepare live qualification paths\n"),
    qualifyJob.indexOf("      - name: Checkout exact candidate\n")
  )
  for (const job of [dedicatedFormalJob, stressedFormalJob, qualifyJob]) {
    assert.doesNotMatch(jobEnvironment(job), /\$\{\{\s*runner\./u)
  }
  assert.equal((workflow.match(/evidence_dir="\$RUNNER_TEMP\/dalph-live-formal\//gu) ?? []).length, 2)
  assert.equal((workflow.match(/DALPH_FORMAL_EVIDENCE_DIR=\$evidence_dir/gu) ?? []).length, 2)
  for (const assignment of [
    "DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER=$RUNNER_TEMP/dalph-live-publication",
    "DALPH_LIVE_QUALIFICATION_MANIFEST=$RUNNER_TEMP/dalph-live-qualification/manifest.json",
    "DALPH_LIVE_QUALIFICATION_ARTIFACT=$RUNNER_TEMP/dalph-live-qualification/qualification.json",
    "DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS=$RUNNER_TEMP/dalph-live-publication/retained-locators.json",
    "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED=$RUNNER_TEMP/dalph-live-formal/dedicated/formal.log",
    "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED=$RUNNER_TEMP/dalph-live-formal/stressed/formal.log",
    "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA=$RUNNER_TEMP/dalph-live-formal/dedicated/provenance.json",
    "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA=$RUNNER_TEMP/dalph-live-formal/stressed/provenance.json"
  ]) {
    assert.ok(qualificationPaths.includes(assignment), `missing qualification path assignment: ${assignment}`)
  }
  assert.match(qualificationPaths, /\}\s*>> "\$GITHUB_ENV"/u)
})

test("formal evidence is captured in dedicated and stressed jobs before one live job", () => {
  assert.match(workflow, /^  formal-dedicated:$/mu)
  assert.match(workflow, /^  formal-stressed:$/mu)
  assert.match(dedicatedFormalJob, /pnpm check:ci:formal/u)
  assert.match(stressedFormalJob, /pnpm check:ci:formal/u)
  assert.equal((workflow.match(/pnpm check:ci:formal/gu) ?? []).length, 2)
  assert.match(dedicatedFormalJob, /DALPH_FORMAL_PROFILE_KIND: dedicated/u)
  assert.match(dedicatedFormalJob, /DALPH_FORMAL_RUNNER_LABEL: ubuntu-24\.04-arm/u)
  assert.doesNotMatch(dedicatedFormalJob, /taskset/u)
  assert.match(stressedFormalJob, /DALPH_FORMAL_PROFILE_KIND: stressed/u)
  assert.match(stressedFormalJob, /DALPH_FORMAL_STRESS_CPU_LIST: 0-1/u)
  assert.match(
    stressedFormalJob,
    /taskset --cpu-list "\$DALPH_FORMAL_STRESS_CPU_LIST" pnpm check:ci:formal 2>&1 \| tee/u
  )
  assert.match(stressedFormalJob, /test "\$host_parallelism" -gt "\$effective_parallelism"/u)
  assert.match(stressedFormalJob, /test "\$effective_parallelism" -eq 2/u)
  assert.match(workflow, /upload-artifact@v4/u)
  assert.match(workflow, /needs:\s*\[formal-dedicated, formal-stressed\]/u)
  assert.match(workflow, /Resolve current formal job provenance[\s\S]*?GITHUB_TOKEN: \$\{\{ github\.token \}\}/u)
  assert.match(workflow, /Resolve current formal job provenance[\s\S]*?--resolve-formal-jobs/u)
  assert.match(
    workflow,
    /DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS=\$RUNNER_TEMP\/dalph-live-publication\/retained-locators\.json/u
  )
  assert.match(workflow, /mkdir -p "\$RUNNER_TEMP\/dalph-live-publication"/u)
  assert.match(workflow, /qualify:production-live/u)
})

test("successful Actions jobs supply the complete duration after their final uploads", () => {
  assert.equal((workflow.match(/timeout-minutes: 16/gu) ?? []).length, 2)
  assert.doesNotMatch(dedicatedFormalJob, /completeJobSeconds|completed-ms/u)
  assert.doesNotMatch(stressedFormalJob, /completeJobSeconds|completed-ms/u)
  assert.equal((workflow.match(/const log = "formal\.log"/gu) ?? []).length, 2)
  assert.match(qualificationResolver, /Date\.parse\(job\.started_at\)/u)
  assert.match(qualificationResolver, /Date\.parse\(job\.completed_at\)/u)
  assert.match(qualificationResolver, /completeJobSeconds: \(completed - started\) \/ 1000/u)
})

test("provider credentials occur only on the one live command and artifacts upload on failure", () => {
  assert.equal((workflow.match(/secrets\.DALPH_LIVE_GITHUB_TOKEN/gu) ?? []).length, 1)
  assert.equal((workflow.match(/secrets\.DALPH_LIVE_CODEX_PROVIDER_CREDENTIAL/gu) ?? []).length, 1)
  assert.match(workflow, /Run one protected live qualification[\s\S]*?DALPH_LIVE_GITHUB_TOKEN/u)
  assert.match(workflow, /Run one protected live qualification[\s\S]*?DALPH_LIVE_CODEX_PROVIDER_CREDENTIAL/u)
  assert.doesNotMatch(workflow, /Run one protected live qualification[\s\S]*?^\s+GITHUB_TOKEN:/mu)
  assert.match(workflow, /Upload redacted qualification outputs[\s\S]*?if: always\(\)/u)
  const uploadedOutputs = workflow.slice(workflow.indexOf("      - name: Upload redacted qualification outputs\n"))
  assert.match(uploadedOutputs, /dalph-live-qualification\/qualification\.json/u)
  assert.match(uploadedOutputs, /dalph-live-publication\/retained-locators\.json/u)
  assert.doesNotMatch(uploadedOutputs, /qualification\.json\.pre-cleanup/u)
  assert.doesNotMatch(uploadedOutputs, /manifest\.json/u)
  assert.doesNotMatch(workflow, /retry:/u)
  assert.doesNotMatch(workflow, /continue-on-error:/u)
  assert.doesNotMatch(ciWorkflow, /production-live|qualify:production-live/u)
})
