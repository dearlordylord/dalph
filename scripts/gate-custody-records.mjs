import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  closeSync,
  fsyncSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { hostname } from "node:os"
import { performance } from "node:perf_hooks"
import { dirname, join, resolve } from "node:path"

export const epochMilliseconds = () => performance.timeOrigin + performance.now()
export const wallClockTimestamp = () => new Date(epochMilliseconds()).toISOString()
export const custodyVersion = 1
export const custodyEnvironmentNames = ["DALPH_GATE_RUN_DIRECTORY", "DALPH_GATE_RUN_ID", "DALPH_GATE_OBLIGATION"]
export const digest = (value) => createHash("sha256").update(value).digest("hex")
export const newIdentity = () => randomUUID()
export const localHostIdentity = () => ({
  hostname: hostname(),
  bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
})
const sameHost = (host) => {
  const current = localHostIdentity()
  return host?.hostname === current.hostname && host?.bootId === current.bootId
}

export const atomicRecord = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${newIdentity()}.tmp`
  const descriptor = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, path)
  const directory = openSync(dirname(path), "r")
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
export const readRecord = (path) => {
  const value = JSON.parse(readFileSync(path, "utf8"))
  if (value === null || typeof value !== "object" || Array.isArray(value) || value.version !== custodyVersion)
    throw new Error(`Invalid custody record: ${path}`)
  return value
}
export const removeRecord = (path) => {
  unlinkSync(path)
  const descriptor = openSync(dirname(path), "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

// flock operates on the inherited open file description; the caller retains the lock on its descriptor.
export const openFileLock = (path, nonblocking = false) => {
  mkdirSync(dirname(path), { recursive: true })
  const descriptor = openSync(path, "a", 0o600)
  const result = spawnSync("flock", ["-x", ...(nonblocking ? ["-n"] : []), "3"], {
    stdio: ["ignore", "ignore", "pipe", descriptor]
  })
  if (result.error !== undefined || (result.status !== 0 && !(nonblocking && result.status === 1))) {
    closeSync(descriptor)
    throw new Error(`Cannot acquire flock ${path}: ${result.error?.message ?? result.stderr?.toString()}`)
  }
  if (result.status === 1) {
    closeSync(descriptor)
    return undefined
  }
  return () => closeSync(descriptor)
}
// Only the acquiring shell and its custody owner share this descriptor; tool descendants do not need it.
export const requireWorktreeLock = (path) => {
  let held
  let expected
  try {
    held = fstatSync(8)
    expected = statSync(path)
  } catch {
    throw new Error("Fresh custody requires the acquiring shell's exact worktree lock")
  }
  if (held.dev !== expected.dev || held.ino !== expected.ino)
    throw new Error("Fresh custody requires the acquiring shell's exact worktree lock")
  const result = spawnSync("flock", ["-x", "-n", "3"], { stdio: ["ignore", "ignore", "pipe", 8] })
  if (result.error !== undefined || result.status !== 0)
    throw new Error("Cannot prove the fresh custody owner's worktree lock")
}
export const withFileLock = (path, use) => {
  const release = openFileLock(path)
  try {
    return use()
  } finally {
    release()
  }
}

export const repositoryLocation = (cwd = process.cwd()) => {
  if (process.platform !== "linux") throw new Error("Gate custody requires local Linux, Git and flock")
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" })
    if (result.error !== undefined || result.status !== 0)
      throw new Error(`Gate custody requires a readable Git worktree: ${cwd}`)
    return realpathSync(result.stdout.trim())
  }
  const worktree = git(["rev-parse", "--show-toplevel"])
  const commonDirectory = git(["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const custodyRoot = join(commonDirectory, "dalph-gates")
  const worktreeKey = digest(worktree)
  return {
    commonDirectory,
    custodyRoot,
    worktree,
    worktreeFence: join(custodyRoot, `worktree-${worktreeKey}.fence.json`),
    worktreeLock: join(custodyRoot, `worktree-${worktreeKey}.lock`)
  }
}
export const validateRun = (runDirectory, expectedRunId) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(expectedRunId ?? ""))
    throw new Error("Invalid gate run ID")
  const run = readRecord(join(runDirectory, "run.json"))
  if (
    typeof run.runId !== "string" ||
    run.runId !== expectedRunId ||
    resolve(runDirectory) !== join(run.custodyRoot, "runs", run.runId) ||
    !sameHost(run.host)
  )
    throw new Error("Gate run identity or local host does not match")
  if (
    typeof run.worktree !== "string" ||
    typeof run.reportDirectory !== "string" ||
    !Number.isSafeInteger(run.slot) ||
    run.slot < 1
  )
    throw new Error("Invalid gate run location")
  const location = repositoryLocation(run.worktree)
  if (
    ["worktree", "commonDirectory", "custodyRoot", "worktreeFence", "worktreeLock"].some(
      (name) => run[name] !== location[name]
    ) ||
    run.slotLock !== join(run.commonDirectory, `dalph-gate-slot-${run.slot}.lock`) ||
    run.slotFence !== join(run.commonDirectory, `dalph-gate-slot-${run.slot}.fence.json`) ||
    run.reportDirectory !== join(run.worktree, ".scratch", "quality-gates", run.runId)
  )
    throw new Error("Gate run worktree or lock association does not match")
  return run
}
export const registrationLockPath = (runDirectory) => join(runDirectory, "registration.lock")

export const inheritedCustody = (environment = process.env) => {
  const supplied = custodyEnvironmentNames.filter((name) => environment[name] !== undefined)
  if (supplied.length === 0) return undefined
  if (supplied.length !== custodyEnvironmentNames.length) throw new Error("Incomplete inherited gate custody identity")
  const runDirectory = environment.DALPH_GATE_RUN_DIRECTORY
  const run = validateRun(runDirectory, environment.DALPH_GATE_RUN_ID)
  const parentId = environment.DALPH_GATE_OBLIGATION
  if (parentId !== "root") {
    if (!/^[0-9a-f-]{36}$/u.test(parentId)) throw new Error("Invalid parent obligation ID")
    // The spawning observer holds this lock through observed publication. An early
    // child waits for that publication, or still refuses intent after observer death.
    withFileLock(registrationLockPath(runDirectory), () => {
      const parent = readRecord(join(runDirectory, "obligations", `${parentId}.json`))
      if (parent.runId !== run.runId || parent.obligationId !== parentId || parent.state !== "observed")
        throw new Error("Invalid inherited parent obligation")
    })
  }
  return { parentId, run, runDirectory }
}
export const withoutInheritedCustody = (environment) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !custodyEnvironmentNames.includes(name) && name !== "DALPH_GATE_SLOT" && name !== "DALPH_COVERAGE_DIRECTORY"
    )
  )
