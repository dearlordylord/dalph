import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import {
  atomicRecord,
  custodyVersion,
  digest,
  localHostIdentity,
  readRecord,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { closeAndDigestPreviousBootInventory, registrationLockPath } from "./gate-registration.mjs"
import { artifactEvidence } from "./gate-run-evidence.mjs"
import { createRunInputIdentity, currentSourceInputDigest } from "./gate-run-identity.mjs"
import {
  parseReconcileArguments,
  reconcileGateRun,
  reconcilePreviousBootGateRun,
  validatePreviousBootProof
} from "./reconcile-gate-run.mjs"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const uuid = () => randomUUID()
const previousBoot = () => uuid()
const command = (root, name) => ({
  executable: process.execPath,
  args: [],
  cwd: root,
  name,
  acceptedExitCodes: [0],
  timeoutMilliseconds: 1000
})
const fixture = ({ parentIds = [], registrationState = "open", states = ["no-child"] } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-previous-boot-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  writeFileSync(join(root, ".gitignore"), ".scratch/\n")
  git("add", ".gitignore")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
  mkdirSync(join(root, ".scratch"))
  const location = repositoryLocation(root)
  const runId = uuid()
  const runDirectory = join(location.custodyRoot, "runs", runId)
  const recordedBootId = previousBoot()
  const run = {
    version: custodyVersion,
    ...location,
    runId,
    reportDirectory: join(root, ".scratch", "quality-gates", runId),
    slot: 1,
    slotFence: join(location.commonDirectory, "dalph-gate-slot-1.fence.json"),
    slotLock: join(location.commonDirectory, "dalph-gate-slot-1.lock"),
    host: { hostname: localHostIdentity().hostname, bootId: recordedBootId },
    ownerPid: 1,
    commandArguments: [process.execPath, "-e", ""],
    startedAt: wallClockTimestamp()
  }
  mkdirSync(join(runDirectory, "obligations"), { recursive: true })
  atomicRecord(join(runDirectory, "run.json"), run)
  const obligations = states.map((state, index) => {
    const obligationId = uuid()
    const record = {
      version: custodyVersion,
      runId,
      obligationId,
      parentId: parentIds[index] ?? "root",
      command: command(root, `previous boot ${index}`),
      state,
      startedAt: wallClockTimestamp()
    }
    if (state === "observed") record.processGroup = 9000 + index
    atomicRecord(join(runDirectory, "obligations", `${obligationId}.json`), record)
    return record
  })
  atomicRecord(join(runDirectory, "registration.json"), {
    version: custodyVersion,
    runId,
    state: registrationState,
    obligations: obligations.map(({ obligationId }) => obligationId)
  })
  const fence = { version: custodyVersion, runId, runDirectory, worktree: run.worktree, slot: run.slot }
  atomicRecord(run.worktreeFence, fence)
  atomicRecord(run.slotFence, fence)
  return {
    root,
    run,
    runDirectory,
    recordedBootId,
    obligations,
    proofPath: join(runDirectory, "previous-boot-ended.json"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}
const linkedRepository = (worktreePath) => {
  const baseRoot = mkdtempSync(join(tmpdir(), "dalph-location-base-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: baseRoot, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  writeFileSync(join(baseRoot, ".gitignore"), ".scratch/\n")
  git("add", ".gitignore")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
  const path = worktreePath === undefined ? join(baseRoot, "recorded-worktree") : worktreePath
  git("worktree", "add", "--detach", "-q", path)
  return {
    baseRoot,
    commonDirectory: repositoryLocation(path).commonDirectory,
    path,
    remove: () => {
      if (existsSync(path)) {
        const result = spawnSync("git", ["worktree", "remove", "--force", path], { cwd: baseRoot, encoding: "utf8" })
        assert.equal(result.status, 0, result.stderr)
      }
    },
    cleanup: () => {
      if (existsSync(path)) {
        const result = spawnSync("git", ["worktree", "remove", "--force", path], { cwd: baseRoot, encoding: "utf8" })
        assert.equal(result.status, 0, result.stderr)
      }
      rmSync(baseRoot, { recursive: true, force: true })
    }
  }
}
const linkedFixture = () => {
  const repository = linkedRepository()
  const location = repositoryLocation(repository.path)
  const runId = uuid()
  const runDirectory = join(location.custodyRoot, "runs", runId)
  const recordedBootId = previousBoot()
  const run = {
    version: custodyVersion,
    ...location,
    runId,
    reportDirectory: join(repository.path, ".scratch", "quality-gates", runId),
    slot: 1,
    slotFence: join(location.commonDirectory, "dalph-gate-slot-1.fence.json"),
    slotLock: join(location.commonDirectory, "dalph-gate-slot-1.lock"),
    host: { hostname: localHostIdentity().hostname, bootId: recordedBootId },
    ownerPid: 1,
    commandArguments: [process.execPath, "-e", ""],
    startedAt: wallClockTimestamp()
  }
  mkdirSync(join(runDirectory, "obligations"), { recursive: true })
  atomicRecord(join(runDirectory, "run.json"), run)
  const obligationId = uuid()
  atomicRecord(join(runDirectory, "obligations", `${obligationId}.json`), {
    version: custodyVersion,
    runId,
    obligationId,
    parentId: "root",
    command: command(repository.path, "linked previous boot"),
    state: "no-child",
    startedAt: wallClockTimestamp()
  })
  atomicRecord(join(runDirectory, "registration.json"), {
    version: custodyVersion,
    runId,
    state: "open",
    obligations: [obligationId]
  })
  const fence = { version: custodyVersion, runId, runDirectory, worktree: run.worktree, slot: run.slot }
  atomicRecord(run.worktreeFence, fence)
  atomicRecord(run.slotFence, fence)
  return {
    ...repository,
    run,
    runDirectory,
    proofPath: join(runDirectory, "previous-boot-ended.json"),
    runPath: join(runDirectory, "run.json"),
    recordedBootId,
    cleanup: repository.cleanup
  }
}
const registration = (f) => readRecord(join(f.runDirectory, "registration.json"))
const fencesExist = (f) => [f.run.worktreeFence, f.run.slotFence].every((path) => existsSync(path))

void test("gate reconcile parser accepts only ordinary or one exact previous-boot attestation", () => {
  const runId = uuid()
  const bootId = uuid()
  assert.deepEqual(parseReconcileArguments([runId]), { runId, previousBootId: undefined })
  assert.deepEqual(parseReconcileArguments([runId, `--previous-boot=${bootId}`]), { runId, previousBootId: bootId })
  for (const arguments_ of [
    [],
    [runId, "--previous-boot"],
    [runId, undefined],
    [runId, `--previous-boot=${bootId}`, `--previous-boot=${bootId}`],
    [runId, `--previous-boot=${bootId}`, "extra"],
    [runId, "--force"],
    [runId, "--other=value"],
    [runId, `DALPH_GATE_PREVIOUS_BOOT=${bootId}`],
    [`${runId.toUpperCase()}`, `--previous-boot=${bootId}`],
    [runId, "--previous-boot=not-a-uuid"],
    [123, `--previous-boot=${bootId}`]
  ])
    assert.throws(() => parseReconcileArguments(arguments_))
  const previous = process.env.DALPH_GATE_PREVIOUS_BOOT
  process.env.DALPH_GATE_PREVIOUS_BOOT = bootId
  try {
    assert.deepEqual(parseReconcileArguments([runId]), { runId, previousBootId: undefined })
  } finally {
    if (previous === undefined) delete process.env.DALPH_GATE_PREVIOUS_BOOT
    else process.env.DALPH_GATE_PREVIOUS_BOOT = previous
  }
})

void test("previous-boot reconciliation refuses same-boot mismatched and foreign-host attestations before mutation", () => {
  const successful = fixture()
  try {
    assert.deepEqual(
      reconcilePreviousBootGateRun({
        runDirectory: successful.runDirectory,
        runId: successful.run.runId,
        previousBootId: successful.recordedBootId
      }).custody,
      "stopped"
    )
  } finally {
    successful.cleanup()
  }

  const mismatch = fixture()
  try {
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: mismatch.runDirectory,
          runId: mismatch.run.runId,
          previousBootId: uuid()
        }),
      /previous-boot identity/u
    )
    assert.equal(registration(mismatch).state, "open")
    assert.equal(fencesExist(mismatch), true)
  } finally {
    mismatch.cleanup()
  }

  const sameBoot = fixture()
  try {
    const current = localHostIdentity()
    atomicRecord(join(sameBoot.runDirectory, "run.json"), { ...sameBoot.run, host: current })
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: sameBoot.runDirectory,
          runId: sameBoot.run.runId,
          previousBootId: current.bootId
        }),
      /previous-boot identity/u
    )
    assert.equal(registration(sameBoot).state, "open")
    assert.equal(fencesExist(sameBoot), true)
  } finally {
    sameBoot.cleanup()
  }

  const foreign = fixture()
  try {
    atomicRecord(join(foreign.runDirectory, "run.json"), {
      ...foreign.run,
      host: { hostname: "foreign-host.invalid", bootId: foreign.recordedBootId }
    })
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: foreign.runDirectory,
          runId: foreign.run.runId,
          previousBootId: foreign.recordedBootId
        }),
      /previous-boot identity/u
    )
    assert.equal(registration(foreign).state, "open")
    assert.equal(fencesExist(foreign), true)
  } finally {
    foreign.cleanup()
  }

  const f = fixture()
  try {
    for (const option of [
      `--previous-boot=${f.recordedBootId.toUpperCase()}`,
      `--previous-boot=${f.recordedBootId}x`,
      "--previous-boot=not-a-uuid"
    ])
      assert.throws(() => parseReconcileArguments([f.run.runId, option]))
    assert.equal(registration(f).state, "open")
    assert.equal(fencesExist(f), true)
    assert.equal(existsSync(f.proofPath), false)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot reconciliation closes an open complete observed inventory without probing reused groups", async () => {
  const f = fixture({ states: Array.from({ length: 8 }, () => "observed") })
  try {
    const reconcileUrl = new URL("./reconcile-gate-run.mjs", import.meta.url).href
    const source = `import {reconcilePreviousBootGateRun} from ${JSON.stringify(reconcileUrl)};const originalKill=process.kill;let probed=false;process.kill=()=>{probed=true;throw Error('previous-boot reconciliation must not probe process groups')};try{const result=reconcilePreviousBootGateRun({runDirectory:${JSON.stringify(f.runDirectory)},runId:${JSON.stringify(f.run.runId)},previousBootId:${JSON.stringify(f.recordedBootId)}});if(probed||result.obligationCount!==8)process.exitCode=23}catch(error){console.error(error);process.exitCode=24}finally{process.kill=originalKill}`
    const checker = spawn(process.execPath, ["--input-type=module", "-e", source], {
      stdio: ["ignore", "pipe", "pipe"]
    })
    let checkerOutput = ""
    checker.stdout.on("data", (chunk) => (checkerOutput += chunk))
    checker.stderr.on("data", (chunk) => (checkerOutput += chunk))
    const checkerResult = await new Promise((resolve) =>
      checker.once("close", (code, signal) => resolve({ code, signal }))
    )
    assert.equal(checkerResult.code, 0, checkerOutput)
    assert.equal(registration(f).state, "closed")
    assert.equal(existsSync(join(f.runDirectory, "absence")), false)
    assert.equal(existsSync(join(f.runDirectory, "receipts")), false)
    assert.equal(existsSync(join(f.runDirectory, "terminal.json")), false)
    const second = closeAndDigestPreviousBootInventory({ runDirectory: f.runDirectory, runId: f.run.runId })
    assert.equal(second.count, 8)
    assert.equal(second.digest, readRecord(f.proofPath).inventoryDigest)
    assert.equal(fencesExist(f), false)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot reconciliation closes then refuses intent and malformed inventory without clearing fences", () => {
  const rejected = (mutate, pattern, fixtureOptions = { states: ["no-child", "observed"] }) => {
    const f = fixture(fixtureOptions)
    try {
      mutate(f)
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        pattern
      )
      assert.equal(registration(f).state, "open")
      assert.equal(fencesExist(f), true)
      assert.equal(existsSync(f.proofPath), false)
    } finally {
      f.cleanup()
    }
  }
  rejected(
    (f) => unlinkSync(join(f.runDirectory, "obligations", `${f.obligations[0].obligationId}.json`)),
    /directory does not match/u
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "obligations", `${uuid()}.json`), {
        ...f.obligations[0],
        obligationId: uuid()
      }),
    /directory does not match/u
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "registration.json"), {
        ...registration(f),
        obligations: [...registration(f).obligations, f.obligations[0].obligationId]
      }),
    /registration inventory/u
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[1].obligationId}.json`), {
        ...f.obligations[1],
        parentId: uuid()
      }),
    /parent is not registered/u
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[0].obligationId}.json`), {
        ...f.obligations[0],
        parentId: f.obligations[0].obligationId
      }),
    /parent cycle/u
  )
  rejected(
    (f) => {
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[0].obligationId}.json`), {
        ...f.obligations[0],
        parentId: f.obligations[1].obligationId
      })
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[1].obligationId}.json`), {
        ...f.obligations[1],
        parentId: f.obligations[0].obligationId
      })
    },
    /parent cycle/u,
    { states: ["no-child", "observed", "no-child"] }
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[0].obligationId}.json`), {
        ...f.obligations[0],
        state: "intent"
      }),
    /unobserved obligation/u
  )
  rejected(
    (f) =>
      atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[1].obligationId}.json`), {
        ...f.obligations[1],
        processGroup: 0
      }),
    /Invalid custody obligation variant/u
  )
})

