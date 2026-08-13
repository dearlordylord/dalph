import assert from "node:assert/strict"
import { execFile, execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, test } from "node:test"

import { authoredTextLooksSensitive, isMutatingCommand, isPrimaryWorktree } from "./project-memory.mjs"
import { assertUpdateBranch, updateWith } from "./update-project-memory-toolkit.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const execFileAsync = promisify(execFile)
let activeFixtureRoots = []

afterEach(() => {
  for (const root of activeFixtureRoots.reverse()) {
    if (root.startsWith(`${tmpdir()}/dalph-project-memory-`)) {
      rmSync(root, { force: true, recursive: true })
    }
  }
  activeFixtureRoots = []
  delete process.env.DALPH_PROJECT_MEMORY_TEST_ROOT
  delete process.env.NODE_ENV
})

const fixture = (branch = "master", withTool = true) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-project-memory-"))
  activeFixtureRoots.push(root)
  execFileSync("git", ["init", "-q", "-b", branch], { cwd: root })
  mkdirSync(join(root, "tools"), { recursive: true })
  if (withTool) {
    symlinkSync(join(repositoryRoot, "tools", "optmem"), join(root, "tools", "optmem"), "dir")
  }
  process.env.NODE_ENV = "test"
  process.env.DALPH_PROJECT_MEMORY_TEST_ROOT = root
  return root
}

const invoke = (root, args, cwd = join(root, "tools"), environment = {}) =>
  spawnSync(process.execPath, [join(repositoryRoot, "scripts", "project-memory.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DALPH_PROJECT_MEMORY_TEST_ROOT: root, NODE_ENV: "test", ...environment }
  })

test("loads the same checked-in memory from the repository root and a nested working directory", () => {
  const fromRoot = spawnSync(process.execPath, [join(repositoryRoot, "scripts", "project-memory.mjs"), "wake"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })
  const fromNestedDirectory = spawnSync(
    process.execPath,
    [join(repositoryRoot, "scripts", "project-memory.mjs"), "wake"],
    { cwd: join(repositoryRoot, "scripts"), encoding: "utf8" }
  )

  assert.equal(fromRoot.status, 0)
  assert.equal(fromNestedDirectory.status, 0)
  assert.equal(fromRoot.stdout, fromNestedDirectory.stdout)
  assert.match(fromRoot.stdout, /Codex built-in Memories are disabled/u)
})

test("loads a temporary project memory from a nested working directory", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  assert.equal(invoke(root, ["note", "A durable project lesson."]).status, 0)

  const result = invoke(root, ["wake"])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /A durable project lesson\./u)
  assert.match(result.stdout, /You are awake\./u)
})

test("a missing submodule reports the initialization command", () => {
  const root = fixture("master", false)

  const result = invoke(root, ["wake"], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /git submodule update --init tools\/optmem/u)
})

test("master appends one note to the project store", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)

  const result = invoke(root, ["note", "Only master publishes project memory."])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Saved as #0\./u)
  assert.match(
    readFileSync(join(root, ".codex", "memory", "LOG.txt"), "utf8"),
    /Only master publishes project memory\./u
  )
})

test("parallel sessions sharing master's primary worktree append distinct positional records", async () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  const notes = Array.from({ length: 8 }, (_, index) => `Concurrent durable lesson ${index}.`)

  await Promise.all(
    notes.map((note) =>
      execFileAsync(process.execPath, [join(repositoryRoot, "scripts", "project-memory.mjs"), "note", note], {
        cwd: root,
        env: { ...process.env, DALPH_PROJECT_MEMORY_TEST_ROOT: root, NODE_ENV: "test" }
      })
    )
  )

  const log = readFileSync(join(root, ".codex", "memory", "LOG.txt"), "utf8")
  const records = log.trimEnd().split("\n")

  assert.equal(records.length, notes.length)
  assert.deepEqual(
    records.map((record) => Number(/^#(\d+)/u.exec(record)?.[1])).sort((left, right) => left - right),
    notes.map((_, index) => index)
  )
  for (const note of notes) {
    assert.match(log, new RegExp(note.replace(".", "\\."), "u"))
  }
})

test("repairs a partial record before appending a retried note", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  appendFileSync(join(root, ".codex", "memory", "LOG.txt"), "partial-record")

  const result = invoke(root, ["note", "Recovered after an interrupted append."])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Saved as #0\./u)
  assert.equal(readFileSync(join(root, ".codex", "memory", "LOG.txt")).byteLength, 320)
})

