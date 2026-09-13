import assert from "node:assert/strict"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { arch, platform, tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { afterEach, test } from "node:test"
import {
  createFormalEnvironment,
  formalInputPolicyVersion,
  quintImportSources,
  startFormalInputGuard
} from "./formal-input-policy.mjs"
import { localHostIdentity } from "./gate-custody-records.mjs"
import { startInputObserver } from "./gate-input-observer.mjs"
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const fixture = () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-formal-input-"))
  cleanups.push(() => rmSync(outer, { force: true, recursive: true }))
  const root = join(outer, "repo")
  for (const directory of ["specs", "scripts", ".github/workflows", "source", ".git", "tools"])
    mkdirSync(join(root, directory), { recursive: true })
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    "specs/model.qnt",
    "scripts/runner.mjs",
    "source/app.ts",
    ".git/HEAD",
    ".git/index",
    "tools/runtime.so"
  ])
    writeFileSync(join(root, file), "original\n")
  writeFileSync(join(root, "specs/model.qnt"), "module fixture {}\n")
  const toolchain = {
    version: formalInputPolicyVersion,
    platform: platform(),
    architecture: arch(),
    roots: [join(root, "tools")],
    allowedRoots: [join(root, "tools")],
    requiredRoots: [join(root, "tools")],
    pythonExecutable: "/usr/bin/python3",
    javaUserHome: join(outer, "jvm-home"),
    versions: { fixture: "1" }
  }
  const environment = createFormalEnvironment({ PATH: process.env.PATH, HOME: outer })
  const profile = { obligations: ["one", "two"], seed: 153000, budget: 720000 }
  const guard = async (options = {}) => {
    const g = await startFormalInputGuard({
      worktree: root,
      effectiveEnvironment: environment,
      profile,
      toolchain,
      ...options
    })
    cleanups.push(() => g.close())
    return g
  }
  const identity = async () => {
    const g = await guard()
    await g.finish()
    await g.close()
    return g.identity
  }
  return { root, outer, toolchain, environment, profile, guard, identity }
}

test("retains formal reuse across unrelated edits without binding HEAD index or base", async () => {
  const f = fixture(),
    original = await f.identity()
  for (const file of ["source/app.ts", ".git/HEAD", ".git/index"]) writeFileSync(join(f.root, file), "unrelated\n")
  assert.equal((await f.identity()).inputDigest, original.inputDigest)
  assert.equal("head" in original, false)
  assert.equal("index" in original, false)
})

