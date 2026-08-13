import { readFile, readdir } from "node:fs/promises"
import { URL, pathToFileURL } from "node:url"

/**
 * The package boundary check owns two related contracts:
 *
 * - workspace manifests keep the package graph pointing from the application
 *   shell towards the orchestrator and never in the reverse direction; and
 * - source roles keep authority protocols behind the one boundary that owns
 *   them, even when two roles happen to live in the same package.
 *
 * The second contract is intentionally checked here instead of inferred from
 * directory names by a caller. A future file can therefore not silently move
 * an integration call into a descriptive or dispatch module.
 */

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

const executorForbiddenSourceFragments = [
  "@dalph/dalph",
  "@dalph/orchestrator",
  "integration-candidate",
  "integration-candidate-construction",
  "target-verification",
  "target-promotion",
  "integration-finality",
  "completion",
  "integration-target-resource",
  "/cleanup",
  "\\/cleanup"
]

const passiveSourceFiles = (relativePath) =>
  /^(?:packages\/orchestrator\/src\/coordination\/delivery\/(?:delivery|relations|ticket-delivery-projection|delivery-evidence|delivery-action-planning|delivery-action-proposal|delivery-proposal(?:-derivation|-identity|-route)?|delivery-transition-policy|fresh-workflow-step)\.ts|packages\/(?:orchestrator|dalph)\/src\/presentation\/[^/]+\.ts|packages\/(?:orchestrator|dalph)\/src\/(?:[^/]+-)?presentation\.ts|packages\/dalph\/src\/cassettes\/authored-presentation\.ts)$/u.test(
    relativePath
  )

const planningSourceFiles = (relativePath) =>
  /^packages\/orchestrator\/src\/coordination\/delivery\/(?:delivery-action-planning|delivery-action-proposal|delivery-proposal(?:-derivation|-identity|-route)?|delivery-transition-policy|fresh-workflow-step)\.ts$/u.test(
    relativePath
  )

const actionAdapterSourceFiles = (relativePath) =>
  /^packages\/orchestrator\/src\/coordination\/delivery\/(?:fresh|recovered|planned-attempt|integration)-delivery-action-adapter\.ts$/u.test(
    relativePath
  )

const dispatcherSourceFile = (relativePath) =>
  relativePath === "packages/orchestrator/src/coordination/delivery/live-delivery-action-executor.ts"

const passiveForbiddenImportFragments = [
  "authorities/git/command",
  "authorities/git/worktree",
  "authorities/git/integration-candidate",
  "coordination/admission/integration-target-resource",
  "workflow/protocols/task-claim-acquisition/execute",
  "workflow/protocols/task-claim-reacquisition/execute",
  "workflow/protocols/task-claim-release",
  "workflow/protocols/target-verification/runtime",
  "workflow/protocols/target-promotion/runtime",
  "workflow-journal/store"
]

const planningForbiddenImportFragments = [
  "coordination/admission/integration-target-resource",
  "coordination/delivery/delivery-runtime",
  "workflow/protocols/task-attempt-planning/plan",
  "workflow/protocols/task-claim-acquisition/execute",
  "workflow/protocols/task-claim-reacquisition/execute"
]

const dispatcherForbiddenImportFragments = [
  "workflow/protocols/",
  "workflow/interpretation/",
  "workflow-journal/",
  "workflow/registry/",
  "authorities/git/",
  "authorities/task-tracker/",
  "coordination/run/",
  "coordination/admission/",
  "coordination/delivery/delivery-runtime"
]

const actionAdapterForbiddenImportFragments = [
  "delivery-transition-policy",
  "delivery-proposal-route",
  "delivery-action-planning",
  "delivery-runtime-"
]

const passiveForbiddenBindings =
  /\b(?:GitCommand(?:Service)?|GitWorktree(?:Service)?|IntegrationCandidateGit|TargetPromotionGit|TargetVerificationBoundary|IntegrationTargetResourceController|JournalStore|JournalService|InRunJournal|WorkflowInterpreter|TrackerMutation(?:Service)?|TaskClaimMutation|GithubTrackerMutation|TaskTrackerMutation|DeliveryActionExecutor|run(?:TaskClaim|Completion|Target(?:Verification|Promotion)|IntegrationCandidate)|queueAcceptedResultIntegrationResponsibility|startQueuedIntegration|Cleanup|cleanup|JournalAppend|appendJournal)\b/u

