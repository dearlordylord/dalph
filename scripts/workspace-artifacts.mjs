import { lstat, readFile, readdir } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const SECOND = 1_000

const readProductionPackages = async (repositoryRoot) => {
  const packagesRoot = join(repositoryRoot, "packages")
  const entries = await readdir(packagesRoot, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const root = join(packagesRoot, entry.name)
        const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
        return { manifest, root }
      })
  )
}

const requireBuildScripts = (packages) => {
  for (const workspacePackage of packages) {
    const packageName = workspacePackage.manifest.name ?? workspacePackage.root
    if (
      typeof workspacePackage.manifest.scripts?.build !== "string" ||
      workspacePackage.manifest.scripts.build.trim() === ""
    ) {
      throw new Error(`${packageName} must declare a nonempty scripts.build`)
    }
  }
}

const targetLeaves = (value, owner) => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => targetLeaves(entry, owner))
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((entry) => targetLeaves(entry, owner))
  }
  throw new Error(`${owner} contains a package target that is not a string, array, or condition object`)
}

const requiredArtifact = async ({ packageName, packageRoot, target }) => {
  const normalizedTarget = target.startsWith("./") ? target.slice(2) : target
  const distRoot = resolve(packageRoot, "dist")
  const artifactPath = resolve(packageRoot, normalizedTarget)
  const pathBelowDist = relative(distRoot, artifactPath)
  if (
    normalizedTarget === "" ||
    isAbsolute(normalizedTarget) ||
    pathBelowDist === "" ||
    pathBelowDist === ".." ||
    pathBelowDist.startsWith(`..${sep}`) ||
    isAbsolute(pathBelowDist)
  ) {
    throw new Error(`${packageName} package target must stay below dist: ${target}`)
  }
  const status = await lstat(artifactPath).catch(() => undefined)
  if (status === undefined || !status.isFile()) throw new Error(`${packageName} package target is missing: ${target}`)
  return normalizedTarget.replaceAll("\\", "/")
}

const packageTargets = async (workspacePackage) => {
  const { manifest, root } = workspacePackage
  const packageName = manifest.name ?? root
  if (manifest.exports === undefined) throw new Error(`${packageName} must declare package exports`)
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
    throw new Error(`${packageName} must package only its dist directory`)
  }
  const exports = await Promise.all(
    targetLeaves(manifest.exports, `${packageName} exports`).map((target) =>
      requiredArtifact({ packageName, packageRoot: root, target })
    )
  )
  const binEntries =
    typeof manifest.bin === "string" ? [[packageName, manifest.bin]] : Object.entries(manifest.bin ?? {})
  const bins = await Promise.all(
    binEntries.map(async ([binName, target]) => {
      if (typeof target !== "string") throw new Error(`${packageName} bin ${binName} target must be a string`)
      const path = await requiredArtifact({ packageName, packageRoot: root, target })
      const source = await readFile(join(root, path), "utf8")
      if (!source.startsWith("#!/usr/bin/env node\n")) {
        throw new Error(`${packageName} bin ${binName} must begin with #!/usr/bin/env node`)
      }
      return { name: binName, path }
    })
  )
  return { bins, exports, packageName, root }
}

const packFilePaths = (output, packageName) => {
  let report
  try {
    report = JSON.parse(output)
  } catch {
    throw new Error(`${packageName} pnpm pack --dry-run did not return JSON`)
  }
  if (report === null || typeof report !== "object" || !Array.isArray(report.files)) {
    throw new Error(`${packageName} pnpm pack --dry-run returned an invalid file inventory`)
  }
  return report.files.map((file) => {
    if (file === null || typeof file !== "object" || typeof file.path !== "string") {
      throw new Error(`${packageName} pnpm pack --dry-run returned an invalid file entry`)
    }
    return file.path
  })
}

const validateBuiltWorkspaceArtifacts = async ({ packages, pnpmEntryPoint, repositoryRoot, runCommand }) => {
  const targets = await Promise.all(packages.map(packageTargets))
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "check:package-boundary"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Production package boundary",
    relayParentSignals: true,
    timeoutMilliseconds: 60 * SECOND
  })
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "exec", "tsc", "-p", "tsconfig.artifacts.json", "--noEmit"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Artifact declaration resolution",
    relayParentSignals: true,
    timeoutMilliseconds: 2 * 60 * SECOND
  })
  await runCommand({
    args: [
      "--input-type=module",
      "--eval",
      "await Promise.all(process.argv.slice(1).map((packageName) => import(packageName)))",
      ...targets.map(({ packageName }) => packageName)
    ],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Artifact runtime export imports",
    relayParentSignals: true,
    timeoutMilliseconds: 30 * SECOND
  })
  for (const target of targets) {
    for (const bin of target.bins) {
      await runCommand({
        args: ["--check", join(target.root, bin.path)],
        cwd: repositoryRoot,
        executable: process.execPath,
        name: `${target.packageName} bin ${bin.name} syntax`,
        relayParentSignals: true,
        timeoutMilliseconds: 30 * SECOND
      })
    }
  }
  for (const target of targets) {
    const result = await runCommand({
      args: [pnpmEntryPoint, "--silent", "--filter", target.packageName, "pack", "--dry-run", "--json"],
      captureOutput: true,
      cwd: repositoryRoot,
      executable: process.execPath,
      forwardOutput: false,
      name: `${target.packageName} package contents`,
      relayParentSignals: true,
      timeoutMilliseconds: 30 * SECOND
    })
    const files = packFilePaths(result.output, target.packageName)
    const unexpected = files.filter((path) => path !== "package.json" && !path.startsWith("dist/"))
    if (unexpected.length > 0) {
      throw new Error(
        `${target.packageName} package contains files outside package.json and dist: ${unexpected.join(", ")}`
      )
    }
    for (const path of [...target.exports, ...target.bins.map((bin) => bin.path)]) {
      if (!files.includes(path)) throw new Error(`${target.packageName} package omits declared artifact: ${path}`)
    }
  }
}

export const validateWorkspaceArtifacts = async ({
  pnpmEntryPoint = process.env.npm_execpath,
  repositoryRoot = fileURLToPath(new URL("../", import.meta.url)),
  runCommand = runBoundedCommand
} = {}) => {
  if (pnpmEntryPoint === undefined) {
    throw new Error("Run artifact validation through pnpm so the pinned executable can be resolved safely")
  }
  const packages = await readProductionPackages(repositoryRoot)
  requireBuildScripts(packages)
  await validateBuiltWorkspaceArtifacts({ packages, pnpmEntryPoint, repositoryRoot, runCommand })
}

export const prepareWorkspaceArtifacts = async ({
  pnpmEntryPoint = process.env.npm_execpath,
  repositoryRoot = fileURLToPath(new URL("../", import.meta.url)),
  runCommand = runBoundedCommand
} = {}) => {
  if (pnpmEntryPoint === undefined) {
    throw new Error("Run artifact preparation through pnpm so the pinned executable can be resolved safely")
  }
  const packages = await readProductionPackages(repositoryRoot)
  requireBuildScripts(packages)
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "build"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Workspace production build",
    relayParentSignals: true,
    timeoutMilliseconds: 2 * 60 * SECOND
  })
  await validateBuiltWorkspaceArtifacts({ packages, pnpmEntryPoint, repositoryRoot, runCommand })
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await prepareWorkspaceArtifacts()
}
