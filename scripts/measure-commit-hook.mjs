import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { runBoundedCommand } from "./run-bounded-command.mjs"

// No commit is made in the invoking worktree. Only this newly created Git repository is mutated.
const root = process.cwd()
const output = resolve(process.argv[2] ?? ".scratch/commit-hook-timings.json")
let fixture
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
/** @type {{ stopped: boolean, parentSignal: "SIGTERM" | "SIGINT" | undefined }} */
const ownership = { stopped: true, parentSignal: undefined }
const cancellation = new AbortController()
const signalListeners = new Map()
for (const signal of ["SIGTERM", "SIGINT"]) {
  const listener = () => {
    ownership.parentSignal ??= signal
    cancellation.abort(new Error(`Timing fixture interrupted by ${signal}`))
  }
  signalListeners.set(signal, listener)
  process.on(signal, listener)
}
// Keep signal ownership until asynchronous evidence publication and exact fixture disposition finish.
const runOwnedCommand = async (command) => {
  cancellation.signal.throwIfAborted()
  ownership.stopped = false
  try {
    const result = await runBoundedCommand({ ...command, signal: cancellation.signal })
    ownership.stopped = true
    return result
  } catch (error) {
    ownership.stopped = error.stoppedWritersProven === true
    throw error
  }
}
const git = async (args, cwd = fixture) =>
  (
    await runOwnedCommand({
      executable: "git",
      args,
      cwd,
      environment,
      name: "Timing fixture Git",
      timeoutMilliseconds: 10_000,
      captureOutput: true,
      forwardOutput: false
    })
  ).output
const report = {
  version: 1,
  observedAt: new Date(performance.timeOrigin + performance.now()).toISOString(),
  candidate: undefined,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  sampleLimit: 2,
  timeoutMilliseconds: 60_000,
  samples: []
}
try {
  fixture = await mkdtemp(join(tmpdir(), "dalph-hook-timing-"))
  report.candidate = (await git(["rev-parse", "HEAD"], root)).trim()
  const paths = (await git(["ls-files", "-z"], root)).split("\0").filter(Boolean)
  for (const path of paths) {
    cancellation.signal.throwIfAborted()
    await mkdir(dirname(join(fixture, path)), { recursive: true })
    await copyFile(join(root, path), join(fixture, path))
  }
  await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir")
  await git(["init", "--quiet"])
  await git(["config", "core.hooksPath", "/dev/null"])
  await git(["add", "."])
  await git([
    "-c",
    "user.name=Timing Fixture",
    "-c",
    "user.email=timing@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Disposable timing baseline"
  ])
  report.fixtureBaselineTree = (await git(["rev-parse", "HEAD^{tree}"])).trim()
  report.instrumentationSha256 = {}
  for (const path of [".husky/pre-commit", "scripts/run-quality-lint.mjs"])
    report.instrumentationSha256[path] = createHash("sha256")
      .update(await readFile(join(fixture, path)))
      .digest("hex")
  const stagedPath = "scripts/hook-timing-fixture.ts"
  await writeFile(join(fixture, stagedPath), "export {}\n")
  await git(["add", "--", stagedPath])
  report.stagedPaths = (await git(["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean)
  if (report.stagedPaths.length !== 1 || report.stagedPaths[0] !== stagedPath)
    throw new Error("Expected exactly the owned staged file")
  report.versions = {}
  for (const { args, executable, name } of [
    { name: "pnpm", executable: "pnpm", args: ["--version"] },
    { name: "lint-staged", executable: join(root, "node_modules/.bin/lint-staged"), args: ["--version"] },
    { name: "oxlint", executable: join(root, "node_modules/.bin/oxlint"), args: ["--version"] },
    { name: "dprint", executable: join(root, "node_modules/.bin/dprint"), args: ["--version"] },
    { name: "gitleaks", executable: "gitleaks", args: ["version"] }
  ]) {
    const result = await runOwnedCommand({
      executable,
      args,
      cwd: fixture,
      environment,
      name: `${name} version`,
      timeoutMilliseconds: 10_000,
      captureOutput: true,
      forwardOutput: false
    })
    report.versions[name] = result.output.trim()
  }
  for (let index = 0; index < report.sampleLimit; index += 1) {
    const startedAt = new Date(performance.timeOrigin + performance.now()).toISOString()
    const started = performance.now()
    const sample = {
      input:
        index === 0 ? "fresh Git fixture; ambient tool/OS caches" : "same staged file and fixture; caches retained",
      startedAt,
      stopAt: new Date(Date.parse(startedAt) + report.timeoutMilliseconds).toISOString()
    }
    report.samples.push(sample)
    console.error(`Sample ${index + 1}: expected <30s; hard stop ${sample.stopAt} (then bounded descendant cleanup)`)
    try {
      const result = await runOwnedCommand({
        executable: "sh",
        args: [".husky/pre-commit"],
        cwd: fixture,
        environment: { ...environment, DALPH_HOOK_TIMINGS: "1" },
        name: "One-file commit hook",
        timeoutMilliseconds: report.timeoutMilliseconds,
        captureOutput: true,
        forwardOutput: false
      })
      ownership.stopped = true
      sample.exitCode = result.exitCode
      sample.timings = result.output
        .split("\n")
        .filter((line) => line.startsWith('{"version":1,"kind":"hook-timing"'))
        .map((line) => JSON.parse(line))
      const stages = sample.timings.map((timing) => timing.stage)
      if (["discovery", "oxlint", "dprint", "lint-staged", "gitleaks"].some((stage) => !stages.includes(stage)))
        throw new Error("Missing component timing")
      const elapsed = (stage) => sample.timings.find((timing) => timing.stage === stage).milliseconds
      sample.lintStagedOrchestrationMilliseconds =
        elapsed("lint-staged") - elapsed("discovery") - elapsed("oxlint") - elapsed("dprint")
    } catch (error) {
      ownership.stopped = error.stoppedWritersProven === true || ownership.stopped
      sample.failure = error.quintCommandResult ?? "measurement-failed"
      throw error
    } finally {
      sample.totalMilliseconds = performance.now() - started
      sample.stoppedWritersProven = ownership.stopped
    }
  }
} catch (error) {
  report.failure =
    error.quintCommandResult ?? (ownership.parentSignal === undefined ? "measurement-failed" : "interrupted")
  throw error
} finally {
  try {
    if (ownership.stopped && fixture !== undefined) await rm(fixture, { recursive: true, force: true })
    if (!ownership.stopped) console.error(`Retained fixture; stopped writers unproven: ${fixture}`)
    report.stoppedWritersProven = ownership.stopped
    report.fixtureDisposition = fixture === undefined ? "not-created" : ownership.stopped ? "removed" : "retained"
    report.interruptedBy = ownership.parentSignal
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  } finally {
    for (const [signal, listener] of signalListeners) process.removeListener(signal, listener)
    if (ownership.parentSignal !== undefined) process.kill(process.pid, ownership.parentSignal)
  }
}
