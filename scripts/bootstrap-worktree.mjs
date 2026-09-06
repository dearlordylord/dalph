import { lstat, readFile, readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const SECOND = 1_000

const declaredWorkspaceBins = async (repositoryRoot) => {
  const packagesRoot = join(repositoryRoot, "packages")
  const entries = await readdir(packagesRoot, { withFileTypes: true })
  const bins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(await readFile(join(packagesRoot, entry.name, "package.json"), "utf8"))
    const declaredBins = typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : (manifest.bin ?? {})
    for (const binName of Object.keys(declaredBins)) {
      if (basename(binName) !== binName) throw new Error(`${manifest.name} declares an invalid bin name: ${binName}`)
      bins.push(binName)
    }
  }
  return bins.toSorted()
}

const validateWorkspaceBinLaunchers = async (repositoryRoot) => {
  for (const binName of await declaredWorkspaceBins(repositoryRoot)) {
    const launcherName = process.platform === "win32" ? `${binName}.cmd` : binName
    const launcher = join(repositoryRoot, "node_modules", ".bin", launcherName)
    const status = await lstat(launcher).catch(() => undefined)
    if (status === undefined || (!status.isFile() && !status.isSymbolicLink())) {
      throw new Error(`workspace bin launcher is missing: ${binName}`)
    }
  }
}

export const bootstrapWorktree = async ({
  gitExecutable = "git",
  pnpmEntryPoint = process.env.npm_execpath,
  repositoryRoot = fileURLToPath(new URL("../", import.meta.url)),
  runCommand = runBoundedCommand
} = {}) => {
  if (pnpmEntryPoint === undefined) {
    throw new Error("Run worktree bootstrap through pnpm so the pinned executable can be resolved safely")
  }
  const gitmodules = await lstat(join(repositoryRoot, ".gitmodules")).catch(() => undefined)
  if (gitmodules?.isFile()) {
    await runCommand({
      args: ["submodule", "update", "--init", "--recursive"],
      cwd: repositoryRoot,
      executable: gitExecutable,
      name: "Workspace submodule initialization",
      relayParentSignals: true,
      timeoutMilliseconds: 2 * 60 * SECOND
    })
  }
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "install", "--frozen-lockfile"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Frozen workspace install",
    relayParentSignals: true,
    timeoutMilliseconds: 5 * 60 * SECOND
  })
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "check:artifacts"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Workspace artifact preparation",
    relayParentSignals: true,
    timeoutMilliseconds: 5 * 60 * SECOND
  })
  await runCommand({
    args: [pnpmEntryPoint, "--silent", "install", "--frozen-lockfile", "--ignore-scripts"],
    cwd: repositoryRoot,
    executable: process.execPath,
    name: "Workspace bin relink",
    relayParentSignals: true,
    timeoutMilliseconds: 5 * 60 * SECOND
  })
  await validateWorkspaceBinLaunchers(repositoryRoot)
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await bootstrapWorktree()
}
