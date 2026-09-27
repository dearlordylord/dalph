import { spawnSync } from "node:child_process"

export const deliverySmokeIterations = 3

/** Exact committed candidate comparison; absent history conservatively selects all. */
export const candidateChangedPaths = (baseSha, candidateSha, cwd = process.cwd()) => {
  const result = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", baseSha, candidateSha, "--"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  })
  return result.status === 0 ? result.stdout.split("\0").filter(Boolean) : undefined
}

export const requiresBroadSampling = (paths) =>
  !Array.isArray(paths) ||
  paths.length === 0 ||
  paths.some((path) =>
    /(?:^(?:scripts\/|\.github\/|patches\/)|(?:^|\/)(?:package\.json|pnpm-[^/]*|[^/]*config[^/]*|\.[^/]*rc(?:\.json)?)$|\/(?:coordination|workflow|execution|cassettes)\/)/u.test(
      path
    )
  )

/** Select expensive assurance by the changed boundary; absent evidence selects all. */
export const selectQualityStages = (stages, changedPaths) => {
  const advisory = new Set(["complexity", "duplicates"])
  const controls = new Set([
    "coverage-explanation-controls",
    "custody-controls",
    "previous-boot-reconciliation-controls",
    "resume-controls",
    "preflight-controls",
    "ci-classification",
    "formal-controls"
  ])
  const unknown = !Array.isArray(changedPaths) || changedPaths.length === 0
  const shared =
    unknown ||
    changedPaths.some((path) =>
      /(?:^(?:scripts\/|\.github\/|patches\/)|(?:^|\/)(?:package\.json|pnpm-[^/]*|[^/]*config[^/]*|\.[^/]*rc(?:\.json)?)$)/u.test(
        path
      )
    )
  const catalog =
    shared ||
    changedPaths.some((path) =>
      /^(?:packages\/contracts\/|packages\/(?:dalph|orchestrator)\/src\/(?:cassettes|workflow-journal|.*schema|.*projection)|packages\/dalph\/test\/cassettes|prototypes\/reducer-lab)/u.test(
        path
      )
    )
  return stages
    .filter((stage) => {
      if (advisory.has(stage.id)) return false
      if (controls.has(stage.id)) return shared
      if (stage.id === "reducer-lab" || stage.id === "recorded-catalog") return catalog
      return true
    })
    .map((stage) =>
      stage.id === "delivery-repeatability" && !requiresBroadSampling(changedPaths)
        ? { ...stage, name: "fresh-process delivery smoke", args: ["test:delivery-smoke"], timeout: 5 * 60_000 }
        : stage
    )
}
