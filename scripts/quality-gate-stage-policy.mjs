const SECOND = 1_000
const DEFAULT_PROCESS_GROUP_ABSENCE_TIMEOUT = 2 * SECOND
const DEFAULT_TERMINATION_GRACE = 5 * SECOND

/**
 * The checked-in stage algebra is shared by the local resumable gate and the
 * hosted post-preflight jobs.  The candidate and reviewed Base are inputs to a
 * plan; this identity names the stage policy that interpreted those inputs.
 */
export const qualityGatePolicyIdentity = Object.freeze({ id: "dalph-quality-stage-algebra", revision: 4, version: 1 })

// Local Vitest-backed obligations are admitted under the highest fixed cap
// proven safe by the pairwise memory campaign recorded for issue #336.  This
// is a checked-in policy, never a function of host cores or available RAM.
export const localQualificationConcurrency = 1

/**
 * A clean hosted runner reconstructs production artifacts after installing the
 * frozen dependency graph.  The suffix stages must use this exact bounded
 * preparation sequence; they do not rerun the structural preflight.
 */
export const qualityGateCleanRunnerPreparation = Object.freeze({
  artifactTransfer: "none",
  commands: Object.freeze([
    Object.freeze({
      args: Object.freeze(["install", "--frozen-lockfile"]),
      id: "frozen-install",
      timeoutMilliseconds: 5 * 60 * SECOND
    }),
    Object.freeze({
      args: Object.freeze(["check:artifacts"]),
      id: "artifact-preparation",
      timeoutMilliseconds: 5 * 60 * SECOND
    })
  ]),
  id: "frozen-install-and-artifact-preparation",
  preflightRerun: false,
  timeoutMilliseconds: 10 * 60 * SECOND
})

const deliveryDigestArtifactObligation = Object.freeze({
  id: "delivery-digest",
  required: true,
  type: "delivery-repeatability-digest"
})

const coverageArtifactObligations = Object.freeze([
  Object.freeze({ id: "coverage-final", path: "coverage/coverage-final.json", required: true, type: "coverage" }),
  Object.freeze({ id: "coverage-summary", path: "coverage/coverage-summary.json", required: true, type: "coverage" })
])

// The unchanged all-catalog proof measured 348.688s wall time without V8
// instrumentation. Seven minutes leaves 71.312s (20.5%) for runner variance
// while keeping this duplicate semantic pass separate and finite.
export const recordedCatalogQualityGate = Object.freeze({
  args: Object.freeze(["test:recorded-catalog"]),
  name: "maintained recorded-catalog semantics",
  timeout: 7 * 60 * SECOND
})

// Issue #401's 90-sample contention campaign observed 30/30 timeouts at the
// 60-second bound under saturation and 8/30 under moderate load. Keep the
// larger deadline finite so custody and fail-closed timeout behavior remain
// unchanged while allowing the measured source audit headroom to complete.
const CAPABILITY_REGISTRATION_TIMEOUT = 120 * SECOND

// Recovery qualification measured the custody and resume suites at 70.5s and
// 98.5s under admitted execution. Two minutes keeps both finite without making
// normal host variance a false product failure. The maintained Lab completed
// just below its former five-minute edge, so its bounded headroom is seven minutes.
const GATE_CONTROL_TIMEOUT = 2 * 60 * SECOND
const REDUCER_LAB_TIMEOUT = 7 * 60 * SECOND

