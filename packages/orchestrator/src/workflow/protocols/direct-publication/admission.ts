import { RemotePublicationTarget, type RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  remotePublicationAdmissionObservedRecordKey,
  remotePublicationAdmissionReadIntendedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  RemotePublicationAdmissionObservedEvent,
  RemotePublicationAdmissionReadIntendedEvent,
  RemotePublicationGit,
  remotePublicationAdmissionIdFor
} from "./events.js"

export class RemotePublicationAdmissionRejected extends Schema.TaggedError<RemotePublicationAdmissionRejected>()(
  "RemotePublicationAdmissionRejected",
  {
    reason: Schema.Literals(["DestinationPinMismatch", "DestinationPinMissing", "TargetMissing"]),
    target: RemotePublicationTarget
  }
) {}

/** Journals the destination read before Git and admits only an existing pinned branch. */
export const admitRemotePublicationTarget = Effect.fn("RemotePublication.admitTarget")(function* (
  runId: RunId,
  target: RemotePublicationTarget
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(runId)
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")?.event
  if (began?._tag !== "WorkflowRunBegan") {
    return yield* new RemotePublicationAdmissionRejected({ reason: "DestinationPinMissing", target })
  }
  if (!Schema.toEquivalence(RemotePublicationTarget)(began.remotePublicationTarget, target)) {
    return yield* new RemotePublicationAdmissionRejected({ reason: "DestinationPinMismatch", target })
  }
  const admissionId = remotePublicationAdmissionIdFor(runId, target)
  const observedKey = remotePublicationAdmissionObservedRecordKey(admissionId)
  const existingObservation = records.find(({ key }) => key === observedKey)?.event
  const observation =
    existingObservation?._tag === "RemotePublicationAdmissionObserved"
      ? existingObservation.observation
      : yield* Effect.gen(function* () {
          yield* journal.append(
            runId,
            remotePublicationAdmissionReadIntendedRecordKey(admissionId),
            RemotePublicationAdmissionReadIntendedEvent.make({
              admissionId,
              initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
              occurrenceClassification: "InitiatedAction",
              runId,
              target,
              version: workflowJournalEventVersion
            })
          )
          const current = yield* (yield* RemotePublicationGit).admit(target)
          yield* journal.append(
            runId,
            observedKey,
            RemotePublicationAdmissionObservedEvent.make({
              admissionId,
              observation: current,
              occurrenceClassification: "NonActionOccurrence",
              runId,
              target,
              version: workflowJournalEventVersion
            })
          )
          return current
        })
  if (observation._tag === "TargetMissing") {
    return yield* new RemotePublicationAdmissionRejected({ reason: "TargetMissing", target })
  }
  return observation
})
