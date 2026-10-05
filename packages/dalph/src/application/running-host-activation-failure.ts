import { Option, Schema } from "effect"
import type { RunningHostError } from "./running-host-contract.js"

/** A provider failure grants no Run finality, retry or cleanup authority. */
export const integrationActivationReadFailure = (failure: unknown): Option.Option<RunningHostError> =>
  Option.isSome(Schema.decodeUnknownOption(Schema.TaggedStruct("IntegratorCallFailure", {}))(failure))
    ? Option.some({
        _tag: "ReadFailed",
        causeTag: "IntegratorCallFailure",
        detail: "The integration provider failed. Its candidate and responsibility remain retained."
      })
    : Option.none()
