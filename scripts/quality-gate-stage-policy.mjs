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