const passiveForbiddenEffects =
  /\b(?:Schedule|Fiber|Queue|Semaphore)\b|\bEffect\.(?:fork|forkScoped|forkChild|retry|repeat|acquireRelease|acquireUseRelease)\b|\.\s*(?:retry|retryOrElse|repeat)\s*\(/u

const planningForbiddenBindings =
  /\b(?:OperationIdAllocator|PlannedTaskAttemptPlanner|DeliveryRuntime|DeliveryActionExecutor|IntegrationTargetResourceController|Schedule|Fiber|Queue|Ref|Semaphore)\b|\bEffect\.(?:fork|forkScoped|forkChild|retry|repeat|acquireRelease|acquireUseRelease)\b/u

const actionAdapterForbiddenBindings =
  /\b(?:deliveryTransitionPolicy|acceptedTransitionExecutionOf|usesPlannedAttemptProtocol|usesStopSubjectProtocol)\b/u

const importReferencesIn = (source) => {
  const references = []
  const staticImport =
    /^\s*(?<kind>import|export)\s+(?<typeOnly>type\s+)?(?<clause>[\s\S]*?)\s+from\s+["'](?<specifier>[^"']+)["']\s*;?/gmu
  for (const match of source.matchAll(staticImport)) {
    const index = match.index ?? 0
    references.push({
      clause: match.groups?.clause ?? "",
      index,
      specifier: match.groups?.specifier ?? "",
      typeOnly: match.groups?.kind === "import" && match.groups?.typeOnly !== undefined
    })
  }

  const sideEffectImport = /^\s*import\s+["'](?<specifier>[^"']+)["']\s*;?/gmu
  for (const match of source.matchAll(sideEffectImport)) {
    const index = match.index ?? 0
    if (references.some((reference) => reference.index === index)) continue
    references.push({ clause: "", index, specifier: match.groups?.specifier ?? "", typeOnly: false })
  }

  const dynamicImport = /\bimport\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/gu
  for (const match of source.matchAll(dynamicImport)) {
    references.push({ clause: "", index: match.index ?? 0, specifier: match.groups?.specifier ?? "", typeOnly: false })
  }

  return references.toSorted((left, right) => left.index - right.index)
}

const lineNumberAt = (source, index) => source.slice(0, index).split("\n").length

const hasFragment = (value, fragments) => fragments.some((fragment) => value.includes(fragment))

const sourceViolation = (file, index, rule, detail) =>
  `${file.relativePath}:${lineNumberAt(file.source, index)}: ${rule}: ${detail}`

const findSourceBoundaryViolations = (files) => {
  const violations = []
  for (const file of files) {
    const references = importReferencesIn(file.source)

    if (file.packageName === "executor") {
      for (const reference of references) {
        if (hasFragment(reference.specifier, executorForbiddenSourceFragments)) {
          violations.push(
            sourceViolation(
              file,
              reference.index,
              "executor-source-boundary",
              `executor code cannot import integration, tracker-completion, resource, cleanup, or application implementations (${reference.specifier})`
            )
          )
        }
      }
    }

    const isOrchestrator = file.packageName === "orchestrator"

    if (isOrchestrator && !file.relativePath.endsWith(".test.ts") && !file.relativePath.endsWith(".spec.ts")) {
      const promotionImport = references.find(
        ({ clause, typeOnly }) => !typeOnly && /\brunTargetPromotion\b/u.test(clause)
      )
      const isIntegrationActionAdapter =
        file.relativePath === "packages/orchestrator/src/coordination/delivery/integration-delivery-action-adapter.ts"
      if (promotionImport !== undefined && !isIntegrationActionAdapter) {
        violations.push(
          sourceViolation(
            file,
            promotionImport.index,
            "integration-promotion-boundary",
            "only the integration delivery action adapter may import the target-promotion action"
          )
        )
      }
      if (promotionImport === undefined && !isIntegrationActionAdapter) {
        const promotionCall = file.source.match(/\brunTargetPromotion\s*\(/u)
        if (promotionCall !== null) {
          violations.push(
            sourceViolation(
              file,
              file.source.search(/\brunTargetPromotion\s*\(/u),
              "integration-promotion-boundary",
              "only the integration delivery action adapter may invoke target promotion"
            )
          )
        }
      }
    }

    if (passiveSourceFiles(file.relativePath)) {
      for (const reference of references) {
        if (
          hasFragment(reference.specifier, passiveForbiddenImportFragments) &&
          !(reference.specifier.includes("workflow-journal/store") && reference.typeOnly)
        ) {
          violations.push(
            sourceViolation(
              file,
              reference.index,
              "passive-source-boundary",
              `description and presentation code cannot import a mutation capability (${reference.specifier})`
            )
          )
        }
      }
      if (passiveForbiddenBindings.test(file.source)) {
        violations.push(
          sourceViolation(
            file,
            file.source.search(passiveForbiddenBindings),
            "passive-source-boundary",
            "description and presentation code cannot receive tracker, Git, journal-append, retry, admission, or cleanup capability"
          )
        )
      }
      if (passiveForbiddenEffects.test(file.source)) {
        violations.push(
          sourceViolation(
            file,
            file.source.search(passiveForbiddenEffects),
            "passive-source-boundary",
            "description and presentation code cannot own retries, fibers, queues, or admission synchronization"
          )
        )
      }
    }

    if (isOrchestrator && planningSourceFiles(file.relativePath)) {
      for (const reference of references) {
        if (hasFragment(reference.specifier, planningForbiddenImportFragments)) {
          violations.push(
            sourceViolation(
              file,
              reference.index,
              "planning-source-boundary",
              `planning code cannot import allocation, admission, or runtime implementation (${reference.specifier})`
            )
          )
        }
      }
      if (planningForbiddenBindings.test(file.source)) {
        violations.push(
          sourceViolation(
            file,
            file.source.search(planningForbiddenBindings),
            "planning-source-boundary",
            "planning code cannot allocate identities, acquire resources, own fibers, or retry"
          )
        )
      }
      for (const identityConstructor of file.source.matchAll(/\b(?:OperationId|AttemptId)\.make\s*\(/gu)) {
        violations.push(
          sourceViolation(
            file,
            identityConstructor.index ?? 0,
            "planning-source-boundary",
            "planning code cannot allocate workflow or proposal identities"
          )
        )
      }
    }

    if (isOrchestrator && dispatcherSourceFile(file.relativePath)) {
      for (const reference of references) {
        if (
          hasFragment(reference.specifier, dispatcherForbiddenImportFragments) &&
          !(reference.typeOnly && reference.specifier.endsWith("/authorities/task-tracker/target.js"))
        ) {
          violations.push(
            sourceViolation(
              file,
              reference.index,
              "dispatch-source-boundary",
              `dispatch may select an existing action adapter but cannot import an authority protocol (${reference.specifier})`
            )
          )
        }
      }
    }

    if (isOrchestrator && actionAdapterSourceFiles(file.relativePath)) {
      for (const reference of references) {
        if (hasFragment(reference.specifier, actionAdapterForbiddenImportFragments)) {
          violations.push(
            sourceViolation(
              file,
              reference.index,
              "action-adapter-source-boundary",
              `action adapters cannot import scheduling policy or runtime coordination (${reference.specifier})`
            )
          )
        }
      }
      if (actionAdapterForbiddenBindings.test(file.source)) {
        violations.push(
          sourceViolation(
            file,
            file.source.search(actionAdapterForbiddenBindings),
            "action-adapter-source-boundary",
            "action adapters execute the selected protocol and cannot derive scheduling policy from route policy"
          )
        )
      }
    }
  }
  return violations
}

const filesBelow = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)
      return entry.isDirectory() ? filesBelow(url) : [url]
    })
  )
  return nested.flat()
}

