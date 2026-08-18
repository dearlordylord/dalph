import { Schema } from "effect"

/** Outer Integrator preparation cannot run until both the opaque service and its Git qualifier are configured. */
export class IntegratorBoundaryUnavailable extends Schema.TaggedError<IntegratorBoundaryUnavailable>()(
  "IntegratorBoundaryUnavailable",
  { boundary: Schema.Literals(["Integrator", "Git"]) }
) {}
