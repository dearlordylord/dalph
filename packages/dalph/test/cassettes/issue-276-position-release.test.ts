import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Queue, Ref, Fiber, Deferred } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import { makeIssue276PositionRelease, type Issue276TerminalCut } from "../../test-support/issue-276-position-release.js"
import { target, integrationTarget } from "../../test-support/issue-276-g5-facts.js"

type Fixture = Effect.Success<ReturnType<typeof makeIssue276PositionRelease>>
const taskNames = ["B", "C", "D", "E", "F", "G"] as const

const start = Effect.fn("Issue276Test.start")(function* (fixture: Fixture) {
  const running = yield* fixture.activate.pipe(Effect.forkScoped)
  const take = <A>(queue: Queue.Dequeue<A>) =>
    Queue.take(queue).pipe(
      Effect.raceFirst(Fiber.join(running).pipe(Effect.andThen(Effect.die("runtime exited before checkpoint"))))
    )
  const awaitHeld = (names: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (;;) {
        const bundle = yield* take(fixture.publicationQueue)
        const held = bundle.actionInputs.runtimeFacts.taskWork.held
          .map(({ correlation }) => correlation.attemptId)
          .toSorted()
        if (JSON.stringify(held) === JSON.stringify(names.map((name) => `attempt:${name}`).toSorted())) return bundle
      }
    })
  return { awaitHeld, running, take }
})

const handoffs = Effect.fn("Issue276Test.handoffs")(function* () {
  const fixture = yield* makeIssue276PositionRelease()
  const process = yield* start(fixture)
  yield* process.awaitHeld(["B", "C", "D"])
  yield* fixture.terminal("B")
  yield* process.awaitHeld(["C", "D", "E"])
  const first = yield* process.take(fixture.integrationEntered)
  expect(first.session.plannedAttempt.taskId).toBe("B")
  yield* fixture.terminal("C")
  yield* process.awaitHeld(["D", "E", "F"])
  yield* fixture.terminal("D")
  yield* process.awaitHeld(["E", "F", "G"])
  return { fixture, process }
})

