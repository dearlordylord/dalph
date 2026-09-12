import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { inputObserverScript, startInputObserver } from "./gate-input-observer.mjs"

const hash = (value) => createHash("sha256").update(value).digest("hex")
const below = (path, root) => path === root || path.startsWith(`${root}${sep}`)
const git = (worktree, args, environment) =>
  execFileSync("git", args, {
    cwd: worktree,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  })

/** Only per-run transport and invocation bookkeeping is erased; behavioral settings, including diagnostics base, remain. */
const excludedEnvironmentKeys = new Set([
  "DALPH_GATE_RUN_DIRECTORY",
  "DALPH_GATE_RUN_ID",
  "DALPH_GATE_OBLIGATION",
  "DALPH_GATE_SLOT",
  "DALPH_GATE_WAIT_STARTED_MILLISECONDS",
  "DALPH_COVERAGE_DIRECTORY",
  "npm_lifecycle_event",
  "npm_lifecycle_script",
  "npm_command",
  "npm_config_argv",
  "PNPM_SCRIPT_SRC_DIR",
  "INIT_CWD",
  "PWD",
  "SHLVL",
  "_"
])
const environmentDigests = (environment) =>
  Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) => !excludedEnvironmentKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, hash(value ?? "<unset>")])
  )

const executableCandidates = (name, environment) =>
  isAbsolute(name) || name.includes(sep)
    ? [resolve(name)]
    : (environment.PATH ?? "").split(delimiter).map((path) => resolve(path, name))
const implementationRoot = (path) => {
  let directory = dirname(realpathSync(path))
  while (directory !== dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory
    directory = dirname(directory)
  }
  throw new Error(`Cannot locate installed pnpm implementation: ${path}`)
}
const executable = (name, environment) => {
  const candidates = executableCandidates(name, environment)
  const path = candidates.find((candidate) => {
    try {
      const status = lstatSync(candidate)
      return (status.isFile() || status.isSymbolicLink()) && (lstatSync(realpathSync(candidate)).mode & 0o111) !== 0
    } catch {
      return false
    }
  })
  if (path === undefined) throw new Error(`Required input executable is unavailable: ${name}`)
  return resolve(path)
}

