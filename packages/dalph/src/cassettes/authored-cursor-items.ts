import { Schema } from "effect"
import { AuthoredCassetteStoryItem } from "./authored-domain.js"

export type AuthoredAttemptChoiceItem =
  | typeof AuthoredCassetteStoryItem.cases.OperatorContinuesAttempt.Type
  | typeof AuthoredCassetteStoryItem.cases.OperatorStopsAttempt.Type

export const AuthoredAttemptChoiceItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.OperatorContinuesAttempt,
  AuthoredCassetteStoryItem.cases.OperatorStopsAttempt
])

export const isAuthoredAttemptChoiceItem = (item: unknown): item is AuthoredAttemptChoiceItem =>
  typeof item === "object" &&
  item !== null &&
  "_tag" in item &&
  (item._tag === "OperatorContinuesAttempt" || item._tag === "OperatorStopsAttempt")

export type AuthoredTaskClaimReadItem =
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned.Type
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadReturned.Type

export const AuthoredTaskClaimReadItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.TaskClaimReadFailed,
  AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned,
  AuthoredCassetteStoryItem.cases.TaskClaimReadReturned
])

export const isTaskClaimReadItem = (item: unknown): item is AuthoredTaskClaimReadItem =>
  typeof item === "object" &&
  item !== null &&
  "_tag" in item &&
  (item._tag === "TaskClaimReadFailed" ||
    item._tag === "TaskClaimCurrentReadReturned" ||
    item._tag === "TaskClaimReadReturned")
