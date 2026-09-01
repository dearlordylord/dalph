# Determinism discussion handoff

Status: investigation handoff only. This document is not an accepted issue,
operational scenario, specification, or architecture decision. It changes no
Dalph runtime behavior and does not block the active #268 composition work.

## Concrete question exposed by #268

A maintainer runs the #268 DS01–DS13 cassette through the ordinary production
workflow algebra with controlled tracker, Git, executor, and Journal Layers.
After A1's worktree interaction, five boundary interactions can become ready
without an ordering edge between them:

1. select D1's exact attempt-plan operation;
2. select E1's exact attempt-plan operation;
3. select B1's exact worktree-reconciliation operation;
4. select C1's exact worktree-reconciliation operation; and
5. receive A1's exact `Begin` → `ExecutorWorkExecuting` response.

Four later interactions each depend on exactly one of those first interactions:
D1 plan precedes D1 worktree reconciliation, E1 plan precedes E1 worktree
reconciliation, B1 worktree reconciliation precedes B1 Begin, and C1 worktree
reconciliation precedes C1 Begin. A1's response is the fifth independent lane.
The resulting local model has nine nodes and four edges. It has
`9! / 2^4 = 22,680` legal sequential topological orders.

That number is derived from the local dependency model; Dalph has not executed
22,680 full capstone runs. The empirical finding was narrower: repeated #268
runs reached controlled boundaries in orders that disagreed with the cassette's
then-current strict next item while still respecting the known predecessor
edges. The first concrete mismatch had A1's Begin response reach the harness
before the strictly listed B1/C1 worktree interactions. Subsequent diagnosis
found D1/E1 plan selections at the same unordered frontier. This evidence
motivated the closed concurrent-interaction group in issue #309. It does not,
by itself, prove that production outcomes are nondeterministic or that Effect
promises or violates a particular scheduling order.

## Four different determinism claims

### 1. Controlled inputs and time

Test Layers can return exact fixed tracker, Git, executor, and Journal values.
`TestClock` can deterministically advance Effects that use the Clock for sleeps,
timeouts, schedules, and retries. Those controls do not by themselves state a
global order for fibers that independently become runnable or for calls that
arrive through separate queues and services.

The current capstone is also not evidence for a pure `TestClock` claim: its
runner wraps the capstone effect in `TestClock.withLive`, and its diagnostic
progress watchdog uses JavaScript `setTimeout`. That watchdog diagnoses silence;
it must not define workflow causality or consume a missing cassette interaction.

### 2. Domain decisions and outcomes

The desired domain-level claim may be that the same authoritative facts and
accepted commands yield the same decisions, exact obligations, and terminal or
suspended outcome, even when causally independent work interleaves differently.
This is different from requiring identical boundary-call order. The #268
investigation must compare the domain result and safety invariants separately
from the incidental order in which independent fibers reach controlled seams.

### 3. Journal creation and replay

The Journal is an ordered workflow history, so one actual run gives every
accepted occurrence a concrete position. Replaying that recorded prefix should
reconstruct according to the recorded order. A separate unresolved question is
whether two fresh executions with the same inputs must create byte-for-byte
identical Journal sequences, or may interleave independent occurrences
differently while folding to the same authoritative obligations and outcome.

Do not silently answer that question by sorting after the fact. Journal
positions, operation predecessors, intent-before-boundary rules, and ordinal
allocation can make order observable. The investigation must identify which
order differences are semantically permitted before proposing an equivalence
relation.

### 4. Total order of independent fibers and boundary arrivals

Effect's Clock and Scheduler are distinct services in the pinned
`effect@4.0.0-beta.106` source. `TestClock` documents ordered wake-up for clock
sleeps. `Scheduler.MixedScheduler` documents dispatch priority and FIFO order
inside one equal-priority dispatcher bucket. Neither statement, without a
source-level proof over Dalph's forks, queues, publications, and readiness
transitions, establishes a stable total order for all independently ready
Dalph fibers or their calls into different controlled adapters.

Treat any repeatedly observed order as an implementation observation until the
pinned Effect contract and Dalph's own happens-before edges prove more. Do not
add a production scheduling authority merely to make a cassette transcript
linear.

