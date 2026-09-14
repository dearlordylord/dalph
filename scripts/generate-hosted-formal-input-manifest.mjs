import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"
import { parse as parseYaml } from "yaml"

import { discoverFormalSourcePaths } from "./formal-input-policy.mjs"
import {
  createHostedFormalInputManifest,
  hostedFormalInputManifestPath,
  serializeHostedFormalInputManifest
} from "./hosted-formal-input-manifest.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const hostedPolicyEntries = Object.freeze([
  "scripts/classify-docs-only-change.mjs",
  "scripts/generate-hosted-formal-input-manifest.mjs"
])
const hostedBootstrapInputs = Object.freeze([
  ".github/workflows/ci.yml",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  hostedFormalInputManifestPath
])
const executableConformanceAdapters = async (worktree) =>
  (await readdir(join(worktree, "packages/dalph/test/conformance"), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".mbt.test.ts") &&
        // This infrastructure control proves Vitest resolves source rather than
        // dist output; it does not execute a Quint model or govern runtime behavior.
        entry.name !== "workspace-source-resolution.mbt.test.ts"
    )
    .map((entry) => posix.join("packages/dalph/test/conformance", entry.name))

const repositoryPath = (worktree, path) => {
  const value = relative(worktree, path)
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) return undefined
  const normalized = value.split(sep).join(posix.sep)
  return normalized === "node_modules" || normalized.startsWith("node_modules/") ? undefined : normalized
}

const typescriptModuleSpecifiers = (source, sourcePath) => {
  const syntax = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true)
  const specifiers = new Set()
  const add = (node, syntaxKind) => {
    if (!ts.isStringLiteralLike(node))
      throw new Error(`Hosted formal manifest does not support non-literal ${syntaxKind} in ${sourcePath}`)
    specifiers.add(node.text)
  }
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined)
      add(node.moduleSpecifier, "module source")
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      add(node.moduleReference.expression, "import assignment")
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1) throw new Error(`Unsupported dynamic import in ${sourcePath}`)
        add(node.arguments[0], "dynamic import")
      } else if (
        (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "require" &&
          node.expression.name.text === "resolve")
      ) {
        if (node.arguments.length !== 1) throw new Error(`Unsupported require call in ${sourcePath}`)
        add(node.arguments[0], "require source")
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  return [...specifiers]
}

/** TypeScript resolves the executable adapter graph, including its workspace
 * aliases and `.js` source specifiers, without broadening it to unrelated
 * production files. */
const discoverExecutableConformancePaths = async (worktree) => {
  const configPath = join(worktree, "tsconfig.json")
  const loaded = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path))
  if (loaded.error !== undefined)
    throw new Error(
      `Hosted formal manifest cannot read TypeScript configuration: ${ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n")}`
    )
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, worktree, undefined, configPath)
  if (config.errors.length > 0)
    throw new Error(
      `Hosted formal manifest cannot parse TypeScript configuration: ${ts.flattenDiagnosticMessageText(config.errors[0].messageText, "\n")}`
    )
  const pending = (await executableConformanceAdapters(worktree)).map((path) => join(worktree, path))
  const visited = new Set()
  while (pending.length > 0) {
    const path = resolve(pending.pop())
    const selected = repositoryPath(worktree, path)
    if (selected === undefined || visited.has(selected)) continue
    visited.add(selected)
    const source = await readFile(path, "utf8")
    const imports = typescriptModuleSpecifiers(source, selected)
    for (const specifier of imports) {
      const resolved = ts.resolveModuleName(specifier, path, config.options, ts.sys).resolvedModule?.resolvedFileName
      if (resolved === undefined) {
        if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@dalph/"))
          throw new Error(`Hosted formal manifest cannot resolve adapter import ${selected} -> ${specifier}`)
        continue
      }
      if (repositoryPath(worktree, resolved) !== undefined) pending.push(resolved)
    }
  }
  return [...visited].sort((left, right) => left.localeCompare(right))
}

const supportedEnvironmentByJob = Object.freeze({
  "formal-models": Object.freeze({
    DALPH_FORMAL_COMMIT_SHA: "${{ github.sha }}",
    DALPH_FORMAL_NODE_VERSION: "${{ matrix.node-version }}",
    NODE_OPTIONS: "--max-old-space-size=8192"
  }),
  "formal-model-aggregate": Object.freeze({
    DALPH_FORMAL_COMMIT_SHA: "${{ github.sha }}",
    DALPH_FORMAL_NODE_VERSION: "${{ matrix.node-version }}",
    DALPH_FORMAL_BASE_SHA: "${{ needs.change-plan.outputs.base-sha }}",
    DALPH_FORMAL_HEAD_SHA: "${{ needs.change-plan.outputs.head-sha }}",
    DALPH_FORMAL_CLASSIFICATION: "${{ needs.change-plan.outputs.formal-classification }}"
  })
})

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const hasExactKeys = (value, keys) =>
  isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const isExactFlatRecord = (value, expected) =>
  hasExactKeys(value, Object.keys(expected)) &&
  Object.entries(expected).every(([key, expectedValue]) => Object.is(value[key], expectedValue))

