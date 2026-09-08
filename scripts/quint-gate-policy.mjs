import { performance } from "node:perf_hooks"

const second = 1000

// Hosted reference: ubuntu-24.04-arm (4 CPUs), Node 24.15.0, Quint 0.32.0;
// cold run 33998647004 completed every check in 645.73s on 2026-09-05.
// Provisional regression budget: that sample +15%, rounded up to 30s.
// This replaces the 600s budget calibrated on an unspecified local ARM host.
export const quintGateRegressionBudgetMilliseconds = 750 * second

export const quintHostedJobTimeoutMinutes = 16
export const quintHostedReserveMilliseconds = 210 * second
export const quintGateTerminationGraceMilliseconds = 5 * second
export const quintGateProcessGroupAbsenceTimeoutMilliseconds = 2 * second

// Reserve setup/install/reporting and bounded child termination before choosing
// the last complete 30-second execution interval inside the hosted cutoff.
// This safety stop is intentionally stricter than the unchanged regression
// threshold: a wedged child must leave time to terminate and report failure.
const deadlineIntervalMilliseconds = 30 * second
export const quintGateSafetyTimeoutMilliseconds =
  Math.floor(
    (quintHostedJobTimeoutMinutes * 60 * second -
      quintHostedReserveMilliseconds -
      quintGateTerminationGraceMilliseconds -
      quintGateProcessGroupAbsenceTimeoutMilliseconds) /
      deadlineIntervalMilliseconds
  ) * deadlineIntervalMilliseconds

/**
 * Read the formal job's literal cutoff from the checked-in workflow. Unsupported
 * expressions, duplicate keys, and missing policy linkage are failures, not a
 * fallback to a presumed hosted timeout.
 */
export const assertQuintHostedDeadlineContract = (workflow) => {
  const jobs = workflow
    .split(/(?=^  [A-Za-z0-9_-]+:\s*$)/m)
    .filter((section) => section.startsWith("  formal-models:\n"))
  const cutoffs = jobs.length === 1 ? [...jobs[0].matchAll(/^    timeout-minutes: (\d+)$/gm)] : []
  const declarations = jobs.length === 1 ? [...jobs[0].matchAll(/^    timeout-minutes:/gm)] : []
  const timeoutMinutes = cutoffs.length === 1 ? Number(cutoffs[0][1]) : undefined
  const requiredMilliseconds =
    quintGateSafetyTimeoutMilliseconds +
    quintHostedReserveMilliseconds +
    quintGateTerminationGraceMilliseconds +
    quintGateProcessGroupAbsenceTimeoutMilliseconds
  if (
    declarations.length !== 1 ||
    timeoutMinutes !== quintHostedJobTimeoutMinutes ||
    requiredMilliseconds >= timeoutMinutes * 60 * second
  ) {
    throw new Error(
      "Quint hosted deadline contract requires one literal 16-minute formal job with execution, termination, and reserve strictly inside its cutoff"
    )
  }
}

/** One monotonic execution deadline; an expired gate must not admit another child. */
export const createQuintGateDeadline = ({ now = () => performance.now(), startedAt = now() } = {}) => {
  const deadline = startedAt + quintGateSafetyTimeoutMilliseconds
  return (name) => {
    const remaining = deadline - now()
    if (remaining > 0) return remaining
    throw Object.assign(new Error(`${name} exceeded the Quint gate execution deadline before launch`), {
      quintCommandResult: "timed-out"
    })
  }
}
