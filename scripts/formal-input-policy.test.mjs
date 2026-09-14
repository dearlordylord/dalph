import assert from "node:assert/strict"
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { arch, platform, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { afterEach, test } from "node:test"
import {
  createFormalEnvironment,
  discoverFormalSourcePaths,
  formalInputPolicyVersion,
  quintImportSources,
  resolveFormalExecutable,
  startFormalInputGuard
} from "./formal-input-policy.mjs"
import {
  expectedHostedFormalInputManifestText,
  hostedWorkflowCommandEntries
} from "./generate-hosted-formal-input-manifest.mjs"
import { hostedFormalInputManifestPath } from "./hosted-formal-input-manifest.mjs"
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
  for (const directory of ["specs", "scripts", ".github/workflows", "docs", "source", ".git", "tools"])
    mkdirSync(join(root, directory), { recursive: true })
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".github/workflows/ci.yml",
    "specs/model.qnt",
    "scripts/with-gate-slot.mjs",
    "scripts/run-admitted-gate.mjs",
    "scripts/run-formal-gate.mjs",
    "scripts/run-formal-workflow.mjs",
    "scripts/run-formal-profile.mjs",
    "scripts/check-quint-models.mjs",
    "source/app.ts",
    "docs/formal-notes.md",
    ".git/HEAD",
    ".git/index",
    "tools/runtime.so"
  ])
    writeFileSync(join(root, file), "original\n")
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
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
  const profile = {
    obligations: ["one", "two"],
    seed: 153000,
    budget: 720000,
    commands: [{ args: ["typecheck", "specs/model.qnt"] }]
  }
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

test("formal executable lookup continues from a missing PATH entry to the later executable", async () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-formal-path-"))
  cleanups.push(() => rmSync(root, { force: true, recursive: true }))
  const missing = join(root, "missing")
  const available = join(root, "available")
  mkdirSync(available)
  const executable = join(available, "formal-tool")
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  assert.equal(await resolveFormalExecutable("formal-tool", { PATH: `${missing}:${available}` }, root), executable)
  await assert.rejects(
    resolveFormalExecutable("absent-tool", { PATH: missing }, root),
    (error) => error.code === "ENOENT" && error.cause?.code === "ENOENT"
  )
})

test("checked-in hosted formal inputs exactly match the authoritative JavaScript and Quint closure", async () => {
  const manifest = JSON.parse(readFileSync(hostedFormalInputManifestPath, "utf8"))
  for (const path of [
    "package.json",
    "packages/contracts/package.json",
    "packages/dalph/package.json",
    "packages/orchestrator/package.json",
    "prototypes/reducer-lab/package.json"
  ])
    assert.equal(manifest.paths.includes(path), true, path)
  assert.equal(
    readFileSync(hostedFormalInputManifestPath, "utf8"),
    await expectedHostedFormalInputManifestText(process.cwd())
  )
  assert.equal(
    manifest.paths.includes("packages/dalph/test/conformance/planned-attempt-executor-resume-fixture.ts"),
    true
  )
  assert.equal(
    manifest.paths.includes(
      "packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/resume-redelivery.ts"
    ),
    true
  )
  assert.equal(
    manifest.paths.includes("packages/dalph/test/conformance/workspace-source-resolution.mbt.test.ts"),
    false
  )
})