const supportedActionInputs = Object.freeze({
  "actions/checkout@v7": Object.freeze([{ "fetch-depth": 0 }]),
  "pnpm/action-setup@v6": Object.freeze([{ run_install: false, version: "10.29.3" }]),
  "actions/setup-node@v7": Object.freeze([
    { cache: "pnpm", "node-version": "${{ matrix.node-version }}" },
    { "node-version": "${{ matrix.node-version }}" }
  ]),
  "actions/upload-artifact@v4": Object.freeze([
    {
      name: "formal-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.node-version }}-${{ matrix.shard }}",
      path: "formal-shard-reports/shard-${{ matrix.shard }}.json",
      "if-no-files-found": "error",
      "retention-days": 1
    }
  ]),
  "actions/download-artifact@v4": Object.freeze([
    {
      pattern: "formal-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.node-version }}-*",
      path: "formal-shard-reports",
      "merge-multiple": true
    }
  ])
})

const supportedJobConditions = Object.freeze({
  "formal-models": "needs.change-plan.outputs.formal-required == 'true'",
  "formal-model-aggregate": "always()"
})
const supportedAggregateStepConditions = Object.freeze({
  "Refuse failed change plan": "needs.change-plan.result != 'success'",
  Checkout: "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'true'",
  "Set up Node.js": "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'true'",
  "Download formal model shard evidence":
    "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'true'",
  "Validate complete formal model evidence":
    "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'true'",
  "Report formal model gate not applicable":
    "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required == 'false'",
  "Refuse missing formal classification":
    "needs.change-plan.result == 'success' && needs.change-plan.outputs.formal-required != 'true' && needs.change-plan.outputs.formal-required != 'false'"
})

const validateFormalJobEnvironment = (environment, job) => {
  if (!isRecord(environment) || JSON.stringify(environment) !== JSON.stringify(supportedEnvironmentByJob[job]))
    throw new Error(`Hosted formal manifest requires the exact supported environment in ${job}`)
}

const formalWorkflowCommands = (workflow) => {
  const parsed = parseYaml(workflow)
  if (!isRecord(parsed) || !isRecord(parsed.jobs))
    throw new Error("Hosted formal manifest cannot identify workflow jobs")
  for (const key of ["env", "defaults", "shell", "working-directory"])
    if (Object.hasOwn(parsed, key)) throw new Error(`Hosted formal manifest does not support workflow-level ${key}`)
  const commands = []
  for (const job of ["formal-models", "formal-model-aggregate"]) {
    const definition = parsed.jobs[job]
    const jobKeys = ["name", "needs", "if", "runs-on", "timeout-minutes", "env", "strategy", "steps"]
    if (!hasExactKeys(definition, jobKeys) || !Array.isArray(definition.steps))
      throw new Error(`Hosted formal manifest cannot identify workflow job ${job}`)
    if (definition.if !== supportedJobConditions[job])
      throw new Error(`Hosted formal manifest requires the exact supported job condition in ${job}`)
    validateFormalJobEnvironment(definition.env, job)
    for (const step of definition.steps) {
      if (!isRecord(step)) throw new Error(`Hosted formal manifest does not support step syntax in ${job}`)
      const hasAction = Object.hasOwn(step, "uses")
      const hasCommand = Object.hasOwn(step, "run")
      if (hasAction && typeof step.uses === "string" && step.uses.startsWith("./"))
        throw new Error(`Hosted formal manifest does not support a repository-local action in ${job}`)
      const expectedStepKeys = hasAction
        ? job === "formal-models"
          ? ["name", "uses", "with"]
          : ["name", "if", "uses", "with"]
        : job === "formal-models"
          ? ["name", "run"]
          : ["name", "if", "run"]
      if (hasAction === hasCommand || !hasExactKeys(step, expectedStepKeys))
        throw new Error(`Hosted formal manifest does not support step syntax in ${job}`)
      const condition = step.if
      if (
        (job === "formal-models" && condition !== undefined) ||
        (job === "formal-model-aggregate" &&
          (!Object.hasOwn(supportedAggregateStepConditions, step.name) ||
            supportedAggregateStepConditions[step.name] !== condition))
      )
        throw new Error(`Hosted formal manifest does not support step condition in ${job}`)
      if (hasAction) {
        const action = step.uses
        if (typeof action !== "string")
          throw new Error(`Hosted formal manifest does not support workflow action syntax in ${job}`)
        const supportedInputs = supportedActionInputs[action]
        if (
          supportedInputs === undefined ||
          !supportedInputs.some((expected) => isExactFlatRecord(step.with, expected))
        )
          throw new Error(`Hosted formal manifest does not support workflow action inputs in ${job}: ${action}`)
      }
      if (!hasCommand) continue
      if (typeof step.run !== "string")
        throw new Error(`Hosted formal manifest does not support workflow run syntax in ${job}`)
      commands.push(...step.run.split("\n").filter((command) => command !== ""))
    }
  }
  return commands
}