test("mutating config keeps its checked-in instruction portable", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)

  const result = invoke(root, ["config", "WAKE_LINES=60"])

  assert.equal(result.status, 0)
  assert.match(
    readFileSync(join(root, ".codex", "memory", "config"), "utf8"),
    /Edit with `pnpm memory -- config NAME=VALUE`\./u
  )
})

test("non-master worktrees can read but cannot mutate project memory", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  execFileSync("git", ["checkout", "-q", "-b", "task-memory"], { cwd: root })

  const read = invoke(root, ["wake"])
  const write = invoke(root, ["note", "This must not be appended."])

  assert.equal(read.status, 0)
  assert.equal(write.status, 1)
  assert.match(write.stderr, /serialized through master's primary worktree/u)
  assert.doesNotMatch(readFileSync(join(root, ".codex", "memory", "LOG.txt"), "utf8"), /must not be appended/u)
})

test("a second physical master worktree cannot mutate project memory", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  execFileSync("git", ["config", "user.email", "memory-test@example.invalid"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Memory Test"], { cwd: root })
  execFileSync("git", ["add", "."], { cwd: root })
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root })
  const linkedRoot = `${root}-linked`
  activeFixtureRoots.push(linkedRoot)
  execFileSync("git", ["worktree", "add", "--force", "-q", linkedRoot, "master"], { cwd: root })

  assert.equal(isPrimaryWorktree(root), true)
  assert.equal(isPrimaryWorktree(linkedRoot), false)

  const result = invoke(linkedRoot, ["note", "This must not be appended."], linkedRoot)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /serialized through master's primary worktree/u)
})

test("rewrites pending compression commands through the project wrapper", () => {
  const root = fixture()
  const environment = { HOME: root }
  assert.equal(invoke(root, ["init"], root, environment).status, 0)
  assert.equal(invoke(root, ["note", "First durable lesson."], root, environment).status, 0)

  const second = invoke(root, ["note", "Second durable lesson."], root, environment)

  assert.equal(second.status, 0)
  assert.match(second.stdout, /Run: pnpm memory -- nap 0-1 "<your line>"/u)
  assert.doesNotMatch(second.stdout, /tools\/optmem\/memo nap/u)

  const nap = invoke(root, ["nap", "0-1", "Two durable lessons were recorded."], root, environment)

  assert.equal(nap.status, 0)
  assert.equal(existsSync(join(root, ".codex", "memory", "TREE", "2")), true)
})

test("wake surfaces a required compression through the project wrapper", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)
  assert.equal(invoke(root, ["config", "WAKE_LINES=1"]).status, 0)
  assert.equal(invoke(root, ["note", "First durable lesson."]).status, 0)
  assert.equal(invoke(root, ["note", "Second durable lesson."]).status, 0)

  const wake = invoke(root, ["wake"])

  assert.equal(wake.status, 1)
  assert.match(wake.stdout, /Cannot wake/u)
  assert.match(wake.stdout, /Run: pnpm memory -- nap 0-1 "<your line>"/u)
  assert.doesNotMatch(wake.stdout, /tools\/optmem\/memo nap/u)
})

test("refuses authored memory text that resembles a credential", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)

  const note = invoke(root, ["note", "api_key=not-a-real-secret-value"])
  const nap = invoke(root, ["nap", "0-1", "token=not-a-real-secret-value"])

  assert.equal(note.status, 1)
  assert.equal(nap.status, 1)
  assert.match(note.stderr, /resembles a credential or secret/u)
  assert.match(nap.stderr, /resembles a credential or secret/u)
})