/** Complete membership/content/modes and resolved links, with no metadata cache. Cycles are recorded but not traversed twice. */
const manifest = (roots, exclusions) => {
  const entries = new Map()
  const skipped = (path) => exclusions.some((root) => below(path, root))
  const visit = (path) => {
    path = resolve(path)
    if (entries.has(path) || skipped(path)) return
    let status
    try {
      status = lstatSync(path)
    } catch (error) {
      if (error.code === "ENOENT") {
        entries.set(path, { path, type: "absent" })
        return
      }
      throw error
    }
    const mode = status.mode & 0o777
    if (status.isSymbolicLink()) {
      const target = readlinkSync(path)
      const resolved = realpathSync(path)
      entries.set(path, { path, type: "symlink", mode, target, resolved })
      visit(resolved)
    } else if (status.isDirectory()) {
      entries.set(path, { path, type: "directory", mode })
      for (const child of readdirSync(path).sort((left, right) => left.localeCompare(right))) visit(join(path, child))
    } else if (status.isFile()) entries.set(path, { path, type: "file", mode, sha256: hash(readFileSync(path)) })
    else throw new Error(`Unsupported resume input: ${path}`)
  }
  for (const root of roots) visit(root)
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/** Only options emitted by this harness are supported. Unknown syntax/options may load external files and refuse reuse. */
const validateNodeOptions = (value = "") => {
  if (/["'\\]/u.test(value)) throw new Error("Unsupported NODE_OPTIONS quoted or escaped syntax for resume")
  const tokens = value.trim().split(/\s+/u).filter(Boolean)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (/^--max[-_]old[-_]space[-_]size=\d+$/u.test(token) || token === "--disable-warning=ExperimentalWarning")
      continue
    if (/^--max[-_]old[-_]space[-_]size$/u.test(token) && /^\d+$/u.test(tokens[index + 1] ?? "")) {
      index++
      continue
    }
    throw new Error(`Unsupported NODE_OPTIONS option for resume: ${token}`)
  }
}
const dprintCacheRoot = (environment) =>
  environment.DPRINT_CACHE_DIR ??
  (environment.XDG_CACHE_HOME !== undefined
    ? join(environment.XDG_CACHE_HOME, "dprint")
    : environment.HOME !== undefined
      ? join(environment.HOME, ".cache", "dprint")
      : undefined)

const configurationRoots = (worktree, environment) => {
  const home = environment.HOME
  const paths =
    home === undefined ? [] : [join(home, ".gitconfig"), join(home, ".npmrc"), join(home, ".config", "git", "config")]
  const cacheRoot = dprintCacheRoot(environment)
  if (cacheRoot !== undefined) paths.push(resolve(worktree, cacheRoot))
  const configRoot = environment.XDG_CONFIG_HOME ?? (home === undefined ? undefined : join(home, ".config"))
  if (configRoot !== undefined) paths.push(join(configRoot, "pnpm", "rc"))
  for (const key of ["GITLEAKS_CONFIG", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (environment[key] !== undefined) paths.push(resolve(worktree, environment[key]))
  paths.push(environment.GIT_CONFIG_SYSTEM ?? "/etc/gitconfig")
  if (environment.GIT_CONFIG_GLOBAL !== undefined) paths.push(environment.GIT_CONFIG_GLOBAL)
  if (environment.npm_config_globalconfig !== undefined) paths.push(environment.npm_config_globalconfig)
  if (environment.XDG_CONFIG_HOME !== undefined) paths.push(join(environment.XDG_CONFIG_HOME, "git", "config"))
  if (environment.npm_config_userconfig !== undefined) paths.push(resolve(worktree, environment.npm_config_userconfig))
  const origins = git(worktree, ["config", "--show-origin", "--list", "-z"], environment).split("\0")
  for (const origin of origins) if (origin.startsWith("file:")) paths.push(resolve(worktree, origin.slice(5)))
  validateNodeOptions(environment.NODE_OPTIONS)
  return [...new Set(paths)]
}

const optionalGit = (worktree, args, environment) => {
  try {
    return git(worktree, args, environment).trim()
  } catch (error) {
    if (error.status === 1) return undefined
    throw error
  }
}

const candidateHistory = (worktree, logicalInvocation, environment) => {
  const history = logicalInvocation.gitHistory
  const marker = environment.DALPH_GATE_GIT_HISTORY
  if (history === undefined && marker === undefined) return false
  if (
    history?.mode !== "candidate-ancestry" ||
    marker !== "candidate-ancestry" ||
    !/^[0-9a-f]{40}$/u.test(history.headSha ?? "")
  )
    throw new Error("Candidate Git history must match the effective environment and logical invocation")
  if (git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"], environment).trim() !== history.headSha)
    throw new Error("Candidate Git history scan SHA does not equal snapshot HEAD")
  const expected = ["check:secrets", `--log-opts=--full-history --diff-filter=tuxdb ${history.headSha} --`]
  const stage = logicalInvocation.stageManifest?.find((entry) => entry.id === "secrets")
  if (
    JSON.stringify(stage?.args) !== JSON.stringify(expected) ||
    stage?.execution?.args?.length !== 4 ||
    JSON.stringify(stage.execution.args.slice(1)) !== JSON.stringify(["--silent", ...expected])
  )
    throw new Error("Candidate Git history requires the exact bound secret-stage command")
  return true
}

const gitAuthorityInputs = (root, logicalInvocation, environment, gitDirectory, commonDirectory) => {
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_SHALLOW_FILE",
    "GIT_REPLACE_REF_BASE",
    "GIT_GRAFT_FILE",
    "GIT_NAMESPACE",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_ATTR_SOURCE"
  ])
    if (environment[key] !== undefined) throw new Error(`Unsupported Git input redirect: ${key}`)
  // Git path-format canonicalization erases authored symlink locators. Resolve
  // plain --git-path output against this worktree while retaining those links.
  const path = (name) => resolve(root, git(root, ["rev-parse", "--git-path", name], environment).trim())
  const paths = [
    join(gitDirectory, "HEAD"),
    join(gitDirectory, "HEAD.lock"),
    join(gitDirectory, "index"),
    join(gitDirectory, "index.lock"),
    join(commonDirectory, "config"),
    path("config.worktree"),
    path("packed-refs"),
    path("packed-refs.lock"),
    path("info/exclude"),
    path("info/attributes"),
    path("info/grafts"),
    path("shallow"),
    path("refs/replace")
  ]
  for (const name of ["core.excludesfile", "core.attributesfile"]) {
    const configured = optionalGit(root, ["config", "--path", "--get", name], environment)
    if (configured !== undefined) paths.push(resolve(root, configured))
  }
  for (const name of ["objects", "objects/info"]) {
    // --path-format=absolute resolves object-directory links; inspect the
    // authored locator first so canonicalization cannot erase indirection.
    const directory = join(commonDirectory, name)
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
      throw new Error(`Unsupported Git object-directory link: ${directory}`)
  }
  for (const name of ["objects/info/alternates", "objects/info/http-alternates"]) {
    const authority = path(name)
    paths.push(authority)
    if (existsSync(authority) && readFileSync(authority, "utf8").trim() !== "")
      throw new Error(`Unsupported Git object indirection: ${authority}`)
  }
  if (optionalGit(root, ["config", "--get", "extensions.partialclone"], environment) !== undefined)
    throw new Error("Unsupported Git partial-clone history")
  const storage = optionalGit(root, ["config", "--get", "extensions.refstorage"], environment)
  if (storage !== undefined && storage !== "files") throw new Error("Unsupported Git reference storage")
  if (!candidateHistory(root, logicalInvocation, environment)) paths.push(path("refs"))
  else {
    let target = optionalGit(root, ["symbolic-ref", "--quiet", "--no-recurse", "HEAD"], environment)
    const seen = new Set()
    while (target !== undefined) {
      if (seen.has(target)) throw new Error("Cyclic candidate HEAD symbolic reference")
      seen.add(target)
      git(root, ["check-ref-format", target], environment)
      const locator = path(target)
      let ancestor = dirname(locator)
      while (below(ancestor, commonDirectory) || below(ancestor, gitDirectory)) {
        if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink())
          throw new Error(`Unsupported selected Git ref ancestor link: ${ancestor}`)
        ancestor = dirname(ancestor)
      }
      paths.push(locator, `${locator}.lock`)
      target = optionalGit(root, ["symbolic-ref", "--quiet", "--no-recurse", target], environment)
    }
  }
  return [...new Set(paths)]
}

const inputLayout = ({ effectiveEnvironment, generatedOutputRoots, logicalInvocation, worktree }) => {
  const root = realpathSync(worktree)
  if (!Array.isArray(logicalInvocation.toolExecutables))
    throw new Error("Logical invocation must declare its complete external tool inventory")
  const toolNames = [process.execPath, "python3", "git", ...logicalInvocation.toolExecutables]
  const selectedTools = toolNames.map((tool) => executable(tool, effectiveEnvironment))
  const tools = [
    ...new Set([...selectedTools, ...toolNames.flatMap((tool) => executableCandidates(tool, effectiveEnvironment))])
  ]
  if (effectiveEnvironment.npm_execpath !== undefined)
    tools.push(resolve(effectiveEnvironment.npm_execpath), implementationRoot(effectiveEnvironment.npm_execpath))
  tools.push(inputObserverScript)
  const gitDirectory = git(root, ["rev-parse", "--path-format=absolute", "--git-dir"], effectiveEnvironment).trim()
  const commonDirectory = git(
    root,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    effectiveEnvironment
  ).trim()
  const gitInputs = gitAuthorityInputs(root, logicalInvocation, effectiveEnvironment, gitDirectory, commonDirectory)
  if (lstatSync(join(root, ".git")).isFile()) gitInputs.push(join(root, ".git"))
  const configurations = configurationRoots(root, effectiveEnvironment)
  const exclusions = generatedOutputRoots.map((path) => resolve(root, path))
  const environmentDisablesIncremental = effectiveEnvironment.DALPH_DPRINT_INCREMENTAL === "disabled"
  const contractDisablesIncremental = logicalInvocation.dprintIncremental === "disabled"
  if (environmentDisablesIncremental !== contractDisablesIncremental)
    throw new Error("Dprint incremental policy must match the effective environment and logical invocation")
  // The caller binds --incremental=false into its actual lint command. Only that
  // contract makes incremental results and lock coordination bookkeeping outputs;
  // plugin implementations, their manifests, and unknown cache paths remain inputs.
  const cacheRoot = dprintCacheRoot(effectiveEnvironment)
  if (environmentDisablesIncremental && cacheRoot !== undefined) {
    const cache = resolve(
      root,
      effectiveEnvironment.DPRINT_CACHE_DIR === undefined ? join(cacheRoot, "cache") : cacheRoot
    )
    exclusions.push(join(cache, "incremental"), join(cache, "locks"))
  }
  if (exclusions.some((path) => below(root, path)))
    throw new Error("Generated output exclusions cannot erase the worktree")
  return {
    root,
    tools,
    gitInputs,
    configurations,
    exclusions,
    sourceExclusions: [...exclusions, join(root, ".git")],
    python: executable("python3", effectiveEnvironment)
  }
}

const snapshot = ({ effectiveEnvironment, layout, logicalInvocation }) => {
  const index = git(layout.root, ["ls-files", "--stage", "-z"], effectiveEnvironment).split("\0").filter(Boolean)
  if (index.some((entry) => !/^\d+ [0-9a-f]+ 0\t/u.test(entry)))
    throw new Error("Unresolved Git index conflicts forbid resume")
  const head = git(layout.root, ["rev-parse", "HEAD"], effectiveEnvironment).trim()
  const source = manifest([layout.root], layout.sourceExclusions)
  const manifests = {
    source,
    index,
    head,
    git: manifest(layout.gitInputs, []),
    tools: manifest(layout.tools, layout.exclusions),
    configuration: manifest(layout.configurations, layout.exclusions)
  }
  const sourceInputDigest = hash(JSON.stringify({ head, index, source }))
  const inputs = {
    version: 2,
    observerVersion: 1,
    worktree: layout.root,
    logicalInvocation,
    manifests,
    environmentDigests: environmentDigests(effectiveEnvironment),
    sourceInputDigest
  }
  return { ...inputs, inputDigest: hash(JSON.stringify(inputs)) }
}

/** Observation begins before hashing. A dirty/lost observer or unequal final full snapshot can never produce green guard evidence. */
export const startInputGuard = async ({
  effectiveEnvironment = process.env,
  generatedOutputRoots = [],
  logicalInvocation,
  worktree
}) => {
  const layout = inputLayout({ worktree, logicalInvocation, effectiveEnvironment, generatedOutputRoots })
  const observer = await startInputObserver({
    roots: [layout.root, ...layout.gitInputs, ...layout.tools, ...layout.configurations],
    excludedRoots: layout.sourceExclusions,
    protectedRoots: layout.gitInputs,
    pythonExecutable: layout.python
  })
  let identity
  try {
    const observedLayout = inputLayout({ worktree, logicalInvocation, effectiveEnvironment, generatedOutputRoots })
    if (JSON.stringify(observedLayout) !== JSON.stringify(layout))
      throw new Error("Input roots changed during observer setup")
    identity = snapshot({ layout, logicalInvocation, effectiveEnvironment })
    await observer.assertUnchanged()
  } catch (error) {
    await observer.close()
    throw error
  }
  const originalEnvironment = JSON.stringify(identity.environmentDigests)
  const originalInvocation = JSON.stringify(logicalInvocation)
  let invalidation
  const assertUnchanged = async () => {
    await observer.assertUnchanged()
    if (
      JSON.stringify(environmentDigests(effectiveEnvironment)) !== originalEnvironment ||
      JSON.stringify(logicalInvocation) !== originalInvocation
    ) {
      invalidation ??= "Effective environment or logical invocation changed"
    }
    if (invalidation !== undefined) throw new Error(invalidation)
  }
  return {
    identity,
    assertUnchanged,
    protectArtifacts: observer.protect,
    finish: async () => {
      await assertUnchanged()
      const finalLayout = inputLayout({ worktree, logicalInvocation, effectiveEnvironment, generatedOutputRoots })
      if (JSON.stringify(finalLayout) !== JSON.stringify(layout))
        throw new Error("Resolved input roots changed during execution")
      const finalIdentity = snapshot({ layout, logicalInvocation, effectiveEnvironment })
      await assertUnchanged()
      if (finalIdentity.inputDigest !== identity.inputDigest)
        throw new Error("Complete resume inputs changed during execution")
      return {
        version: 1,
        observerVersion: 1,
        unchanged: true,
        ready: true,
        drained: true,
        inputDigest: identity.inputDigest,
        sourceInputDigest: identity.sourceInputDigest
      }
    },
    close: observer.close
  }
}
