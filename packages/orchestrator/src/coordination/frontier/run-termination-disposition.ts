import { Schema } from "effect"

/** Accepted whole-Run results; storage availability never changes this disposition. */
export const RunTerminationDisposition = Schema.Literals(["Completed", "Blocked", "Cancelled"])
export type RunTerminationDisposition = typeof RunTerminationDisposition.Type
