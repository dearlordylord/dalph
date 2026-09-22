import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import * as fc from "fast-check"

import { digest, readRecord, repositoryLocation, withoutInheritedCustody } from "./gate-custody-records.mjs"
import { createQualityGateStagePlan } from "./quality-gate-stage-plan.mjs"
import {
  aggregateHostedQualityStages,
  closedFailedTestFiles,
  hostedQualityNodeVersions,
  hostedQualityStageIds,
  selectedHostedQualityStage
} from "./hosted-quality-evidence.mjs"
import { parseHostedQualityAggregateArguments, renderHostedQualityRow } from "./aggregate-hosted-quality-stages.mjs"
import {
  deliveryRepeatabilityDefaultIterations,
  deliveryRepeatabilityExpectedAcceptedOrderDigest,
  deliveryRepeatabilityExpectedOccurrenceCount
} from "./run-delivery-repeatability.mjs"

const candidateSha = "b".repeat(40)
const baseSha = "a".repeat(40)
const binding = { candidateSha, baseSha, runId: "901", runAttempt: "2" }
const nodeVersion = hostedQualityNodeVersions[0]
const tool = { pnpmSha256: "c".repeat(64) }
const plan = createQualityGateStagePlan({
  baseSha,
  candidateSha,
  nodeExecutable: "node",
  nodeVersions: hostedQualityNodeVersions,
  pnpmEntryPoint: "pnpm"
})

void test("projects only closed repository-relative Vitest failure paths", () => {
  const firstCharacter = fc.constantFrom(...Array.from("abcdefghijklmnopqrstuvwxyz0123456789"))
  const remainingCharacter = fc.constantFrom(...Array.from("abcdefghijklmnopqrstuvwxyz0123456789._-"))
  const segment = fc
    .tuple(firstCharacter, fc.array(remainingCharacter, { maxLength: 19 }))
    .map(([first, remaining]) => `${first}${remaining.join("")}`)
  const testPath = fc
    .tuple(fc.constantFrom("packages", "scripts", "src", "test"), fc.array(segment, { minLength: 1, maxLength: 4 }))
    .map(([root, segments]) => `${root}/${segments.join("/")}.test.ts`)

  fc.assert(
    fc.property(testPath, (path) => {
      const log = `\u001b[31m FAIL \u001b[39m ${path} > controlled failure\n ❯ ${path}:12:3\n`
      assert.deepEqual(closedFailedTestFiles(log, new Set([path])), [path])
    }),
    { numRuns: 100 }
  )
  fc.assert(
    fc.property(segment, (value) => {
      assert.deepEqual(closedFailedTestFiles(`FAIL /tmp/${value}.test.ts > private\n`, new Set()), [])
      const traversal = `packages/../${value}.test.ts`
      assert.deepEqual(closedFailedTestFiles(`FAIL ${traversal} > traversal\n`, new Set([traversal])), [])
    }),
    { numRuns: 100 }
  )
  assert.deepEqual(
    closedFailedTestFiles(
      "FAIL  packages/dalph/src/one.test.ts > first\nFAIL  scripts/two.test.mjs > second\n",
      new Set(["packages/dalph/src/one.test.ts", "scripts/two.test.mjs"])
    ),
    ["packages/dalph/src/one.test.ts", "scripts/two.test.mjs"]
  )
})

