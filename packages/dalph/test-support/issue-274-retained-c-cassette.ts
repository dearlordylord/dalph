import { runIssue274LifecycleResume, runIssue274LostResume } from "./issue-268-controlled-characterization.js"

/** Controlled continuations consume the actual DS-13 Journal after a deliberate process cut. */
export const issue274RetainedCCassetteCatalog = {
  issue274LifecycleReopen: { resumeResponse: "Return" },
  issue274LostResumeResponse: { resumeResponse: "Lose" }
} as const

/** The same production activation interprets either direct settlement or response-loss recovery. */
export const runIssue274RetainedCCassette = (
  cassette: (typeof issue274RetainedCCassetteCatalog)[keyof typeof issue274RetainedCCassetteCatalog]
) => (cassette.resumeResponse === "Return" ? runIssue274LifecycleResume : runIssue274LostResume)