it.effect(
  "starts B integration after its exact acquired claim graph and lineage observations",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue276PositionRelease()
      const process = yield* start(fixture)
      yield* process.awaitHeld(["B", "C", "D"])
      yield* fixture.terminal("B")
      const run = yield* process.take(fixture.integrationEntered)
      const records = yield* fixture.journal.read(fixture.runId)
      const acquired = records.find(({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === "B")
      const started = records.find(
        ({ event }) => event._tag === "IntegrationStarted" && event.plannedAttempt.taskId === "B"
      )
      if (acquired === undefined || started === undefined) return expect.fail("missing B claim or integration start")
      const graph = records.find(
        ({ event, position }) =>
          position > acquired.position &&
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "CompleteTaskTrackerFacts" ||
            event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
      )
      if (graph?.event._tag !== "TaskTrackerFactsObserved") return expect.fail("missing complete graph after B claim")
      expect(graph.event.observation.target).toEqual(target)
      const plan = records.find(
        ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === "B"
      )
      if (plan?.event._tag !== "TaskAttemptPlanned" || acquired.event._tag !== "TaskClaimAcquired")
        return expect.fail("missing exact B plan and acquired claim")
      expect(plan.event.operation.plannedAttempt).toEqual(run.session.plannedAttempt)
      expect(plan.position).toBeGreaterThan(graph.position)
      const acquiredClaim = acquired.event.claim
      const acquisition = records.find(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" &&
          event.operation.acquisition.operationId === acquiredClaim.operationId
      )
      if (acquisition?.event._tag !== "TaskClaimAcquisitionIntended")
        return expect.fail("missing exact B acquisition intent")
      expect(acquiredClaim).toMatchObject(acquisition.event.operation.acquisition)
      expect(acquisition.position).toBeLessThan(acquired.position)
      const lineage = records.find(
        ({ event, position }) =>
          position > started.position && event._tag === "TargetLineageObserved" && event.plannedAttempt.taskId === "B"
      )
      if (lineage?.event._tag !== "TargetLineageObserved")
        return expect.fail("missing B integration lineage observation")
      const lineageOperationId = lineage.event.operationId
      const intent = records.find(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation.operationId === lineageOperationId
      )
      if (intent?.event._tag !== "GitReadIntentRecorded" || intent.event.operation._tag !== "ReadTargetLineage")
        return expect.fail("missing exact Git lineage boundary")
      expect(intent.position).toBeGreaterThan(graph.position)
      expect(lineage.position).toBeGreaterThan(intent.position)
      expect(intent.event.operation.integrationTarget).toEqual(integrationTarget)
      expect(intent.event.operation.plannedAttempt).toEqual(run.session.plannedAttempt)
      expect(lineage.event.plannedAttempt).toEqual(run.session.plannedAttempt)
      const integrator = records.find(
        ({ event }) => event._tag === "IntegratorRunStarted" && event.run.session.plannedAttempt.taskId === "B"
      )
      expect(integrator?.position).toBeGreaterThan(lineage.position)
      expect(
        records.filter(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            (event.observation._tag === "FocusedTaskClaimFacts" ||
              event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
            event.observation.coverage.taskId === "B"
        )
      ).toEqual([])
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

it.effect(
  "releases B C and D positions to E F and G while B holds integration",
  () =>
    Effect.gen(function* () {
      const { fixture } = yield* handoffs()
      expect((yield* Ref.get(fixture.commands)).map((attempt) => attempt.taskId)).toEqual([
        "B",
        "C",
        "D",
        "E",
        "F",
        "G"
      ])
      expect((yield* Ref.get(fixture.integrations)).map((run) => run.session.plannedAttempt.taskId)).toEqual(["B"])
      const records = yield* fixture.journal.read(fixture.runId)
      for (const name of ["B", "C", "D"]) {
        const terminal = records.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report._tag === "ExecutorWorkTerminal" &&
            event.report.correlation.attemptId === `attempt:${name}`
        )
        expect(terminal).toHaveLength(1)
        const position = terminal[0]?.position
        if (position === undefined) return expect.fail("missing durable terminal report")
        const integration = records.filter(
          ({ event }) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.taskId === name
        )
        expect(integration).toHaveLength(1)
        expect(integration[0]?.position).toBeGreaterThan(position)
        const before = (yield* Ref.get(fixture.publications)).filter(
          (bundle) => (bundle.actionInputs.runtimeFacts.acceptedAt ?? 0) < position
        )
        const firstHeld = before.find((bundle) =>
          bundle.actionInputs.runtimeFacts.taskWork.held.some(({ taskId }) => taskId === name)
        )
        if (firstHeld === undefined) return expect.fail("missing original holder")
        expect(
          before
            .filter(
              (bundle) =>
                (bundle.actionInputs.runtimeFacts.acceptedAt ?? 0) >=
                (firstHeld.actionInputs.runtimeFacts.acceptedAt ?? 0)
            )
            .every((bundle) => bundle.actionInputs.runtimeFacts.taskWork.held.some(({ taskId }) => taskId === name))
        ).toBe(true)
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

it.effect(
  "serializes distinct B through G sessions resources and candidates in accepted order",
  () =>
    Effect.gen(function* () {
      const { fixture, process } = yield* handoffs()
      for (const [name, held] of [
        ["E", ["F", "G"]],
        ["F", ["G"]],
        ["G", []]
      ] as const) {
        yield* fixture.terminal(name)
        yield* process.awaitHeld(held)
      }
      for (const name of taskNames) {
        const release = fixture.releaseIntegration.get(TaskId.make(name))
        if (release === undefined) return expect.fail("missing controlled integration turn")
        expect((yield* Ref.get(fixture.integrations)).at(-1)?.session.plannedAttempt.taskId).toBe(name)
        yield* Deferred.succeed(release, undefined)
        if (name !== "G") yield* process.take(fixture.integrationEntered)
      }
      for (;;) {
        const records = yield* fixture.journal.read(fixture.runId)
        if (
          records.some(
            ({ event }) =>
              event._tag === "IntegratorRunCandidateGitObserved" && event.run.session.plannedAttempt.taskId === "G"
          )
        )
          break
        yield* process.take(fixture.publicationQueue)
      }
      const integrations = yield* Ref.get(fixture.integrations)
      expect(integrations.map((run) => run.session.plannedAttempt.taskId)).toEqual(taskNames)
      const attempts = yield* Ref.get(fixture.commands)
      for (const values of [
        attempts.map(({ worktree }) => worktree),
        attempts.map(({ executor }) => executor),
        attempts.map(({ branch }) => branch)
      ])
        expect(new Set<string>(values).size).toBe(taskNames.length)
      for (const values of [
        integrations.map((run) => run.session.sessionId),
        integrations.map((run) => run.session.candidateResource),
        integrations.map((run) => run.session.acceptedResult.commit)
      ])
        expect(new Set<string>(values).size).toBe(taskNames.length)
      expect(
        integrations.every(
          ({ session }) => !attempts.some(({ worktree }) => String(worktree) === String(session.candidateResource))
        )
      ).toBe(true)
      const records = yield* fixture.journal.read(fixture.runId)
      const candidates = records.flatMap(({ event }) =>
        event._tag === "IntegratorRunCandidateGitObserved" && event.observation._tag === "Commit"
          ? [event.observation]
          : []
      )
      expect(candidates).toHaveLength(taskNames.length)
      expect(new Set(candidates.map(({ commit }) => commit)).size).toBe(taskNames.length)
      expect(new Set(candidates.map(({ candidateText }) => candidateText)).size).toBe(taskNames.length)
      for (const [index, candidate] of candidates.entries()) {
        const session = integrations[index]?.session
        if (session === undefined) return expect.fail("candidate without its exact session")
        expect(candidate.directParents).toEqual([session.expectedTargetHead, session.acceptedResult.commit])
        if (index > 0) expect(session.expectedTargetHead).toBe(candidates[index - 1]?.commit)
      }
      const queued = records.flatMap(({ event, position }) =>
        event._tag === "IntegrationResponsibilityBegan" ? [{ name: event.plannedAttempt.taskId, position }] : []
      )
      expect(queued.map(({ name }) => name)).toEqual(taskNames)
      expect(integrations.map((run) => run.session.queuedAt)).toEqual(queued.map(({ position }) => position))
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

for (const cut of [
  "BeforeObservation",
  "AfterObservation",
  "AfterAcceptance"
] satisfies ReadonlyArray<Issue276TerminalCut>) {
  it.effect(
    `recovers B at ${cut} without another executor command`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeIssue276PositionRelease()
        const first = yield* start(fixture)
        yield* first.awaitHeld(["B", "C", "D"])
        yield* Ref.set(fixture.cut, { _tag: "Armed", at: cut })
        yield* fixture.terminal("B")
        expect(yield* first.take(fixture.cutReached)).toBe(cut)
        const before = yield* fixture.journal.read(fixture.runId)
        const accepted = before.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
        )
        expect(accepted).toHaveLength(cut === "AfterAcceptance" ? 1 : 0)
        if (cut !== "AfterAcceptance")
          expect(
            (yield* Ref.get(fixture.publications))
              .at(-1)
              ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
              .toSorted()
          ).toEqual(["attempt:B", "attempt:C", "attempt:D"])
        expect((yield* Ref.get(fixture.commands)).map((attempt) => attempt.taskId)).toEqual(["B", "C", "D"])
        yield* Fiber.interrupt(first.running)
        yield* Ref.set(fixture.cut, { _tag: "Disabled" })
        const restarted = yield* start(fixture)
        yield* restarted.awaitHeld(["C", "D", "E"])
        yield* restarted.take(fixture.integrationEntered)
        const after = yield* fixture.journal.read(fixture.runId)
        expect(
          after.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
          )
        ).toHaveLength(1)
        expect(after.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
        expect(
          after.filter(
            ({ event }) => event._tag === "PlannedAttemptExecutorStateObserved" && event.plannedAttempt.taskId === "B"
          )
        ).toHaveLength(1)
        const original = (yield* Ref.get(fixture.commands)).find((attempt) => attempt.taskId === "B")
        const responsibility = after.find(({ event }) => event._tag === "IntegrationResponsibilityBegan")
        if (responsibility?.event._tag !== "IntegrationResponsibilityBegan")
          return expect.fail("missing recovered responsibility")
        expect(responsibility.event.plannedAttempt).toEqual(original)
        expect((yield* Ref.get(fixture.commands)).map((attempt) => attempt.taskId)).toEqual(["B", "C", "D", "E"])
      }).pipe(Effect.provide(NodeCrypto.layer)),
    30_000
  )
}

for (const kind of ["Unavailable", "Foreign"] as const) {
  it.effect(
    `retains every occupied position when B terminal evidence is ${kind}`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeIssue276PositionRelease()
        const process = yield* start(fixture)
        yield* process.awaitHeld(["B", "C", "D"])
        const before = (yield* fixture.journal.read(fixture.runId)).length
        yield* fixture.unresolved(kind)
        for (;;) {
          const bundle = yield* process.take(fixture.publicationQueue)
          const records = yield* fixture.journal.read(fixture.runId)
          const observed = records
            .slice(before)
            .find(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")
          if (observed !== undefined && (bundle.actionInputs.runtimeFacts.acceptedAt ?? 0) >= observed.position) {
            expect(bundle.actionInputs.runtimeFacts.taskWork.held.map(({ taskId }) => taskId).toSorted()).toEqual([
              "B",
              "C",
              "D"
            ])
            expect(
              records
                .slice(before)
                .some(
                  ({ event }) =>
                    event._tag === "PlannedAttemptExecutorWorkReported" ||
                    event._tag === "IntegrationResponsibilityBegan"
                )
            ).toBe(false)
            break
          }
        }
        expect((yield* Ref.get(fixture.commands)).map((attempt) => attempt.taskId)).toEqual(["B", "C", "D"])
        expect(yield* Ref.get(fixture.integrations)).toEqual([])
      }).pipe(Effect.provide(NodeCrypto.layer)),
    30_000
  )
}
