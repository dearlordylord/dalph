import { readFile, readdir } from "node:fs/promises"
import { URL } from "node:url"

const forbiddenPathFragments = [".test."]
const allowedWorkspaceDependencies = {
  contracts: [],
  dalph: ["contracts", "executor", "orchestrator"],
  executor: ["contracts"],
  orchestrator: ["contracts"]
}
const forbiddenSourceImports = {
  contracts: ["dalph", "executor", "orchestrator"],
  dalph: [],
  executor: ["dalph", "orchestrator"],
  orchestrator: ["dalph", "executor"]
}

const filesBelow = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)
    return entry.isDirectory() ? filesBelow(url) : [url]
  }))
  return nested.flat()
}

for (const [packageName, allowedDependencies] of Object.entries(allowedWorkspaceDependencies)) {
  const packageRoot = new URL(`../packages/${packageName}/`, import.meta.url)
  const buildOutput = new URL("dist/", packageRoot)
  const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"))
  if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
    throw new Error(`@dalph/${packageName} must package only its dist directory`)
  }

  const workspaceDependencies = Object.keys(manifest.dependencies ?? {})
    .filter((dependency) => dependency.startsWith("@dalph/"))
    .map((dependency) => dependency.slice("@dalph/".length))
    .sort()
  if (JSON.stringify(workspaceDependencies) !== JSON.stringify(allowedDependencies)) {
    throw new Error(
      `@dalph/${packageName} workspace dependencies must be ${allowedDependencies.join(", ") || "empty"}; found ${
        workspaceDependencies.join(", ") || "empty"
      }`
    )
  }

  const emittedFiles = await filesBelow(buildOutput)
  for (const file of emittedFiles) {
    const relativePath = decodeURIComponent(file.href.slice(buildOutput.href.length))
    if (forbiddenPathFragments.some((fragment) => relativePath.includes(fragment))) {
      throw new Error(`test support was emitted in @dalph/${packageName}: ${relativePath}`)
    }
    if (relativePath.endsWith(".d.ts")) {
      const declaration = await readFile(file, "utf8")
      if (/(?:from\s+|import\()["'][^"']+\.ts["']/u.test(declaration)) {
        throw new Error(`TypeScript source import was emitted in @dalph/${packageName}: ${relativePath}`)
      }
    }
  }

  const sourceFiles = (await filesBelow(new URL("src/", packageRoot))).filter(
    (file) => file.pathname.endsWith(".ts") && !file.pathname.endsWith(".test.ts")
  )
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8")
    for (const forbiddenDependency of forbiddenSourceImports[packageName]) {
      if (source.includes(`"@dalph/${forbiddenDependency}"`)) {
        throw new Error(`@dalph/${packageName} imports forbidden @dalph/${forbiddenDependency}: ${file.pathname}`)
      }
    }
  }
}
