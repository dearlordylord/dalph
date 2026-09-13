import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises"
import { accessSync, constants, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { arch, platform } from "node:os"
import { delimiter, dirname, extname, isAbsolute, join, resolve, sep } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { parse } from "acorn"
import { formalEvidenceContract } from "./formal-evidence-contract.mjs"
import { localHostIdentity } from "./gate-custody-records.mjs"
import { inputObserverScript, startInputObserver } from "./gate-input-observer.mjs"
import { apalacheVersion } from "./quint-temporal-gate.mjs"

export const formalInputPolicyVersion = formalEvidenceContract.inputPolicyVersion
const digest = (value) => createHash("sha256").update(value).digest("hex")
const below = (path, root) => path === root || path.startsWith(`${root}${sep}`)
const retainedEnvironmentKeys = [
  "PATH",
  "HOME",
  "QUINT_HOME",
  "JAVA_HOME",
  "NODE_OPTIONS",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "JVM_ARGS",
  "JVM_GC_ARGS",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_COLLATE",
  "LC_NUMERIC",
  "LC_TIME",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "npm_execpath"
]
const unsupportedEnvironmentKeys = [
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "LD_DEBUG",
  "LD_DEBUG_OUTPUT",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "OPENSSL_CONF",
  "OPENSSL_MODULES",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "APALACHE_JAR",
  "JAVACMD",
  "_JAVA_OPTIONS",
  "JAVA_OPTIONS",
  "PYTHONHOME",
  "PYTHONPATH"
]
const validateMemoryOptions = (name, value) => {
  if (value === undefined || value.trim() === "") return
  if (/["'\\]/u.test(value)) throw new Error(`Unsupported ${name} quoted or escaped syntax`)
  const tokens = value.trim().split(/\s+/u)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (name === "NODE_OPTIONS") {
      if (/^--max[-_]old[-_]space[-_]size=\d+$/u.test(token) || token === "--disable-warning=ExperimentalWarning")
        continue
      if (/^--max[-_]old[-_]space[-_]size$/u.test(token) && /^\d+$/u.test(tokens[index + 1] ?? "")) {
        index++
        continue
      }
    } else if (
      /^-Xm[sx]\d+[kKmMgG]?$/u.test(token) ||
      /^-XX:(?:MaxRAMPercentage|InitialRAMPercentage)=\d+(?:\.\d+)?$/u.test(token) ||
      /^-XX:[+-](?:UseG1GC|G1PeriodicGCInvokesConcurrent)$/u.test(token) ||
      /^-XX:G1PeriodicGCInterval=\d+$/u.test(token)
    )
      continue
    throw new Error(`Unsupported file-loading or execution ${name} option: ${token}`)
  }
}

/** Only these caller settings reach children. Presence is retained separately from empty values. */
export const createFormalEnvironment = (callerEnvironment = process.env) => {
  for (const key of unsupportedEnvironmentKeys)
    if (callerEnvironment[key] !== undefined) throw new Error(`Unsupported formal runtime override: ${key}`)
  for (const key of ["NODE_OPTIONS", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "JVM_ARGS", "JVM_GC_ARGS"])
    validateMemoryOptions(key, callerEnvironment[key])
  const environment = {}
  for (const key of retainedEnvironmentKeys)
    if (callerEnvironment[key] !== undefined) environment[key] = String(callerEnvironment[key])
  if (environment.TZ?.startsWith(":") || environment.TZ?.startsWith("/") || environment.TZ?.includes(".."))
    throw new Error("Unsupported formal timezone file redirect")
  return environment
}
const environmentIdentity = (environment) =>
  Object.fromEntries(
    retainedEnvironmentKeys.map((key) => [
      key,
      environment[key] === undefined ? { present: false } : { present: true, digest: digest(environment[key]) }
    ])
  )
const requiredFile = async (path, executable = false) => {
  try {
    const status = await lstat(await realpath(path))
    if (!status.isFile() || status.size === 0)
      throw new Error(`Required prepared formal artifact is not a nonempty file: ${path}`)
    await access(path, executable ? constants.R_OK | constants.X_OK : constants.R_OK)
    return path
  } catch (error) {
    if (error.message?.startsWith("Required prepared formal artifact")) throw error
    const failure = new Error(`Unreadable or missing required formal input: ${path}`, { cause: error })
    if (typeof error.code === "string") failure.code = error.code
    throw failure
  }
}
export const resolveFormalExecutable = async (name, environment, worktree) => {
  const candidates =
    isAbsolute(name) || name.includes(sep)
      ? [resolve(worktree, name)]
      : (environment.PATH ?? "").split(delimiter).map((directory) => resolve(worktree, directory, name))
  let lastFailure
  for (const candidate of candidates) {
    try {
      await requiredFile(candidate, true)
      return candidate
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EACCES") throw error
      lastFailure = error
    }
  }
  const failure = new Error(`Required formal executable is unavailable: ${name}`, { cause: lastFailure })
  if (typeof lastFailure?.code === "string") failure.code = lastFailure.code
  throw failure
}
const packageRoot = async (launcher, name) => {
  let directory = dirname(await realpath(launcher))
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"))
      if (metadata.name === name) return directory
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    directory = dirname(directory)
  }
  throw new Error(`Cannot identify installed ${name} implementation: ${launcher}`)
}

/** Resolve prepared installations only. This function never invokes a downloader or a checker. */
export const resolveFormalToolchain = async ({ effectiveEnvironment, timeoutMilliseconds = 60_000, worktree }) => {
  const deadline = phaseDeadline("tool identification", timeoutMilliseconds)
  if (platform() !== "linux" || !["arm64", "x64"].includes(arch()))
    throw new Error(`Unsupported formal observation host: ${platform()}/${arch()}`)
  const root = await realpath(worktree)
  const environment = createFormalEnvironment(effectiveEnvironment)
  const nodeExecutable = await realpath(process.execPath)
  const nodeRoot = dirname(dirname(nodeExecutable))
  if (["/", "/usr", "/usr/local"].includes(nodeRoot))
    throw new Error("Unsupported Node installation: cannot identify a finite complete runtime directory")
  const pnpmExecutable =
    environment.npm_execpath === undefined
      ? await resolveFormalExecutable("pnpm", environment, root)
      : resolve(root, environment.npm_execpath)
  await requiredFile(pnpmExecutable)
  const pnpmRoot = await packageRoot(pnpmExecutable, "pnpm")
  const require = createRequire(join(root, "package.json"))
  const quintPackage = require.resolve("@informalsystems/quint/package.json")
  const quintRoot = dirname(await realpath(quintPackage))
  const storeRoot = join(root, "node_modules", ".pnpm")
  if (!below(quintRoot, await realpath(storeRoot)))
    throw new Error("Incoherent formal installation: Quint is outside this worktree's pnpm store")
  const metadata = JSON.parse(await readFile(quintPackage, "utf8"))
  const acornPackage = require.resolve("acorn/package.json")
  const acornRoot = dirname(await realpath(acornPackage))
  const acornMetadata = JSON.parse(await readFile(acornPackage, "utf8"))
  const project = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const expected =
    project.devDependencies?.["@informalsystems/quint"] ?? project.dependencies?.["@informalsystems/quint"]
  if (metadata.version !== expected)
    throw new Error("Incoherent formal installation: installed Quint differs from package.json")
  const pnpmMetadata = JSON.parse(await readFile(join(pnpmRoot, "package.json"), "utf8"))
  if (project.packageManager !== `pnpm@${pnpmMetadata.version}`)
    throw new Error("Incoherent formal installation: installed pnpm differs from packageManager")
  const quintEntryPoint = join(quintRoot, "dist", "src", "cli.js")
  await requiredFile(quintEntryPoint)
  const { QUINT_EVALUATOR_VERSION: evaluatorVersion } = require("@informalsystems/quint/dist/src/rust/binaryManager.js")
  const quintHome = resolve(
    root,
    environment.QUINT_HOME ??
      join(
        environment.HOME ??
          (() => {
            throw new Error("Formal tools require explicit HOME or QUINT_HOME")
          })(),
        ".quint"
      )
  )
  const evaluatorDirectory = join(quintHome, `rust-evaluator-${evaluatorVersion}`)
  const evaluatorPath = join(evaluatorDirectory, "quint_evaluator")
  await requiredFile(evaluatorPath, true)
  const apalacheDirectory = join(quintHome, `apalache-dist-${apalacheVersion}`, "apalache")
  const apalacheJar = join(apalacheDirectory, "lib", "apalache.jar")
  await requiredFile(apalacheJar)
  await requiredFile(join(apalacheDirectory, "bin", "apalache-mc"), true)
  const javaExecutable =
    environment.JAVA_HOME === undefined
      ? await resolveFormalExecutable("java", environment, root)
      : join(resolve(root, environment.JAVA_HOME), "bin", "java")
  await requiredFile(javaExecutable, true)
  const javaRoot = dirname(dirname(await realpath(javaExecutable)))
  await requiredFile(join(javaRoot, "release"))
  await requiredFile(join(javaRoot, "lib", "modules"))
  const javaSettings = spawnSync(javaExecutable, ["-XshowSettings:properties", "-version"], {
    env: environment,
    encoding: "utf8",
    timeout: deadline.remaining(),
    maxBuffer: 128 * 1024
  })
  if (javaSettings.error || javaSettings.status !== 0)
    throw new Error("Cannot identify JVM user.home before formal observation", { cause: javaSettings.error })
  const homeSettings = [...javaSettings.stderr.matchAll(/^\s*user\.home = (.+)$/gmu)]
  if (homeSettings.length !== 1 || !isAbsolute(homeSettings[0][1]))
    throw new Error("Unsupported JVM user.home property")
  const javaUserHome = resolve(homeSettings[0][1])
  const configPaths = apalacheConfigurationPaths(root, javaUserHome)
  const pythonExecutable = await resolveFormalExecutable("python3", environment, root)
  const pythonVersion = execFileSync(
    pythonExecutable,
    ["-I", "-S", "-c", "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))"],
    { env: environment, encoding: "utf8", timeout: deadline.remaining(), maxBuffer: 4096 }
  ).trim()
  if (!/^3\.\d+$/u.test(pythonVersion)) throw new Error("Cannot identify Python runtime")
  if ((await realpath(pythonExecutable)) !== `/usr/bin/python${pythonVersion}`)
    throw new Error("Unsupported Python installation: requires identified Debian runtime")
  const osRelease = await readFile("/etc/os-release", "utf8")
  if (!/^ID=debian$/mu.test(osRelease) || !/^VERSION_ID="12"$/mu.test(osRelease))
    throw new Error("Unsupported formal runtime root policy: requires Debian 12")
  const architectureDirectory = arch() === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu"
  const runtimeRoots = [
    `/usr/lib/${architectureDirectory}`,
    `/lib/${architectureDirectory}`,
    `/lib/ld-linux-${arch() === "arm64" ? "aarch64" : "x86-64"}.so.${arch() === "arm64" ? "1" : "2"}`,
    "/usr/local/lib",
    `/usr/lib/python${pythonVersion}`,
    `/etc/python${pythonVersion}`,
    "/usr/lib/locale",
    "/usr/share/locale",
    "/usr/share/zoneinfo",
    "/etc/ssl/certs",
    "/etc/ssl/openssl.cnf",
    "/usr/lib/ssl/openssl.cnf",
    "/usr/share/ca-certificates",
    "/etc/ld.so.conf",
    "/etc/ld.so.conf.d",
    "/etc/ld.so.cache",
    "/etc/ld.so.preload",
    "/etc/nsswitch.conf",
    "/etc/hosts",
    "/etc/resolv.conf",
    "/etc/localtime",
    "/etc/timezone",
    "/etc/gai.conf",
    "/etc/host.conf",
    "/etc/passwd",
    "/etc/group",
    "/etc/networks",
    "/etc/protocols",
    "/etc/services",
    "/etc/ethers",
    "/etc/rpc",
    "/etc/netgroup",
    "/var/lib/misc",
    "/etc/os-release",
    "/usr/lib/os-release",
    "/usr/bin/env"
  ]
  await validateRuntimeConfiguration(runtimeRoots, deadline)
  deadline.assert()
  const roots = [
    nodeRoot,
    nodeExecutable,
    javaExecutable,
    pnpmExecutable,
    pnpmRoot,
    dirname(dirname(quintRoot)),
    acornRoot,
    javaRoot,
    evaluatorDirectory,
    apalacheDirectory,
    pythonExecutable,
    inputObserverScript,
    ...configPaths,
    ...runtimeRoots
  ].map((path) => resolve(path))
  // Quint's package is nested under node_modules/@informalsystems: its containing node_modules never ascends to the store parent.
  return {
    version: formalInputPolicyVersion,
    platform: platform(),
    architecture: arch(),
    runtimePolicy: "debian12",
    runtimeRoots,
    roots: [...new Set(roots)],
    allowedRoots: [
      ...new Set([
        ...roots,
        storeRoot,
        ...(await canonicalRoots([
          nodeRoot,
          pnpmExecutable,
          pnpmRoot,
          javaExecutable,
          javaRoot,
          evaluatorDirectory,
          apalacheDirectory,
          pythonExecutable,
          storeRoot,
          acornRoot
        ]))
      ])
    ],
    requiredRoots: [
      nodeRoot,
      pnpmRoot,
      dirname(dirname(quintRoot)),
      acornRoot,
      javaRoot,
      evaluatorDirectory,
      apalacheDirectory,
      `/usr/lib/${architectureDirectory}`,
      `/usr/lib/python${pythonVersion}`
    ],
    pythonExecutable,
    nodeExecutable,
    pnpmExecutable,
    quintEntryPoint,
    javaExecutable,
    javaRoot,
    javaUserHome,
    configPaths,
    evaluatorPath,
    apalacheJar,
    javaArguments: [
      `-Duser.home=${javaUserHome}`,
      ...(environment.JVM_ARGS?.trim().split(/\s+/u).filter(Boolean) ?? []),
      ...(environment.JVM_ARGS?.includes("-Xmx") || environment.JVM_ARGS?.includes("-XX:MaxRAMPercentage")
        ? []
        : ["-Xmx4096m"]),
      ...(environment.JVM_GC_ARGS?.trim()
        ? environment.JVM_GC_ARGS.trim().split(/\s+/u)
        : ["-XX:+UseG1GC", "-XX:G1PeriodicGCInterval=600000", "-XX:+G1PeriodicGCInvokesConcurrent"])
    ],
    versions: {
      node: process.version,
      pnpm: pnpmMetadata.version,
      quint: metadata.version,
      acorn: acornMetadata.version,
      evaluator: evaluatorVersion,
      apalache: apalacheVersion,
      java: await readFile(join(javaRoot, "release"), "utf8"),
      python: pythonVersion
    }
  }
}
const validateRuntimeConfiguration = async (runtimeRoots, deadline) => {
  // The loader can add search locations outside the finite runtime policy. Refuse those before execution.
  for (const config of [
    "/etc/ld.so.conf",
    ...(await readdir("/etc/ld.so.conf.d")).map((name) => join("/etc/ld.so.conf.d", name))
  ]) {
    for (const line of (await readFile(config, "utf8"))
      .split("\n")
      .map((line) => line.replace(/#.*/u, "").trim())
      .filter(Boolean)) {
      if (line === "include /etc/ld.so.conf.d/*.conf") continue
      if (
        !isAbsolute(line) ||
        !runtimeRoots.some(
          (declared) => below(resolve(line), declared) || below(resolve(line), declared.replace(/^\/usr/u, ""))
        )
      )
        throw new Error(`Unsupported loader configuration location: ${line}`)
    }
  }
  try {
    if ((await readFile("/etc/ld.so.preload", "utf8")).trim() !== "")
      throw new Error("Unsupported system loader preload configuration")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const openssl = await readFile("/etc/ssl/openssl.cnf", "utf8")
  if (/^\s*(?:\.include\b|module\s*=)/mu.test(openssl))
    throw new Error("Unsupported external OpenSSL configuration include")
  const nss = await readFile("/etc/nsswitch.conf", "utf8")
  for (const service of ["passwd", "group", "hosts"]) {
    const line = nss.split("\n").find((line) => line.startsWith(`${service}:`))
    const sources =
      line
        ?.slice(line.indexOf(":") + 1)
        .trim()
        .split(/\s+/u) ?? []
    if (
      sources.length === 0 ||
      sources.some((source) => !["files", "dns"].includes(source) || (service !== "hosts" && source !== "files"))
    )
      throw new Error(`Unsupported ${service} name-service configuration`)
  }
  deadline.assert()
}
const phaseDeadline = (name, milliseconds) => {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0)
    throw new Error(`A finite positive ${name} deadline is required`)
  const end = performance.now() + milliseconds
  const assert = () => {
    if (performance.now() >= end) throw new Error(`Formal ${name} deadline exceeded`)
  }
  return {
    assert,
    remaining: () => {
      assert()
      return Math.max(1, Math.ceil(end - performance.now()))
    }
  }
}
const canonicalRoots = async (paths) =>
  Promise.all(
    paths.map(async (path) => {
      try {
        return await realpath(path)
      } catch (error) {
        if (error.code === "ENOENT") return resolve(path)
        throw error
      }
    })
  )

/** Re-enumerate declared roots; the active chain rejects cycles while shared dependencies are visited once. */
const manifest = async (roots, allowedRoots, requiredRoots, deadline) => {
  const entries = new Map()
  const allowed = allowedRoots.map((path) => resolve(path))
  const required = new Set(requiredRoots.map((path) => resolve(path)))
  const visit = async (path, chain) => {
    deadline.assert()
    path = resolve(path)
    if (chain.has(path)) throw new Error(`Cyclic formal input link: ${path}`)
    if (entries.has(path)) return
    let status
    try {
      status = lstatSync(path)
    } catch (error) {
      if (error.code === "ENOENT" && !required.has(path)) {
        entries.set(path, { path, type: "absent" })
        return
      }
      throw new Error(`Unreadable or missing required formal input: ${path}`, { cause: error })
    }
    const mode = status.mode & 0o777
    if (status.isSymbolicLink()) {
      const target = readlinkSync(path)
      let resolved
      try {
        resolved = realpathSync(path)
      } catch (error) {
        throw new Error(`Unresolvable or cyclic formal input link: ${path}`, { cause: error })
      }
      if (!allowed.some((root) => below(resolved, root)))
        throw new Error(`Undeclared external formal input target: ${path} -> ${resolved}`)
      entries.set(path, { path, type: "symlink", mode, target, resolved })
      await visit(resolved, new Set([...chain, path]))
    } else if (status.isDirectory()) {
      accessSync(path, constants.R_OK | constants.X_OK)
      entries.set(path, { path, type: "directory", mode })
      for (const child of readdirSync(path).sort()) await visit(join(path, child), new Set([...chain, path]))
    } else if (status.isFile()) {
      accessSync(path, constants.R_OK)
      const resolved = realpathSync(path)
      if (!allowed.some((root) => below(resolved, root)))
        throw new Error(`Undeclared external formal input target: ${path} -> ${resolved}`)
      entries.set(path, {
        path,
        type: "file",
        mode,
        ...(resolved === path ? {} : { resolved }),
        sha256: digest(readFileSync(path))
      })
    } else throw new Error(`Unsupported formal input kind: ${path}`)
    deadline.assert()
  }
  for (const root of roots) await visit(root, new Set())
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
}
// The pinned grammar makes every external source a FROM token followed by STRING.
// Conservatively inspect all such token pairs; the actual profile owns full syntax/type checking.
export const quintImportSources = (text, sourceLocation) => {
  const require = createRequire(import.meta.url)
  const lexerFile = require.resolve("@informalsystems/quint/dist/src/generated/QuintLexer.js")
  const quintRequire = createRequire(lexerFile)
  const { QuintLexer } = require("@informalsystems/quint/dist/src/generated/QuintLexer.js")
  const { CharStreams } = quintRequire("antlr4ts/CharStreams")
  const lexer = new QuintLexer(CharStreams.fromString(text))
  const errors = []
  lexer.removeErrorListeners()
  lexer.addErrorListener({
    syntaxError: (_recognizer, _symbol, line, character, message) => errors.push(`${line}:${character}: ${message}`)
  })
  const tokens = lexer.getAllTokens().filter((token) => token.channel === 0)
  if (errors.length !== 0)
    throw new Error(`Unidentifiable Quint lexical input in ${sourceLocation}: ${errors.join("; ")}`)
  const sources = []
  for (let position = 0; position + 1 < tokens.length; position++) {
    if (tokens[position].type === QuintLexer.FROM && tokens[position + 1].type === QuintLexer.STRING)
      sources.push(tokens[position + 1].text.slice(1, -1))
  }
  return sources
}
const quintImportedPath = (() => {
  const require = createRequire(import.meta.url)
  const { fileSourceResolver } = require("@informalsystems/quint/dist/src/parsing/sourceResolver.js")
  const resolver = fileSourceResolver()
  return (sourcePath, source) => resolver.lookupPath(dirname(sourcePath), `${source}.qnt`).normalizedPath
})()

const selectedQuintRoots = (profile, worktree) => {
  if (!Array.isArray(profile?.commands)) throw new Error("Formal profile has no identifiable command list")
  const roots = []
  for (const command of profile.commands) {
    if (!Array.isArray(command?.args)) throw new Error("Formal profile command has no identifiable arguments")
    for (const argument of command.args) {
      if (typeof argument !== "string" || !argument.endsWith(".qnt")) continue
      const path = resolve(worktree, argument)
      if (!below(path, worktree))
        throw new Error(`Formal profile selects a Quint input outside the worktree: ${argument}`)
      roots.push(path)
    }
  }
  if (roots.length === 0) throw new Error("Formal profile selects no Quint inputs")
  return [...new Set(roots)]
}

const discoverQuintClosure = async (profile, worktree, deadline) => {
  const pending = selectedQuintRoots(profile, worktree)
  const visited = new Set()
  const parsed = new Set()
  while (pending.length > 0) {
    deadline.assert()
    const path = resolve(pending.pop())
    if (visited.has(path)) continue
    if (!below(path, worktree)) throw new Error(`Quint import leaves the worktree: ${path}`)
    await requiredFile(path)
    visited.add(path)
    const canonical = await realpath(path)
    if (parsed.has(canonical)) continue
    parsed.add(canonical)
    const text = await readFile(path, { encoding: "utf8", signal: deadline.signal })
    for (const source of quintImportSources(text, path)) pending.push(quintImportedPath(path, source))
  }
  return [...visited].sort((left, right) => left.localeCompare(right))
}

const formalJavaScriptEntries = (worktree) =>
  [
    "scripts/with-gate-slot.mjs",
    "scripts/run-admitted-gate.mjs",
    "scripts/run-formal-gate.mjs",
    "scripts/run-formal-workflow.mjs",
    "scripts/run-formal-profile.mjs",
    "scripts/check-quint-models.mjs"
  ].map((path) => join(worktree, path))

const walkSyntax = (node, visit) => {
  if (node === null || typeof node !== "object") return
  if (typeof node.type === "string") visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue
    if (Array.isArray(child)) for (const item of child) walkSyntax(item, visit)
    else walkSyntax(child, visit)
  }
}

const literalModuleSources = (text, sourcePath) => {
  let tree
  try {
    tree = parse(text, { allowHashBang: true, ecmaVersion: "latest", sourceType: "module" })
  } catch (error) {
    throw new Error(`Unidentifiable JavaScript formal input in ${sourcePath}: ${error.message}`, { cause: error })
  }
  const sources = []
  const literal = (node, dependencyKind, syntaxKind) => {
    if (node?.type !== "Literal" || typeof node.value !== "string")
      throw new Error(`Unsupported non-literal ${syntaxKind} in formal source: ${sourcePath}`)
    sources.push({ dependencyKind, specifier: node.value })
  }
  walkSyntax(tree, (node) => {
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source)
      literal(node.source, "esm", "module source")
    else if (node.type === "ImportExpression") literal(node.source, "esm", "dynamic import")
    else if (
      node.type === "CallExpression" &&
      ((node.callee?.type === "Identifier" && node.callee.name === "require") ||
        (node.callee?.type === "MemberExpression" &&
          node.callee.computed === false &&
          node.callee.object?.type === "Identifier" &&
          node.callee.object.name === "require" &&
          node.callee.property?.type === "Identifier" &&
          node.callee.property.name === "resolve"))
    ) {
      if (node.arguments.length !== 1) throw new Error(`Unsupported require call in formal source: ${sourcePath}`)
      literal(node.arguments[0], "commonjs", "require source")
    }
  })
  return sources
}

const localJavaScriptPath = async ({ dependencyKind, specifier }, importer, worktree) => {
  if (!(specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:"))) return undefined
  const canonicalImporter = await realpath(importer)
  const requested = specifier.startsWith("file:")
    ? fileURLToPath(specifier)
    : resolve(dirname(canonicalImporter), specifier)
  if (!below(requested, worktree))
    throw new Error(`Repository formal source imports outside the worktree: ${importer} -> ${requested}`)
  if (dependencyKind === "commonjs") {
    if (specifier.startsWith("file:"))
      throw new Error(`Unsupported repository CommonJS file URL in formal source: ${importer} -> ${specifier}`)
    let requestedStatus
    try {
      requestedStatus = await lstat(requested)
      if (requestedStatus.isDirectory())
        throw new Error(`Unsupported repository CommonJS directory import: ${importer} -> ${specifier}`)
      if (requestedStatus.isSymbolicLink() && (await lstat(await realpath(requested))).isDirectory())
        throw new Error(`Unsupported repository CommonJS symlinked directory import: ${importer} -> ${specifier}`)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    let selected
    try {
      selected = createRequire(canonicalImporter).resolve(specifier)
    } catch (error) {
      throw new Error(`Missing repository formal source import: ${importer} -> ${specifier}`, { cause: error })
    }
    if (!below(selected, worktree))
      throw new Error(`Repository formal source imports outside the worktree: ${importer} -> ${selected}`)
    if (extname(selected) === ".node")
      throw new Error(`Unsupported repository native CommonJS input: ${importer} -> ${selected}`)
    if (requestedStatus === undefined && extname(requested) === "")
      for (const suffix of [".js", ".json", ".node"])
        try {
          const candidateStatus = await lstat(`${requested}${suffix}`)
          if (candidateStatus.isSymbolicLink())
            throw new Error(
              `Unsupported repository extensionless CommonJS symlink resolution: ${importer} -> ${specifier}`
            )
          if (!candidateStatus.isFile())
            throw new Error(`Unsupported repository CommonJS resolution candidate: ${requested}${suffix}`)
          break
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
    if ((requestedStatus?.isFile() || requestedStatus?.isSymbolicLink()) && (await realpath(requested)) === selected)
      return requested
    return selected
  }
  if (extname(requested) === ".node")
    throw new Error(`Unsupported repository native ESM input: ${importer} -> ${requested}`)
  try {
    const status = await lstat(requested)
    if (status.isFile() || status.isSymbolicLink()) return requested
    throw new Error(`Unsupported repository ESM directory import: ${importer} -> ${specifier}`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  throw new Error(`Missing repository formal source import: ${importer} -> ${specifier}`)
}

const discoverJavaScriptClosure = async (worktree, deadline) => {
  const pending = formalJavaScriptEntries(worktree)
  const visited = new Set()
  while (pending.length > 0) {
    deadline.assert()
    const path = resolve(pending.pop())
    if (visited.has(path)) continue
    await requiredFile(path)
    visited.add(path)
    if (path.endsWith(".json")) continue
    const text = await readFile(path, { encoding: "utf8", signal: deadline.signal })
    for (const source of literalModuleSources(text, path)) {
      const dependency = await localJavaScriptPath(source, path, worktree)
      if (dependency !== undefined) pending.push(dependency)
    }
  }
  return [...visited].sort((left, right) => left.localeCompare(right))
}

const discoverFormalSources = async (profile, worktree, deadline) =>
  [
    ...new Set([
      ...(await discoverJavaScriptClosure(worktree, deadline)),
      ...(await discoverQuintClosure(profile, worktree, deadline))
    ])
  ].sort((left, right) => left.localeCompare(right))
// Apalache's ConfigManager searches these paths even without caller configuration arguments.
const apalacheConfigurationPaths = (worktree, javaUserHome) => {
  const paths = [join(javaUserHome, ".tlaplus", "apalache.cfg")]
  let directory = resolve(worktree)
  for (;;) {
    paths.push(join(directory, ".apalache.cfg"))
    if (directory === dirname(directory)) break
    directory = dirname(directory)
  }
  return [...new Set(paths)]
}
const refuseApalacheConfiguration = async (paths, deadline) => {
  for (const path of paths) {
    try {
      await lstat(path)
    } catch (error) {
      if (error.code === "ENOENT") {
        deadline.assert()
        continue
      }
      throw new Error(`Unreadable Apalache configuration prerequisite: ${path}`, { cause: error })
    }
    throw new Error(
      `Unsupported existing Apalache configuration: ${path}; remove it before guarded formal verification`
    )
  }
}
const validateToolchain = (toolchain) => {
  if (
    toolchain?.version !== formalInputPolicyVersion ||
    toolchain.platform !== platform() ||
    toolchain.architecture !== arch()
  )
    throw new Error("Unsupported or incompatible formal toolchain policy")
  for (const key of ["roots", "allowedRoots", "requiredRoots"])
    if (!Array.isArray(toolchain[key]) || toolchain[key].some((path) => !isAbsolute(path)))
      throw new Error(`Formal toolchain requires absolute ${key}`)
  if (!isAbsolute(toolchain.javaUserHome ?? ""))
    throw new Error("Formal toolchain requires an identified absolute JVM user.home")
  if (!isAbsolute(toolchain.pythonExecutable ?? ""))
    throw new Error("Formal observer requires an identified absolute Python executable")
}

/** Start observation before enumeration; current inputs, not Git candidate facts, establish formal applicability. */
export const startFormalInputGuard = async ({
  effectiveEnvironment,
  profile,
  qualificationTimeoutMilliseconds = 60_000,
  setupTimeoutMilliseconds = 60_000,
  startObserver = startInputObserver,
  toolchain,
  worktree
}) => {
  const deadline = phaseDeadline("input setup", setupTimeoutMilliseconds)
  phaseDeadline("input qualification", qualificationTimeoutMilliseconds)
  validateToolchain(toolchain)
  const environment = createFormalEnvironment(effectiveEnvironment)
  if (JSON.stringify(environment) !== JSON.stringify(effectiveEnvironment))
    throw new Error("Formal child environment must be the sanitized formal environment")
  const root = await realpath(worktree)
  const configPaths = apalacheConfigurationPaths(root, toolchain.javaUserHome)
  const discoveryRoots = [root, ...toolchain.roots, ...configPaths]
  const discoveryExcludedRoots = [".git", ".scratch", "coverage", "node_modules"].map((path) => join(root, path))
  const originalEffectiveEnvironment = JSON.stringify(effectiveEnvironment)
  const originalEnvironment = JSON.stringify(environmentIdentity(environment))
  const originalProfile = JSON.stringify(profile)
  const originalToolchain = JSON.stringify(toolchain)
  const controller = new AbortController()
  let phaseTimer = setTimeout(() => controller.abort(), deadline.remaining())
  const timings = { observerSetupMilliseconds: 0, initialSnapshotMilliseconds: 0, qualificationMilliseconds: [] }
  const broadObserverStarted = performance.now()
  const broadObserver = await startObserver({
    roots: discoveryRoots,
    excludedRoots: discoveryExcludedRoots,
    protectedRoots: [...toolchain.roots, ...configPaths],
    pythonExecutable: toolchain.pythonExecutable,
    pythonArguments: ["-I", "-S"],
    environment,
    signal: controller.signal,
    timeoutMilliseconds: deadline.remaining()
  }).catch((error) => {
    clearTimeout(phaseTimer)
    throw error
  })
  let source
  let observer
  try {
    source = await discoverFormalSources(profile, root, deadline)
    observer = await startObserver({
      roots: [...source, ...toolchain.roots, ...configPaths],
      pythonExecutable: toolchain.pythonExecutable,
      pythonArguments: ["-I", "-S"],
      environment,
      signal: controller.signal,
      timeoutMilliseconds: deadline.remaining()
    })
    await broadObserver.assertUnchanged()
    const rediscovered = await discoverFormalSources(profile, root, deadline)
    await broadObserver.assertUnchanged()
    if (JSON.stringify(rediscovered) !== JSON.stringify(source))
      throw new Error("Formal source dependency closure changed during discovery")
    source = rediscovered
    await observer.assertUnchanged()
    await broadObserver.close()
  } catch (error) {
    await Promise.allSettled([observer?.close(), broadObserver.close()])
    clearTimeout(phaseTimer)
    throw error
  }
  timings.observerSetupMilliseconds = performance.now() - broadObserverStarted
  deadline.signal = controller.signal
  let failed
  const snapshot = async (phase) => {
    await refuseApalacheConfiguration(configPaths, phase)
    if (toolchain.runtimePolicy === "debian12") await validateRuntimeConfiguration(toolchain.runtimeRoots, phase)
    const currentSource = await discoverFormalSources(profile, root, phase)
    if (JSON.stringify(currentSource) !== JSON.stringify(source))
      throw new Error("Formal source dependency closure changed during verification")
    const sourceManifest = await manifest(source, [root], source, phase)
    const toolManifest = await manifest(
      [...toolchain.roots, ...configPaths],
      [...toolchain.allowedRoots, ...configPaths],
      toolchain.requiredRoots,
      phase
    )
    const result = {
      version: formalInputPolicyVersion,
      observerVersion: formalEvidenceContract.observerVersion,
      host: localHostIdentity(),
      worktree: root,
      sourceDigest: digest(JSON.stringify(sourceManifest)),
      toolDigest: digest(JSON.stringify({ toolchain, toolManifest })),
      environmentDigest: digest(originalEnvironment),
      profileDigest: digest(originalProfile),
      sourceManifest,
      toolManifest,
      environmentDigests: JSON.parse(originalEnvironment),
      toolchain,
      profile
    }
    return { ...result, inputDigest: digest(JSON.stringify(result)) }
  }
  const assertUnchanged = async ({ timeoutMilliseconds = qualificationTimeoutMilliseconds } = {}) => {
    if (failed) throw failed
    const control = phaseDeadline("observer drain", Math.min(timeoutMilliseconds, qualificationTimeoutMilliseconds))
    const timer = setTimeout(() => controller.abort(), control.remaining())
    try {
      if (
        JSON.stringify(effectiveEnvironment) !== originalEffectiveEnvironment ||
        JSON.stringify(environmentIdentity(effectiveEnvironment)) !== originalEnvironment ||
        JSON.stringify(profile) !== originalProfile ||
        JSON.stringify(toolchain) !== originalToolchain
      )
        throw new Error("Formal environment profile or toolchain changed during verification")
      await observer.assertUnchanged()
      control.assert()
    } catch (error) {
      failed = error
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  let identity
  try {
    deadline.assert()
    const snapshotStarted = performance.now()
    identity = await snapshot(deadline)
    timings.initialSnapshotMilliseconds = performance.now() - snapshotStarted
    await assertUnchanged({ timeoutMilliseconds: deadline.remaining() })
    deadline.assert()
    clearTimeout(phaseTimer)
  } catch (error) {
    clearTimeout(phaseTimer)
    await Promise.allSettled([observer.close(), broadObserver.close()])
    throw error
  }
  return {
    identity,
    timings,
    assertUnchanged,
    finish: async ({ timeoutMilliseconds = qualificationTimeoutMilliseconds } = {}) => {
      const qualificationStarted = performance.now()
      const phase = phaseDeadline(
        "input qualification",
        Math.min(timeoutMilliseconds, qualificationTimeoutMilliseconds)
      )
      phase.signal = controller.signal
      phaseTimer = setTimeout(() => controller.abort(), phase.remaining())
      try {
        await assertUnchanged({ timeoutMilliseconds: phase.remaining() })
        phase.assert()
        const finalIdentity = await snapshot(phase)
        await assertUnchanged({ timeoutMilliseconds: phase.remaining() })
        phase.assert()
        if (identity.inputDigest !== finalIdentity.inputDigest)
          throw new Error("Complete formal inputs changed during verification")
        return {
          version: formalInputPolicyVersion,
          observerVersion: formalEvidenceContract.observerVersion,
          ready: true,
          drained: true,
          unchanged: true,
          inputDigest: identity.inputDigest
        }
      } catch (error) {
        failed = error
        throw error
      } finally {
        timings.qualificationMilliseconds.push(performance.now() - qualificationStarted)
        clearTimeout(phaseTimer)
      }
    },
    close: async () => {
      clearTimeout(phaseTimer)
      await Promise.allSettled([observer.close(), broadObserver.close()])
    }
  }
}
