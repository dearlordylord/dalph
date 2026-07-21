import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { trackerGraphReaderContract } from "../test/tracker-graph-reader-contract.js"
import {
  FixtureTarget,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  TaskId,
  TaskLifecycle
} from "./domain.js"
import { TrackerGraphReader, trackerGraphReaderFileLayer } from "./tracker-graph-reader.js"

const fixture = (name: string): FixtureTarget =>
  FixtureTarget.make(
    new URL(`../fixtures/${name}.json`, import.meta.url).pathname
  )

trackerGraphReaderContract({
  complete: {
    expectedTasks: [{
      id: TaskId.make("task-only"),
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }],
    forbiddenTaskIdFragments: [],
    layer: trackerGraphReaderFileLayer,
    target: fixture("singleton")
  },
  failures: [
    {
      expectedErrorTag: "TaskDag.GraphProjectionError",
      layer: trackerGraphReaderFileLayer,
      name: "an invalid graph",
      target: fixture("invalid-graph")
    },
    {
      expectedErrorTag: "TrackerGraphReader.TrackerReadError",
      layer: trackerGraphReaderFileLayer,
      name: "malformed serialized input",
      target: fixture("malformed")
    },
    {
      expectedErrorTag: "FixtureReader.FixtureReadError",
      layer: trackerGraphReaderFileLayer,
      name: "an inaccessible fixture",
      target: fixture("missing")
    }
  ],
  name: "fixture tracker reader"
})

it.effect("fixture tracker reader rejects a GitHub target", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const error = yield* reader.read(GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(42),
      owner: GithubRepositoryOwner.make("octo"),
      repository: GithubRepositoryName.make("dalph")
    })).pipe(Effect.flip, Effect.orDie)
    expect(error._tag).toBe("TrackerGraphReader.AdapterReadError")
  }).pipe(Effect.provide(trackerGraphReaderFileLayer)))
