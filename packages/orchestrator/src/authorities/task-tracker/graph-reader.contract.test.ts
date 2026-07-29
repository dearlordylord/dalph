import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { trackerGraphReaderContract } from "../../../test/tracker-graph-reader-contract.js"
import { TaskId } from "@dalph/contracts"
import { FixtureTarget } from "./fixture/target.js"
import { TaskLifecycle } from "./task.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./github/target.js"
import { TrackerGraphReader, trackerGraphReaderFileLayer } from "./graph-reader.js"

const fixture = (name: string): FixtureTarget =>
  FixtureTarget.make(new URL(`../../../fixtures/${name}.json`, import.meta.url).pathname)

trackerGraphReaderContract({
  complete: {
    expectedTasks: [
      {
        id: TaskId.make("task-only"),
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ],
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
      expectedErrorTag: "TrackerGraphReader.TrackerReadError",
      layer: trackerGraphReaderFileLayer,
      name: "invalid boundary input",
      target: fixture("invalid")
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
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const error = yield* reader
      .read(
        GithubIssueTarget.make({
          issueNumber: GithubIssueNumber.make(42),
          owner: GithubRepositoryOwner.make("octo"),
          repository: GithubRepositoryName.make("dalph")
        })
      )
      .pipe(Effect.flip, Effect.orDie)
    expect(error._tag).toBe("TrackerGraphReader.AdapterReadError")
  }).pipe(Effect.provide(trackerGraphReaderFileLayer))
)

it.effect("fixture tracker reader returns only the focused authored specification", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const specification = yield* reader.readTaskWorkSpecification(fixture("singleton"), TaskId.make("task-only"))
    expect(specification).toMatchObject({ body: "", taskId: "task-only", title: "task-only" })
  }).pipe(Effect.provide(trackerGraphReaderFileLayer))
)

it.effect("focused fixture reads reject unsupported targets, malformed specifications, and absent tasks", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const githubTarget = GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(42),
      owner: GithubRepositoryOwner.make("octo"),
      repository: GithubRepositoryName.make("dalph")
    })
    const unsupported = yield* reader
      .readTaskWorkSpecification(githubTarget, TaskId.make("task-only"))
      .pipe(Effect.flip)
    const malformed = yield* reader
      .readTaskWorkSpecification(fixture("invalid-task-work-specification"), TaskId.make("missing-authored-content"))
      .pipe(Effect.flip)
    const absent = yield* reader
      .readTaskWorkSpecification(fixture("singleton"), TaskId.make("absent"))
      .pipe(Effect.flip)

    expect(unsupported._tag).toBe("TrackerGraphReader.AdapterReadError")
    expect(malformed._tag).toBe("TrackerGraphReader.TrackerReadError")
    expect(absent._tag).toBe("TrackerGraphReader.AdapterReadError")
  }).pipe(Effect.provide(trackerGraphReaderFileLayer))
)