const seal = (payload) => ({ ...payload, envelopeSha256: digest(JSON.stringify(payload)) })
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-hosted-quality-evidence-"))
  const reports = hostedQualityStageIds.map((stageId) => {
    const directory = join(root, stageId)
    mkdirSync(directory, { recursive: true })
    const log =
      stageId === "delivery-repeatability"
        ? Array.from(
            { length: deliveryRepeatabilityDefaultIterations },
            (_value, index) =>
              `delivery repeatability fresh iteration ${index + 1}/${deliveryRepeatabilityDefaultIterations} PASS ` +
              `elapsedMs=1 occurrenceCount=${deliveryRepeatabilityExpectedOccurrenceCount} ` +
              `acceptedOrderDigest=${deliveryRepeatabilityExpectedAcceptedOrderDigest} candidateSha=${candidateSha}`
          ).join("\n") +
          `\ndelivery repeatability complete mode=fresh warmIterations=${deliveryRepeatabilityDefaultIterations} ` +
          `freshSampleIterations=0 elapsedMs=20 occurrenceCount=${deliveryRepeatabilityExpectedOccurrenceCount} ` +
          `acceptedOrderDigest=${deliveryRepeatabilityExpectedAcceptedOrderDigest} candidateSha=${candidateSha}\n`
        : `${stageId} complete\n`
    writeFileSync(join(directory, "stage.log"), log)
    const artifacts = [{ path: "stage.log", bytes: Buffer.byteLength(log), sha256: digest(Buffer.from(log)) }]
    if (stageId === "coverage") {
      mkdirSync(join(directory, "coverage"))
      for (const kind of ["final", "summary"]) {
        const bytes = Buffer.from(`{"${kind}":true}\n`)
        writeFileSync(join(directory, "coverage", `coverage-${kind}.json`), bytes)
        artifacts.push({ path: `coverage/coverage-${kind}.json`, bytes: bytes.length, sha256: digest(bytes) })
      }
    }
    const payload = {
      version: 2,
      binding,
      stageId,
      expectedStageIds: hostedQualityStageIds,
      configurationDigest: plan.configurationDigest,
      nodeVersion,
      policyDigest: plan.policyDigest,
      stageContract: (() => {
        const { identity: _identity, ...contract } = plan.stages.find((cell) => cell.stageId === stageId)
        return contract
      })(),
      stageIdentity: plan.stages.find((cell) => cell.stageId === stageId).identity,
      tool,
      outcome: "passed",
      terminal: { custody: "stopped", sourceUnchanged: true, childOutcome: "passed", exitCode: 0, signal: null },
      timing: {
        cellStartedAt: "2026-09-20T09:59:30.000Z",
        startedAt: "2026-09-20T10:00:00.000Z",
        finishedAt: "2026-09-20T10:01:00.000Z"
      },
      artifacts,
      childDiagnostics: [],
      ...(stageId === "delivery-repeatability"
        ? {
            delivery: {
              expectedIterations: deliveryRepeatabilityDefaultIterations,
              completedIterations: deliveryRepeatabilityDefaultIterations,
              summaryCount: 1,
              occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
              acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest
            }
          }
        : {})
    }
    const report = join(directory, "envelope.json")
    writeFileSync(report, `${JSON.stringify(seal(payload))}\n`)
    return report
  })
  const rewrite = (index, change) => {
    const envelope = JSON.parse(readFileSync(reports[index], "utf8"))
    delete envelope.envelopeSha256
    change(envelope)
    writeFileSync(reports[index], `${JSON.stringify(seal(envelope))}\n`)
  }
  const rewriteLog = (index, change) => {
    const logPath = join(dirname(reports[index]), "stage.log")
    const log = change(readFileSync(logPath, "utf8"))
    writeFileSync(logPath, log)
    rewrite(index, (envelope) => {
      envelope.artifacts[0] = { path: "stage.log", bytes: Buffer.byteLength(log), sha256: digest(Buffer.from(log)) }
    })
  }
  return { root, reports, rewrite, rewriteLog, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

void test("separates the portable semantic plan from the absolute owner execution manifest", () => {
  const selected = selectedHostedQualityStage({
    baseSha,
    candidateSha,
    nodeExecutable: process.execPath,
    nodeVersion,
    pnpmEntryPoint: process.execPath,
    stageId: "recorded-catalog",
    worktree: "/owner/worktree"
  })
  const planned = selected.plan.stages.find(({ stageId }) => stageId === "recorded-catalog")
  assert.deepEqual(planned?.command, {
    args: ["pnpm", "--silent", "test:recorded-catalog"],
    executable: "node",
    name: "Quality gate 'maintained recorded-catalog semantics'"
  })
  assert.equal(selected.stage.execution.executable, process.execPath)
  assert.equal(selected.stage.execution.args[0], process.execPath)
  assert.equal(selected.executionManifest[1].execution.args[0], process.execPath)
})

void test("aggregates a complete exact suffix and retains every artifact location", () => {
  const f = fixture()
  try {
    const result = aggregateHostedQualityStages({ binding, reports: [...f.reports].reverse() })
    assert.equal(result.succeeded, true)
    assert.deepEqual(
      result.rows.map(({ outcome }) => outcome),
      ["passed", "passed", "passed"]
    )
    assert.ok(result.rows[2].artifacts.some((path) => path.endsWith("/coverage/coverage-final.json")))
    assert.ok(result.rows[2].artifacts.some((path) => path.endsWith("/coverage/coverage-summary.json")))
  } finally {
    f.cleanup()
  }
})

void test("reports two independent failures and the passing stage in one fail-slow result", () => {
  const f = fixture()
  try {
    for (const index of [0, 2])
      f.rewrite(index, (envelope) => {
        envelope.outcome = "failed"
        envelope.terminal = { ...envelope.terminal, childOutcome: "exit:23", exitCode: 23 }
      })
    const result = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(result.succeeded, false)
    assert.deepEqual(
      result.rows.map(({ outcome }) => outcome),
      ["failed", "passed", "failed"]
    )
    assert.ok(result.rows.every(({ artifacts }) => artifacts.some((path) => path.endsWith("/stage.log"))))
  } finally {
    f.cleanup()
  }
})

void test("rejects missing, duplicate, malformed, changed-candidate, and mixed-tool evidence", () => {
  const cases = [
    (f) => f.reports.pop(),
    (f) => f.reports.push(f.reports[0]),
    (f) => writeFileSync(f.reports[1], "not json\n"),
    (f) => f.rewrite(0, (envelope) => (envelope.binding.candidateSha = "d".repeat(40))),
    (f) => f.rewrite(1, (envelope) => (envelope.binding.baseSha = "e".repeat(40))),
    (f) => f.rewrite(1, (envelope) => (envelope.binding.runAttempt = "3")),
    (f) => f.rewrite(1, (envelope) => (envelope.configurationDigest = "f".repeat(64))),
    (f) => f.rewrite(1, (envelope) => (envelope.nodeVersion = "99.0.0")),
    (f) =>
      f.rewrite(1, (envelope) => {
        envelope.terminal = { ...envelope.terminal, childOutcome: "exit:23", exitCode: 23 }
      }),
    (f) =>
      f.rewrite(1, (envelope) => {
        envelope.outcome = "failed"
      }),
    (f) =>
      f.rewrite(1, (envelope) => {
        envelope.outcome = "failed"
        envelope.terminal = { ...envelope.terminal, childOutcome: "timed-out", exitCode: "none", signal: "SIGKILL" }
      }),
    (f) => writeFileSync(join(dirname(f.reports[2]), "coverage", "coverage-final.json"), "changed\n"),
    (f) => writeFileSync(join(dirname(f.reports[1]), "unlisted-artifact.txt"), "unexpected\n")
  ]
  for (const mutate of cases) {
    const f = fixture()
    try {
      mutate(f)
      const result = aggregateHostedQualityStages({ binding, reports: f.reports })
      assert.equal(result.succeeded, false)
      assert.ok(result.failures.length > 0)
      assert.equal(result.rows.length, 3)
    } finally {
      f.cleanup()
    }
  }
})

void test("keeps malformed structured artifact entries unproven while reporting every row", () => {
  for (const malformed of [null, "not-an-artifact"]) {
    const f = fixture()
    try {
      f.rewrite(1, (envelope) => {
        envelope.artifacts[0] = malformed
      })
      const result = aggregateHostedQualityStages({ binding, reports: f.reports })
      assert.equal(result.succeeded, false)
      assert.deepEqual(
        result.rows.map(({ outcome }) => outcome),
        ["passed", "UNPROVEN", "passed"]
      )
      assert.equal(result.rows.length, 3)
      assert.ok(result.rows[1].failures.some((failure) => failure.includes("malformed portable artifact")))
      assert.ok(result.failures.some((failure) => failure.startsWith("recorded-catalog:")))
    } finally {
      f.cleanup()
    }
  }
})

void test("keeps directory artifact entries unproven without aborting the other rows", () => {
  for (const [index, path] of [
    [1, "."],
    [2, "coverage"]
  ]) {
    const f = fixture()
    try {
      f.rewrite(index, (envelope) => {
        envelope.artifacts[0] = { path, bytes: 0, sha256: "0".repeat(64) }
      })
      assert.doesNotThrow(() => aggregateHostedQualityStages({ binding, reports: f.reports }))
      const result = aggregateHostedQualityStages({ binding, reports: f.reports })
      assert.equal(result.succeeded, false)
      assert.equal(result.rows.length, 3)
      assert.deepEqual(
        result.rows.map(({ outcome }) => outcome),
        [0, 1, 2].map((row) => (row === index ? "UNPROVEN" : "passed"))
      )
      assert.ok(result.rows[index].failures.some((failure) => failure.includes("regular file")))
      assert.ok(
        result.rows.filter(({ outcome }) => outcome === "passed").every(({ artifacts }) => artifacts.length > 0)
      )
    } finally {
      f.cleanup()
    }
  }
})

void test("revalidates every delivery digest candidate against the hosted binding", () => {
  const f = fixture()
  try {
    const otherCandidate = "d".repeat(40)
    f.rewriteLog(0, (log) => log.replaceAll(`candidateSha=${candidateSha}`, `candidateSha=${otherCandidate}`))
    const result = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(result.succeeded, false)
    assert.deepEqual(
      result.rows.map(({ outcome }) => outcome),
      ["UNPROVEN", "passed", "passed"]
    )
    assert.ok(result.failures.some((failure) => failure.startsWith("delivery-repeatability:")))
  } finally {
    f.cleanup()
  }
})

void test("uses the checked-in command when a sealed stage contract is malformed", () => {
  const f = fixture()
  try {
    f.rewrite(1, (envelope) => {
      envelope.stageContract.command = { executable: { malformed: true }, args: { malformed: true } }
    })
    const result = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(result.succeeded, false)
    assert.equal(result.rows.length, 3)
    assert.equal(result.rows[1].outcome, "UNPROVEN")
    assert.deepEqual(
      result.rows[1].command,
      plan.stages.find((cell) => cell.nodeVersion === nodeVersion && cell.stageId === "recorded-catalog")?.command
    )
  } finally {
    f.cleanup()
  }
})

void test("renders a malformed row command without throwing", () => {
  assert.doesNotThrow(() =>
    renderHostedQualityRow({
      nodeVersion,
      stageId: "recorded-catalog",
      outcome: "UNPROVEN",
      artifacts: [],
      command: {
        executable: null,
        args: {
          join: () => {
            throw new Error("must not run")
          }
        }
      },
      failures: ["malformed stage command"]
    })
  )
})

void test("resolves every aggregate CLI report without leaking Array.map callback arguments", () => {
  const { reports, values } = parseHostedQualityAggregateArguments([
    "--base",
    baseSha,
    "--candidate",
    candidateSha,
    "--run-id",
    binding.runId,
    "--run-attempt",
    binding.runAttempt,
    "--",
    "first/envelope.json",
    "second/envelope.json"
  ])
  assert.deepEqual(reports, [resolve("first/envelope.json"), resolve("second/envelope.json")])
  assert.equal(values.get("--candidate"), candidateSha)
})

void test("accepts terminal timeout as diagnostic evidence but never as qualification success", () => {
  const f = fixture()
  try {
    f.rewrite(1, (envelope) => {
      envelope.outcome = "failed"
      envelope.terminal = { ...envelope.terminal, childOutcome: "timed-out", exitCode: null, signal: "SIGKILL" }
    })
    const result = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(result.rows[1].outcome, "failed")
    assert.equal(result.succeeded, false)
  } finally {
    f.cleanup()
  }
})

void test("requires twenty ordered delivery digests and accepts zero or one production summary", () => {
  const cases = [
    (f) => f.rewriteLog(0, (log) => log.replace(/^delivery repeatability complete.*\n/u, "")),
    (f) =>
      f.rewriteLog(
        0,
        (log) =>
          `${log}delivery repeatability complete mode=fresh occurrenceCount=${deliveryRepeatabilityExpectedOccurrenceCount} acceptedOrderDigest=${deliveryRepeatabilityExpectedAcceptedOrderDigest} candidateSha=${candidateSha}\n`
      ),
    (f) =>
      f.rewriteLog(0, (log) =>
        log.replace("delivery repeatability fresh iteration 1/20", "delivery repeatability fresh iteration 2/20")
      ),
    (f) => f.rewriteLog(0, (log) => `${log}delivery repeatability fresh iteration malformed\n`)
  ]
  const [zeroSummary, duplicateSummary, reordered, malformed] = cases
  const valid = fixture()
  try {
    zeroSummary(valid)
    assert.equal(aggregateHostedQualityStages({ binding, reports: valid.reports }).succeeded, true)
  } finally {
    valid.cleanup()
  }
  for (const mutate of [duplicateSummary, reordered, malformed]) {
    const f = fixture()
    try {
      mutate(f)
      const result = aggregateHostedQualityStages({ binding, reports: f.reports })
      assert.equal(result.succeeded, false)
      assert.equal(result.rows[0].outcome, "UNPROVEN")
      assert.ok(result.failures.some((failure) => failure.startsWith("delivery-repeatability:")))
    } finally {
      f.cleanup()
    }
  }
})

void test("includes setup time in hosted quality timing and rejects reversed cell starts", () => {
  const f = fixture()
  try {
    f.rewrite(0, (envelope) => {
      envelope.outcome = "failed"
      envelope.terminal = { ...envelope.terminal, childOutcome: "exit:23", exitCode: 23 }
      envelope.timing.cellStartedAt = "2026-09-20T09:58:00.000Z"
    })
    const result = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(result.metrics.makespanMilliseconds, 180_000)
    assert.equal(result.metrics.firstActionableFailureMilliseconds, 180_000)

    f.rewrite(1, (envelope) => {
      envelope.timing.cellStartedAt = "2026-09-20T10:01:01.000Z"
    })
    const reversed = aggregateHostedQualityStages({ binding, reports: f.reports })
    assert.equal(reversed.succeeded, false)
    assert.equal(reversed.rows[1].outcome, "UNPROVEN")
  } finally {
    f.cleanup()
  }
})

void test("the production runner exports owner-validated stopped custody from a controlled child process", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-hosted-quality-runner-"))
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git("init", "-q")
    mkdirSync(join(root, "scripts"), { recursive: true })
    writeFileSync(join(root, ".gitignore"), ".scratch/\n")
    writeFileSync(join(root, "scripts", "hosted-quality-evidence.test.mjs"), "// tracked fixture identity\n")
    git("add", ".gitignore", "scripts/hosted-quality-evidence.test.mjs")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
    const fixtureBase = git("rev-parse", "HEAD")
    writeFileSync(join(root, "candidate.txt"), "candidate\n")
    git("add", "candidate.txt")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "candidate")
    const fixtureCandidate = git("rev-parse", "HEAD")
    const pnpm = join(root, "controlled-pnpm.mjs")
    const boundedCommand = pathToFileURL(fileURLToPath(new URL("./run-bounded-command.mjs", import.meta.url))).href
    const invalidTaskLog = '"code":"InvalidTask"\nFAIL  scripts/hosted-quality-evidence.test.mjs > bounded failure\n'
    const invalidTaskSource = `process.stdout.write(${JSON.stringify(invalidTaskLog)});process.exit(23)`
    const taskMismatchSource = `process.stdout.write(${JSON.stringify('"code":"TaskMismatch"\n')})`
    const nested =
      `import { runBoundedCommand } from ${JSON.stringify(boundedCommand)}\n` +
      `await runBoundedCommand({ executable: process.execPath, args: ["-e", ${JSON.stringify(taskMismatchSource)}], name: "nested safe-code fixture", timeoutMilliseconds: 5_000 })\n`
    writeFileSync(
      pnpm,
      `import { runBoundedCommand } from ${JSON.stringify(boundedCommand)}\n` +
        `let rejected = false\n` +
        `try { await runBoundedCommand({ executable: process.execPath, args: ["-e", ${JSON.stringify(invalidTaskSource)}], name: "caught failure fixture", timeoutMilliseconds: 5_000 }) } catch (error) { if (error.quintCommandResult !== "exit:23") throw error; rejected = true }\n` +
        `await runBoundedCommand({ executable: process.execPath, args: ["--input-type=module", "-e", ${JSON.stringify(nested)}], name: "nested parent fixture", timeoutMilliseconds: 5_000 })\n` +
        `if (!rejected) process.exit(42)\n` +
        `process.stdout.write("controlled recorded catalog failure\\n")\n` +
        `process.exitCode = 1\n`
    )
    const runner = fileURLToPath(new URL("./run-hosted-quality-stage.mjs", import.meta.url))
    const output = join(root, ".scratch", "portable")
    const environment = withoutInheritedCustody(process.env)
    delete environment.DALPH_COVERAGE_BASE_SHA
    const result = spawnSync(
      process.execPath,
      [
        runner,
        "--stage",
        "recorded-catalog",
        "--base",
        fixtureBase,
        "--candidate",
        fixtureCandidate,
        "--node-version",
        process.version.replace(/^v/u, ""),
        "--run-id",
        "44",
        "--run-attempt",
        "1",
        "--output",
        output
      ],
      { cwd: root, encoding: "utf8", env: { ...environment, npm_execpath: pnpm }, timeout: 30_000 }
    )
    assert.equal(result.status, 0, result.stderr)
    const envelope = JSON.parse(readFileSync(join(output, "envelope.json"), "utf8"))
    assert.equal(envelope.outcome, "failed", `${result.stdout}\n${result.stderr}\n${JSON.stringify(envelope)}`)
    assert.equal(envelope.terminal.custody, "stopped")
    assert.equal(envelope.binding.candidateSha, fixtureCandidate)
    assert.match(readFileSync(join(output, "stage.log"), "utf8"), /controlled recorded catalog failure/u)
    assert.equal(envelope.childDiagnostics.length, 3)
    assert.deepEqual(
      envelope.childDiagnostics.map(({ parent }) => parent),
      ["stage", "stage", 1]
    )
    assert.deepEqual(
      envelope.childDiagnostics.map(({ outcome }) => outcome),
      ["exit:23", "passed", "passed"]
    )
    const expectedCommands = [
      { args: ["-e", invalidTaskSource], name: "caught failure fixture" },
      { args: ["--input-type=module", "-e", nested], name: "nested parent fixture" },
      { args: ["-e", taskMismatchSource], name: "nested safe-code fixture" }
    ].map(({ args, name }) => ({
      executable: process.execPath,
      args,
      cwd: resolve(root),
      name,
      timeoutMilliseconds: 5_000,
      acceptedExitCodes: [0],
      relayParentSignals: false,
      terminationGraceMilliseconds: 5_000,
      processGroupAbsenceTimeoutMilliseconds: 2_000
    }))
    const expectedLogs = [invalidTaskLog, '"code":"TaskMismatch"\n', '"code":"TaskMismatch"\n']
    assert.deepEqual(
      envelope.childDiagnostics.map(({ command }) => command),
      expectedCommands.map((command) => ({ acceptedExitCodes: [0], sha256: digest(JSON.stringify(command)) }))
    )
    assert.deepEqual(
      envelope.childDiagnostics.map(({ log }) => ({ bytes: log.bytes, sha256: log.sha256 })),
      expectedLogs.map((log) => ({ bytes: Buffer.byteLength(log), sha256: digest(Buffer.from(log)) }))
    )
    assert.deepEqual(
      envelope.childDiagnostics.map(({ exitCode, signal, stopped }) => ({ exitCode, signal, stopped })),
      [
        { exitCode: 23, signal: null, stopped: true },
        { exitCode: 0, signal: null, stopped: true },
        { exitCode: 0, signal: null, stopped: true }
      ]
    )
    assert.deepEqual(envelope.childDiagnostics[0].log.diagnosticCodes, ["InvalidTask"])
    assert.deepEqual(envelope.childDiagnostics[2].log.diagnosticCodes, ["TaskMismatch"])
    assert.deepEqual(envelope.childDiagnostics[0].log.failedTestFiles, ["scripts/hosted-quality-evidence.test.mjs"])
    assert.deepEqual(envelope.childDiagnostics[1].log.failedTestFiles, [])
    assert.equal(readdirSync(output).includes("child-logs"), false)
    const aggregate = aggregateHostedQualityStages({
      binding: { baseSha: fixtureBase, candidateSha: fixtureCandidate, runId: "44", runAttempt: "1" },
      reports: [join(output, "envelope.json")]
    })
    const row = aggregate.rows.find(({ stageId }) => stageId === "recorded-catalog")
    assert.equal(row?.outcome, "failed")
    assert.deepEqual(row?.failures, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("rejects malformed or contradictory descendant terminal evidence", () => {
  const valid = [
    {
      parent: "stage",
      command: { acceptedExitCodes: [0], sha256: "1".repeat(64) },
      log: { bytes: 10, diagnosticCodes: ["InvalidTask"], failedTestFiles: [], sha256: "2".repeat(64) },
      stopped: true,
      exitCode: 23,
      outcome: "exit:23",
      signal: null
    },
    {
      parent: 0,
      command: { acceptedExitCodes: [0], sha256: "3".repeat(64) },
      log: { bytes: 20, diagnosticCodes: [], failedTestFiles: [], sha256: "4".repeat(64) },
      stopped: true,
      exitCode: 0,
      outcome: "passed",
      signal: null
    }
  ]
  const mutations = [
    (children) => (children[0].outcome = "invented"),
    (children) => Object.assign(children[0], { outcome: "passed" }),
    (children) => (children[0].signal = "SIGTERM"),
    (children) => (children[1].parent = 1),
    (children) => (children[0].extra = true),
    (children) => children[0].log.diagnosticCodes.push("ProviderPayload"),
    (children) => children[0].log.failedTestFiles.push("/tmp/private.test.ts"),
    (children) => (children[0].command.sha256 = "not-a-digest"),
    (children) => (children[0].log.bytes = -1)
  ]
  const accepted = fixture()
  try {
    accepted.rewrite(1, (envelope) => (envelope.childDiagnostics = structuredClone(valid)))
    assert.equal(aggregateHostedQualityStages({ binding, reports: accepted.reports }).rows[1].outcome, "passed")
  } finally {
    accepted.cleanup()
  }
  for (const mutate of mutations) {
    const f = fixture()
    try {
      f.rewrite(1, (envelope) => {
        envelope.childDiagnostics = structuredClone(valid)
        mutate(envelope.childDiagnostics)
      })
      const result = aggregateHostedQualityStages({ binding, reports: f.reports })
      assert.equal(result.rows[1].outcome, "UNPROVEN")
      assert.ok(result.rows[1].failures.some((failure) => failure.includes("child diagnostic")))
    } finally {
      f.cleanup()
    }
  }
})

void test("relays cancellation, settles descendants, and never exports cancellation as success", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-hosted-quality-cancel-"))
  let childPid
  let controlledGroupPid
  let runnerChild
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git("init", "-q")
    writeFileSync(join(root, ".gitignore"), ".scratch/\n")
    git("add", ".gitignore")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
    const fixtureBase = git("rev-parse", "HEAD")
    writeFileSync(join(root, "candidate.txt"), "candidate\n")
    git("add", "candidate.txt")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "candidate")
    const fixtureCandidate = git("rev-parse", "HEAD")
    const pidPath = join(root, ".scratch", "descendant.pid")
    const groupPidPath = join(root, ".scratch", "controlled-pnpm.pid")
    const readyPath = join(root, ".scratch", "descendant.ready")
    const pnpm = join(root, "controlled-pnpm.mjs")
    writeFileSync(
      pnpm,
      [
        'import { spawn } from "node:child_process"',
        'import { mkdirSync, writeFileSync } from "node:fs"',
        'import { dirname } from "node:path"',
        "const pidPath = process.env.CONTROLLED_CHILD_PID_FILE",
        "const groupPidPath = process.env.CONTROLLED_GROUP_PID_FILE",
        "mkdirSync(dirname(pidPath), { recursive: true })",
        `const descendant = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(`import { writeFileSync } from "node:fs"; process.on("SIGTERM",()=>{}); writeFileSync(${JSON.stringify(readyPath)}, "ready\\n"); setInterval(()=>{},1000)`)}], { stdio: "ignore" })`,
        "writeFileSync(groupPidPath, String(process.pid))",
        "writeFileSync(pidPath, String(descendant.pid))",
        'process.on("SIGTERM", () => {})',
        "setInterval(() => {}, 1000)"
      ].join("\n")
    )
    const runner = fileURLToPath(new URL("./run-hosted-quality-stage.mjs", import.meta.url))
    const output = join(root, ".scratch", "portable")
    const environment = withoutInheritedCustody({
      ...process.env,
      CONTROLLED_CHILD_PID_FILE: pidPath,
      CONTROLLED_GROUP_PID_FILE: groupPidPath,
      npm_execpath: pnpm
    })
    delete environment.DALPH_COVERAGE_BASE_SHA
    delete environment.DALPH_HOSTED_QUALITY_CELL_STARTED_AT
    runnerChild = spawn(
      process.execPath,
      [
        runner,
        "--stage",
        "recorded-catalog",
        "--base",
        fixtureBase,
        "--candidate",
        fixtureCandidate,
        "--node-version",
        process.version.replace(/^v/u, ""),
        "--run-id",
        "45",
        "--run-attempt",
        "1",
        "--output",
        output
      ],
      { cwd: root, encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] }
    )
    let stderr = ""
    runnerChild.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const closed = new Promise((resolve) => runnerChild.once("close", (status, signal) => resolve({ signal, status })))
    for (
      let attempt = 0;
      attempt < 80 && (!existsSync(groupPidPath) || !existsSync(pidPath) || !existsSync(readyPath));
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 25))
    assert.ok(existsSync(groupPidPath), stderr)
    assert.ok(existsSync(pidPath), stderr)
    assert.ok(existsSync(readyPath), stderr)
    controlledGroupPid = Number(readFileSync(groupPidPath, "utf8"))
    assert.ok(Number.isSafeInteger(controlledGroupPid) && controlledGroupPid > 0)
    childPid = Number(readFileSync(pidPath, "utf8"))
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0)
    assert.equal(runnerChild.kill("SIGTERM"), true)
    let closeTimer
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(new Error(`cancellation did not close: ${stderr}`)), 10_000)
      })
    ]).finally(() => clearTimeout(closeTimer))
    assert.equal(result.signal, null)
    const location = repositoryLocation(root)
    const runDirectory = join(location.custodyRoot, "runs", readdirSync(join(location.custodyRoot, "runs"))[0])
    const obligations = readdirSync(join(runDirectory, "obligations")).map((name) =>
      readRecord(join(runDirectory, "obligations", name))
    )
    const admitted = obligations.find((obligation) => obligation.command.name === "admitted gate command")
    assert.equal(admitted?.command.relayedSignalGraceMilliseconds, 4_000)
    const ownedStage = obligations.find((obligation) => obligation.command.name.includes("recorded-catalog"))
    assert.ok(ownedStage)
    assert.equal(Object.hasOwn(ownedStage.command, "relayedSignalGraceMilliseconds"), false)
    const envelopePath = join(output, "envelope.json")
    if (existsSync(envelopePath)) {
      const envelope = JSON.parse(readFileSync(envelopePath, "utf8"))
      assert.equal(envelope.outcome, "failed")
      assert.notEqual(envelope.terminal.childOutcome, "passed")
      assert.equal(envelope.terminal.custody, "stopped")
    } else {
      assert.notEqual(result.status, 0, "missing terminal custody must fail the stage")
    }
    const descendantIsRunning = () => {
      try {
        const stat = readFileSync(`/proc/${childPid}/stat`, "utf8")
        const commandEnd = stat.lastIndexOf(")")
        return stat.slice(commandEnd + 2, commandEnd + 3) !== "Z"
      } catch {
        return false
      }
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!descendantIsRunning()) {
        childPid = undefined
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(childPid, undefined, `cancelled descendant remained alive; stderr=${stderr}`)
  } finally {
    if (runnerChild?.exitCode === null && runnerChild.signalCode === null) runnerChild.kill("SIGKILL")
    if (controlledGroupPid !== undefined) {
      try {
        process.kill(-controlledGroupPid, "SIGKILL")
      } catch {
        // The group may already have been reaped by the cancellation under test.
      }
    }
    if (childPid !== undefined) {
      try {
        process.kill(childPid, "SIGKILL")
      } catch {
        // The descendant may already have exited while the test was cleaning up.
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
})
