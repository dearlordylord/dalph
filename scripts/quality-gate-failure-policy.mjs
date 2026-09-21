// These terminal command results are ordinary, observable qualification
// failures.  They remain actionable siblings; custody, cancellation, and
// runner-integrity failures must instead stop admission fail-closed.
const ordinaryQualityCommandResult = /^(?:exit:\d+|launch-failed|timed-out)$/u

export const isOrdinaryQualityCommandResult = (value) =>
  ordinaryQualityCommandResult.test(typeof value === "string" ? value : (value?.quintCommandResult ?? ""))