test("reruns after input membership content mode or link changes", async () => {
  const f = fixture(),
    original = await f.identity()
  writeFileSync(join(f.root, ".npmrc"), "new optional config\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
  const next = await f.identity()
  chmodSync(join(f.root, "specs/model.qnt"), 0o755)
  assert.notEqual((await f.identity()).inputDigest, next.inputDigest)
  const mode = await f.identity()
  symlinkSync("model.qnt", join(f.root, "specs/alias.qnt"))
  assert.notEqual((await f.identity()).inputDigest, mode.inputDigest)
  const linked = await f.identity()
  renameSync(join(f.root, "specs/model.qnt"), join(f.root, "specs/renamed.qnt"))
  rmSync(join(f.root, "specs/alias.qnt"))
  assert.notEqual((await f.identity()).inputDigest, linked.inputDigest)
})

test("invalidates changed effective tools environment profile or policy", async () => {
  const f = fixture(),
    original = await f.identity()
  writeFileSync(join(f.root, "tools/runtime.so"), "same version different bytes\n")
  assert.notEqual((await f.identity()).toolDigest, original.toolDigest)
  const tools = await f.identity()
  f.environment.TZ = ""
  assert.notEqual((await f.identity()).environmentDigest, tools.environmentDigest)
  assert.equal(JSON.stringify((await f.identity()).environmentDigests).includes(f.outer), false)
  const env = await f.identity()
  f.profile.seed++
  assert.notEqual((await f.identity()).profileDigest, env.profileDigest)
})

for (const [phase, change] of [
  [
    "execution file edit revert",
    (f) => {
      const p = join(f.root, "tools/runtime.so")
      writeFileSync(p, "changed\n")
      writeFileSync(p, "original\n")
    }
  ],
  [
    "reuse membership create delete",
    (f) => {
      const p = join(f.root, "specs/temporary.qnt")
      writeFileSync(p, "temporary\n")
      rmSync(p)
    }
  ],
  [
    "reuse link replacement",
    (f) => {
      const p = join(f.root, "specs/link.qnt")
      symlinkSync("model.qnt", p)
      rmSync(p)
    }
  ]
])
  test(`rejects edit and revert at qualification: ${String(phase)}`, async () => {
    const f = fixture(),
      guard = await f.guard()
    change(f)
    await assert.rejects(guard.assertUnchanged(), /dirty|error/u)
    await assert.rejects(guard.finish(), /dirty|error/u)
  })

test("refuses unidentifiable current inputs: undeclared target and cycle", async () => {
  const f = fixture()
  writeFileSync(join(f.outer, "external.qnt"), "external\n")
  symlinkSync(join(f.outer, "external.qnt"), join(f.root, "specs/external.qnt"))
  await assert.rejects(f.guard(), /Undeclared external/u)
  rmSync(join(f.root, "specs/external.qnt"))
  symlinkSync(".", join(f.root, "specs/cycle"))
  await assert.rejects(f.guard(), /Cyclic/u)
})

test("shared dependencies are visited without admitting a filesystem cycle", async () => {
  const f = fixture()
  symlinkSync("runtime.so", join(f.root, "tools/one"))
  symlinkSync("runtime.so", join(f.root, "tools/two"))
  const identity = await f.identity()
  assert.equal(identity.toolManifest.filter((entry) => entry.type === "file").length, 1)
})

test("unsupported prerequisites never yield verified success", async () => {
  const f = fixture()
  await assert.rejects(f.guard({ toolchain: { ...f.toolchain, platform: "unsupported" } }), /Unsupported/u)
  await assert.rejects(f.guard({ setupTimeoutMilliseconds: Infinity }), /finite/u)
  await assert.rejects(f.guard({ setupTimeoutMilliseconds: 1 }), /deadline|aborted|timeout/u)
  rmSync(join(f.root, "pnpm-lock.yaml"))
  await assert.rejects(f.guard(), /missing required/u)
})

test("sanitizes ambient and lifecycle values and rejects loading overrides", () => {
  const env = createFormalEnvironment({
    PATH: "/bin",
    npm_execpath: "/pnpm.cjs",
    npm_lifecycle_event: "check:quint",
    SECRET: "private",
    DALPH_GATE_RUN_ID: "transient",
    TZ: ""
  })
  assert.deepEqual(env, { PATH: "/bin", TZ: "", npm_execpath: "/pnpm.cjs" })
  for (const value of [
    { LD_PRELOAD: "/outside.so" },
    { NODE_OPTIONS: "--require /outside.js" },
    { JAVA_TOOL_OPTIONS: "-javaagent:/outside.jar" },
    { TZ: ":/outside" }
  ])
    assert.throws(() => createFormalEnvironment(value), /Unsupported/u)
})

test("fails closed on lost observation and supports bounded abort", async () => {
  const f = fixture(),
    controller = new AbortController()
  const observer = await startInputObserver({
    roots: [join(f.root, "tools")],
    signal: controller.signal,
    timeoutMilliseconds: 1000
  })
  controller.abort()
  await assert.rejects(observer.assertUnchanged(), /closed|aborted/u)
  await observer.close()
  const g = await f.guard()
  // Removing a watched tree loses coverage even if equivalent bytes are rebuilt.
  renameSync(join(f.root, "tools"), join(f.root, "old-tools"))
  mkdirSync(join(f.root, "tools"))
  writeFileSync(join(f.root, "tools/runtime.so"), readFileSync(join(f.root, "old-tools/runtime.so")))
  await assert.rejects(g.finish(), /dirty|error/u)
})

test("watch removal reports the exact lost input path and refuses qualification", async () => {
  const f = fixture()
  const path = join(f.root, "tools/runtime.so")
  const observer = await startInputObserver({ roots: [path] })
  try {
    await observer.pause()
    rmSync(path)
    await assert.rejects(
      observer.assertUnchanged(),
      (error) => error.message.includes("unexpected watch removal or unmount") && error.message.includes(path)
    )
  } finally {
    await observer.close()
  }
})

test("rejects a Quint import outside the conservative formal boundary", async () => {
  const f = fixture()
  writeFileSync(join(f.outer, "external.qnt"), "module external {}\n")
  writeFileSync(join(f.root, "specs/model.qnt"), 'module fixture { import external.* from "../../external" }\n')
  await assert.rejects(f.guard(), /Undeclared Quint import/u)
})

test("unreadable current inputs refuse qualification without a hash fallback", async () => {
  const f = fixture()
  chmodSync(join(f.root, "tools/runtime.so"), 0o000)
  await assert.rejects(f.guard(), /EACCES|permission|Errno 13/u)
})

for (const [name, source] of [
  ["multiline source declaration", 'module fixture { import helper.*\n from "../../external/helper" }'],
  ["comment-like quoted source", 'module fixture { import helper.* from "../../external//helper" }'],
  ["escaped quoted source", String.raw`module fixture { import helper.* from "../../external\\helper" }`],
  ["module instance source", 'module fixture { import helper(N = 1) as H\n from "../../external/helper" }']
])
  test(`parser rejects external imports: ${name}`, async () => {
    const f = fixture()
    writeFileSync(join(f.root, "specs/model.qnt"), source)
    await assert.rejects(f.guard(), /Undeclared Quint import/u)
  })

test("parser respects comments and quoted strings without manufacturing source imports", async () => {
  const f = fixture()
  writeFileSync(
    join(f.root, "specs/model.qnt"),
    String.raw`module fixture {
    // import helper.* from "../../external/helper"
    /* import helper.*
       from "../../external/helper" */
    val text = "import helper.* from ../../external//helper"
    val slash = "// not a comment"
  }`
  )
  const g = await f.guard()
  assert.equal((await g.finish()).unchanged, true)
})

test("parser validates an observed multiline local import using checker locator semantics", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "specs/helper.qnt"), "module helper {}\n")
  writeFileSync(
    join(f.root, "specs/model.qnt"),
    'module fixture { import helper.*\n /* comment between clauses */ from "./helper" }'
  )
  const g = await f.guard()
  assert.equal((await g.finish()).unchanged, true)
})

