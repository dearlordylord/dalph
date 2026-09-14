import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, posix } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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
  hostedFormalInputManifestPath
])

const workflowJobSection = (workflow, name) => {
  const lines = workflow.split("\n")
  const start = lines.findIndex((line) => line === `  ${name}:`)
  if (start < 0) throw new Error(`Hosted formal manifest cannot identify workflow job ${name}`)
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/u.test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

const yamlScalar = (source) => {
  if ((source.startsWith('"') && source.endsWith('"')) || (source.startsWith("'") && source.endsWith("'")))
    return source.slice(1, -1)
  return source
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

const validateFormalJobEnvironment = (lines, job) => {
  const found = {}
  for (let index = 0; index < lines.length; index++) {
    const block = /^(\s*)env:\s*$/u.exec(lines[index])
    if (block === null) continue
    const indentation = block[1].length
    while (index + 1 < lines.length) {
      const next = lines[index + 1]
      if (next.trim() === "") {
        index++
        continue
      }
      const leading = /^\s*/u.exec(next)[0].length
      if (leading <= indentation) break
      index++
      const entry = new RegExp(`^ {${indentation + 2}}([A-Z][A-Z0-9_]*):\\s*(.+?)\\s*$`, "u").exec(next)
      if (entry === null || Object.hasOwn(found, entry[1]))
        throw new Error(`Hosted formal manifest does not support environment syntax in ${job}`)
      found[entry[1]] = yamlScalar(entry[2])
    }
  }
  if (JSON.stringify(found) !== JSON.stringify(supportedEnvironmentByJob[job]))
    throw new Error(`Hosted formal manifest requires the exact supported environment in ${job}`)
}

const formalWorkflowCommands = (workflow) => {
  if (/^(?:env|defaults):(?:\s|$)/mu.test(workflow))
    throw new Error("Hosted formal manifest does not support workflow-level environment or run defaults")
  const commands = []
  for (const job of ["formal-models", "formal-model-aggregate"]) {
    const lines = workflowJobSection(workflow, job)
    validateFormalJobEnvironment(lines, job)
    for (let index = 0; index < lines.length; index++) {
      if (/^\s+(?:shell|working-directory):/u.test(lines[index]))
        throw new Error(`Hosted formal manifest does not support a custom shell or working directory in ${job}`)
      const uses = /^        uses:\s*(.+?)\s*$/u.exec(lines[index])
      if (uses !== null) {
        const action = yamlScalar(uses[1])
        if (action.startsWith("./"))
          throw new Error(`Hosted formal manifest does not support a repository-local action in ${job}`)
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/u.test(action) && !action.startsWith("docker://"))
          throw new Error(`Hosted formal manifest does not support workflow action syntax in ${job}: ${action}`)
      }
      const run = /^        run:\s*(.*?)\s*$/u.exec(lines[index])
      if (run === null) continue
      if (run[1] === ">") throw new Error(`Hosted formal manifest does not support a folded run command in ${job}`)
      if (run[1] !== "|") {
        commands.push(yamlScalar(run[1]))
        continue
      }
      while (index + 1 < lines.length && (lines[index + 1].trim() === "" || /^ {10,}/u.test(lines[index + 1]))) {
        index++
        if (lines[index].trim() !== "") commands.push(lines[index].trim())
      }
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

const rootLifecycleEntries = (packageJson) => {
  for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
    const script = packageJson.scripts?.[name]
    if (script === undefined) continue
    if (name === "prepare" && script === "husky && effect-tsgo patch --typescript-package @typescript/native") continue
    throw new Error(`Hosted formal package lifecycle ${name} has an unsupported command shape`)
  }
  return []
}

const inertFormalCommands = new Set([
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

export const hostedWorkflowCommandEntries = ({ packageJson, workflow }) => {
  const entries = []
  for (const command of formalWorkflowCommands(workflow)) {
    if (command === "pnpm install --frozen-lockfile") {
      entries.push(...rootLifecycleEntries(packageJson))
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

const hostedCommandEntries = async (worktree, packageJson) => {
  const workflow = await readFile(join(worktree, ".github/workflows/ci.yml"), "utf8")
  const workflowEntries = hostedWorkflowCommandEntries({ packageJson, workflow })
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
  const packageJson = JSON.parse(await readFile(join(worktree, "package.json"), "utf8"))
  const quintPatches = Object.entries(packageJson.pnpm?.patchedDependencies ?? {})
    .filter(([name]) => name.startsWith("@informalsystems/quint@"))
    .map(([, path]) => path)
  if (quintPatches.length !== 1 || quintPatches.some((path) => typeof path !== "string"))
    throw new Error("Hosted formal manifest requires one selected Quint patch input")
  const discovered = await discoverFormalSourcePaths({
    javascriptEntries: await hostedCommandEntries(worktree, packageJson),
    profile: createQuintEffectiveProfile({ purpose: "hosted" }),
    worktree
  })
  return createHostedFormalInputManifest([...hostedBootstrapInputs, ...quintPatches, ...discovered])
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
