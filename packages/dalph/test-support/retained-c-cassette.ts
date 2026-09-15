import { runRetainedCLifecycleResume, runRetainedCLostResume } from "./controlled-characterization.js"

/** Controlled continuations consume the actual DS-13 Journal after a deliberate process cut. */
export const retainedCCassetteCatalog = {
  retainedCLifecycleReopen: { resumeResponse: "Return" },
  retainedCLostResumeResponse: { resumeResponse: "Lose" }
} as const

/** The same production activation interprets either direct settlement or response-loss recovery. */
export const runRetainedCCassette = (
  cassette: (typeof retainedCCassetteCatalog)[keyof typeof retainedCCassetteCatalog]
) => (cassette.resumeResponse === "Return" ? runRetainedCLifecycleResume : runRetainedCLostResume)