for (const location of ["worktree", "ancestor", "JVM user.home"])
  test(`refuses implicit Apalache configuration at ${location}`, async () => {
    const f = fixture()
    const path =
      location === "worktree"
        ? join(f.root, ".apalache.cfg")
        : location === "ancestor"
          ? join(f.outer, ".apalache.cfg")
          : join(f.toolchain.javaUserHome, ".tlaplus/apalache.cfg")
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, 'malformed { includes = "external unsupported configuration"')
    await assert.rejects(f.guard(), /Unsupported existing Apalache configuration/u)
  })

test("observes absence of implicit Apalache configurations and rejects ordinary create revert", async () => {
  const f = fixture(),
    g = await f.guard()
  const path = join(f.root, ".apalache.cfg")
  assert.equal(
    g.identity.toolManifest.some((entry) => entry.path === path && entry.type === "absent"),
    true
  )
  writeFileSync(path, "temporary malformed config")
  rmSync(path)
  await assert.rejects(g.finish(), /dirty|error/u)
})

test("JVM configuration paths bind actual identified home instead of caller HOME", async () => {
  const f = fixture()
  mkdirSync(join(f.environment.HOME, ".tlaplus"), { recursive: true })
  writeFileSync(join(f.environment.HOME, ".tlaplus/apalache.cfg"), "unrelated caller HOME configuration")
  const g = await f.guard()
  const actual = join(f.toolchain.javaUserHome, ".tlaplus/apalache.cfg")
  assert.equal(
    g.identity.toolManifest.some((entry) => entry.path === actual && entry.type === "absent"),
    true
  )
  mkdirSync(join(actual, ".."), { recursive: true })
  writeFileSync(actual, "new config after initial qualification")
  await assert.rejects(g.finish(), /dirty|error/u)
})