void test("previous-boot reconciliation preserves a closed terminal run and reports maintenance qualification unproven", () => {
  const f = fixture({ registrationState: "closed", states: ["observed"] })
  try {
    const commandArguments = [process.execPath, "-e", "process.exit(0)"]
    const identity = createRunInputIdentity({ commandArguments, worktree: f.run.worktree })
    atomicRecord(join(f.runDirectory, "identity.json"), identity)
    const coverageDirectory = join(f.run.reportDirectory, "coverage")
    mkdirSync(coverageDirectory, { recursive: true })
    writeFileSync(join(coverageDirectory, "coverage-final.json"), "{}")
    writeFileSync(join(coverageDirectory, "coverage-summary.json"), "{}")
    const terminalPath = join(f.runDirectory, "terminal.json")
    atomicRecord(terminalPath, {
      version: custodyVersion,
      runId: f.run.runId,
      inputDigest: identity.inputDigest,
      commandExit: 0,
      outcome: "passed",
      custody: "stopped",
      obligationCount: 1,
      sourceUnchanged: currentSourceInputDigest(f.run.worktree) === identity.sourceInputDigest,
      finishedAt: wallClockTimestamp(),
      coverage: {
        final: artifactEvidence(join(coverageDirectory, "coverage-final.json")),
        summary: artifactEvidence(join(coverageDirectory, "coverage-summary.json"))
      }
    })
    const before = readFileSync(terminalPath)
    assert.deepEqual(
      reconcilePreviousBootGateRun({
        runDirectory: f.runDirectory,
        runId: f.run.runId,
        previousBootId: f.recordedBootId
      }),
      { runId: f.run.runId, custody: "stopped", qualification: "UNPROVEN", basis: "previous-boot", obligationCount: 1 }
    )
    assert.deepEqual(readFileSync(terminalPath), before)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot reconciliation never probes or signals a reused current-boot process group", async () => {
  const f = fixture({ states: ["no-child"] })
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" })
  try {
    const obligation = f.obligations[0]
    const observed = { ...obligation, state: "observed", processGroup: child.pid }
    atomicRecord(join(f.runDirectory, "obligations", `${obligation.obligationId}.json`), observed)
    const reconcileUrl = new URL("./reconcile-gate-run.mjs", import.meta.url).href
    const source = `import {reconcilePreviousBootGateRun} from ${JSON.stringify(reconcileUrl)};const originalKill=process.kill;let probed=false;process.kill=()=>{probed=true;throw Error('previous-boot reconciliation must not probe process groups')};try{const result=reconcilePreviousBootGateRun({runDirectory:${JSON.stringify(f.runDirectory)},runId:${JSON.stringify(f.run.runId)},previousBootId:${JSON.stringify(f.recordedBootId)}});if(probed||result.custody!=='stopped')process.exitCode=23}catch(error){console.error(error);process.exitCode=24}finally{process.kill=originalKill}`
    const checker = spawn(process.execPath, ["--input-type=module", "-e", source], {
      stdio: ["ignore", "pipe", "pipe"]
    })
    let checkerOutput = ""
    checker.stdout.on("data", (chunk) => (checkerOutput += chunk))
    checker.stderr.on("data", (chunk) => (checkerOutput += chunk))
    const checkerResult = await new Promise((resolve) =>
      checker.once("close", (code, signal) => resolve({ code, signal }))
    )
    assert.equal(checkerResult.code, 0, checkerOutput)
    assert.equal(child.exitCode, null)
  } finally {
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("close", resolve))
    f.cleanup()
  }
})