const nodeEntry = (command) => {
  if (/[;&|`<>]|\$\(/u.test(command))
    throw new Error(`Hosted formal manifest does not support shell control syntax: ${command}`)
  const match = /^node ([A-Za-z0-9._/-]+\.(?:c?js|mjs|ts))(.*)$/u.exec(command)
  if (match === null || match[1].startsWith("/") || match[1].split("/").includes(".."))
    throw new Error(`Hosted formal manifest does not support workflow command: ${command}`)
  if (match[2] !== "" && !/^(?: formal-shard-reports\/[A-Za-z0-9._-]+\.json)+$/u.test(match[2]))
    throw new Error(`Hosted formal manifest does not support repository command arguments: ${command}`)
  return match[1].replace(/^\.\//u, "")
}

const lifecycleEntries = (packageJson, manifestPath, isRoot) => {
  for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
    const script = packageJson.scripts?.[name]
    if (script === undefined) continue
    if (isRoot && name === "prepare" && script === "husky && effect-tsgo patch --typescript-package @typescript/native")
      continue
    throw new Error(`Hosted formal package lifecycle ${name} in ${manifestPath} has an unsupported command shape`)
  }
  return []
}

const isWorkspaceDirectory = (path) =>
  typeof path === "string" &&
  path !== "" &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..")

const readPackageManifest = async (worktree, path, isRoot = false) => {
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(join(worktree, path), "utf8"))
  } catch (error) {
    throw new Error(`Hosted formal manifest cannot read workspace package manifest ${path}`, { cause: error })
  }
  if (!isRecord(packageJson))
    throw new Error(`Hosted formal workspace package manifest ${path} must contain a JSON object`)
  lifecycleEntries(packageJson, path, isRoot)
  return Object.freeze({ path, packageJson, isRoot })
}

const workspacePackageManifests = async (worktree) => {
  const workspacePath = join(worktree, "pnpm-workspace.yaml")
  const workspace = parseYaml(await readFile(workspacePath, "utf8"))
  if (!isRecord(workspace) || !Array.isArray(workspace.packages) || workspace.packages.length === 0)
    throw new Error("Hosted formal manifest requires an explicit pnpm workspace package declaration")
  const manifestPaths = []
  for (const pattern of workspace.packages) {
    if (pattern === ".") {
      manifestPaths.push("package.json")
      continue
    }
    if (typeof pattern !== "string")
      throw new Error("Hosted formal manifest does not support non-string pnpm workspace package patterns")
    if (pattern.endsWith("/*") && isWorkspaceDirectory(pattern.slice(0, -2))) {
      const parent = pattern.slice(0, -2)
      const children = await readdir(join(worktree, parent), { withFileTypes: true })
      for (const child of children) {
        if (child.isDirectory() || child.isSymbolicLink())
          manifestPaths.push(posix.join(parent, child.name, "package.json"))
      }
      continue
    }
    if (!isWorkspaceDirectory(pattern) || pattern.includes("*"))
      throw new Error(`Hosted formal manifest does not support pnpm workspace package pattern: ${pattern}`)
    manifestPaths.push(posix.join(pattern, "package.json"))
  }
  const uniquePaths = [...new Set(manifestPaths)].sort((left, right) => left.localeCompare(right))
  return Promise.all(uniquePaths.map((path) => readPackageManifest(worktree, path, path === "package.json")))
}

const inertFormalCommands = new Set([
  "printf 'Formal model change plan did not succeed; refusing a successful required check.\\n' >&2",
  "printf 'Formal model gate not applicable.\\n'",
  `printf 'Base SHA: %s\\n' "$DALPH_FORMAL_BASE_SHA"`,
  `printf 'Head SHA: %s\\n' "$DALPH_FORMAL_HEAD_SHA"`,
  `printf 'Classification: %s\\n' "$DALPH_FORMAL_CLASSIFICATION"`,
  "printf 'Formal model classification is missing; refusing a successful required check.\\n' >&2",
  "exit 1"
])
const shardWorkflowCommand =
  'pnpm check:ci:formal:shard --shard "${{ matrix.shard }}" --report "formal-shard-reports/shard-${{ matrix.shard }}.json"'
const shardPackageCommand = "node scripts/with-gate-slot.mjs -- node scripts/run-hosted-formal-shard.mjs"

export const hostedWorkflowCommandEntries = ({ packageJson, workflow, workspacePackages = [] }) => {
  const entries = []
  for (const command of formalWorkflowCommands(workflow)) {
    if (command === "pnpm install --frozen-lockfile") {
      entries.push(...lifecycleEntries(packageJson, "package.json", true))
      for (const workspacePackage of workspacePackages)
        entries.push(...lifecycleEntries(workspacePackage.packageJson, workspacePackage.path, workspacePackage.isRoot))
      continue
    }
    if (inertFormalCommands.has(command)) continue
    if (command === shardWorkflowCommand) {
      const script = packageJson.scripts?.["check:ci:formal:shard"]
      if (script !== shardPackageCommand)
        throw new Error("Hosted formal package shard script has an unsupported command shape")
      entries.push(...shardPackageCommand.split(" -- ").map(nodeEntry))
      continue
    }
    entries.push(nodeEntry(command))
  }
  if (entries.length === 0) throw new Error("Hosted formal workflow selects no repository command entries")
  return [...new Set(entries)]
}

const hostedCommandEntries = async (worktree, packageJson, workspacePackages) => {
  const workflow = await readFile(join(worktree, ".github/workflows/ci.yml"), "utf8")
  const workflowEntries = hostedWorkflowCommandEntries({ packageJson, workflow, workspacePackages })
  const withGateEntry = workflowEntries.find((entry) => posix.basename(entry) === "with-gate-slot.mjs")
  if (withGateEntry === undefined) throw new Error("Hosted formal workflow does not use the admitted gate entry")
  const withGateSource = await readFile(join(worktree, withGateEntry), "utf8")
  const admittedEntries = [
    ...withGateSource.matchAll(/new URL\("(\.\/[A-Za-z0-9._/-]+\.mjs)", import\.meta\.url\)/gmu)
  ].map((match) => posix.join(posix.dirname(withGateEntry), match[1]))
  if (admittedEntries.length !== 1)
    throw new Error("Hosted formal manifest cannot identify the admitted gate command entry")
  return [...hostedPolicyEntries, ...workflowEntries, ...admittedEntries]
}

export const deriveHostedFormalInputManifest = async (worktree = repositoryRoot) => {
  const workspacePackages = await workspacePackageManifests(worktree)
  const packageJson = workspacePackages.find(({ isRoot }) => isRoot)?.packageJson
  if (packageJson === undefined)
    throw new Error("Hosted formal manifest requires the root package in the pnpm workspace")
  const quintPatches = Object.entries(packageJson.pnpm?.patchedDependencies ?? {})
    .filter(([name]) => name.startsWith("@informalsystems/quint@"))
    .map(([, path]) => path)
  if (quintPatches.length !== 1 || quintPatches.some((path) => typeof path !== "string"))
    throw new Error("Hosted formal manifest requires one selected Quint patch input")
  const discovered = await discoverFormalSourcePaths({
    javascriptEntries: await hostedCommandEntries(worktree, packageJson, workspacePackages),
    profile: createQuintEffectiveProfile({ purpose: "hosted" }),
    worktree
  })
  return createHostedFormalInputManifest([
    ...hostedBootstrapInputs,
    ...workspacePackages.map(({ path }) => path),
    ...quintPatches,
    ...(await discoverExecutableConformancePaths(worktree)),
    ...discovered
  ])
}

export const expectedHostedFormalInputManifestText = async (worktree = repositoryRoot) =>
  serializeHostedFormalInputManifest(await deriveHostedFormalInputManifest(worktree))

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  const expected = await expectedHostedFormalInputManifestText()
  const manifest = join(repositoryRoot, hostedFormalInputManifestPath)
  if (process.argv.length !== 3 || !["--check", "--write"].includes(process.argv[2]))
    throw new Error("Usage: node scripts/generate-hosted-formal-input-manifest.mjs --check|--write")
  if (process.argv[2] === "--write") await writeFile(manifest, expected)
  else {
    const actual = await readFile(manifest, "utf8")
    if (actual !== expected)
      throw new Error(
        `Hosted formal input manifest is stale; run node ${join(dirname(manifest), "generate-hosted-formal-input-manifest.mjs")} --write`
      )
  }
}