test("hosted command discovery includes new Node entries and rejects unsupported formal job inputs", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const withFormalStep = workflow.replace(
    "      - name: Run formal model shard\n",
    "      - name: Prepare hosted formal input\n        run: node scripts/prepare-hosted-formal.mjs\n\n      - name: Run formal model shard\n"
  )
  assert.equal(
    hostedWorkflowCommandEntries({ packageJson, workflow: withFormalStep }).includes(
      "scripts/prepare-hosted-formal.mjs"
    ),
    true
  )
  const withShellStep = workflow.replace(
    "      - name: Run formal model shard\n",
    "      - name: Prepare hosted formal input\n        run: bash scripts/prepare-hosted-formal.sh\n\n      - name: Run formal model shard\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withShellStep }),
    /does not support workflow command/u
  )
  for (const command of [
    "node scripts/first-formal.mjs && node scripts/second-formal.mjs",
    "node scripts/first-formal.mjs; node scripts/second-formal.mjs",
    "node scripts/first-formal.mjs | node scripts/second-formal.mjs",
    "node scripts/first-formal.mjs $(node scripts/second-formal.mjs)",
    "node scripts/first-formal.mjs > formal-output.txt",
    "node scripts/first-formal.mjs node scripts/second-formal.mjs"
  ]) {
    const unsupported = workflow.replace(
      "      - name: Run formal model shard\n",
      `      - name: Prepare hosted formal inputs\n        run: ${command}\n\n      - name: Run formal model shard\n`
    )
    assert.throws(() => hostedWorkflowCommandEntries({ packageJson, workflow: unsupported }), /does not support/u)
  }
  const withChainedInstall = workflow.replaceAll(
    "        run: pnpm install --frozen-lockfile\n",
    "        run: pnpm install --frozen-lockfile && node scripts/post-install-formal.mjs\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withChainedInstall }),
    /does not support shell control syntax/u
  )
  const withShardConfig = workflow.replace(
    '        run: pnpm check:ci:formal:shard --shard "${{ matrix.shard }}" --report "formal-shard-reports/shard-${{ matrix.shard }}.json"\n',
    "        run: pnpm check:ci:formal:shard --config config/hosted-formal.json\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withShardConfig }),
    /does not support workflow command/u
  )
  assert.throws(() =>
    hostedWorkflowCommandEntries({
      packageJson: {
        ...packageJson,
        scripts: { ...packageJson.scripts, prepare: "husky && node scripts/prepare-formal.mjs" }
      },
      workflow
    })
  )
  assert.throws(() =>
    hostedWorkflowCommandEntries({
      packageJson: {
        ...packageJson,
        scripts: { ...packageJson.scripts, prepare: "husky && tsx config/prepare-hosted-formal.ts" }
      },
      workflow
    })
  )
  assert.throws(() =>
    hostedWorkflowCommandEntries({
      packageJson: { ...packageJson, scripts: { ...packageJson.scripts, prepare: "node scripts/prepare-formal.mjs" } },
      workflow
    })
  )
  assert.throws(
    () =>
      hostedWorkflowCommandEntries({
        packageJson,
        workspacePackages: [
          {
            path: "packages/dalph/package.json",
            packageJson: { scripts: { postinstall: "node scripts/mutate-formal-runtime.mjs" } },
            isRoot: false
          }
        ],
        workflow
      }),
    /lifecycle postinstall in packages\/dalph\/package\.json has an unsupported command shape/u
  )
  const withLocalAction = workflow.replace(
    "      - name: Run formal model shard\n",
    "      - name: Prepare hosted formal input\n        uses: './.github/actions/prepare-formal'\n\n      - name: Run formal model shard\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withLocalAction }),
    /does not support a repository-local action/u
  )
  const withFileLoadingEnvironment = workflow.replaceAll(
    "      NODE_OPTIONS: --max-old-space-size=8192\n",
    "      NODE_OPTIONS: --require ./scripts/formal-hook.cjs\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withFileLoadingEnvironment }),
    /requires the exact supported environment/u
  )
  const withCustomShell = workflow.replace(
    "      - name: Run formal model shard\n",
    "      - name: Run formal model shard\n        shell: node scripts/formal-shell.mjs {0}\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withCustomShell }),
    /does not support step/u
  )
  const withWorkflowEnvironment = workflow.replace(
    "jobs:\n",
    "env:\n  NODE_OPTIONS: --require ./scripts/formal-hook.cjs\n\njobs:\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withWorkflowEnvironment }),
    /does not support workflow-level/u
  )
  const withWorkflowRunDefaults = workflow.replace(
    "jobs:\n",
    "defaults:\n  run:\n    shell: node scripts/formal-shell.mjs {0}\n\njobs:\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withWorkflowRunDefaults }),
    /does not support workflow-level/u
  )
  const withWorkflowWorkingDirectory = workflow.replace(
    "jobs:\n",
    "defaults:\n  run:\n    working-directory: scripts\n\njobs:\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withWorkflowWorkingDirectory }),
    /does not support workflow-level/u
  )
  for (const replacement of [
    '"env":\n  NODE_OPTIONS: --require ./scripts/formal-hook.cjs\n\njobs:\n',
    "defaults :\n  run:\n    shell: node scripts/formal-shell.mjs {0}\n\njobs:\n"
  ]) {
    const withEquivalentWorkflowKey = workflow.replace("jobs:\n", replacement)
    assert.throws(
      () => hostedWorkflowCommandEntries({ packageJson, workflow: withEquivalentWorkflowKey }),
      /does not support workflow-level/u
    )
  }
  for (const key of ['"env"', '"defaults"', '"shell"', '"working-directory"']) {
    const withEquivalentFormalKey = workflow.replace(
      "      - name: Run formal model shard\n",
      `      - name: Prepare hosted formal input\n        ${key}: node scripts/formal-hook.mjs\n\n      - name: Run formal model shard\n`
    )
    assert.throws(
      () => hostedWorkflowCommandEntries({ packageJson, workflow: withEquivalentFormalKey }),
      /does not support step/u
    )
  }
  const withQuotedRunKey = workflow.replace(
    "      - name: Run formal model shard\n",
    '      - name: Prepare hosted formal input\n        "run": node scripts/formal-hook.mjs\n\n      - name: Run formal model shard\n'
  )
  assert.equal(
    hostedWorkflowCommandEntries({ packageJson, workflow: withQuotedRunKey }).includes("scripts/formal-hook.mjs"),
    true
  )
  const withQuotedUsesKey = workflow.replace(
    "      - name: Run formal model shard\n",
    '      - name: Prepare hosted formal input\n        "uses": "./.github/actions/formal-hook"\n\n      - name: Run formal model shard\n'
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withQuotedUsesKey }),
    /does not support a repository-local action/u
  )
  const withSpacedFormalKey = workflow.replace(
    "      - name: Run formal model shard\n",
    "      - name: Prepare hosted formal input\n        shell : node scripts/formal-shell.mjs {0}\n\n      - name: Run formal model shard\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withSpacedFormalKey }),
    /does not support step/u
  )
  const withActionRepositoryPath = workflow.replaceAll(
    "          fetch-depth: 0\n",
    "          fetch-depth: 0\n          path: scripts/formal-checkout\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withActionRepositoryPath }),
    /does not support workflow action inputs/u
  )
  const withStepHash = workflow.replaceAll(
    "      - name: Checkout\n        uses: actions/checkout@v7\n",
    "      - name: Checkout\n        if: ${{ hashFiles('scripts/formal-hook.mjs') != '' }}\n        uses: actions/checkout@v7\n"
  )
  assert.throws(() => hostedWorkflowCommandEntries({ packageJson, workflow: withStepHash }), /does not support step/u)
  const withJobHash = workflow.replace(
    "    if: needs.change-plan.outputs.formal-required == 'true'\n",
    "    if: ${{ hashFiles('scripts/formal-hook.mjs') != '' }}\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withJobHash }),
    /requires the exact supported job condition/u
  )
  const withSwappedValidationCondition = workflow.replace(
    "      - name: Validate complete formal model evidence\n        if: needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'true'\n",
    "      - name: Validate complete formal model evidence\n        if: needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'false'\n"
  )
  assert.throws(
    () => hostedWorkflowCommandEntries({ packageJson, workflow: withSwappedValidationCondition }),
    /does not support step condition/u
  )
  for (const field of ["container: node:24", "services: {}", "defaults: {}"]) {
    const withUnsupportedJobField = workflow.replace(
      "    runs-on: ubuntu-24.04-arm\n",
      `    runs-on: ubuntu-24.04-arm\n    ${field}\n`
    )
    assert.throws(
      () => hostedWorkflowCommandEntries({ packageJson, workflow: withUnsupportedJobField }),
      /cannot identify workflow job/u
    )
  }
  const withUnrelatedLocalAction = workflow.replace(
    "      - name: Install gitleaks\n",
    "      - name: Prepare documentation\n        uses: './.github/actions/prepare-docs'\n\n      - name: Install gitleaks\n"
  )
  assert.deepEqual(
    hostedWorkflowCommandEntries({ packageJson, workflow: withUnrelatedLocalAction }),
    hostedWorkflowCommandEntries({ packageJson, workflow })
  )
})

