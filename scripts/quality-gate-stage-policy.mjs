const SECOND = 1_000

// The unchanged all-catalog proof measured 348.688s wall time without V8
// instrumentation. Seven minutes leaves 71.312s (20.5%) for runner variance
// while keeping this duplicate semantic pass separate and finite.
export const recordedCatalogQualityGate = Object.freeze({
  args: Object.freeze(["test:recorded-catalog"]),
  name: "maintained recorded-catalog semantics",
  timeout: 7 * 60 * SECOND
})

export const capabilityRegistrationQualityGate = Object.freeze({
  args: Object.freeze(["test:capability-registration"]),
  name: "capability registration",
  timeout: 60 * SECOND
})

/** The complexity policy compares its registry with the exact full-gate base. */
export const complexityQualityGate = (baseSha) =>
  Object.freeze({
    args: Object.freeze(["check:complexity", `--candidate=${baseSha}`]),
    name: "cyclomatic complexity",
    timeout: 60 * SECOND
  })

/** Coverage receives the same canonical base that governs complexity suppressions. */
export const qualityGateTestEnvironment = (baseSha, environment = process.env) => ({
  ...environment,
  DALPH_COVERAGE_BASE_SHA: baseSha,
  NODE_OPTIONS: [environment.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" ")
})

/** Build the process-group-bounded invocation shared by every quality stage. */
export const boundedQualityGateCommand = ({ gate, nodeExecutable, pnpmEntryPoint }) => ({
  // Omit pnpm lifecycle banners; retain the child tool's output and exit status.
  args: [pnpmEntryPoint, "--silent", ...gate.args],
  environment: gate.environment,
  executable: nodeExecutable,
  name: `Quality gate '${gate.name}'`,
  relayParentSignals: true,
  terminationGraceMilliseconds: gate.terminationGrace,
  timeoutMilliseconds: gate.timeout
})

/** Structural checks run once before qualification; production artifacts are prepared before source checks. */
export const preflightQualityGates = (baseSha) => [
  { args: ["check:artifacts"], name: "build and production artifacts", timeout: 5 * 60 * SECOND },
  { args: ["typecheck"], name: "typecheck", timeout: 2 * 60 * SECOND },
  { args: ["typecheck:effect"], name: "Effect diagnostics", timeout: 3 * 60 * SECOND },
  { args: ["lint:code", "--census"], name: "format and lint", timeout: 5 * 60 * SECOND },
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  complexityQualityGate(baseSha),
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["test:coverage:explanation"], name: "coverage explanation controls", timeout: 60 * SECOND },
  { args: ["test:gate-custody"], name: "gate custody controls", timeout: 60 * SECOND },
  { args: ["test:gate-resume"], name: "gate resume controls", timeout: 60 * SECOND },
  { args: ["test:preflight"], name: "preflight controls", timeout: 60 * SECOND },
  { args: ["test:ci-change-classification"], name: "CI change classification", timeout: 60 * SECOND },
  { args: ["test:quint:selection"], name: "final formal selection controls", timeout: 60 * SECOND },
  { args: ["check:secrets"], name: "secret scan", timeout: 5 * 60 * SECOND },
  capabilityRegistrationQualityGate
]

/** One stable ordered inventory binds resumable quality verdicts to bounded commands and outputs. */
export const fullQualityGateManifest = (baseSha, invocation) => {
  if (invocation?.candidateHeadSha !== undefined && !/^[0-9a-f]{40}$/u.test(invocation.candidateHeadSha))
    throw new Error("Candidate secret scan requires a canonical HEAD SHA")
  const preflightIds = [
    "production-artifacts",
    "typecheck",
    "effect-diagnostics",
    "format-lint",
    "dependency-cycles",
    "complexity",
    "duplicates",
    "coverage-explanation-controls",
    "custody-controls",
    "resume-controls",
    "preflight-controls",
    "ci-classification",
    "formal-selection-controls",
    "secrets",
    "capability-registration"
  ]
  const prefix = preflightQualityGates(baseSha).map((gate, ordinal) => ({
    ...gate,
    args:
      gate.args[0] === "check:secrets" && invocation?.candidateHeadSha !== undefined
        ? ["check:secrets", `--log-opts=--full-history --diff-filter=tuxdb ${invocation.candidateHeadSha} --`]
        : gate.args,
    id: preflightIds[ordinal],
    boundary: "preflight",
    artifactRoots:
      gate.args[0] === "typecheck"
        ? ["dist"]
        : gate.args[0] === "check:artifacts"
          ? ["packages/contracts/dist", "packages/orchestrator/dist", "packages/dalph/dist"]
          : []
  }))
  const manifest = [
    ...prefix,
    {
      id: "issue-268-repeatability",
      boundary: "qualification",
      args: ["test:issue-268-c4"],
      name: "issue 268 fresh-process repeatability",
      terminationGrace: 15 * SECOND,
      timeout: 19 * 60 * SECOND,
      artifactRoots: []
    },
    {
      id: "reducer-lab",
      boundary: "qualification",
      args: ["check:lab"],
      name: "Reducer Lab maintained evaluation",
      timeout: 5 * 60 * SECOND,
      artifactRoots: ["prototypes/reducer-lab/dist"]
    },
    { ...recordedCatalogQualityGate, id: "recorded-catalog", boundary: "qualification", artifactRoots: [] },
    {
      id: "coverage",
      boundary: "qualification",
      args: ["test:coverage"],
      name: "tests and coverage",
      environmentPolicy: "coverage-base-warning",
      timeout: 20 * 60 * SECOND,
      artifactRoots: ["@coverage"]
    }
  ]
  return invocation === undefined
    ? manifest
    : manifest.map((stage) => ({
        ...stage,
        execution: {
          executable: invocation.nodeExecutable,
          args: [invocation.pnpmEntryPoint, "--silent", ...stage.args],
          cwd: invocation.worktree,
          name: `Quality gate '${stage.name}'`,
          timeoutMilliseconds: stage.timeout,
          acceptedExitCodes: [0],
          relayParentSignals: true,
          terminationGraceMilliseconds: stage.terminationGrace ?? 5000,
          processGroupAbsenceTimeoutMilliseconds: 2000
        }
      }))
}
