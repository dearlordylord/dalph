import { integratorSessionCorrelationsEqual } from "./events.js"
import type { IntegratorResponsibilityFacts, IntegratorSessionCorrelation } from "./events.js"

/** Exact session identity equivalence shared by reconstruction and authorization. */
export const integratorCorrelationsEqual = integratorSessionCorrelationsEqual

/** Projects the responsibility identity carried by an exact fixed session. */
export const integratorResponsibilityFactsFromCorrelation = (
  correlation: IntegratorSessionCorrelation
): IntegratorResponsibilityFacts => ({
  acceptedResult: correlation.acceptedResult,
  integrationTarget: correlation.integrationTarget,
  plannedAttempt: correlation.plannedAttempt,
  queuedAt: correlation.queuedAt,
  startedAt: correlation.startedAt
})
