/** Compile-time inventory of every issue #41 coordinator-death acceptance point. */
export const TaskWorkSessionCrashScenario = {
  BeforeIntentAcknowledgement: "BeforeIntentAcknowledgement",
  AfterIntentBeforeRequest: "AfterIntentBeforeRequest",
  AfterRequestCrossed: "AfterRequestCrossed",
  AfterRequestCrossedWithoutCreation: "AfterRequestCrossedWithoutCreation",
  AfterAcknowledgementRecorded: "AfterAcknowledgementRecorded",
  AfterAcknowledgementRecordedWithoutCreation: "AfterAcknowledgementRecordedWithoutCreation",
  AfterMatchingReportRecorded: "AfterMatchingReportRecorded",
  AfterAbsenceReportRecorded: "AfterAbsenceReportRecorded",
  AfterOutcomeRecorded: "AfterOutcomeRecorded"
} as const
export type TaskWorkSessionCrashScenario =
  typeof TaskWorkSessionCrashScenario[keyof typeof TaskWorkSessionCrashScenario]