test("rejects edit and revert before initial hashing returns any formal identity", async () => {
  const f = fixture()
  let observed = false
  let returnedIdentity = false
  let closed = false
  const startObserver = async (options) => {
    const observer = await startInputObserver(options)
    observed = true
    // The real helper has installed watches and drained readiness before this write boundary.
    const path = join(f.root, "specs/model.qnt")
    const original = readFileSync(path)
    writeFileSync(path, "module edited {}\n")
    writeFileSync(path, original)
    return {
      ...observer,
      close: async () => {
        await observer.close()
        closed = true
      }
    }
  }
  await assert.rejects(async () => {
    await f.guard({ startObserver })
    returnedIdentity = true
  }, /dirty|error/u)
  assert.equal(observed, true)
  assert.equal(returnedIdentity, false)
  assert.equal(closed, true)
  assert.equal(readFileSync(join(f.root, "specs/model.qnt"), "utf8"), "module fixture {}\n")
})

test("uses the existing supported custody host identity without a machine-id prerequisite", async () => {
  const f = fixture(),
    g = await f.guard()
  assert.deepEqual(g.identity.host, localHostIdentity())
  assert.equal(
    g.identity.toolManifest.some((entry) => entry.path === "/etc/machine-id"),
    false
  )
  assert.equal((await g.finish()).inputDigest, g.identity.inputDigest)
  assert.deepEqual(g.identity.host, localHostIdentity())
})

test("pinned lexer source pairs contain every pinned parser import and instance source", { timeout: 10_000 }, () => {
  const require = createRequire(import.meta.url)
  const { parsePhase1fromText } = require("@informalsystems/quint/dist/src/parsing/quintParserFrontend.js")
  const { newIdGenerator } = require("@informalsystems/quint/dist/src/idGenerator.js")
  for (const text of [
    'module fixture { import helper.*\n from "../external//helper" }',
    String.raw`module fixture { import helper.* from "../external\\helper" }`,
    'module fixture { import helper(N = 1) as H\n from /* source comment */ "./helper" }',
    'module fixture { import helper.* from "./first" import helper as H from "./second" }',
    'module fixture { // import helper.* from "./hidden"\n val text = "from // ordinary string" val from = "ordinary" }'
  ]) {
    const parsed = parsePhase1fromText(newIdGenerator(), text, "differential-fixture")
    assert.deepEqual(parsed.errors, [])
    const expected = parsed.modules.flatMap((module) =>
      module.declarations
        .filter((declaration) => declaration.kind === "import" || declaration.kind === "instance")
        .map((declaration) => declaration.fromSource)
        .filter(Boolean)
    )
    const observed = quintImportSources(text, "differential-fixture")
    for (const source of expected) assert.equal(observed.includes(source), true)
    assert.deepEqual(observed, expected)
  }
})

test("pinned lexer errors cannot silently omit an unidentified source", () => {
  assert.throws(() => quintImportSources("module fixture { val text = @ }", "invalid-fixture"), /lexical input/u)
})

test(
  "final handoff validation cancels an observer drain within its caller's remaining allowance",
  { timeout: 2_000 },
  async () => {
    const f = fixture()
    let drains = 0
    let aborted = false
    const g = await f.guard({
      startObserver: async ({ signal }) => ({
        assertUnchanged: async () => {
          drains += 1
          if (drains === 1) return
          await new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true
                reject(new Error("observer drain aborted at remaining deadline"))
              },
              { once: true }
            )
          })
        },
        close: async () => {}
      })
    })
    await assert.rejects(g.finish({ timeoutMilliseconds: 25 }), /remaining deadline/u)
    assert.equal(aborted, true)
    assert.equal(drains, 2)
    await assert.rejects(g.assertUnchanged(), /remaining deadline/u)
  }
)
