import { epochMilliseconds } from "./gate-custody-records.mjs"

// One absolute deadline covers admission and execution; nesting cannot restart the clock.
export const gateDeadlineEnvironmentName = "DALPH_GATE_DEADLINE"
export const defaultGateBudgetMilliseconds = 60 * 60 * 1000

export const resolveGateDeadline = ({ configured, inherited, now = epochMilliseconds() }) => {
  const parse = (value) => {
    const milliseconds = Date.parse(value)
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value)
      throw new Error(`${gateDeadlineEnvironmentName} must be an ISO UTC timestamp with milliseconds`)
    return milliseconds
  }
  const parent = inherited === undefined ? undefined : parse(inherited)
  const requested = configured === undefined ? undefined : parse(configured)
  if (parent !== undefined && requested !== undefined && requested > parent)
    throw new Error("A nested gate cannot extend its persisted deadline")
  const deadline = requested ?? parent ?? now + defaultGateBudgetMilliseconds
  if (deadline <= now) throw new Error("Gate deadline expired; no new command may start")
  return new Date(deadline).toISOString()
}

export const remainingGateMilliseconds = (deadline, now = epochMilliseconds()) => {
  resolveGateDeadline({ configured: deadline, now })
  return Date.parse(deadline) - now
}

// A registered child may exist when setup exhausts the budget: schedule immediate
// bounded termination, rather than throwing before its custody can be settled.
export const gateCommandTimeout = ({ deadline, now = epochMilliseconds(), requested }) =>
  deadline === undefined ? requested : Math.max(0, Math.min(requested, Date.parse(deadline) - now))
