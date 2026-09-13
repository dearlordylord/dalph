import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { test } from "node:test"

import { createQuintEffectiveProfile, assertQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { runQuintEffectiveProfile } from "./check-quint-models.mjs"
import { quintGateExpectedCommandCounts } from "./quint-gate-command-contract.mjs"

const capturedOutput = (command) => {
  const lines = command.verdict.witnesses.map(
    (witness) => `${witness} was witnessed in 1 trace(s) out of 1 explored (100.00%)`
  )
  if (command.verdict.collectedReplacementTest) {
    lines.push("ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)")
  }
  if (command.verdict.temporal === "clean") lines.push("[ok] No violation found")
  if (command.verdict.temporal === "violation") lines.push("[violation] Found an issue")
  return `${lines.join("\n")}\n`
}
const provenance = {
  architecture: "fixture",
  bytes: 1,
  evaluatorPath: "/identified/evaluator",
  evaluatorVersion: "fixture",
  platform: "fixture",
  quintPackageVersion: "fixture",
  sha256: "fixture"
}
const controlledRun = (profile, launches) => async (options) => {
  const command = profile.commands.find(({ name }) => name === options.name)
  assert.ok(command)
  launches.push({ position: command.position, ...options })
  return {
    exitCode: command.verdict.acceptedExitCodes[0],
    output: capturedOutput(command),
    gateObligationId: `custody-${command.position}`
  }
}
const controls = (profile, launches) => ({
  profile,
  runCommand: controlledRun(profile, launches),
  readProvenance: async () => provenance,
  assertArtifactPrepared: async () => {},
  write: () => {}
})

test("hosted and local imports launch no checker", async () => {
  const result = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    'await import("./scripts/check-quint-models.mjs"); console.log("imported")'
  ])
  assert.equal(result.stdout, "imported\n")
  assert.equal(result.stderr, "")
})

test("materializes the independent complete 105 obligations before any launch", () => {
  const profile = createQuintEffectiveProfile()
  assertQuintEffectiveProfile(profile)
  const counts = Object.fromEntries(
    ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
      kind,
      profile.commands.filter((command) => command.kind === kind).length
    ])
  )
  assert.deepEqual({ total: profile.commands.length, ...counts }, quintGateExpectedCommandCounts)
  assert.ok(Object.isFrozen(profile.commands[0].args))
  assert.deepEqual(
    profile.steps.filter((step) => step.kind === "commands").flatMap((step) => step.positions),
    Array.from({ length: 105 }, (_, index) => index)
  )
  assert.deepEqual(profile.steps[1], { kind: "commands", positions: [1, 2, 3], concurrency: 2, serializedPrefix: 1 })
  assert.deepEqual(profile.policy, {
    regressionBudgetMilliseconds: 750000,
    safetyTimeoutMilliseconds: 720000,
    terminationGraceMilliseconds: 5000,
    processGroupAbsenceTimeoutMilliseconds: 2000,
    apalacheVersion: "0.56.1"
  })
  for (const command of profile.commands.filter(({ kind }) => kind === "test")) {
    assert.deepEqual(command.args.slice(-4), ["--max-samples", "1", "--seed", String(153000 + command.position)])
  }
  assert.deepEqual(
    profile.commands
      .filter(({ kind }) => kind === "sampled-run")
      .map(({ args, position }) => [
        position,
        args[args.indexOf("--max-samples") + 1],
        args[args.indexOf("--seed") + 1]
      ]),
    [
      [3, "10000", "154003"],
      [10, "5000", "6511"],
      [14, "5000", "6513"],
      [19, "10000", "203"],
      [23, "5000", "2031"],
      [27, "5000", "2032"],
      [31, "5000", "2033"],
      [35, "5000", "2034"],
      [40, "5000", "154040"],
      [45, "10000", "154045"],
      [50, "10000", "315"],
      [54, "5000", "3151"],
      [58, "5000", "3152"],
      [63, "10000", "102"],
      [68, "10000", "154068"],
      [72, "5000", "6501"],
      [76, "5000", "6502"],
      [80, "5000", "6503"],
      [84, "5000", "6504"],
      [89, "5000", "6511"],
      [94, "10000", "270"],
      [98, "5000", "6801"],
      [103, "10000", "154103"]
    ]
  )
  for (const command of profile.commands.filter(({ kind }) => kind === "sampled-run")) {
    assert.equal(command.args.filter((arg) => arg === "--seed").length, 1)
    assert.deepEqual(command.args.slice(-2), ["--n-threads", "4"])
  }
})

