import {
  JournalPosition,
  JournalRecord,
  ProductionRunSelection,
  WorkflowResponsibilityEntry
} from "@dalph/orchestrator"
import { Schema } from "effect"
import { LocalHostAddress } from "../src/application/running-host-contract.js"
import { HermeticControllerEndpoint } from "../src/application/production-hermetic-provider-bridge.js"

/** Inputs to two separately started hosts over the same disposable Git/SQLite history. */
export const HostDeathFixtureInput = Schema.Struct({
  configurationPath: Schema.NonEmptyString,
  address: LocalHostAddress,
  provider: HermeticControllerEndpoint
})

export const HostDeathFixtureCommand = Schema.Literals(["Pause", "Arm", "History"])
export type HostDeathFixtureEvent =
  | { readonly _tag: "Ready"; readonly selection: ProductionRunSelection }
  | { readonly _tag: "Paused" | "Armed" | "Idle" }
  | { readonly _tag: "CommittedBeforeCallback"; readonly record: JournalRecord }
  | { readonly _tag: "Timer"; readonly state: "Started" | "Stopped" }
  | { readonly _tag: "Callback"; readonly direction: "Pause" | "Unpause" }
  | {
      readonly _tag: "Reconstructed"
      readonly acceptedAt: JournalPosition | null
      readonly responsibilities: ReadonlyArray<WorkflowResponsibilityEntry>
    }
  | { readonly _tag: "History"; readonly records: ReadonlyArray<JournalRecord> }
  | { readonly _tag: "ActivationFailed"; readonly detail: string }

export const HostDeathFixtureEvent: Schema.Codec<HostDeathFixtureEvent, unknown> = Schema.TaggedUnion({
  Ready: { selection: ProductionRunSelection },
  Paused: {},
  Armed: {},
  CommittedBeforeCallback: { record: JournalRecord },
  Timer: { state: Schema.Literals(["Started", "Stopped"]) },
  Callback: { direction: Schema.Literals(["Pause", "Unpause"]) },
  Reconstructed: {
    acceptedAt: Schema.NullOr(JournalPosition),
    responsibilities: Schema.Array(WorkflowResponsibilityEntry)
  },
  History: { records: Schema.Array(JournalRecord) },
  Idle: {},
  ActivationFailed: { detail: Schema.String }
})
