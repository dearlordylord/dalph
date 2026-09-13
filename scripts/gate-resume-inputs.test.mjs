import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  cpSync,
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, test } from "node:test"
import { startInputGuard } from "./gate-resume-inputs.mjs"
import { startInputObserver } from "./gate-input-observer.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const fixture = () => {
  const outer = mkdtempSync(join(tmpdir(), "dalph-input-"))
  roots.push(outer)
  const root = join(outer, "repo")
  mkdirSync(root)
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q")
  git("config", "user.name", "Input Fixture")
  git("config", "user.email", "input@example.test")
  writeFileSync(join(root, "source.ts"), "initial\n")
  writeFileSync(join(root, ".gitignore"), ".scratch/\nnode_modules/\n.env\n")
  git("add", ".")
  git("commit", "-qm", "base")
  mkdirSync(join(root, "node_modules"))
  writeFileSync(join(root, "node_modules", "dep.js"), "dependency\n")
  const environment = { PATH: process.env.PATH, HOME: outer, DALPH_DIAGNOSTICS_BASE: "origin/master" }
  const invocation = { baseSha: git("rev-parse", "HEAD"), mode: "check:all", toolExecutables: [] }
  const guard = () =>
    startInputGuard({
      worktree: root,
      logicalInvocation: invocation,
      effectiveEnvironment: environment,
      generatedOutputRoots: [join(root, ".scratch")]
    })
  return { root, outer, git, environment, invocation, guard }
}

test("unchanged complete inputs produce identical identity and drained final guard proof", async () => {
  const f = fixture()
  const guard = await f.guard()
  try {
    assert.equal(guard.identity.version, 2)
    assert.equal((await guard.finish()).inputDigest, guard.identity.inputDigest)
  } finally {
    await guard.close()
  }
})

for (const [name, mutate] of [
  [
    "source editrestore",
    (f) => {
      writeFileSync(join(f.root, "source.ts"), "edit\n")
      writeFileSync(join(f.root, "source.ts"), "initial\n")
    }
  ],
  ["ignored configuration", (f) => writeFileSync(join(f.root, ".env"), "VITE_MODE=other\n")],
  ["untracked membership", (f) => writeFileSync(join(f.root, "new.ts"), "new\n")],
  ["dependency bytes", (f) => writeFileSync(join(f.root, "node_modules", "dep.js"), "edited\n")],
  ["index staging", (f) => f.git("update-index", "--chmod=+x", "source.ts")],
  [
    "atomic source replacement",
    (f) => {
      writeFileSync(join(f.root, "replacement"), "initial\n")
      renameSync(join(f.root, "replacement"), join(f.root, "source.ts"))
    }
  ],
  [
    "directory replacement",
    (f) => {
      renameSync(join(f.root, "node_modules"), join(f.root, "old-deps"))
      mkdirSync(join(f.root, "node_modules"))
    }
  ]
]) {
  test(`${String(name)} invalidates the observer despite unchanged HEAD`, async () => {
    const f = fixture()
    const guard = await f.guard()
    try {
      mutate(f)
      await assert.rejects(guard.assertUnchanged())
      await assert.rejects(guard.finish())
    } finally {
      await guard.close()
    }
  })
}

test("effective environment remains behavioral input and per-run transport does not", async () => {
  const f = fixture()
  const guard = await f.guard()
  try {
    f.environment.DALPH_GATE_RUN_ID = "new-id"
    await guard.assertUnchanged()
    f.environment.DALPH_DIAGNOSTICS_BASE = "other"
    await assert.rejects(guard.assertUnchanged(), /environment/u)
  } finally {
    await guard.close()
  }
})

