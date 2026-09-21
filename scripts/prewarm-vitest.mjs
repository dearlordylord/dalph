import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"

const DEFAULT_PREWARM_CONCURRENCY = 4

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

const defaultCreateVitest = async () => {
  const { createVitest } = await import("vitest/node")
  return createVitest
}

const ordinaryEnvironment = () => {
  // Bootstrap must never inherit opt-in qualification suites into a cache
  // prewarm. The cache is for the ordinary test-mode module graph only.
  const previous = new Map(
    ["DALPH_RUN_QUALIFICATION_TESTS", "DALPH_RUN_DELIVERY_REPEATABILITY", "DALPH_COVERAGE_DIRECTORY", "NODE_ENV"].map(
      (key) => [key, process.env[key]]
    )
  )
  process.env.DALPH_RUN_QUALIFICATION_TESTS = "0"
  process.env.DALPH_RUN_DELIVERY_REPEATABILITY = "0"
  delete process.env.DALPH_COVERAGE_DIRECTORY
  process.env.NODE_ENV = "test"
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const warmModuleGraph = async (specifications, concurrency) => {
  const warmed = new Set()
  const warm = async (project, moduleId, importer) => {
    const environmentName =
      project.config.environment === "jsdom" || project.config.environment === "happy-dom" ? "client" : "ssr"
    const environment = project.vite.environments[environmentName]
    if (environment === undefined) return
    if (typeof project._fetcher !== "function") throw new Error("Vitest prewarm project lacks its module fetcher")
    const key = `${environmentName}:${moduleId}`
    if (warmed.has(key)) return
    warmed.add(key)
    // Vite's public transformRequest path does not ask Vitest's filesystem
    // cache to persist the result. The pinned Vitest node API exposes this
    // internal fetcher as the same boundary used by test workers.
    const fetched = await project._fetcher(moduleId, importer, environment, true, {})
    if ("externalize" in fetched) return
    const moduleNode = environment.moduleGraph.getModuleById(fetched.id ?? moduleId)
    const dependencies = moduleNode?.importedModules ?? []
    await Promise.all(
      [...dependencies].map(async (dependency) => {
        if (!dependency.id.includes("node_modules")) await warm(project, dependency.id, fetched.id ?? moduleId)
      })
    )
  }

  const queue = specifications.filter((specification) => specification.project !== undefined)
  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      const specification = queue[cursor++]
      await warm(specification.project, specification.moduleId)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return warmed.size
}

/**
 * Transform and parse the ordinary Vitest module graph without executing tests.
 * The Vitest config owns the persistent filesystem cache policy.
 */
export const prewarmVitest = async ({
  concurrency = DEFAULT_PREWARM_CONCURRENCY,
  configPath = join(repositoryRoot, "vitest.config.ts"),
  createVitest = defaultCreateVitest,
  root = repositoryRoot
} = {}) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Vitest prewarm concurrency must be a positive integer, received ${String(concurrency)}`)
  }

  const restoreEnvironment = ordinaryEnvironment()
  let vitest
  try {
    const create = await createVitest()
    vitest = await create("test", { config: configPath, root, run: true, watch: false })
    if (typeof vitest.standalone !== "function") throw new Error("Vitest prewarm instance lacks standalone()")
    if (typeof vitest.getRelevantTestSpecifications !== "function") {
      throw new Error("Vitest prewarm instance lacks getRelevantTestSpecifications()")
    }
    if (typeof vitest.experimental_parseSpecifications !== "function") {
      throw new Error("Vitest prewarm requires experimental_parseSpecifications()")
    }

    await vitest.standalone()
    const specifications = await vitest.getRelevantTestSpecifications()
    await vitest.experimental_parseSpecifications(specifications, { concurrency })
    const warmedModuleCount = await warmModuleGraph(specifications, concurrency)
    return { concurrency, transformedFileCount: specifications.length, warmedModuleCount }
  } finally {
    if (vitest !== undefined && typeof vitest.close === "function") await vitest.close()
    restoreEnvironment()
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const result = await prewarmVitest()
  console.log(
    `Vitest prewarm transformed ${result.transformedFileCount} ordinary test files and warmed ${result.warmedModuleCount} modules`
  )
}