void test("previous-boot reconciliation requires the exact recreated worktree and Git common directory", () => {
  const historical = linkedFixture()
  const historicalRunBytes = readFileSync(historical.runPath)
  try {
    historical.remove()
    assert.equal(existsSync(historical.run.worktree), false)
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: historical.runDirectory,
          runId: historical.run.runId,
          previousBootId: historical.recordedBootId
        }),
      /Git worktree|identity|local host/u
    )
    assert.deepEqual(readFileSync(historical.runPath), historicalRunBytes)
    assert.equal(registration(historical).state, "open")
    assert.equal(fencesExist(historical), true)
    assert.equal(existsSync(historical.proofPath), false)

    const replacement = linkedRepository(historical.run.worktree)
    try {
      assert.notEqual(replacement.commonDirectory, historical.run.commonDirectory)
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            runDirectory: historical.runDirectory,
            runId: historical.run.runId,
            previousBootId: historical.recordedBootId
          }),
        /association|worktree/u
      )
      assert.deepEqual(readFileSync(historical.runPath), historicalRunBytes)
      assert.equal(registration(historical).state, "open")
      assert.equal(fencesExist(historical), true)
      assert.equal(existsSync(historical.proofPath), false)
    } finally {
      replacement.cleanup()
    }
  } finally {
    historical.cleanup()
  }

  const mutations = [
    ["worktree", (f) => join(f.root, "recreated-worktree")],
    ["commonDirectory", (f) => join(f.root, "wrong-common-directory")],
    ["custodyRoot", (f) => join(f.root, "wrong-custody")],
    ["reportDirectory", (f) => join(f.root, "wrong-report")],
    ["slot", () => 2],
    ["slotLock", (f) => join(f.root, "wrong-slot.lock")],
    ["slotFence", (f) => join(f.root, "wrong-slot.fence")],
    ["worktreeLock", (f) => join(f.root, "wrong-worktree.lock")],
    ["worktreeFence", (f) => join(f.root, "wrong-worktree.fence")]
  ]
  for (const [field, value] of mutations) {
    const f = fixture()
    try {
      atomicRecord(join(f.runDirectory, "run.json"), { ...f.run, [field]: value(f) })
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /worktree|association|Git|identity|local host/u
      )
      assert.equal(registration(f).state, "open")
      assert.equal(fencesExist(f), true)
      assert.equal(existsSync(f.proofPath), false)
    } finally {
      f.cleanup()
    }
  }
  const f = fixture()
  const foreignRoot = mkdtempSync(join(tmpdir(), "dalph-foreign-common-"))
  try {
    const result = spawnSync("git", ["init", "-q"], { cwd: foreignRoot, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const foreignCommonDirectory = repositoryLocation(foreignRoot).commonDirectory
    atomicRecord(join(f.runDirectory, "run.json"), { ...f.run, commonDirectory: foreignCommonDirectory })
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: f.runDirectory,
          runId: f.run.runId,
          previousBootId: f.recordedBootId
        }),
      /association|worktree/u
    )
    assert.equal(registration(f).state, "open")
    assert.equal(fencesExist(f), true)
  } finally {
    f.cleanup()
    rmSync(foreignRoot, { recursive: true, force: true })
  }
})

