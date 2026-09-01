import { Schema } from "effect"
import { AuthoredCassetteStoryItem } from "./authored-domain.js"

export type AuthoredAttemptChoiceItem =
  | typeof AuthoredCassetteStoryItem.cases.OperatorContinuesAttempt.Type
  | typeof AuthoredCassetteStoryItem.cases.OperatorRestartsAttempt.Type
  | typeof AuthoredCassetteStoryItem.cases.OperatorStopsAttempt.Type

export const AuthoredAttemptChoiceItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.OperatorContinuesAttempt,
  AuthoredCassetteStoryItem.cases.OperatorRestartsAttempt,
  AuthoredCassetteStoryItem.cases.OperatorStopsAttempt
])

export const isAuthoredAttemptChoiceItem = (item: unknown): item is AuthoredAttemptChoiceItem =>
  typeof item === "object" &&
  item !== null &&
  "_tag" in item &&
  (item._tag === "OperatorContinuesAttempt" ||
    item._tag === "OperatorRestartsAttempt" ||
    item._tag === "OperatorStopsAttempt")

export type AuthoredTaskClaimReadOverrideItem =
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadReturned.Type

export const AuthoredTaskClaimReadOverrideItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.TaskClaimReadFailed,
  AuthoredCassetteStoryItem.cases.TaskClaimReadReturned
])

export const isTaskClaimReadOverrideItem = (item: unknown): item is AuthoredTaskClaimReadOverrideItem =>
  typeof item === "object" &&
  item !== null &&
  "_tag" in item &&
  (item._tag === "TaskClaimReadFailed" || item._tag === "TaskClaimReadReturned")

export type AuthoredPlannedAttemptExecutorOutcomeItem =
  | typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorResponseLost.Type
  | typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.Type

export const AuthoredPlannedAttemptExecutorOutcomeItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorResponseLost,
  AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported
])

export const isAuthoredPlannedAttemptExecutorOutcomeItem = (
  item: unknown
): item is AuthoredPlannedAttemptExecutorOutcomeItem =>
  typeof item === "object" &&
  item !== null &&
  "_tag" in item &&
  (item._tag === "PlannedAttemptExecutorResponseLost" || item._tag === "PlannedAttemptExecutorWorkReported")