test("explicit source discovery uses the same parser-backed model and helper closure", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/hosted-entry.mjs"), 'import "./hosted-helper.mjs"\n')
  writeFileSync(join(f.root, "scripts/hosted-helper.mjs"), "export const hosted = true\n")
  const paths = await discoverFormalSourcePaths({
    javascriptEntries: ["scripts/hosted-entry.mjs"],
    profile: f.profile,
    worktree: f.root
  })
  assert.deepEqual(paths, ["scripts/hosted-entry.mjs", "scripts/hosted-helper.mjs", "specs/model.qnt"])
})

test("retains formal reuse across unrelated edits without binding HEAD index or base", async () => {
  const f = fixture(),
    original = await f.identity()
  for (const file of ["source/app.ts", ".git/HEAD", ".git/index"]) writeFileSync(join(f.root, file), "unrelated\n")
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/ci.yml"])
    writeFileSync(join(f.root, file), "unrelated raw metadata\n")
  const unrelatedScript = join(f.root, "scripts/repair.test.mjs")
  writeFileSync(unrelatedScript, "assert.equal(actual, expected)\n")
  writeFileSync(unrelatedScript, "assert.equal(actual, corrected)\n")
  rmSync(unrelatedScript)
  writeFileSync(join(f.root, "specs/experiment.qnt"), "module experiment {}\n")
  writeFileSync(join(f.root, "docs/formal-notes.md"), "updated notes\n")
  assert.equal((await f.identity()).inputDigest, original.inputDigest)
  assert.equal("head" in original, false)
  assert.equal("index" in original, false)
})

