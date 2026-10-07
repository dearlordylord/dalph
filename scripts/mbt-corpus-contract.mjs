import { createHash } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

export const corpusManifestPath = "scripts/mbt-corpus-manifest.json"
const root = fileURLToPath(new URL("../", import.meta.url))
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  )

// Bootstrap tooling only: never import a generator or a production workflow.
export const deriveCorpusManifest = async (worktree = root) => {
  const directory = "packages/dalph/test/conformance"
  const files = (await readdir(join(worktree, directory))).filter((name) => name.endsWith(".mbt.test.ts")).sort()
  const lanes = []
  const replayBoundaries = {}
  const models = new Set()
  const inputs = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
    "vitest.config.ts",
    "mise.toml",
    "scripts/hosted-formal-input-manifest.json",
    "scripts/mbt-corpus-contract.mjs",
    "scripts/measure-mbt-corpus.mjs",
    "scripts/mbt-corpus-loader.mjs",
    "scripts/generate-mbt-corpus.mjs",
    "scripts/generate-mbt-corpus-worker.mjs",
    "scripts/mbt-corpus-replay.mjs",
    "scripts/replay-mbt-corpus.mjs",
    "patches/@firfi__quint-connect@2.0.2-effect4.1.patch",
    "patches/@informalsystems__quint@0.32.0.patch"
  ])
  const property = (object, key) =>
    object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText().replaceAll('"', "") === key)
      ?.initializer
  const literal = (node) => {
    if (node === undefined) return undefined
    if (ts.isAsExpression(node)) return literal(node.expression)
    if (ts.isStringLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((p) => {
          if (!ts.isPropertyAssignment(p)) throw new Error("Unsupported generation property")
          return [p.name.getText().replaceAll('"', ""), literal(p.initializer)]
        })
      )
    throw new Error(`Unresolved generation input: ${node.getText()}`)
  }
  for (const name of files) {
    const path = `${directory}/${name}`
    inputs.add(path)
    const source = await readFile(join(worktree, path), "utf8")
    const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
    let ordinal = 0
    replayBoundaries[path] = []
    const add = (object, substitutions = {}, origin = object) => {
      const objectSyntax = object.getSourceFile()
      const spec = literal(property(object, "spec"))
      models.add(spec)
      const options = {
        backend: "typescript",
        generation: { mode: "run" },
        init: "init",
        step: "step",
        maxSamples: 10000,
        maxSteps: 20,
        nTraces: 10
      }
      const declared = []
      for (const key of [
        "backend",
        "generation",
        "init",
        "step",
        "main",
        "maxSamples",
        "maxSteps",
        "nTraces",
        "seed",
        "invariants",
        "witnesses"
      ]) {
        const node =
          property(object, key) ??
          object.properties.find((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === key)
        if (Object.hasOwn(substitutions, key)) {
          options[key] = substitutions[key]
          declared.push(key)
        } else if (node !== undefined) {
          options[key] = literal(node)
          declared.push(key)
        }
      }
      if (options.generation.mode === "test") {
        options.maxSteps = null
        options.nTraces = options.maxSamples
      }
      if (typeof options.seed !== "string") throw new Error(`Missing selected seed: ${path}`)
      const id = `${name.replace(".mbt.test.ts", "")}/${++ordinal}`
      lanes.push({
        id,
        corpus: `corpora/mbt/${id}.itf.json`,
        source: path,
        line: syntax.getLineAndCharacterOfPosition(origin.getStart()).line + 1,
        spec,
        options,
        declared,
        driver:
          property(object, "driverFactory")?.getText(objectSyntax) ??
          "see replayBoundaries[source]: shared options consumers or direct generation",
        stateCheck: property(object, "stateCheck")?.getText(objectSyntax) ?? "manual assertions in source",
        limits: {
          generationMilliseconds: 600000,
          replayMilliseconds: 600000,
          bytes: 67108864,
          traces: options.nTraces,
          states:
            options.generation.mode === "test" ? 65536 * options.nTraces : options.nTraces * (options.maxSteps + 1)
        }
      })
    }
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ["quintRun", "quintIt", "generateTraces", "checkReverseTrace", "quintRunWithTraceGeneration"].includes(
          node.expression.getText(syntax)
        )
      ) {
        replayBoundaries[path].push({
          call: node.expression.getText(syntax),
          line: syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          source: node.getText(syntax)
        })
      }
      if (ts.isObjectLiteralExpression(node) && property(node, "spec") !== undefined) {
        // The sole parameterized option factory is expanded at every selected call.
        if (
          property(node, "spec").getText(syntax) !== '"specs/freshTaskAdmission.qnt"' ||
          property(node, "maxSteps") !== undefined
        )
          add(node)
      }
      if (ts.isCallExpression(node) && node.expression.getText(syntax) === "focusedConformance") {
        const match = source.slice(source.indexOf("const focusedConformance"))
        const helper = ts.createSourceFile(path, match, ts.ScriptTarget.Latest, true)
        let object
        const find = (child) => {
          if (ts.isObjectLiteralExpression(child) && property(child, "spec")) object = child
          ts.forEachChild(child, find)
        }
        find(helper.statements[0])
        add(object, { step: literal(node.arguments[0]), maxSteps: literal(node.arguments[1]) }, node)
      }
      ts.forEachChild(node, visit)
    }
    visit(syntax)
  }
  const modelClosures = {}
  const closure = async (path, visited = new Set()) => {
    if (visited.has(path)) return visited
    visited.add(path)
    inputs.add(path)
    const source = await readFile(join(worktree, path), "utf8")
    for (const match of source.matchAll(/\bfrom\s+"([^"]+)"/gu)) {
      const imported = relative(
        worktree,
        resolve(worktree, dirname(path), match[1] + (match[1].endsWith(".qnt") ? "" : ".qnt"))
      )
      if (imported.startsWith("..")) throw new Error("Model import escapes repository")
      await closure(imported, visited)
    }
    return visited
  }
  for (const model of [...models].sort((a, b) => a.localeCompare(b)))
    modelClosures[model] = [...(await closure(model))].sort((a, b) => a.localeCompare(b))
  // Discover source imports independently of the checked-in hosted projection.
  const configPath = join(worktree, "tsconfig.json")
  const loaded = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path))
  if (loaded.error) throw new Error("Cannot read MBT TypeScript configuration")
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, worktree)
  if (config.errors.length) throw new Error("Cannot parse MBT TypeScript configuration")
  const pending = files.map((name) => `${directory}/${name}`)
  const visitedSources = new Set()
  while (pending.length) {
    const path = pending.pop()
    if (visitedSources.has(path)) continue
    visitedSources.add(path)
    inputs.add(path)
    const syntax = ts.createSourceFile(path, await readFile(join(worktree, path), "utf8"), ts.ScriptTarget.Latest, true)
    const imports = []
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error("Nonliteral MBT import")
        imports.push(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))
          throw new Error("Nonliteral dynamic MBT import")
        imports.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(syntax)
    for (const specifier of imports) {
      const resolved = ts.resolveModuleName(specifier, join(worktree, path), config.options, ts.sys).resolvedModule
        ?.resolvedFileName
      if (!resolved && (specifier.startsWith(".") || specifier.startsWith("@dalph/")))
        throw new Error(`Unresolved MBT import: ${path} -> ${specifier}`)
      if (!resolved) continue
      const selected = relative(worktree, resolved)
      if (!selected.startsWith("..") && !selected.startsWith("node_modules/")) pending.push(selected)
    }
  }
  // Conservatively bind the complete maintained conformance implementation closure.
  const hosted = JSON.parse(await readFile(join(worktree, "scripts/hosted-formal-input-manifest.json"), "utf8"))
  for (const path of hosted.paths) if (path.endsWith(".ts") || path.endsWith("package.json")) inputs.add(path)
  const semanticInputs = {}
  for (const path of [...inputs].sort((a, b) => a.localeCompare(b)))
    semanticInputs[path] = digest(await readFile(join(worktree, path)))
  const pkg = JSON.parse(await readFile(join(worktree, "package.json"), "utf8"))
  return {
    version: 1,
    tools: {
      node: process.version,
      nodeEngine: pkg.engines.node,
      pnpm: pkg.packageManager,
      quint: pkg.devDependencies["@informalsystems/quint"],
      connect: pkg.devDependencies["@firfi/quint-connect"],
      effect: pkg.devDependencies.effect,
      vitest: pkg.devDependencies.vitest
    },
    budgets: { generationMilliseconds: 1800000, replayMilliseconds: 1800000, bytes: 268435456, concurrency: 1 },
    selection: {
      command: "pnpm test:mbt",
      files: files.map((name) => `${directory}/${name}`),
      nonGenerating: ["workspace-source-resolution.mbt.test.ts"]
    },
    modelClosures,
    replayBoundaries,
    lanes,
    semanticInputs
  }
}