void test("previous-boot reconciliation prevalidates both exact fences before registration closure", () => {
  for (const target of ["slotFence", "worktreeFence"]) {
    for (const kind of ["missing", "malformed", "foreign"]) {
      const f = fixture()
      try {
        const path = f.run[target]
        if (kind === "missing") unlinkSync(path)
        if (kind === "malformed") writeFileSync(path, "not-json\n")
        if (kind === "foreign")
          atomicRecord(path, {
            version: custodyVersion,
            runId: uuid(),
            runDirectory: f.runDirectory,
            worktree: f.run.worktree,
            slot: f.run.slot
          })
        assert.throws(
          () =>
            reconcilePreviousBootGateRun({
              runDirectory: f.runDirectory,
              runId: f.run.runId,
              previousBootId: f.recordedBootId
            }),
          kind === "missing"
            ? /Missing previous-boot custody fence/u
            : kind === "foreign"
              ? /fence ownership/u
              : /JSON|record/u
        )
        assert.equal(registration(f).state, "open")
        assert.equal(existsSync(f.proofPath), false)
        assert.equal(existsSync(target === "slotFence" ? f.run.worktreeFence : f.run.slotFence), true)
      } finally {
        f.cleanup()
      }
    }
  }
})

void test("previous-boot reconciliation refuses corrupt inventory before mutation", () => {
  const f = fixture()
  try {
    const obligation = f.obligations[0]
    atomicRecord(join(f.runDirectory, "obligations", `${obligation.obligationId}.json`), {
      ...obligation,
      state: "intent"
    })
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: f.runDirectory,
          runId: f.run.runId,
          previousBootId: f.recordedBootId
        }),
      /unobserved obligation/u
    )
    assert.equal(registration(f).state, "open")
    assert.equal(fencesExist(f), true)
    assert.equal(existsSync(f.proofPath), false)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot reconciliation retries after registration closure before proof publication", () => {
  const f = fixture()
  try {
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          failurePhase: "inventory-closed",
          runDirectory: f.runDirectory,
          runId: f.run.runId,
          previousBootId: f.recordedBootId
        }),
      /Injected/u
    )
    assert.equal(registration(f).state, "closed")
    assert.equal(existsSync(f.proofPath), false)
    assert.equal(fencesExist(f), true)
    const result = reconcilePreviousBootGateRun({
      runDirectory: f.runDirectory,
      runId: f.run.runId,
      previousBootId: f.recordedBootId
    })
    assert.equal(result.obligationCount, 1)
    assert.equal(fencesExist(f), false)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot proof makes partial fence clearance idempotently retryable", () => {
  const f = fixture({ states: ["no-child", "observed"] })
  try {
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: f.runDirectory,
          runId: f.run.runId,
          previousBootId: f.recordedBootId,
          failurePhase: "proof-published"
        }),
      /Injected/u
    )
    assert.equal(existsSync(f.proofPath), true)
    assert.equal(fencesExist(f), true)
    const proof = readRecord(f.proofPath)
    assert.equal(proof.basis, "previous-boot")
    assert.equal(proof.custody, "stopped")
    assert.equal(proof.qualification, "UNPROVEN")
    assert.equal(proof.registrationState, "closed")
    assert.equal(proof.obligationCount, 2)
    assert.deepEqual(proof.currentHost, localHostIdentity())
    assert.notEqual(proof.currentHost.bootId, f.recordedBootId)
    assert.equal(proof.fences.slot.path, f.run.slotFence)
    assert.equal(proof.fences.worktree.path, f.run.worktreeFence)
    assert.match(proof.inventoryDigest, /^[0-9a-f]{64}$/u)
    assert.match(proof.runDigest, /^[0-9a-f]{64}$/u)
    // A later boot may have a clock earlier than the writer.  The proof accepts
    // only the canonical shape; it does not impose mutable wall-clock ordering.
    atomicRecord(f.proofPath, { ...proof, recordedAt: "2099-01-01T00:00:00.000Z" })
    const futureProof = readRecord(f.proofPath)
    assert.doesNotThrow(() =>
      validatePreviousBootProof({
        currentHost: { hostname: f.run.host.hostname, bootId: uuid() },
        inventory: closeAndDigestPreviousBootInventory({ runDirectory: f.runDirectory, runId: f.run.runId }),
        proof: futureProof,
        run: f.run,
        runDirectory: f.runDirectory,
        runSnapshot: { sha256: digest(readFileSync(join(f.runDirectory, "run.json"))) }
      })
    )
    const result = reconcilePreviousBootGateRun({
      runDirectory: f.runDirectory,
      runId: f.run.runId,
      previousBootId: f.recordedBootId
    })
    assert.deepEqual(result, {
      runId: f.run.runId,
      custody: "stopped",
      qualification: "UNPROVEN",
      basis: "previous-boot",
      obligationCount: 2
    })
    assert.equal(existsSync(f.run.slotFence), false)
    assert.equal(existsSync(f.run.worktreeFence), false)
    assert.deepEqual(
      reconcilePreviousBootGateRun({
        runDirectory: f.runDirectory,
        runId: f.run.runId,
        previousBootId: f.recordedBootId
      }),
      result
    )
    const partial = fixture()
    try {
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            failurePhase: "slot-cleared",
            runDirectory: partial.runDirectory,
            runId: partial.run.runId,
            previousBootId: partial.recordedBootId
          }),
        /Injected/u
      )
      assert.equal(existsSync(partial.run.slotFence), false)
      assert.equal(existsSync(partial.run.worktreeFence), true)
      reconcilePreviousBootGateRun({
        runDirectory: partial.runDirectory,
        runId: partial.run.runId,
        previousBootId: partial.recordedBootId
      })
      assert.equal(fencesExist(partial), false)
    } finally {
      partial.cleanup()
    }
  } finally {
    f.cleanup()
  }
})