test("resolved external workspace target and symlink replacement are observed", async () => {
  const f = fixture()
  const external = join(f.outer, "external")
  mkdirSync(external)
  writeFileSync(join(external, "code.js"), "target\n")
  symlinkSync(external, join(f.root, "node_modules", "workspace"))
  const guard = await f.guard()
  try {
    assert.ok(guard.identity.manifests.source.some((entry) => entry.path === join(external, "code.js")))
    writeFileSync(join(external, "code.js"), "edit\n")
    writeFileSync(join(external, "code.js"), "target\n")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("input inode detects writes through a hardlink outside the watched tree", async () => {
  const f = fixture()
  const alias = join(f.outer, "alias")
  linkSync(join(f.root, "source.ts"), alias)
  const guard = await f.guard()
  try {
    writeFileSync(alias, "edit\n")
    writeFileSync(alias, "initial\n")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("generated outputs are excluded until protected as credited artifact inputs", async () => {
  const f = fixture()
  const artifact = join(f.root, ".scratch", "dist")
  mkdirSync(artifact, { recursive: true })
  writeFileSync(join(artifact, "out.js"), "initial\n")
  const guard = await f.guard()
  try {
    writeFileSync(join(artifact, "out.js"), "generated\n")
    await guard.assertUnchanged()
    await guard.protectArtifacts([artifact])
    writeFileSync(join(artifact, "out.js"), "edit\n")
    writeFileSync(join(artifact, "out.js"), "generated\n")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("observer process death fails closed and cleanup alone never establishes success", async () => {
  const f = fixture()
  const observer = await startInputObserver({ roots: [f.root], excludedRoots: [join(f.root, ".git")] })
  try {
    process.kill(observer.processId, "SIGKILL")
    await assert.rejects(observer.assertUnchanged())
  } finally {
    await observer.close()
  }
})

test("actual local inotify queue overflow fails closed without sysctl changes", async () => {
  const f = fixture()
  const observed = join(f.outer, "overflow")
  mkdirSync(observed)
  writeFileSync(join(observed, "events"), "initial")
  const observer = await startInputObserver({ roots: [observed] })
  try {
    await observer.pause()
    const limit = Number(readFileSync("/proc/sys/fs/inotify/max_queued_events", "utf8"))
    execFileSync("python3", [
      "-c",
      "import os,sys; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT,0o600); [(os.pwrite(fd,b'x',0)) for _ in range(int(sys.argv[2]))]; os.close(fd)",
      join(observed, "events"),
      String(limit + 64)
    ])
    await assert.rejects(observer.assertUnchanged(), /IN_Q_OVERFLOW/u)
  } finally {
    await observer.close()
  }
})

test("workspace symlink replacement invalidates reuse even when resolved bytes match", async () => {
  const f = fixture()
  const first = join(f.outer, "first")
  const second = join(f.outer, "second")
  mkdirSync(first)
  mkdirSync(second)
  writeFileSync(join(first, "value"), "same")
  writeFileSync(join(second, "value"), "same")
  const link = join(f.root, "node_modules", "workspace")
  symlinkSync(first, link)
  const guard = await f.guard()
  try {
    rmSync(link)
    symlinkSync(second, link)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("tool bytes and mode are immutable even without a lockfile change", async () => {
  const f = fixture()
  const tool = join(f.outer, "tool")
  writeFileSync(tool, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  f.invocation.toolExecutables.push(tool)
  const guard = await f.guard()
  try {
    writeFileSync(tool, "#!/bin/sh\nexit 1\n")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("unresolved semantic index stages and unsupported module configuration refuse guard startup", async () => {
  const f = fixture()
  f.environment.NODE_OPTIONS = "--require=/outside/module.js"
  await assert.rejects(f.guard(), /[Uu]nsupported/u)
  delete f.environment.NODE_OPTIONS
  const sha = f.git("rev-parse", "HEAD:source.ts")
  execFileSync("git", ["update-index", "--index-info"], {
    cwd: f.root,
    input: `0 ${"0".repeat(40)}\tsource.ts\n100644 ${sha} 1\tsource.ts\n100644 ${sha} 2\tsource.ts\n`
  })
  await assert.rejects(f.guard(), /conflicts/u)
})

test("missing executable and broken external links cannot establish complete input identity", async () => {
  const f = fixture()
  f.invocation.toolExecutables.push(join(f.outer, "missing"))
  await assert.rejects(f.guard(), /unavailable/u)
  f.invocation.toolExecutables.pop()
  symlinkSync(join(f.outer, "missing"), join(f.root, "node_modules", "broken"))
  await assert.rejects(f.guard())
})

test("closed guard cannot credit another stage or final evidence", async () => {
  const f = fixture()
  const guard = await f.guard()
  await guard.close()
  await assert.rejects(guard.assertUnchanged(), /closed/u)
  await assert.rejects(guard.finish(), /closed/u)
})

test("earlier PATH candidate creation cannot shadow an inventoried stage tool", async () => {
  const f = fixture()
  const earlier = join(f.outer, "earlier")
  mkdirSync(earlier)
  f.environment.PATH = `${earlier}:${f.environment.PATH}`
  const guard = await f.guard()
  try {
    writeFileSync(join(earlier, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("strict PATH ancestor permission edit and restore invalidates executable resolution evidence", async () => {
  const f = fixture()
  const scaffolding = join(f.outer, "scaffolding")
  const selected = join(scaffolding, "selected")
  mkdirSync(selected, { recursive: true })
  f.environment.PATH = `${selected}:${f.environment.PATH}`
  const guard = await f.guard()
  try {
    chmodSync(scaffolding, 0o700)
    chmodSync(scaffolding, 0o755)
    await assert.rejects(guard.assertUnchanged(), /mask=/u)
  } finally {
    await guard.close()
  }
})

test("selected external tool edit and restore remains an observed input mutation", async () => {
  const f = fixture()
  const bin = join(f.outer, "tools", "bin")
  mkdirSync(bin, { recursive: true })
  const tool = join(bin, "fixture-tool")
  writeFileSync(tool, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  f.invocation.toolExecutables.push(tool)
  const guard = await f.guard()
  try {
    writeFileSync(tool, "#!/bin/sh\nexit 1\n")
    writeFileSync(tool, "#!/bin/sh\nexit 0\n")
    await assert.rejects(guard.assertUnchanged(), /mask=/u)
  } finally {
    await guard.close()
  }
})

test("creation of a missing intermediate PATH directory invalidates absent candidate evidence", async () => {
  const f = fixture()
  const parent = join(f.outer, "missing-path")
  f.environment.PATH = `${join(parent, "bin")}:${f.environment.PATH}`
  const guard = await f.guard()
  try {
    mkdirSync(parent)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("protecting a strict ancestor promotes its metadata to observed artifact input", async () => {
  const f = fixture()
  const ancestor = join(f.outer, "artifact-parent")
  const tool = join(ancestor, "bin", "fixture-tool")
  mkdirSync(join(ancestor, "bin"), { recursive: true })
  writeFileSync(tool, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  f.invocation.toolExecutables.push(tool)
  const guard = await f.guard()
  try {
    await guard.protectArtifacts([ancestor])
    utimesSync(ancestor, new Date(0), new Date(0))
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("pnpm entrypoint identity includes implementation modules outside its bin directory", async () => {
  const f = fixture()
  const packageRoot = join(f.outer, "pnpm-package")
  mkdirSync(join(packageRoot, "bin"), { recursive: true })
  mkdirSync(join(packageRoot, "dist"))
  writeFileSync(join(packageRoot, "package.json"), '{"name":"pnpm"}')
  writeFileSync(join(packageRoot, "bin", "pnpm.cjs"), "entry")
  const implementation = join(packageRoot, "dist", "pnpm.cjs")
  writeFileSync(implementation, "implementation")
  f.environment.npm_execpath = join(packageRoot, "bin", "pnpm.cjs")
  const guard = await f.guard()
  try {
    assert.ok(guard.identity.manifests.tools.some((entry) => entry.path === implementation))
    writeFileSync(implementation, "changed")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("real dprint cache bytes are inputs and queue-wait timestamps are bookkeeping", async () => {
  const f = fixture()
  const cache = join(f.outer, "dprint-cache")
  mkdirSync(cache)
  const plugin = join(cache, "plugin.wasm")
  writeFileSync(plugin, "plugin")
  f.environment.DPRINT_CACHE_DIR = cache
  const guard = await f.guard()
  try {
    f.environment.DALPH_GATE_WAIT_STARTED_MILLISECONDS = "new-wait"
    await guard.assertUnchanged()
    writeFileSync(plugin, "changed")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("truncated observer transport and setup failure cannot establish readiness", async () => {
  const f = fixture()
  const fake = join(f.outer, "fake-python")
  writeFileSync(fake, "#!/bin/sh\nprintf '{'\n", { mode: 0o755 })
  await assert.rejects(startInputObserver({ roots: [f.root], pythonExecutable: fake }))
  await assert.rejects(
    startInputObserver({ roots: [f.root], pythonExecutable: join(f.outer, "missing") }),
    /spawn failed/u
  )
})

for (const options of [
  "-r /outside/preload.cjs",
  "-r=/outside/preload.cjs",
  "--require /outside/preload.cjs",
  "--require=/outside/preload.cjs",
  '--require="/outside/preload.cjs"',
  '"--require=/outside/preload.cjs"',
  "--experimental-loader=/outside/loader.mjs",
  "--loader /outside/loader.mjs",
  "--import=/outside/import.mjs",
  "--env-file=/outside/env",
  "--openssl-config=/outside/openssl.cnf",
  "--icu-data-dir=/outside/icu",
  "--max-old-space-size=8192 -r /outside/preload.cjs",
  "--max-old-space-size=8192 --unknown-future-option"
]) {
  test(`file-loading or unknown NODE_OPTIONS ${options} refuses input guard`, async () => {
    const f = fixture()
    f.environment.NODE_OPTIONS = options
    await assert.rejects(f.guard(), /Unsupported NODE_OPTIONS/u)
  })
}

test("only harness memory/warning NODE_OPTIONS syntax is accepted and digested", async () => {
  const f = fixture()
  f.environment.NODE_OPTIONS = "--max-old-space-size=8192 --disable-warning=ExperimentalWarning"
  const guard = await f.guard()
  try {
    await guard.assertUnchanged()
    assert.ok(guard.identity.environmentDigests.NODE_OPTIONS)
  } finally {
    await guard.close()
  }
})

test("excluded ancestor rename replacement restore cannot hide a protected artifact mutation", async () => {
  const f = fixture()
  const scratch = join(f.root, ".scratch")
  const artifact = join(scratch, "dist")
  mkdirSync(artifact, { recursive: true })
  writeFileSync(join(artifact, "out.js"), "original")
  const guard = await f.guard()
  try {
    await guard.protectArtifacts([artifact])
    const relocated = join(f.outer, "relocated-scratch")
    renameSync(scratch, relocated)
    mkdirSync(artifact, { recursive: true })
    writeFileSync(join(artifact, "out.js"), "replacement")
    rmSync(scratch, { recursive: true })
    renameSync(relocated, scratch)
    assert.equal(readFileSync(join(artifact, "out.js"), "utf8"), "original")
    await assert.rejects(guard.assertUnchanged())
    await assert.rejects(guard.finish())
  } finally {
    await guard.close()
  }
})

test("nested excluded ancestor replacement cannot hide credited artifact changes", async () => {
  const f = fixture()
  const ancestor = join(f.root, ".scratch", "nested")
  const artifact = join(ancestor, "run", "dist")
  mkdirSync(artifact, { recursive: true })
  writeFileSync(join(artifact, "out.js"), "original")
  const guard = await f.guard()
  try {
    await guard.protectArtifacts([artifact])
    const relocated = join(f.outer, "relocated-nested")
    renameSync(ancestor, relocated)
    mkdirSync(artifact, { recursive: true })
    writeFileSync(join(artifact, "out.js"), "replacement")
    rmSync(ancestor, { recursive: true })
    renameSync(relocated, ancestor)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("linked-worktree Git locator is protected despite admin output exclusions", async () => {
  const f = fixture()
  const linked = join(f.outer, "linked")
  f.git("worktree", "add", "-q", "-b", "linked", linked)
  const guard = await startInputGuard({
    worktree: linked,
    logicalInvocation: f.invocation,
    effectiveEnvironment: f.environment,
    generatedOutputRoots: [join(linked, ".scratch")]
  })
  try {
    const locator = join(linked, ".git")
    const original = readFileSync(locator, "utf8")
    writeFileSync(locator, "gitdir: /outside/other\n")
    writeFileSync(locator, original)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

const disabledDprintFixture = () => {
  const f = fixture()
  f.environment.DPRINT_CACHE_DIR = join(f.outer, "dprint")
  f.environment.DALPH_DPRINT_INCREMENTAL = "disabled"
  f.invocation.dprintIncremental = "disabled"
  mkdirSync(join(f.environment.DPRINT_CACHE_DIR, "plugins"), { recursive: true })
  return f
}

test("disabled dprint contract ignores exact incremental and lock bookkeeping", async () => {
  const f = disabledDprintFixture()
  const guard = await f.guard()
  try {
    for (const directory of ["incremental", "locks"]) {
      const path = join(f.environment.DPRINT_CACHE_DIR, directory)
      mkdirSync(path)
      writeFileSync(join(path, "entry"), "initial")
      writeFileSync(join(path, "entry"), "changed")
      writeFileSync(join(path, "entry"), "initial")
    }
    await guard.finish()
  } finally {
    await guard.close()
  }
})

for (const path of ["plugins/plugin.cwasm", "plugins/plugin.json", "unknown/result"]) {
  test(`disabled dprint contract still observes ${path}`, async () => {
    const f = disabledDprintFixture()
    const target = join(f.environment.DPRINT_CACHE_DIR, path)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, "initial")
    const guard = await f.guard()
    try {
      writeFileSync(target, "changed")
      writeFileSync(target, "initial")
      await assert.rejects(guard.assertUnchanged())
    } finally {
      await guard.close()
    }
  })
}

for (const marker of ["environment", "contract"]) {
  test(`dprint disabled ${marker} marker alone refuses observation`, async () => {
    const f = disabledDprintFixture()
    if (marker === "environment") delete f.invocation.dprintIncremental
    else delete f.environment.DALPH_DPRINT_INCREMENTAL
    await assert.rejects(f.guard(), /Dprint incremental policy/u)
  })
}

test("default dprint contract observes incremental cache writes", async () => {
  const f = disabledDprintFixture()
  delete f.environment.DALPH_DPRINT_INCREMENTAL
  delete f.invocation.dprintIncremental
  const guard = await f.guard()
  try {
    mkdirSync(join(f.environment.DPRINT_CACHE_DIR, "incremental"))
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("installed dprint check with disabled incremental cache preserves real guard and observes cached plugin mutation", async () => {
  const f = disabledDprintFixture()
  const installed = fileURLToPath(
    new URL("../node_modules/.pnpm/dprint@0.55.2/node_modules/dprint/dprint", import.meta.url)
  )
  const originalCache =
    process.env.DPRINT_CACHE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, ".cache"), "dprint")
  const plugins = join(f.environment.DPRINT_CACHE_DIR, "plugins")
  cpSync(join(originalCache, process.env.DPRINT_CACHE_DIR === undefined ? "cache/plugins" : "plugins"), plugins, {
    recursive: true
  })
  const expectedPluginSource = "remote:https://plugins.dprint.dev/oxc-0.32.0.wasm"
  const metadataEntry = readdirSync(plugins)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, metadata: JSON.parse(readFileSync(join(plugins, name), "utf8")) }))
    .find(({ metadata }) => metadata.source === expectedPluginSource)
  assert.ok(metadataEntry, `missing cached dprint metadata for ${expectedPluginSource}`)
  const metadata = metadataEntry.metadata
  assert.equal(metadata.source, expectedPluginSource)
  writeFileSync(join(f.root, "source.ts"), "const value = 1;\n")
  writeFileSync(join(f.root, "dprint.json"), JSON.stringify({ plugins: [metadata.source.slice(7)] }))
  f.invocation.toolExecutables.push(installed)
  f.environment.HTTPS_PROXY = "http://127.0.0.1:1"
  f.environment.HTTP_PROXY = "http://127.0.0.1:1"
  const guard = await f.guard()
  try {
    execFileSync(installed, ["check", "--incremental=false", "source.ts"], {
      cwd: f.root,
      env: f.environment,
      timeout: 10000
    })
    await guard.finish()
    const plugin = join(plugins, `${metadataEntry.name.slice(0, -".json".length)}.cwasm`)
    const original = readFileSync(plugin)
    writeFileSync(plugin, "changed")
    writeFileSync(plugin, original)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("disabled dprint default HOME cache excludes only its nested bookkeeping directories", async () => {
  const f = disabledDprintFixture()
  delete f.environment.DPRINT_CACHE_DIR
  const cache = join(f.outer, ".cache", "dprint", "cache")
  mkdirSync(join(cache, "plugins"), { recursive: true })
  const guard = await f.guard()
  try {
    mkdirSync(join(cache, "incremental"))
    writeFileSync(join(cache, "incremental", "state"), "result")
    mkdirSync(join(cache, "locks"))
    await guard.finish()
  } finally {
    await guard.close()
  }
})

test("disabled dprint contract still observes cache root replacement", async () => {
  const f = disabledDprintFixture()
  const cache = f.environment.DPRINT_CACHE_DIR
  const guard = await f.guard()
  try {
    renameSync(cache, join(f.outer, "old-cache"))
    mkdirSync(cache)
    rmSync(cache, { recursive: true })
    renameSync(join(f.outer, "old-cache"), cache)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

const candidateGitFixture = () => {
  const f = fixture()
  const headSha = f.git("rev-parse", "HEAD")
  f.environment.DALPH_GATE_GIT_HISTORY = "candidate-ancestry"
  f.invocation.gitHistory = { mode: "candidate-ancestry", headSha }
  const args = ["check:secrets", `--log-opts=--full-history --diff-filter=tuxdb ${headSha} --`]
  f.invocation.stageManifest = [{ id: "secrets", args, execution: { args: ["pnpm.cjs", "--silent", ...args] } }]
  return f
}

test("bound candidate history allows real unrelated loose branch and lock writes", async () => {
  const f = candidateGitFixture()
  const sibling = f.git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "unrelated")
  const guard = await f.guard()
  try {
    f.git("update-ref", "refs/heads/unrelated", f.invocation.gitHistory.headSha)
    f.git("update-ref", "refs/heads/unrelated", sibling)
    writeFileSync(join(f.root, ".git", "refs", "heads", "unrelated.lock"), "pending")
    rmSync(join(f.root, ".git", "refs", "heads", "unrelated.lock"))
    await guard.finish()
  } finally {
    await guard.close()
  }
})

for (const authority of ["selected ref", "index", "selected ref lock", "index lock", "HEAD"]) {
  test(`bound candidate history refuses transient ${authority} writes`, async () => {
    const f = candidateGitFixture()
    const reference = f.git("symbolic-ref", "HEAD")
    const path = join(
      f.root,
      ".git",
      authority === "selected ref"
        ? reference
        : authority === "selected ref lock"
          ? `${reference}.lock`
          : authority === "index lock"
            ? "index.lock"
            : authority
    )
    const original = authority.endsWith("lock") ? undefined : readFileSync(path)
    const guard = await f.guard()
    try {
      writeFileSync(path, "transient")
      if (original === undefined) rmSync(path)
      else writeFileSync(path, original)
      await assert.rejects(guard.assertUnchanged())
    } finally {
      await guard.close()
    }
  })
}

test("bound candidate history observes intermediate symbolic HEAD chain", async () => {
  const f = candidateGitFixture()
  const terminal = f.git("symbolic-ref", "HEAD")
  f.git("symbolic-ref", "refs/heads/alias", terminal)
  f.git("symbolic-ref", "HEAD", "refs/heads/alias")
  const path = join(f.root, ".git", "refs", "heads", "alias")
  const original = readFileSync(path)
  const guard = await f.guard()
  try {
    writeFileSync(path, "ref: refs/heads/unrelated\n")
    writeFileSync(path, original)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("bound candidate history observes selected ref ancestor replacement and restore", async () => {
  const f = candidateGitFixture()
  const directory = join(f.root, ".git", "refs", "heads")
  const moved = join(f.outer, "old-heads")
  const guard = await f.guard()
  try {
    renameSync(directory, moved)
    mkdirSync(directory)
    writeFileSync(join(directory, "replacement"), "changed")
    rmSync(directory, { recursive: true })
    renameSync(moved, directory)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

for (const mismatch of ["missing environment", "missing contract", "wrong HEAD", "broad command", "wrong execution"]) {
  test(`candidate history refuses ${mismatch}`, async () => {
    const f = candidateGitFixture()
    if (mismatch === "missing environment") delete f.environment.DALPH_GATE_GIT_HISTORY
    if (mismatch === "missing contract") delete f.invocation.gitHistory
    if (mismatch === "wrong HEAD") f.invocation.gitHistory.headSha = "1".repeat(40)
    if (mismatch === "broad command") f.invocation.stageManifest[0].args = ["check:secrets"]
    if (mismatch === "wrong execution") f.invocation.stageManifest[0].execution.args.pop()
    await assert.rejects(f.guard(), /Candidate Git history/u)
  })
}

for (const authority of [
  "external excludes",
  "info/exclude",
  "info/attributes",
  "info/grafts",
  "shallow",
  "packed-refs",
  "refs/replace/replacement"
]) {
  test(`candidate history observes ${authority} edit and restore`, async () => {
    const f = candidateGitFixture()
    const path = authority === "external excludes" ? join(f.outer, "ignored") : join(f.root, ".git", authority)
    if (authority === "external excludes") f.git("config", "core.excludesfile", path)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, "")
    const guard = await f.guard()
    try {
      writeFileSync(path, "transient")
      writeFileSync(path, "")
      await assert.rejects(guard.assertUnchanged())
    } finally {
      await guard.close()
    }
  })
}

test("default Git history still observes unrelated refs", async () => {
  const f = fixture()
  const guard = await f.guard()
  try {
    f.git("update-ref", "refs/heads/unrelated", f.invocation.baseSha)
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

for (const redirect of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
  "GIT_GRAFT_FILE",
  "GIT_NAMESPACE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_ATTR_SOURCE"
]) {
  test(`candidate history refuses unsupported ${redirect}`, async () => {
    const f = candidateGitFixture()
    // These unsupported authority redirects must refuse before any stage starts.
    f.environment[redirect] = redirect === "GIT_CONFIG_COUNT" ? "0" : "/outside/authority"
    await assert.rejects(f.guard())
  })
}

test("candidate history refuses external object alternates", async () => {
  const f = candidateGitFixture()
  writeFileSync(join(f.root, ".git", "objects", "info", "alternates"), "/outside/objects\n")
  await assert.rejects(f.guard(), /Unsupported Git object indirection/u)
})

test("candidate history observes configuration retargeting of external ignores", async () => {
  const f = candidateGitFixture()
  const guard = await f.guard()
  try {
    f.git("config", "core.excludesfile", join(f.outer, "new-ignore"))
    f.git("config", "--unset", "core.excludesfile")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("candidate history observes resolved external attributes", async () => {
  const f = candidateGitFixture()
  const path = join(f.outer, "attributes")
  writeFileSync(path, "")
  f.git("config", "core.attributesfile", path)
  const guard = await f.guard()
  try {
    writeFileSync(path, "*.ts -diff\n")
    writeFileSync(path, "")
    await assert.rejects(guard.assertUnchanged())
  } finally {
    await guard.close()
  }
})

test("candidate history refuses external object-directory link", async () => {
  const f = candidateGitFixture()
  const objects = join(f.root, ".git", "objects")
  const target = join(f.outer, "external-objects")
  renameSync(objects, target)
  symlinkSync(target, objects, "dir")
  let unexpectedGuard
  try {
    await assert.rejects(async () => {
      unexpectedGuard = await f.guard()
    }, /Unsupported Git object-directory link/u)
  } finally {
    await unexpectedGuard?.close()
  }
})

test("candidate history refuses authored selected ref ancestor symlink", async () => {
  const f = candidateGitFixture()
  const refs = join(f.root, ".git", "refs")
  const external = join(f.outer, "external-refs")
  renameSync(refs, external)
  symlinkSync(external, refs, "dir")
  assert.equal(f.git("rev-parse", "HEAD"), f.invocation.gitHistory.headSha)
  let unexpectedGuard
  try {
    await assert.rejects(async () => {
      unexpectedGuard = await f.guard()
    }, /Unsupported selected Git ref ancestor link/u)
  } finally {
    await unexpectedGuard?.close()
  }
})

test("read-only status under guarded optional-lock policy leaves stale index metadata untouched while required index mutation still locks", async () => {
  const f = fixture()
  f.environment.GIT_OPTIONAL_LOCKS = "0"
  const observedGit = (...args) =>
    execFileSync("git", args, { cwd: f.root, env: f.environment, encoding: "utf8" }).trim()
  // Same authored bytes, new stat metadata: ordinary status would optionally refresh the index.
  writeFileSync(join(f.root, "source.ts"), "initial\n")
  const index = join(f.root, ".git", "index")
  const before = readFileSync(index)
  const guard = await f.guard()
  try {
    assert.equal(observedGit("status", "--porcelain=v1", "--untracked-files=all"), "")
    assert.deepEqual(readFileSync(index), before)
    assert.equal((await guard.finish()).unchanged, true)
    observedGit("update-index", "--chmod=+x", "source.ts")
    assert.notDeepEqual(readFileSync(index), before)
    assert.match(observedGit("ls-files", "--stage", "source.ts"), /^100755 /u)
    await assert.rejects(guard.assertUnchanged(), /dirty|changed|watch/u)
  } finally {
    await guard.close()
  }
})
