import { Context, Effect, Layer, Schema } from "effect"
import { ControlCommand, ControlCommandRecordedEvent, ControlCommandRequest } from "./command.js"
import { RunId } from "@dalph/contracts"
import { type AuthenticatedOperatorIdentity } from "./identity.js"
import { ControlCommandId } from "./identity.js"
import { JournalPosition } from "../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { controlCommandRecordKey } from "../workflow-journal/record-key.js"
import { JournalStore } from "../workflow-journal/store.js"
import type { JournalRecord, JournalStoreError } from "../workflow-journal/store.js"

/**
 * The run already contains another immutable payload under this control
 * command identity. The caller must allocate a new identity for a new command.
 */
export class ControlCommandIdentityContradiction extends Schema.TaggedErrorClass<ControlCommandIdentityContradiction>()(
  "ControlCommandIdentityContradiction",
  { commandId: ControlCommandId, existingPosition: JournalPosition, runId: RunId }
) {}

interface ControlServiceInterface {
  readonly record: (
    operatorId: AuthenticatedOperatorIdentity,
    input: unknown
  ) => Effect.Effect<JournalRecord, ControlCommandIdentityContradiction | JournalStoreError | Schema.SchemaError>
}

/** Transport-independent boundary that decodes and journals user commands. */
export class ControlService extends Context.Service<ControlService, ControlServiceInterface>()(
  "@dalph/ControlService"
) {}

export const controlServiceLayer = Layer.effect(
  ControlService,
  Effect.gen(function* () {
    const journal = yield* JournalStore

    const record = Effect.fn("ControlService.record")(function* (
      operatorId: AuthenticatedOperatorIdentity,
      input: unknown
    ) {
      const request = yield* Schema.decodeUnknownEffect(ControlCommandRequest)(input)
      const command = ControlCommand.make({ ...request, operatorId })
      const event = ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
      return yield* journal
        .append(command.runId, controlCommandRecordKey(command.commandId), event)
        .pipe(
          Effect.mapError((failure) =>
            failure._tag === "JournalStoreContradiction"
              ? new ControlCommandIdentityContradiction({
                  commandId: command.commandId,
                  existingPosition: failure.existingPosition,
                  runId: command.runId
                })
              : failure
          )
        )
    })

    return ControlService.of({ record })
  })
)