test("profile omission substitution argument verdict scheduling and policy changes refuse checker launches", async () => {
  const mutations = [
    (p) => p.commands.pop(),
    (p) => {
      p.commands[0].args[1] = "specs/unregistered.qnt"
    },
    (p) => {
      p.commands[3].args[p.commands[3].args.indexOf("--seed") + 1] = "1"
    },
    (p) => {
      p.commands[3].args[p.commands[3].args.indexOf("--max-samples") + 1] = "1"
    },
    (p) => {
      p.commands[3].verdict.witnesses = []
    },
    (p) => {
      p.commands[6].verdict.temporal = "clean"
    },
    (p) => {
      p.steps[1].serializedPrefix = 0
    },
    (p) => {
      p.execution.relayParentSignals = false
    },
    (p) => {
      p.policy.safetyTimeoutMilliseconds += 1
    }
  ]
  for (const mutate of mutations) {
    const profile = structuredClone(createQuintEffectiveProfile())
    mutate(profile)
    const launches = []
    await assert.rejects(runQuintEffectiveProfile(controls(profile, launches)), /Quint/)
    assert.equal(launches.length, 0)
  }
})

test("records every actual command custody ID and required verdict output with owned routing", async () => {
  const profile = createQuintEffectiveProfile()
  const launches = []
  const environment = { QUINT_HOME: "/identified/quint", PATH: "/identified/bin" }
  const report = await runQuintEffectiveProfile({
    ...controls(profile, launches),
    compact: true,
    environment,
    serverEndpoint: "127.0.0.1:23456",
    evaluatorPath: "/identified/evaluator",
    remainingExecutionMilliseconds: () => 700000
  })
  assert.equal(launches.length, 105)
  assert.equal(report.commands.length, 105)
  assert.deepEqual(
    report.commands.map(({ obligationId }) => obligationId),
    Array.from({ length: 105 }, (_, p) => `custody-${p}`)
  )
  assert.deepEqual(report.provenance, provenance)
  assert.equal(report.timing.records.length, 105)
  for (const actual of report.commands) {
    const command = profile.commands[actual.position]
    const expectedArgs =
      command.kind === "verify" ? [...command.args, "--server-endpoint", "127.0.0.1:23456"] : command.args
    assert.deepEqual(actual.args, expectedArgs)
    assert.equal(actual.output, capturedOutput(command))
    assert.deepEqual(actual.verdict, command.verdict)
  }
  for (const launch of launches) {
    assert.equal(launch.environment, environment)
    assert.ok(launch.timeoutMilliseconds <= 700000)
    assert.equal(launch.relayParentSignals, true)
    assert.equal(launch.captureOutput, true)
    assert.equal(launch.forwardOutput, false)
  }
})

test("a bare successful exit cannot replace required witness and temporal verdict output", async () => {
  for (const failedPosition of [3, 5, 6, 68]) {
    const profile = createQuintEffectiveProfile()
    const launches = []
    const normalRun = controlledRun(profile, launches)
    let failure
    try {
      await runQuintEffectiveProfile({
        ...controls(profile, launches),
        runCommand: async (options) => {
          const result = await normalRun(options)
          if (options.name === profile.commands[failedPosition].name) return { ...result, output: "" }
          return result
        }
      })
    } catch (error) {
      failure = error
    }
    assert.ok(failure instanceof Error)
    assert.ok(failure.formalProfileReport.commands.length < 105)
    assert.ok(launches.some(({ position }) => position === failedPosition))
  }
})

test("expired shared server deadline refuses checker launch without resetting the budget", async () => {
  const profile = createQuintEffectiveProfile()
  const launches = []
  await assert.rejects(
    runQuintEffectiveProfile({
      ...controls(profile, launches),
      environment: {},
      serverEndpoint: "127.0.0.1:23456",
      evaluatorPath: "/identified/evaluator",
      remainingExecutionMilliseconds: () => 0
    }),
    /deadline before launch/
  )
  assert.equal(launches.length, 0)
})

test("owned server cancellation reaches every checker instead of allowing the remaining profile", async () => {
  const profile = createQuintEffectiveProfile()
  const launches = []
  const controller = new AbortController()
  const normalRun = controlledRun(profile, launches)
  await assert.rejects(
    runQuintEffectiveProfile({
      ...controls(profile, launches),
      signal: controller.signal,
      runCommand: async (options) => {
        if (options.signal.aborted) throw new Error("owned server stopped")
        const result = await normalRun(options)
        controller.abort(new Error("owned server stopped"))
        assert.equal(options.signal.aborted, true)
        return result
      }
    }),
    /owned server stopped/
  )
  assert.equal(launches.length, 1)
})

