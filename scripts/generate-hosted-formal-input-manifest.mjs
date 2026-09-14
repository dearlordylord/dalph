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

const hostedCommandEntries = async (worktree, packageJson) => {
  const shardCommand = packageJson.scripts?.["check:ci:formal:shard"]
  const shard =
    typeof shardCommand === "string"
      ? /^node (scripts\/[A-Za-z0-9._/-]+\.mjs) -- node (scripts\/[A-Za-z0-9._/-]+\.mjs)$/u.exec(shardCommand)
      : null
  if (shard === null) throw new Error("Hosted formal manifest cannot identify the package shard command entries")

  const workflow = await readFile(join(worktree, ".github/workflows/ci.yml"), "utf8")
  if (/^\s+uses:\s+\.\//mu.test(workflow))
    throw new Error("Hosted formal manifest does not support an undiscovered repository-local workflow action")
  const aggregateEntries = [
    ...workflow.matchAll(/^\s+run: node (scripts\/[A-Za-z0-9._/-]+\.mjs) formal-shard-reports\//gmu)
  ].map((match) => match[1])
  if (aggregateEntries.length !== 1 || !workflow.includes("run: pnpm check:ci:formal:shard --shard"))
    throw new Error("Hosted formal manifest cannot identify the workflow shard and aggregate commands")

  const withGateEntry = shard[1]
  const withGateSource = await readFile(join(worktree, withGateEntry), "utf8")
  const admittedEntries = [
    ...withGateSource.matchAll(/new URL\("(\.\/[A-Za-z0-9._/-]+\.mjs)", import\.meta\.url\)/gmu)
  ].map((match) => posix.join(posix.dirname(withGateEntry), match[1]))
  if (admittedEntries.length !== 1)
    throw new Error("Hosted formal manifest cannot identify the admitted gate command entry")
  return [...hostedPolicyEntries, shard[1], shard[2], ...admittedEntries, ...aggregateEntries]
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