export const corpusProvenanceDigest = (manifest) => digest(canonical(manifest))

export const validateCorpusManifest = (actual, expected) => {
  if (canonical(actual) !== canonical(expected))
    throw new Error("MBT corpus provenance is missing, malformed or stale; replay refused")
  return expected
}

// Validate bytes and provenance before allowing the caller to replay. No fallback.
export const validateCorpus = (receipt, bytes, manifest, expectedManifest, laneId) => {
  validateCorpusManifest(manifest, expectedManifest)
  const lane = manifest.lanes.find(({ id }) => id === laneId)
  if (lane === undefined) throw new Error("Unknown MBT lane")
  const expected = {
    version: 1,
    lane: laneId,
    provenanceSha256: corpusProvenanceDigest(manifest),
    corpusSha256: digest(bytes)
  }
  if (canonical(receipt) !== canonical(expected) || bytes.byteLength === 0 || bytes.byteLength > lane.limits.bytes)
    throw new Error("MBT corpus receipt/size invalid; replay refused")
  const traces = JSON.parse(bytes.toString("utf8"))
  if (
    !Array.isArray(traces) ||
    traces.length !== lane.limits.traces ||
    traces.some(
      (trace) =>
        trace === null ||
        typeof trace !== "object" ||
        !Array.isArray(trace.states) ||
        trace.states.length === 0 ||
        trace.states.length > lane.limits.states / lane.limits.traces
    )
  )
    throw new Error("MBT corpus trace/state budget invalid; replay refused")
  return traces
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const expected = await deriveCorpusManifest()
  if (process.argv[2] === "--write")
    await writeFile(join(root, corpusManifestPath), `${JSON.stringify(expected, null, 2)}\n`)
  else if (process.argv[2] === "--check")
    validateCorpusManifest(JSON.parse(await readFile(join(root, corpusManifestPath), "utf8")), expected)
  else throw new Error("Usage: mise exec -- node scripts/mbt-corpus-contract.mjs --write|--check")
}