void test("partial clear retry never recreates fences and clears the remaining worktree fence", () => {
  const f = fixture()
  try {
    assert.throws(
      () =>
        reconcilePreviousBootGateRun({
          runDirectory: f.runDirectory,
          runId: f.run.runId,
          previousBootId: f.recordedBootId,
          failurePhase: "slot-cleared"
        }),
      /Injected/u
    )
    assert.equal(existsSync(f.run.slotFence), false)
    assert.equal(existsSync(f.run.worktreeFence), true)
    reconcilePreviousBootGateRun({ runDirectory: f.runDirectory, runId: f.run.runId, previousBootId: f.recordedBootId })
    assert.equal(existsSync(f.run.slotFence), false)
    assert.equal(existsSync(f.run.worktreeFence), false)
  } finally {
    f.cleanup()
  }
})

void test("previous-boot retry fails closed on malformed or mismatched durable proof", () => {
  const mutations = [
    ["identity", (proof) => ({ ...proof, runId: uuid() })],
    ["old boot", (proof) => ({ ...proof, previousBootId: uuid() })],
    ["old host", (proof) => ({ ...proof, previousHost: { ...proof.previousHost, hostname: "foreign-host.invalid" } })],
    ["writer old boot", (proof) => ({ ...proof, currentHost: proof.previousHost })],
    [
      "writer foreign host",
      (proof) => ({ ...proof, currentHost: { hostname: "foreign-host.invalid", bootId: uuid() } })
    ],
    ["count", (proof) => ({ ...proof, obligationCount: proof.obligationCount + 1 })],
    ["run digest", (proof) => ({ ...proof, runDigest: "0".repeat(64) })],
    ["inventory digest", (proof) => ({ ...proof, inventoryDigest: "0".repeat(64) })],
    [
      "slot fence path",
      (proof) => ({
        ...proof,
        fences: { ...proof.fences, slot: { ...proof.fences.slot, path: `${proof.fences.slot.path}.new` } }
      })
    ],
    [
      "slot fence digest",
      (proof) => ({ ...proof, fences: { ...proof.fences, slot: { ...proof.fences.slot, sha256: "0".repeat(64) } } })
    ],
    [
      "worktree fence path",
      (proof) => ({
        ...proof,
        fences: { ...proof.fences, worktree: { ...proof.fences.worktree, path: `${proof.fences.worktree.path}.new` } }
      })
    ],
    [
      "worktree fence digest",
      (proof) => ({
        ...proof,
        fences: { ...proof.fences, worktree: { ...proof.fences.worktree, sha256: "0".repeat(64) } }
      })
    ],
    ["timestamp shape", (proof) => ({ ...proof, recordedAt: "not-a-canonical-timestamp" })],
    ["extra proof field", (proof) => ({ ...proof, unexpected: true })]
  ]
  for (const [label, mutate] of mutations) {
    const f = fixture()
    try {
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            failurePhase: "proof-published",
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /Injected/u,
        label
      )
      const proof = readRecord(f.proofPath)
      atomicRecord(f.proofPath, mutate(proof))
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /proof does not match|Invalid previous-boot proof|proof fence digest/u,
        label
      )
      assert.equal(fencesExist(f), true, label)
    } finally {
      f.cleanup()
    }
  }
  for (const [label, currentHost] of [
    ["retry current old boot", { hostname: "fixture", bootId: uuid() }],
    ["retry current foreign host", { hostname: "foreign-host.invalid", bootId: uuid() }]
  ]) {
    const f = fixture()
    try {
      const retryHost = label === "retry current old boot" ? { ...f.run.host } : currentHost
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            failurePhase: "proof-published",
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /Injected/u,
        label
      )
      assert.throws(
        () =>
          validatePreviousBootProof({
            currentHost: retryHost,
            inventory: closeAndDigestPreviousBootInventory({ runDirectory: f.runDirectory, runId: f.run.runId }),
            proof: readRecord(f.proofPath),
            run: f.run,
            runDirectory: f.runDirectory,
            runSnapshot: { sha256: digest(readFileSync(join(f.runDirectory, "run.json"))) }
          }),
        /proof does not match/u,
        label
      )
      assert.equal(fencesExist(f), true, label)
    } finally {
      f.cleanup()
    }
  }
})