test("bulk import is disabled", () => {
  const root = fixture()
  assert.equal(invoke(root, ["init"]).status, 0)

  const result = invoke(root, ["import", "unreviewed.txt"])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Bulk import is disabled/u)
})

test("classifies mutating commands and obvious sensitive notes", () => {
  assert.equal(isMutatingCommand(["wake"]), false)
  assert.equal(isMutatingCommand(["config"]), false)
  assert.equal(isMutatingCommand(["config", "WAKE_LINES=100"]), true)
  assert.equal(isMutatingCommand(["forget", "0-1"]), true)
  assert.equal(authoredTextLooksSensitive(["note", "token=abc123"]), true)
  assert.equal(authoredTextLooksSensitive(["nap", "0-1", "secret=abc123"]), true)
  assert.equal(authoredTextLooksSensitive(["note", "Tokens are part of model context."]), false)
})

test("update command refuses a non-master worktree", () => {
  assert.throws(() => assertUpdateBranch("task-memory"), /only from the master worktree/u)
  assert.doesNotThrow(() => assertUpdateBranch("master"))
})

test("update refuses a dirty submodule", () => {
  const fakeGit = (args, cwd) => {
    if (args.join(" ") === "branch --show-current") return "master"
    if (args.join(" ") === "status --porcelain" && cwd === "/repo/tools/optmem") return " M memo"
    return ""
  }

  assert.throws(
    () => updateWith({ git: fakeGit, optMemDirectory: "/repo/tools/optmem", root: "/repo", runTests: () => true }),
    /has local changes/u
  )
})

test("update surfaces an upstream test failure", () => {
  const fakeGit = (args) => {
    if (args.join(" ") === "branch --show-current") return "master"
    if (args.join(" ") === "status --porcelain") return ""
    if (args.join(" ") === "rev-parse HEAD") return "updated-revision"
    return ""
  }

  assert.throws(
    () => updateWith({ git: fakeGit, optMemDirectory: "/repo/tools/optmem", root: "/repo", runTests: () => false }),
    /failed its upstream or local test suite/u
  )
})

test("update checks out the remote revision and runs both test suites", () => {
  const calls = []
  let revisionRead = 0
  const fakeGit = (args) => {
    calls.push(args.join(" "))
    if (args.join(" ") === "branch --show-current") return "master"
    if (args.join(" ") === "status --porcelain") return ""
    if (args.join(" ") === "rev-parse HEAD") {
      revisionRead += 1
      return revisionRead === 1 ? "before-revision" : "after-revision"
    }
    return ""
  }
  let testsRan = false

  const result = updateWith({
    git: fakeGit,
    optMemDirectory: "/repo/tools/optmem",
    root: "/repo",
    runTests: () => {
      testsRan = true
      return true
    }
  })

  assert.deepEqual(result, { after: "after-revision", before: "before-revision" })
  assert.equal(testsRan, true)
  assert.ok(calls.includes("submodule update --init tools/optmem"))
  assert.ok(calls.includes("submodule update --remote tools/optmem"))
})

test("project hook loads memory and disables built-in Codex memories", () => {
  const hook = JSON.parse(readFileSync(join(repositoryRoot, ".codex", "hooks.json"), "utf8"))
  const config = readFileSync(join(repositoryRoot, ".codex", "config.toml"), "utf8")
  const sessionStart = hook.hooks.SessionStart[0]
  const gitModules = readFileSync(join(repositoryRoot, ".gitmodules"), "utf8")

  assert.equal(sessionStart.matcher, "startup|resume|clear|compact")
  assert.match(sessionStart.hooks[0].command, /scripts\/project-memory\.mjs" wake/u)
  assert.match(config, /^memories = false$/mu)
  assert.match(config, /^generate_memories = false$/mu)
  assert.match(config, /^use_memories = false$/mu)
  assert.match(gitModules, /^\s*branch = main$/mu)
})