test("builds one applicability identity for equivalent inputs and checkout tools in relocated worktrees", async () => {
  const first = fixture()
  const launcherPath = (worktree) =>
    join(worktree, "node_modules", ".pnpm", "fixture@1.0.0", "node_modules", "fixture", "node_modules", ".bin", "tool")
  const launcher = (
    worktree,
    target = "../../../../tool-package/bin/tool.js",
    nodePath = `${worktree}/node_modules/.pnpm/tool-package/node_modules`
  ) => `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
export NODE_PATH="${nodePath}"
if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/${target}" "$@"
else
  exec node  "$basedir/${target}" "$@"
fi
`
  mkdirSync(dirname(launcherPath(first.root)), { recursive: true })
  writeFileSync(launcherPath(first.root), launcher(first.root), { mode: 0o755 })
  const configurationPaths = (worktree) => {
    const paths = [join(first.toolchain.javaUserHome, ".tlaplus", "apalache.cfg")]
    let directory = worktree
    for (;;) {
      paths.push(join(directory, ".apalache.cfg"))
      if (directory === dirname(directory)) return paths
      directory = dirname(directory)
    }
  }
  const originalConfigurations = configurationPaths(first.root)
  first.toolchain.roots.push(...originalConfigurations)
  first.toolchain.roots.push(join(first.root, "node_modules"))
  first.toolchain.allowedRoots.push(...originalConfigurations)
  first.toolchain.allowedRoots.push(join(first.root, "node_modules"))
  first.toolchain.requiredRoots.push(join(first.root, "node_modules"))
  first.toolchain.configPaths = originalConfigurations
  first.environment.PATH = `${join(first.root, "node_modules", ".bin")}:${first.environment.PATH}`
  first.environment.npm_execpath = join(first.root, "node_modules", ".bin", "pnpm")
  const original = await first.identity()
  const relocatedRoot = join(first.outer, "deeper", "relocated")
  cpSync(first.root, relocatedRoot, { recursive: true })
  writeFileSync(launcherPath(relocatedRoot), launcher(relocatedRoot), { mode: 0o755 })
  const replaceRoot = (value) => JSON.parse(JSON.stringify(value).replaceAll(first.root, relocatedRoot))
  const relocatedToolchain = replaceRoot(first.toolchain)
  const relocatedConfigurations = configurationPaths(relocatedRoot)
  relocatedToolchain.roots = [
    join(relocatedRoot, "tools"),
    join(relocatedRoot, "node_modules"),
    ...relocatedConfigurations
  ]
  relocatedToolchain.allowedRoots = [
    join(relocatedRoot, "tools"),
    join(relocatedRoot, "node_modules"),
    ...relocatedConfigurations
  ]
  relocatedToolchain.requiredRoots = [join(relocatedRoot, "tools"), join(relocatedRoot, "node_modules")]
  relocatedToolchain.configPaths = relocatedConfigurations
  const relocatedEnvironment = replaceRoot(first.environment)
  const relocated = await startFormalInputGuard({
    worktree: relocatedRoot,
    effectiveEnvironment: relocatedEnvironment,
    profile: first.profile,
    toolchain: relocatedToolchain
  })
  cleanups.push(() => relocated.close())
  await relocated.finish()
  assert.notEqual(relocated.identity.inputDigest, original.inputDigest)
  assert.equal(relocated.identity.applicabilityDigest, original.applicabilityDigest)
  assert.deepEqual(relocated.identity.applicability, original.applicability)
  assert.equal(JSON.stringify(original.applicability).includes(".apalache.cfg"), false)

  writeFileSync(launcherPath(relocatedRoot), launcher(relocatedRoot, "../../../../other/bin/tool.js"), { mode: 0o755 })
  const changedLauncher = await startFormalInputGuard({
    worktree: relocatedRoot,
    effectiveEnvironment: relocatedEnvironment,
    profile: first.profile,
    toolchain: relocatedToolchain
  })
  cleanups.push(() => changedLauncher.close())
  assert.notEqual(changedLauncher.identity.applicabilityDigest, original.applicabilityDigest)
  await changedLauncher.close()
  writeFileSync(
    launcherPath(relocatedRoot),
    launcher(relocatedRoot).replace("if [ -x", "export NODE_OPTIONS=--require=/tmp/hook.cjs\nif [ -x"),
    { mode: 0o755 }
  )
  const changedLauncherEnvironment = await startFormalInputGuard({
    worktree: relocatedRoot,
    effectiveEnvironment: relocatedEnvironment,
    profile: first.profile,
    toolchain: relocatedToolchain
  })
  cleanups.push(() => changedLauncherEnvironment.close())
  assert.notEqual(changedLauncherEnvironment.identity.applicabilityDigest, original.applicabilityDigest)
  await changedLauncherEnvironment.close()
  writeFileSync(
    launcherPath(relocatedRoot),
    launcher(
      relocatedRoot,
      "../../../../tool-package/bin/tool.js",
      "{checkout}/node_modules/.pnpm/tool-package/node_modules"
    ),
    { mode: 0o755 }
  )
  const literalPlaceholder = await startFormalInputGuard({
    worktree: relocatedRoot,
    effectiveEnvironment: relocatedEnvironment,
    profile: first.profile,
    toolchain: relocatedToolchain
  })
  cleanups.push(() => literalPlaceholder.close())
  assert.notEqual(literalPlaceholder.identity.applicabilityDigest, original.applicabilityDigest)
  await literalPlaceholder.close()
  writeFileSync(launcherPath(relocatedRoot), launcher(relocatedRoot), { mode: 0o755 })

  writeFileSync(join(relocatedRoot, "specs/model.qnt"), "module fixture { val changed = true }\n")
  const changed = await startFormalInputGuard({
    worktree: relocatedRoot,
    effectiveEnvironment: relocatedEnvironment,
    profile: first.profile,
    toolchain: relocatedToolchain
  })
  cleanups.push(() => changed.close())
  assert.notEqual(changed.identity.applicabilityDigest, original.applicabilityDigest)
})

