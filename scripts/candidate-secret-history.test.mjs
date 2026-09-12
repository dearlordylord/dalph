import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fullQualityGateManifest, preflightQualityGates } from "./quality-gate-stage-policy.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const fixture = () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-secret-history-"))
  const root = join(outer, "repo")
  mkdirSync(root)
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "candidate")
  git("config", "user.name", "History Fixture")
  git("config", "user.email", "history@example.invalid")
  writeFileSync(join(root, "source.txt"), "clean\n")
  git("add", ".")
  git("commit", "-qm", "base")
  const baseSha = git("rev-parse", "HEAD")
  const config = join(outer, "gitleaks.toml")
  writeFileSync(
    config,
    `title = "Private history control"\n[[rules]]\nid = "private-history-sentinel"\ndescription = "Innocuous fixture sentinel"\nregex = '''DALPH_TEST_SENTINEL_[A-Z0-9]{10}'''\n`
  )
  return { root, config, git, baseSha, cleanup: () => rmSync(outer, { recursive: true, force: true }) }
}
const secretStage = (baseSha, headSha) =>
  fullQualityGateManifest(baseSha, headSha === undefined ? undefined : { candidateHeadSha: headSha }).find(
    (stage) => stage.id === "secrets"
  )
const scan = (f, stage) =>
  runBoundedCommand({
    executable: "gitleaks",
    args: ["git", "--redact", "--no-banner", "--config", f.config, ...stage.args.slice(1)],
    cwd: f.root,
    name: "actual private candidate-history secret scan",
    timeoutMilliseconds: 10_000,
    acceptedExitCodes: [0, 1]
  })

test("candidate secret history uses exact canonical HEAD while broad inventories retain defaults", () => {
  const headSha = "a".repeat(40)
  assert.deepEqual(secretStage("b".repeat(40), headSha).args, [
    "check:secrets",
    `--log-opts=--full-history --diff-filter=tuxdb ${headSha} --`
  ])
  const materialized = fullQualityGateManifest("b".repeat(40), {
    candidateHeadSha: headSha,
    nodeExecutable: process.execPath,
    pnpmEntryPoint: "/tool/pnpm.cjs",
    worktree: "/candidate"
  }).find((stage) => stage.id === "secrets")
  assert.deepEqual(materialized.execution.args, [
    "/tool/pnpm.cjs",
    "--silent",
    "check:secrets",
    `--log-opts=--full-history --diff-filter=tuxdb ${headSha} --`
  ])
  assert.deepEqual(secretStage("b".repeat(40)).args, ["check:secrets"])
  assert.deepEqual(preflightQualityGates("b".repeat(40)).find((stage) => stage.args[0] === "check:secrets").args, [
    "check:secrets"
  ])
  for (const invalid of ["HEAD", "a".repeat(39), "A".repeat(40), `${headSha} --all`])
    assert.throws(() => secretStage("b".repeat(40), invalid), /canonical HEAD SHA/u)
})

test("actual candidate scan still detects a removed ancestor sentinel", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.root, "source.txt"), "DALPH_TEST_SENTINEL_0123456789\n")
    f.git("add", ".")
    f.git("commit", "-qm", "ancestor sentinel")
    writeFileSync(join(f.root, "source.txt"), "clean again\n")
    f.git("add", ".")
    f.git("commit", "-qm", "remove sentinel")
    const result = await scan(f, secretStage(f.baseSha, f.git("rev-parse", "HEAD")))
    assert.equal(result.exitCode, 1, result.output)
  } finally {
    f.cleanup()
  }
})

test("actual candidate scan omits unrelated branch history while default scan still detects it", async () => {
  const f = fixture()
  try {
    f.git("checkout", "-qb", "unrelated")
    writeFileSync(join(f.root, "source.txt"), "DALPH_TEST_SENTINEL_ABCDEFGHIJ\n")
    f.git("add", ".")
    f.git("commit", "-qm", "unrelated sentinel")
    f.git("checkout", "-q", "candidate")
    const candidate = await scan(f, secretStage(f.baseSha, f.git("rev-parse", "HEAD")))
    assert.equal(candidate.exitCode, 0, candidate.output)
    const broad = await scan(f, secretStage(f.baseSha))
    assert.equal(broad.exitCode, 1, broad.output)
  } finally {
    f.cleanup()
  }
})
