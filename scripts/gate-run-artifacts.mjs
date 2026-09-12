import { existsSync, lstatSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { artifactEvidence } from "./gate-run-evidence.mjs"

const filesBelow = (root) => {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const path = join(root, name)
      const status = lstatSync(path)
      if (status.isDirectory()) return filesBelow(path)
      if (!status.isFile()) throw new Error(`Unsupported generated artifact: ${path}`)
      return [artifactEvidence(path)]
    })
}
/** Persist byte evidence for the generated outputs that this stage qualifies, without caching stage execution. */
export const stageArtifactEvidence = ({ command, run }) => {
  const artifacts = []
  if (command.args.some((argument) => ["build", "check:artifacts"].includes(argument))) {
    const packages = join(run.worktree, "packages")
    if (existsSync(packages))
      for (const name of readdirSync(packages).sort()) artifacts.push(...filesBelow(join(packages, name, "dist")))
  }
  if (command.args.includes("check:lab"))
    artifacts.push(...filesBelow(join(run.worktree, "prototypes", "reducer-lab", "dist")))
  return artifacts
}