test("discovers direct and transitive JavaScript helpers without including their siblings", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./direct.mjs"\nimport "./required.cjs"\n')
  writeFileSync(
    join(f.root, "scripts/direct.mjs"),
    'export { value } from "./transitive.mjs"\nexport const dynamic = import("./transitive.mjs")\n'
  )
  writeFileSync(join(f.root, "scripts/transitive.mjs"), "export const value = 1\n")
  writeFileSync(
    join(f.root, "scripts/required.cjs"),
    'require("./required-helper.cjs"); require.resolve("./resolved-helper.cjs")\n'
  )
  writeFileSync(join(f.root, "scripts/required-helper.cjs"), "exports.required = true\n")
  writeFileSync(join(f.root, "scripts/resolved-helper.cjs"), "exports.resolved = true\n")
  writeFileSync(join(f.root, "scripts/sibling.test.mjs"), "throw new Error('not executed')\n")
  const original = await f.identity()
  for (const selected of ["direct.mjs", "transitive.mjs", "required.cjs", "required-helper.cjs", "resolved-helper.cjs"])
    assert.equal(
      original.sourceManifest.some((entry) => entry.path.endsWith(selected)),
      true
    )
  writeFileSync(join(f.root, "scripts/transitive.mjs"), "export const value = 2\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
  const changed = await f.identity()
  writeFileSync(join(f.root, "scripts/sibling.test.mjs"), "export const repaired = true\n")
  assert.equal((await f.identity()).inputDigest, changed.inputDigest)
})