export const sourceBoundaryViolations = findSourceBoundaryViolations

export const checkPackageBoundaries = async () => {
  const sourceFiles = []
  const repositoryRoot = new URL("../", import.meta.url)

  for (const [packageName, allowedDependencies] of Object.entries(allowedWorkspaceDependencies)) {
    const packageRoot = new URL(`packages/${packageName}/`, repositoryRoot)
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

    const packageSourceFiles = (await filesBelow(new URL("src/", packageRoot))).filter(
      (file) => file.pathname.endsWith(".ts") && !file.pathname.endsWith(".test.ts")
    )
    for (const file of packageSourceFiles) {
      const source = await readFile(file, "utf8")
      const relativePath = decodeURIComponent(file.href.slice(repositoryRoot.href.length))
      sourceFiles.push({ packageName, relativePath, source })
      for (const forbiddenDependency of forbiddenSourceImports[packageName]) {
        if (importReferencesIn(source).some(({ specifier }) => specifier === `@dalph/${forbiddenDependency}`)) {
          throw new Error(`@dalph/${packageName} imports forbidden @dalph/${forbiddenDependency}: ${file.pathname}`)
        }
      }
    }
  }

  const violations = findSourceBoundaryViolations(sourceFiles)
  if (violations.length > 0) throw new Error(`Source boundary violations:\n${violations.join("\n")}`)
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await checkPackageBoundaries()
}
