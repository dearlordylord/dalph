import { Schema } from "effect"

const ApplicationExitStoryItem = Schema.TaggedUnion({
  RequestExit: {},
  ExpectAdmissionCutoff: {},
  ExpectQuickDrain: { family: Schema.Literals(["ProcessLocalResources", "CoordinatorLock"]) },
  ExpectResult: { result: Schema.Literals(["Succeeded", "Failed"]) },
  ExpectProcessEnd: { decision: Schema.Literals(["RequestGracefulTermination", "RequestForcedTermination"]) }
})

export const ApplicationExitProtocolCassette = Schema.Struct({
  name: Schema.NonEmptyString,
  scenario: Schema.Literals(["IdleSuccess", "DrainFailure"]),
  story: Schema.NonEmptyArray(ApplicationExitStoryItem)
})
export type ApplicationExitProtocolCassette = typeof ApplicationExitProtocolCassette.Type

export const idleApplicationExitProtocolCassette = ApplicationExitProtocolCassette.make({
  name: "an idle application closes admission, drains local ownership, and exits gracefully",
  scenario: "IdleSuccess",
  story: [
    { _tag: "RequestExit" },
    { _tag: "ExpectAdmissionCutoff" },
    { _tag: "ExpectQuickDrain", family: "CoordinatorLock" },
    { _tag: "ExpectResult", result: "Succeeded" },
    { _tag: "ExpectProcessEnd", decision: "RequestGracefulTermination" }
  ]
})

export const failingApplicationExitProtocolCassette = ApplicationExitProtocolCassette.make({
  name: "one executor drain fails while independent local drains finish before forced termination",
  scenario: "DrainFailure",
  story: [
    { _tag: "RequestExit" },
    { _tag: "ExpectAdmissionCutoff" },
    { _tag: "ExpectQuickDrain", family: "ProcessLocalResources" },
    { _tag: "ExpectQuickDrain", family: "CoordinatorLock" },
    { _tag: "ExpectResult", result: "Failed" },
    { _tag: "ExpectProcessEnd", decision: "RequestForcedTermination" }
  ]
})

export const maintainedApplicationExitProtocolCassetteCatalog = {
  idleSuccess: idleApplicationExitProtocolCassette,
  drainFailure: failingApplicationExitProtocolCassette
} as const
