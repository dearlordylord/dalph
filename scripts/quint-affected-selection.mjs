import { candidateChangedPaths } from "./quality-check-selection.mjs"
import { discoverFormalSourcePaths } from "./formal-input-policy.mjs"
import { assertCompleteQuintHostedPartition, quintHostedModelFamilies } from "./quint-hosted-shards.mjs"

/** Select whole model families, retaining every negative control and deep proof.
 * Unmapped runtime/tool inputs conservatively require the complete portfolio.
 */
export const selectAffectedQuintFamilies = async ({ changedPaths, profile, worktree }) => {
  assertCompleteQuintHostedPartition(profile)
  if (!Array.isArray(changedPaths) || changedPaths.length === 0 || changedPaths.some((path) => !path.endsWith(".qnt")))
    return undefined
  const selected = []
  const covered = new Set()
  for (const family of quintHostedModelFamilies) {
    const commands = profile.commands.filter(({ position }) => position >= family.first && position <= family.last)
    const inputs = await discoverFormalSourcePaths({
      javascriptEntries: ["scripts/quint-model-obligations.mjs"],
      profile: { ...profile, commands },
      worktree
    })
    const affected = changedPaths.filter((path) => inputs.includes(path))
    if (affected.length > 0) {
      selected.push(family)
      for (const path of affected) covered.add(path)
    }
  }
  // Deleted/new unregistered models cannot silently disappear from proof selection.
  if (changedPaths.some((path) => !covered.has(path))) return undefined
  return selected.map(({ name }) => name)
}

export const createAffectedQuintSelection = (profile, familyNames) => {
  assertCompleteQuintHostedPartition(profile)
  if (!Array.isArray(familyNames) || familyNames.length === 0 || new Set(familyNames).size !== familyNames.length)
    throw new Error("Affected Quint selection requires distinct model families")
  const families = familyNames.map((name) => {
    const family = quintHostedModelFamilies.find((entry) => entry.name === name)
    if (family === undefined) throw new Error(`Unknown Quint model family: ${name}`)
    return family
  })
  const positions = profile.commands
    .filter(({ position }) => families.some(({ first, last }) => position >= first && position <= last))
    .map(({ position }) => position)
  const selected = new Set(positions)
  const steps = []
  let provenancePlaced = false
  for (const step of profile.steps) {
    if (step.kind !== "commands") continue
    const retained = step.positions.filter((position) => selected.has(position))
    if (retained.length === 0) continue
    if (retained.length !== step.positions.length) throw new Error("Affected selection splits a command family")
    const usesEvaluator = retained.some((position) => ["test", "sampled-run"].includes(profile.commands[position].kind))
    steps.push({
      ...step,
      positions: retained,
      serializedPrefix: !provenancePlaced && usesEvaluator ? Math.max(1, step.serializedPrefix) : step.serializedPrefix
    })
    if (!provenancePlaced && usesEvaluator) {
      steps.push({ kind: "evaluator-provenance" })
      provenancePlaced = true
    }
  }
  if (!provenancePlaced) throw new Error("Affected selection lacks evaluator preparation")
  return { positions, steps }
}

/** Both hosted producer and reader derive selection from the exact bound Git range. */
export const hostedAffectedQuintFamilies = ({ binding, profile, worktree = process.cwd() }) =>
  selectAffectedQuintFamilies({
    changedPaths:
      binding.baseSha === undefined ? undefined : candidateChangedPaths(binding.baseSha, binding.commitSha, worktree),
    profile,
    worktree
  })