## Constraints that already apply

- Dry-run, test, and production interpret one workflow algebra. A test may
  provide controlled services, but it must not replace production decisions
  with a different workflow.
- `TestClock` controls logical time used through Effect's Clock; it is not
  assumed to control every scheduler or external JavaScript callback.
- Tracker, Git, executor, execution-substrate, and Journal facts retain their
  existing authorities. A cassette cursor is not a workflow scheduler or a
  source of production causality.
- The Journal records workflow history. Dalph must not persist a derived
  frontier or scheduler order as a second authority.
- Intent-before-boundary, observation-afterward, exact identity, capacity, and
  predecessor rules remain mandatory under every legal interleaving.
- The active #268 lane continues with the narrow #309 cassette representation.
  This discussion must not reopen completed #264–#269 runtime behavior or delay
  the #268 acceptance run.
- Issue #270 remains reminder-only for this lane. Its separate owner retains
  implementation and integration responsibility.

## Open questions

1. Which externally meaningful property requires determinism: exact Journal
   bytes, Journal order modulo independent occurrences, folded obligations,
   selected operations, visible delivery result, or all of these?
2. Which pairs in the nine-node fragment have a production happens-before edge
   in accepted scenarios or code, and which are genuinely unordered?
3. Does an order difference change an identity, ordinal, capacity decision,
   retry decision, or final disposition? If not, what precise equivalence is
   safe to assert?
4. What ordering guarantees are contractual in Effect 4 beta 106, and which
   are details of `MixedScheduler`, queue wake-up, stream publication, or the
   JavaScript host?
5. Does `TestClock.withLive` cover more of the capstone than intended? Can the
   watchdog remain live while workflow time stays controlled, without changing
   the workflow under test?
6. Is the authored cassette meant to be an exact replay transcript, a causal
   specification, or a combination with explicit constructs for each? The
   three registers in `docs/OPERATIONAL-SCENARIOS.md` constrain this answer.
7. Can a deterministic test interpreter expose one canonical diagnostic trace
   without becoming the only acceptance proof and thereby hiding a production
   race?

## Investigation checklist

1. Pin the repository commit, Node version, and exact Effect version before
   collecting traces.
2. Read the primary Effect 4 beta 106 sources in the installed package:
   `effect/src/testing/TestClock.ts`, `effect/src/Scheduler.ts`, the fiber
   runtime, Queue, Deferred, Semaphore, and Stream publication internals. Check
   the matching official Effect documentation and release notes; record
   contractual language separately from implementation behavior.
3. Trace the concrete #268 forks, queues, semaphores, and publication gates in
   `run-delivery-runtime.ts`, `authored-runner.ts`, and `authored-cursor.ts`.
   Draw only edges established by an awaited result, queue handoff, permit,
   resource conflict, proposal predecessor, or accepted scenario.
4. Reconstruct the nine-node local DAG from those edges. For every proposed
   extra edge, name the actor, action, and boundary that establishes it. Reject
   an edge justified only by current array order or repeated scheduler output.
5. Collect internal test diagnostics for repeated identical runs without
   exporting a production diagnostic API. Record boundary arrivals, Journal
   append order, folded obligations, selected actions, and final disposition.
6. Vary only the scheduler/test interpretation in a diagnostic branch. Use
   deterministic synchronization rather than sleeps or `yieldNow`. Determine
   whether legal schedules preserve domain outcomes and whether any schedule
   exposes a real safety or liveness defect.
7. Property-test generated topological orders against the causal matcher and
   domain invariants. Use edge-covering and concurrency-shaped production tests
   rather than 22,680 full capstone executions unless exhaustive execution is
   demonstrated cheap and informative.
8. Compare replay of each recorded Journal with fresh execution. State whether
   the required property is exact trace equality or an explicitly defined
   order-insensitive semantic equivalence.
9. If the investigation chooses a durable scheduling or Journal-equivalence
   policy, write an accepted operational scenario first. Record an ADR only if
   the choice is hard to reverse, surprising, and represents a real trade-off.

## Candidate approaches and trade-offs