test("tracks the spawned admission entry and its transitive helpers", async () => {
  const f = fixture()
  const original = await f.identity()
  writeFileSync(join(f.root, "scripts/run-admitted-gate.mjs"), 'import "./gate-run-identity.mjs"\n')
  writeFileSync(join(f.root, "scripts/gate-run-identity.mjs"), 'export { policy } from "./gate-slot-policy.mjs"\n')
  writeFileSync(join(f.root, "scripts/gate-slot-policy.mjs"), "export const policy = 1\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
  const entry = await f.identity()
  writeFileSync(join(f.root, "scripts/gate-slot-policy.mjs"), "export const policy = 2\n")
  assert.notEqual((await f.identity()).inputDigest, entry.inputDigest)
})

test("resolves a symlink-imported module's children from the real importer", async () => {
  const f = fixture()
  mkdirSync(join(f.root, "scripts/alias"))
  mkdirSync(join(f.root, "scripts/real"))
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./alias/entry.mjs"\n')
  writeFileSync(join(f.root, "scripts/real/entry.mjs"), 'import "./helper.mjs"\n')
  writeFileSync(join(f.root, "scripts/real/helper.mjs"), "export const actual = 1\n")
  writeFileSync(join(f.root, "scripts/alias/helper.mjs"), "export const conflicting = 1\n")
  symlinkSync("../real/entry.mjs", join(f.root, "scripts/alias/entry.mjs"))
  const original = await f.identity()
  assert.equal(
    original.sourceManifest.some((entry) => entry.path.endsWith("scripts/real/helper.mjs")),
    true
  )
  assert.equal(
    original.sourceManifest.some((entry) => entry.path.endsWith("scripts/alias/helper.mjs")),
    false
  )
  writeFileSync(join(f.root, "scripts/alias/helper.mjs"), "export const conflicting = 2\n")
  assert.equal((await f.identity()).inputDigest, original.inputDigest)
  writeFileSync(join(f.root, "scripts/real/helper.mjs"), "export const actual = 2\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
})

test("uses distinct exact ESM and Node CommonJS resolution rules", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./selector.cjs"\n')
  writeFileSync(join(f.root, "scripts/selector.cjs"), 'require("./helper"); require.resolve("./data")\n')
  writeFileSync(join(f.root, "scripts/helper.js"), "exports.selected = true\n")
  writeFileSync(join(f.root, "scripts/helper.mjs"), "export const unselected = true\n")
  writeFileSync(join(f.root, "scripts/data.json"), '{"selected":true}\n')
  const original = await f.identity()
  assert.equal(
    original.sourceManifest.some((entry) => entry.path.endsWith("scripts/helper.js")),
    true
  )
  assert.equal(
    original.sourceManifest.some((entry) => entry.path.endsWith("scripts/helper.mjs")),
    false
  )
  assert.equal(
    original.sourceManifest.some((entry) => entry.path.endsWith("scripts/data.json")),
    true
  )
  writeFileSync(join(f.root, "scripts/helper.mjs"), "export const unselected = false\n")
  assert.equal((await f.identity()).inputDigest, original.inputDigest)
  writeFileSync(join(f.root, "scripts/helper.js"), "exports.selected = false\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)

  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./extensionless"\n')
  writeFileSync(join(f.root, "scripts/extensionless.js"), "export const notExact = true\n")
  await assert.rejects(f.guard(), /Missing repository formal source import/u)

  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./native-selector.cjs"\n')
  writeFileSync(join(f.root, "scripts/native-selector.cjs"), 'require("./native")\n')
  writeFileSync(join(f.root, "scripts/native.node"), "not a native module\n")
  await assert.rejects(f.guard(), /Unsupported repository native CommonJS input/u)
})

test("fails closed when extensionless CommonJS selection would lose a lexical symlink", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./selector.cjs"\n')
  writeFileSync(join(f.root, "scripts/selector.cjs"), 'require("./helper")\n')
  writeFileSync(join(f.root, "scripts/actual-helper.js"), "exports.actual = true\n")
  symlinkSync("actual-helper.js", join(f.root, "scripts/helper.js"))
  await assert.rejects(f.guard(), /Unsupported repository extensionless CommonJS symlink resolution/u)
})

test("fails closed when CommonJS selection starts through a symlinked directory", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./selector.cjs"\n')
  writeFileSync(join(f.root, "scripts/selector.cjs"), 'require("./linked-package")\n')
  mkdirSync(join(f.root, "scripts/actual-package"))
  writeFileSync(join(f.root, "scripts/actual-package/index.js"), "exports.actual = true\n")
  symlinkSync("actual-package", join(f.root, "scripts/linked-package"))
  await assert.rejects(f.guard(), /Unsupported repository CommonJS symlinked directory import/u)
})

