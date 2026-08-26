import { Schema } from "effect"
import type { AttemptId, TaskId } from "@dalph/contracts"

export type ExecutorReportRendezvousRequest = "StartOrContinue" | "Suspend"

/** Collision-free structural identity shared by authored validation and runtime rendezvous state. */
export const ExecutorReportRendezvousKey = Schema.NonEmptyString.pipe(Schema.brand("ExecutorReportRendezvousKey"))
export type ExecutorReportRendezvousKey = typeof ExecutorReportRendezvousKey.Type

/** Typed closure emitted only after every exact ordinary report append has completed. */
export const ExecutorReportRendezvousClosure = Schema.TaggedStruct("ExecutorReportRendezvousClosed", {})
export type ExecutorReportRendezvousClosure = typeof ExecutorReportRendezvousClosure.Type

/** A named provider, validation, or journal boundary made exact rendezvous closure impossible. */
export class ExecutorReportRendezvousFailure extends Schema.TaggedError<ExecutorReportRendezvousFailure>()(
  "ExecutorReportRendezvousFailure",
  { detail: Schema.NonEmptyString }
) {}

type ExecutorReportRendezvousIdentity =
  | {
      readonly _tag: "ExactMember"
      readonly attemptId: AttemptId
      readonly request: ExecutorReportRendezvousRequest
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "ProviderCommand"
      readonly attemptId: AttemptId
      readonly request: ExecutorReportRendezvousRequest
    }
  | {
      readonly _tag: "JournalAppend"
      readonly attemptId: AttemptId
      readonly ordinal: number
      readonly request: ExecutorReportRendezvousRequest
    }

export const executorReportRendezvousKeyOf = (
  identity: ExecutorReportRendezvousIdentity
): ExecutorReportRendezvousKey => {
  switch (identity._tag) {
    case "ExactMember":
      return ExecutorReportRendezvousKey.make(
        JSON.stringify([identity._tag, identity.taskId, identity.attemptId, identity.request])
      )
    case "ProviderCommand":
      return ExecutorReportRendezvousKey.make(JSON.stringify([identity._tag, identity.attemptId, identity.request]))
    case "JournalAppend":
      return ExecutorReportRendezvousKey.make(
        JSON.stringify([identity._tag, identity.attemptId, identity.ordinal, identity.request])
      )
  }
}