### Keep a production-shaped causal matcher

The cassette accepts any arrival order that respects explicit edges and still
runs the ordinary production workflow algebra. This is closest to the observed
concurrency and can expose real races. It makes the authored evidence less
linear and requires exact identity, duplicate, downstream-crossing, and
non-arrival rules. The narrow #309 group is the current bounded form; a general
DAG language is not accepted by this handoff.

### Provide a canonical deterministic test interpreter

A controlled Scheduler or interpreter could produce one reproducible trace,
making failures easier to compare and shrinking schedule noise. It risks
testing a schedule production does not guarantee and hiding races permitted by
the production runtime. An expert would reject it as the sole vertical proof.
It may be useful as a diagnostic or fast lower-level proof if the same workflow
algebra remains intact and production-shaped causal evidence still runs.

### Serialize production execution

Production could impose a total order at admission or at every controlled
boundary. This would make strict transcripts easier, but it would add scheduling
authority, reduce intended concurrency, and potentially change capacity and
liveness behavior. No accepted issue currently authorizes this. Do not choose
it merely to satisfy the cassette.

### Use complementary proofs

One canonical interpreter can provide reproducible local diagnostics, generated
topological-order properties can cover the causal state space cheaply, and one
production-shaped cassette can prove the real composition. This costs more than
one test style and requires a precise equivalence relation, but avoids asking
either a single canonical schedule or an exhaustive integration test to prove
what it cannot.

The provisional expert choice for the active lane is deliberately smaller:
retain the narrow production-shaped #309 group, finish #268, and investigate
the broader determinism contract independently. The trade-off is postponing a
general answer while avoiding both a new production scheduler and further
scope growth in the capstone.

## Proposed investigation-to-test mapping

These are investigation probes, not accepted #268 acceptance tests.

| Question | Direct probe |
|---|---|
| Do all permitted five-member frontier orders match exactly once? | Existing issue #309 120-permutation and simultaneous-claim cursor tests |
| Do the nine-node schedules preserve every known edge? | A bounded property test that generates topological orders and rejects each successor-before-predecessor mutation |
| Do legal schedules preserve domain meaning? | A focused composition probe comparing obligations, selected identities, capacity, and disposition across representative schedules |
| Is replay deterministic for one committed history? | Memory and SQLite prefix tests replaying the same Journal and comparing reconstructed state |
| Are fresh Journal traces required to be identical? | First define the accepted equality relation; then compare repeated controlled runs without normalizing away meaningful positions or predecessors |
| Does TestClock determine fiber order? | A focused Effect-version-pinned probe over Clock wake-up and independently queued fibers, supported by primary source analysis; do not infer a general guarantee from one green run |
| Does a canonical interpreter hide production behavior? | Run the same workflow algebra once with the diagnostic interpreter and once through the production-shaped runtime, then compare both the semantic result and schedules each can expose |

## Relevant evidence and locations

- Issues [#268](https://github.com/dearlordylord/dalph/issues/268) and
  [#309](https://github.com/dearlordylord/dalph/issues/309).
- `docs/scenarios/issue-309-concurrent-interaction-group.md` on
  `work/issue-309-concurrent-interaction-group`.
- Generic #309 commits `8da0c895c` (scenario), `df62210f5` (closed matcher),
  and `493ff5bd7` (five-way frontier evidence). The #268 worktree contains their
  composed equivalents through `ba22c3fa5`; its capstone migration remains
  active work and is not declared accepted here.
- `packages/dalph/src/cassettes/delivery-story-capstone.ts` and
  `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`.
- `packages/dalph/src/cassettes/authored-cursor.ts` and
  `packages/dalph/src/cassettes/authored-runner.ts`.
- `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.ts`.
- `docs/DEVELOPMENT.md`, especially its Effect-test guidance;
  `docs/ARCHITECTURE.md`; `docs/CONTEXT.md`; and
  `docs/OPERATIONAL-SCENARIOS.md`.
- Pinned dependency sources under
  `node_modules/.pnpm/effect@4.0.0-beta.106/node_modules/effect/src/`, especially
  `testing/TestClock.ts` and `Scheduler.ts`.