test("discovers selected, negative-control, and recursively imported Quint inputs only", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "specs/model.qnt"), 'module fixture { import helper.* from "./helper" }\n')
  writeFileSync(join(f.root, "specs/helper.qnt"), "module helper {}\n")
  writeFileSync(join(f.root, "specs/negative-control.qnt"), "module negative {}\n")
  f.profile.commands.push({ args: ["test", "specs/negative-control.qnt", "--main", "negative"] })
  const original = await f.identity()
  writeFileSync(join(f.root, "specs/helper.qnt"), "module helper { val changed = true }\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
  const transitive = await f.identity()
  writeFileSync(join(f.root, "specs/negative-control.qnt"), "module negative { val changed = true }\n")
  assert.notEqual((await f.identity()).inputDigest, transitive.inputDigest)
  const selected = await f.identity()
  writeFileSync(join(f.root, "specs/experiment.qnt"), "module experiment { val changed = true }\n")
  assert.equal((await f.identity()).inputDigest, selected.inputDigest)
})

test("retained exact observation ignores unrelated script mutation but rejects imported dependency disappearance", async () => {
  const f = fixture()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./helper.mjs"\n')
  writeFileSync(join(f.root, "scripts/helper.mjs"), "export const helper = true\n")
  const g = await f.guard()
  const sibling = join(f.root, "scripts/unrelated.test.mjs")
  writeFileSync(sibling, "assert(false)\n")
  writeFileSync(sibling, "assert(true)\n")
  rmSync(sibling)
  assert.equal((await g.finish()).inputDigest, g.identity.inputDigest)
  rmSync(join(f.root, "scripts/helper.mjs"))
  await assert.rejects(g.finish(), /dirty|error|missing/u)
})

