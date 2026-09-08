const SECOND = 1_000

export const capabilityRegistrationQualityGate = Object.freeze({
  args: Object.freeze(["test:capability-registration"]),
  name: "capability registration",
  timeout: 60 * SECOND
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