void test("previous-boot retry never clears a fence republished for a newer run", () => {
  for (const target of ["slotFence", "worktreeFence"]) {
    const f = fixture()
    try {
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            failurePhase: "proof-published",
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /Injected/u
      )
      const foreignRunId = uuid()
      atomicRecord(f.run[target], {
        version: custodyVersion,
        runId: foreignRunId,
        runDirectory: join(f.root, "foreign-run", foreignRunId),
        worktree: f.run.worktree,
        slot: f.run.slot
      })
      assert.throws(
        () =>
          reconcilePreviousBootGateRun({
            runDirectory: f.runDirectory,
            runId: f.run.runId,
            previousBootId: f.recordedBootId
          }),
        /ownership|digest/u
      )
      assert.equal(existsSync(f.run.slotFence), true)
      assert.equal(existsSync(f.run.worktreeFence), true)
    } finally {
      f.cleanup()
    }
  }
})

void test("ordinary reconciliation retains same-boot validation and process-group absence proof", async () => {
  const old = fixture()
  try {
    assert.throws(
      () => reconcileGateRun({ runDirectory: old.runDirectory, runId: old.run.runId }),
      /identity|local host/u
    )
    assert.equal(registration(old).state, "open")
    assert.equal(fencesExist(old), true)
  } finally {
    old.cleanup()
  }

  const f = fixture({ states: ["observed"] })
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" })
  try {
    const current = localHostIdentity()
    atomicRecord(join(f.runDirectory, "run.json"), { ...f.run, host: current })
    atomicRecord(join(f.runDirectory, "obligations", `${f.obligations[0].obligationId}.json`), {
      ...f.obligations[0],
      processGroup: child.pid
    })
    assert.throws(() => reconcileGateRun({ runDirectory: f.runDirectory, runId: f.run.runId }), /not proven absent/u)
    assert.equal(registration(f).state, "closed")
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("close", resolve))
    assert.deepEqual(reconcileGateRun({ runDirectory: f.runDirectory, runId: f.run.runId }), {
      runId: f.run.runId,
      custody: "stopped",
      qualification: "UNPROVEN"
    })
    assert.equal(existsSync(f.run.slotFence), false)
    assert.equal(existsSync(f.run.worktreeFence), false)
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM")
    f.cleanup()
  }
})

void test("registration lock identity remains the dedicated previous-boot lock boundary", () => {
  const f = fixture()
  try {
    assert.equal(registrationLockPath(f.runDirectory), join(f.runDirectory, "registration.lock"))
  } finally {
    f.cleanup()
  }
})