test("a supplied but invalid shared deadline never falls back to a fresh local budget", async () => {
  const profile = createQuintEffectiveProfile()
  for (const remaining of [undefined, NaN, Infinity, -1]) {
    const launches = []
    await assert.rejects(
      runQuintEffectiveProfile({ ...controls(profile, launches), remainingExecutionMilliseconds: () => remaining }),
      /deadline before launch/
    )
    assert.equal(launches.length, 0)
  }
})

test("a failing family checker cancels its running sibling before any later obligation starts", async () => {
  const profile = createQuintEffectiveProfile()
  const launches = []
  const normalRun = controlledRun(profile, launches)
  let siblingStarted
  const started = new Promise((resolve) => {
    siblingStarted = resolve
  })
  let sawSiblingAbort = false
  await assert.rejects(
    runQuintEffectiveProfile({
      ...controls(profile, launches),
      runCommand: async (options) => {
        if (options.name === profile.commands[2].name) {
          await started
          throw new Error("negative fixture failed")
        }
        if (options.name === profile.commands[3].name) {
          siblingStarted()
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                sawSiblingAbort = true
                reject(new Error("sibling cancelled"))
              },
              { once: true }
            )
          })
        }
        return normalRun(options)
      }
    }),
    /negative fixture failed/
  )
  assert.equal(sawSiblingAbort, true)
  assert.ok(launches.every(({ position }) => position < 4))
})

test("compact mode retains distinct failure diagnostics from every failed or cancelled family sibling", async () => {
  const profile = createQuintEffectiveProfile()
  const launches = []
  const output = []
  const normalRun = controlledRun(profile, launches)
  let siblingStarted
  const started = new Promise((resolve) => {
    siblingStarted = resolve
  })
  await assert.rejects(
    runQuintEffectiveProfile({
      ...controls(profile, launches),
      compact: true,
      write: (text) => output.push(text),
      runCommand: async (options) => {
        if (options.name === profile.commands[2].name) {
          await started
          throw Object.assign(new Error("negative failed"), { output: "NEGATIVE_FAILURE_DIAGNOSTIC\n" })
        }
        if (options.name === profile.commands[3].name) {
          siblingStarted()
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                reject(Object.assign(new Error("sibling cancelled"), { output: "SIBLING_CANCELLATION_DIAGNOSTIC\n" }))
              },
              { once: true }
            )
          })
        }
        return normalRun(options)
      }
    }),
    /negative failed/
  )
  const diagnostics = output.join("")
  assert.equal(diagnostics.split("NEGATIVE_FAILURE_DIAGNOSTIC").length - 1, 1)
  assert.equal(diagnostics.split("SIBLING_CANCELLATION_DIAGNOSTIC").length - 1, 1)
})

test("guarded local execution preserves all hosted obligations and spends the shared local deadline", async () => {
  const hosted = createQuintEffectiveProfile()
  const profile = createQuintEffectiveProfile({ purpose: "local-guarded" })
  assertQuintEffectiveProfile(profile, { purpose: "local-guarded" })
  assert.deepEqual(profile.commands, hosted.commands)
  assert.deepEqual(profile.steps, hosted.steps)
  assert.deepEqual(profile.execution, hosted.execution)
  assert.deepEqual(profile.policy, {
    ...hosted.policy,
    safetyTimeoutMilliseconds: 1800000,
    regressionBudgetMilliseconds: 1850000
  })
  assert.notEqual(JSON.stringify(profile), JSON.stringify(hosted))
  const launches = []
  let remaining = 1700000
  const report = await runQuintEffectiveProfile({
    ...controls(profile, launches),
    purpose: "local-guarded",
    remainingExecutionMilliseconds: () => {
      remaining -= 1000
      return remaining
    }
  })
  assert.equal(launches.length, 105)
  assert.deepEqual(report.profile, profile)
  assert.deepEqual(
    launches.map(({ timeoutMilliseconds }) => timeoutMilliseconds),
    Array.from({ length: 105 }, (_, position) => 1699000 - position * 1000)
  )
})

test("hosted and guarded local execution reject each other's profile and arbitrary local policy before launch", async () => {
  const hosted = createQuintEffectiveProfile()
  const local = createQuintEffectiveProfile({ purpose: "local-guarded" })
  const weakened = structuredClone(local)
  weakened.policy.safetyTimeoutMilliseconds = 3600000
  const omitted = structuredClone(local)
  omitted.commands.pop()
  for (const [purpose, profile] of [
    ["hosted", local],
    ["local-guarded", hosted],
    ["local-guarded", weakened],
    ["local-guarded", omitted]
  ]) {
    const launches = []
    await assert.rejects(runQuintEffectiveProfile({ ...controls(profile, launches), purpose }), /Quint/)
    assert.equal(launches.length, 0)
  }
  assert.throws(() => createQuintEffectiveProfile({ purpose: "arbitrary" }), /supported execution purpose/)
})