export const capabilityRegistrationQualityGate = Object.freeze({
  args: Object.freeze(["test:capability-registration"]),
  name: "capability registration",
  timeout: CAPABILITY_REGISTRATION_TIMEOUT
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

/** The early admitted baseline reuses the exact lint and Lab stages from full preflight. */
export const baselineQualityGates = () => [
  { args: ["lint:code", "--census"], name: "format and lint", timeout: 5 * 60 * SECOND },
  { args: ["check:lab"], name: "Reducer Lab maintained evaluation", timeout: REDUCER_LAB_TIMEOUT }
]

/** Structural checks run once before qualification; production artifacts are prepared before source checks. */
export const preflightQualityGates = (baseSha) => [
  { args: ["check:artifacts"], name: "build and production artifacts", timeout: 5 * 60 * SECOND },
  { args: ["typecheck"], name: "typecheck (including Effect diagnostics)", timeout: 2 * 60 * SECOND },
  ...baselineQualityGates(),
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  complexityQualityGate(baseSha),
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["test:coverage:explanation"], name: "coverage explanation controls", timeout: 60 * SECOND },
  { args: ["test:gate-custody"], name: "gate custody controls", timeout: GATE_CONTROL_TIMEOUT },
  { args: ["test:gate-previous-boot-reconcile"], name: "previous-boot gate reconciliation", timeout: 60 * SECOND },
  { args: ["test:gate-resume"], name: "gate resume controls", timeout: GATE_CONTROL_TIMEOUT },
  { args: ["test:preflight"], name: "preflight controls", timeout: 60 * SECOND },
  { args: ["test:ci-change-classification"], name: "CI change classification", timeout: 60 * SECOND },
  { args: ["test:formal:controls"], name: "formal verification controls", timeout: 60 * SECOND },
  { args: ["check:secrets"], name: "secret scan", timeout: 5 * 60 * SECOND },
  capabilityRegistrationQualityGate
]

/**
 * The only independent post-preflight obligations.  Keep this inventory here
 * so local ordered/resume execution and hosted stage planning cannot drift.
 */
export const qualificationQualityGates = () => [
  {
    artifactObligations: Object.freeze([deliveryDigestArtifactObligation]),
    artifactRoots: Object.freeze([]),
    args: Object.freeze(["test:delivery-repeatability"]),
    boundary: "qualification",
    cleanRunnerPreparation: qualityGateCleanRunnerPreparation,
    id: "delivery-repeatability",
    name: "delivery repeatability",
    terminationGrace: 15 * SECOND,
    timeout: 19 * 60 * SECOND
  },
  {
    artifactObligations: Object.freeze([]),
    artifactRoots: Object.freeze([]),
    args: recordedCatalogQualityGate.args,
    boundary: "qualification",
    cleanRunnerPreparation: qualityGateCleanRunnerPreparation,
    id: "recorded-catalog",
    name: recordedCatalogQualityGate.name,
    processGroupAbsenceTimeout: DEFAULT_PROCESS_GROUP_ABSENCE_TIMEOUT,
    terminationGrace: DEFAULT_TERMINATION_GRACE,
    timeout: recordedCatalogQualityGate.timeout
  },
  {
    artifactObligations: coverageArtifactObligations,
    artifactRoots: Object.freeze(["@coverage"]),
    args: Object.freeze(["test"]),
    boundary: "qualification",
    cleanRunnerPreparation: qualityGateCleanRunnerPreparation,
    environmentPolicy: "coverage-base-warning",
    id: "coverage",
    name: "tests and coverage",
    processGroupAbsenceTimeout: DEFAULT_PROCESS_GROUP_ABSENCE_TIMEOUT,
    terminationGrace: DEFAULT_TERMINATION_GRACE,
    timeout: 20 * 60 * SECOND
  }
]

export const qualityGateQualificationStageIds = Object.freeze(qualificationQualityGates().map(({ id }) => id))

/** One stable ordered inventory binds resumable quality verdicts to bounded commands and outputs. */
export const fullQualityGateManifest = (baseSha, invocation) => {
  if (invocation?.candidateHeadSha !== undefined && !/^[0-9a-f]{40}$/u.test(invocation.candidateHeadSha))
    throw new Error("Candidate secret scan requires a canonical HEAD SHA")
  const preflightIds = [
    "production-artifacts",
    "typecheck",
    "format-lint",
    "reducer-lab",
    "dependency-cycles",
    "complexity",
    "duplicates",
    "coverage-explanation-controls",
    "custody-controls",
    "previous-boot-reconciliation-controls",
    "resume-controls",
    "preflight-controls",
    "ci-classification",
    "formal-controls",
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
          : gate.args[0] === "check:lab"
            ? ["prototypes/reducer-lab/dist"]
            : []
  }))
  const manifest = [...prefix, ...qualificationQualityGates()]
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