test("rejects non-literal repository dependency discovery", async () => {
  const f = fixture()
  writeFileSync(
    join(f.root, "scripts/run-formal-gate.mjs"),
    "const dependency = './helper.mjs'; await import(dependency)\n"
  )
  await assert.rejects(f.guard(), /Unsupported non-literal dynamic import/u)
})

test("reruns after selected content, mode, or newly imported target changes", async () => {
  const f = fixture(),
    original = await f.identity()
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), "export const changed = true\n")
  assert.notEqual((await f.identity()).inputDigest, original.inputDigest)
  const next = await f.identity()
  chmodSync(join(f.root, "specs/model.qnt"), 0o755)
  assert.notEqual((await f.identity()).inputDigest, next.inputDigest)
  const mode = await f.identity()
  writeFileSync(join(f.root, "scripts/helper.mjs"), "export const helper = 1\n")
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'export { helper } from "./helper.mjs"\n')
  assert.notEqual((await f.identity()).inputDigest, mode.inputDigest)
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
      const p = join(f.root, "specs/model.qnt")
      const original = readFileSync(p)
      writeFileSync(p, "module temporary {}\n")
      writeFileSync(p, original)
    }
  ],
  [
    "reuse link replacement",
    (f) => {
      const p = join(f.root, "scripts/run-formal-gate.mjs")
      const original = readFileSync(p)
      rmSync(p)
      symlinkSync("run-formal-workflow.mjs", p)
      rmSync(p)
      writeFileSync(p, original)
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
  writeFileSync(join(f.outer, "external.qnt"), "module external {}\n")
  symlinkSync(join(f.outer, "external.qnt"), join(f.root, "specs/external.qnt"))
  writeFileSync(join(f.root, "specs/model.qnt"), 'module fixture { import external.* from "./external" }\n')
  await assert.rejects(f.guard(), /Undeclared external/u)
  writeFileSync(join(f.root, "specs/model.qnt"), "module fixture {}\n")
  rmSync(join(f.root, "specs/external.qnt"))
  symlinkSync("cycle.mjs", join(f.root, "scripts/cycle.mjs"))
  writeFileSync(join(f.root, "scripts/run-formal-gate.mjs"), 'import "./cycle.mjs"\n')
  await assert.rejects(f.guard(), /levels of symbolic links|loop|ELOOP/u)
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
  rmSync(join(f.root, "specs/model.qnt"))
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
  await assert.rejects(f.guard(), /Quint import leaves the worktree/u)
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
    await assert.rejects(f.guard(), /Quint import leaves the worktree/u)
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
    let observers = 0
    let drains = 0
    let aborted = false
    const g = await f.guard({
      startObserver: async ({ signal }) => {
        observers += 1
        const exact = observers === 2
        return {
          assertUnchanged: async () => {
            if (!exact) return
            drains += 1
            if (drains <= 2) return
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
        }
      }
    })
    await assert.rejects(g.finish({ timeoutMilliseconds: 25 }), /remaining deadline/u)
    assert.equal(aborted, true)
    assert.equal(drains, 3)
    await assert.rejects(g.assertUnchanged(), /remaining deadline/u)
  }
)
