# Consume one causally unordered cassette interaction group

Owning issue: [#309](https://github.com/dearlordylord/dalph/issues/309)

Status: scenario-first required behavior for open issue #309. Implementation
and acceptance evidence are pending independent review of this chronology.

This change affects the controlled authored-cassette harness. It does not
change production workflow semantics, provider requests, delivery scheduling,
or Journal history. This issue #309 scenario accepts that the three exact
interactions below have no cross-interaction ordering edge once each one's own
prerequisites complete. It lets one strict cassette describe that fact without
choosing an arbitrary scheduler order.

## Governing behavior

The [three-register rule](../OPERATIONAL-SCENARIOS.md#three-registers-of-the-same-behavior)
requires a cassette to record the production chronology rather than replace
it with a new scheduling rule. This issue #309 operational scenario owns the
rule that there is no cross-interaction edge among the exact B1 selection, C1
selection, and A1 Begin response after each interaction's own prerequisites
are complete.

The accepted
[#268 DS01–DS13 capstone](https://github.com/dearlordylord/dalph/issues/268)
composes [Delivery Story beats 1 and 2](../DELIVERY-STORY.md#the-beats), in
which A1, B1, and C1 are planned and begun. It is the concrete fixture and
blocker evidence that needs this unordered cassette representation; it does
not define the no-edge rule. The
[#269 exact C1 Begin chronology](issue-269-independent-work-retained-priority.md#an-accepted-c-position-closes-capacity-before-the-relation-lists-it)
owns C1's intent-before-call and accepted-report order inside that production
path and the exact predecessor ordering within its members; it does not define
an order between these three interactions. The cassette implementation merely
enforces this accepted #309 scenario. It does not define, remove, or infer
production causality from #268 fixture arrival order.

The
[#267 reverse-completion scenario](issue-267-exact-causal-active-work-cassette.md#reverse-completion-does-not-cross-two-focused-reads)
already gives `ConcurrentTrackerReadBatch` one exact two-phase meaning: every
tracker-read selection acquires a causal owner and only the result for that
owner completes the member. This scenario preserves that protocol unchanged.

Issue #309 adds only a cassette-playback construct for a closed set of
cursor-visible interactions that production may present in any order. No
Quint law governs test-cursor playback order, and this scenario adds no formal
production concurrency rule. Production bounded admission, exact action
identity, and intent/observation ordering remain governed by their existing
scenarios and invariants.

## Starting situation

The affected person is a Dalph maintainer running the production workflow
algebra through controlled tracker, Git, executor, Journal, and cassette
Layers. There is no target-application user action at this cut: the maintainer
is checking that one maintained production cassette accepts every scheduling
order that the production fibers are already allowed to produce.

The cassette story is strict before and after one bounded group. Every causal
predecessor for these three interactions has already been consumed. In
particular, the current Run and the immutable A1, B1, and C1 planned attempts
already exist. Each interaction may be admitted independently after its own
causal prerequisites complete; no common instant at which all three fibers are
admitted or ready is required. The first controlled boundary call may therefore
be A1's executor call before the B1 or C1 child action is admitted, which is the
concrete #268 blocker this group must accept. No dependency, proposal-order,
resource-conflict, or authored causal edge orders the following interactions
relative to one another:

1. Dalph selects `ReconcileTaskWorktree` for exact task B and attempt B1.
2. Dalph selects `ReconcileTaskWorktree` for exact task C and attempt C1.
3. Dalph's exact A1 `Begin` request receives the controlled
   `ExecutorWorkExecuting` report.

The authored executor member retains the existing cassette shape: request
`Begin`, exact branded A1 `AttemptId`, and report
`ExecutorWorkExecuting`. The controlled adapter supplies the current Run
correlation as it does today; the cassette does not add or infer another Run
identity. Each worktree member retains the complete existing `DalphSelects`
operation, including exact branded `TaskId` and `AttemptId`.

The B1 and C1 members prove only that the ordinary workflow selected those
operations at its real trace seam; they do not prove that Git was called or
returned a worktree result. The A1 member is the existing controlled executor
response item; its later Journal acceptance remains owned by the ordinary
executor protocol. Completing the group proves only that all three exact
cassette interactions were consumed.

The next strict story item is Dalph's selection of
`ReconcileTaskWorktree` for exact task D and attempt D1. D is not a member of
the group.

## Any member order consumes one group

The production fibers may reach the B1 selection, C1 selection, and A1 report
in any of their six sequential permutations. They may also reach the cursor
simultaneously. The controlled tracker/Git/executor Layers continue to invoke
the existing exact cursor operations; production code does not call a special
concurrent-story API.

The first controlled boundary call that matches a member constructs one
process-local matcher for the current top-level group and claims that member.
All member claims pass through the cursor's existing one-permit transition
boundary. Under that permit, the cursor:

1. compares the incoming existing call identity with the group's closed
   member union;
2. requires exactly one unconsumed member with the same claim key;
3. marks only that member consumed; and
4. leaves the top-level story position unchanged while any member remains.

The first two successful member calls therefore return to their production
fibers without presenting a top-level cassette occurrence or advancing the
strict story. The final successful member claim marks the group complete. The
cursor then emits exactly one occurrence for the group through its existing
`onOccurrence` observation and advances the top-level story position exactly
once. It does not emit three invented top-level occurrences and does not
expose the scheduler-selected internal claim order as authored meaning.

Only after that one advance may the exact D1
`ReconcileTaskWorktree` selection consume the next strict item. A D1 call that
arrives before the group completes is a downstream crossing, not permission to
skip the missing member or to reorder the story.

When all three production fibers call simultaneously, the existing permit
serializes only their in-memory matcher transitions. It does not order the
tracker, Git, executor, Journal, or delivery runtime, and it grants no workflow
permission. Whichever exact member acquires the permit last completes the same
authored group.

### Visible result

The maintainer can run the same production-shaped story for all six member
orders and for simultaneous calls. Every run consumes B1, C1, and A1 exactly
once, observes one completed group, advances once, and then consumes strict D1.
The recording says only that the three interactions all happened before D1;
it does not claim an order among them.

## Closed member language and exact identity

The canonical cassette-only phenomena introduced by this scenario are:

- **Concurrent interaction group**: one top-level authored story item
  containing a finite non-empty set of causally unordered cursor-visible
  interactions.
- **Concurrent interaction member**: one value from the narrow V1 closed union
  below, not an arbitrary `AuthoredCassetteStoryItem` and not every value of
  either broader top-level case.
- **Concurrent interaction claim key**: the exact incoming call identity by
  which the cursor claims one member, independent of controlled output that
  the claimed member returns.
- **Outstanding group members**: the process-local set of exact members not
  yet consumed by the current cursor.
- **Completed group occurrence**: the one top-level cassette occurrence
  emitted only after the outstanding set becomes empty.

The V1 member union has exactly two cases:

1. `DalphSelects` with one complete exact operation and with neither `causal`
   nor `causalAnchor` present. Its claim key is that exact operation, including
   its tag and every branded operation field.
2. `PlannedAttemptExecutorWorkReported` with `request: Begin` and authored
   output `ExecutorWorkExecuting`. Its claim key is the request plus the exact
   report `AttemptId`, which are the identity supplied by the incoming
   controlled executor call. The report tag and payload are controlled output
   returned after that claim; they are not extra match identity.

The group is non-empty and its claim keys are unique. In particular, two
executor members with the same `Begin` and `AttemptId` are duplicate and
ambiguous even if their encoded outputs differ; schema decoding rejects them
instead of choosing by output. V1 rejects `DalphSelects` members that carry
`causal` or `causalAnchor`, because no within-group predecessor or anchor
semantics have been accepted. V1 also rejects `Resume`, `Suspend`, safely
suspended, terminal, or response-lost executor members.

The nested schema preserves the existing top-level invariant that a `Begin`
response is `ExecutorWorkExecuting`. Moving that item inside a group cannot
bypass validation: the narrow member schema enforces the same rule, and the
cassette-level invariant treats a nested invalid Begin response equivalently
to a top-level invalid Begin response.

The closed union deliberately excludes nested concurrent groups,
`ConcurrentTrackerReadBatch`, lifecycle controls, coordinator crash controls,
boundary-loss controls, pause observations, Integrator or target-promotion
results, terminal assertions, and every other arbitrary story item. Those
items retain their top-level validation and cursor ownership. A group cannot
hide them from the validators that require their exact chronology.

`ConcurrentTrackerReadBatch` remains a different phenomenon and is not widened
or lowered into this group. It continues to require an exact causal owner at
selection time and a separate exact result consumption for each tracker read.
Its surrounding position advances only after every owner/result pair drains.
The new group contains only the narrow noncausal selection or Begin/Executing
interactions above and never takes over tracker-read results.

The schema reuses existing branded task, attempt, and operation identities. It
introduces no index, ordinal, revision, causal role, or scheduler identity.

## Failure, non-arrival, and scope replacement

The matcher fails closed at the existing controlled boundary when:

- an incoming selection or report is foreign to every outstanding member;
- a consumed member is presented again;
- an authored group is empty;
- an authored group contains duplicate or otherwise ambiguous member
  identities;
- a selection member carries `causal` or `causalAnchor`, or an executor member
  is not exact `Begin`/`ExecutorWorkExecuting`;
- D1 or another downstream strict interaction tries to cross an incomplete
  group; or
- internal group state contradicts the current top-level story position.

Duplicate or ambiguous authored membership is rejected by schema construction
before playback. A foreign, duplicate, or downstream runtime claim fails with
a typed cassette interaction error. The failing claim does not consume a
member, emit `onOccurrence`, or advance the story. Any earlier successful
claims remain only in the already-failing process-local matcher; the cassette
does not pretend that the run can continue from a contradictory schedule.

Absolute non-arrival has no timeout meaning. If one production interaction
never reaches its controlled boundary, the group remains the current
top-level item and emits no occurrence. A test supervisor may diagnose or stop
an incomplete test run, but elapsed time does not consume the missing member,
convert absence into a typed workflow fact, or authorize D1. Acceptance tests
observe the unchanged cursor and occurrence count through deterministic
signals; they do not use a sleep, yield, scheduler turn, or cassette deadline.

The matcher, its outstanding-member set, and the cursor permit are in-memory
harness state scoped to one cursor. A deterministic component-lifetime test
uses a fixture whose first story item is the group and whose second item is
strict D1. Scope 1 constructs its cursor, consumes exactly the B1 member, and
closes normally. Scope 2 then constructs a new cursor from the same authored
story. Because the group is the first item, Scope 2 naturally starts at that
group with B1, C1, and A1 all outstanding; it does not inherit Scope 1's
position, permit, matcher, or consumed-member set and does not need a fabricated
prefix replay.

This orderly scope replacement proves cursor lifetime, not literal process
death. If the test process is lost, no matcher state is durable and a later
full cassette rerun likewise constructs a fresh cursor from the story's
beginning, but issue #309 adds no subprocess crash protocol or resumable
playback claim. Crash recovery for provider requests and workflow
responsibilities remains owned by the corresponding production protocols and
Journal facts.

## Authority boundary and trade-offs

The group records only how the controlled harness accepts already-occurring
production interactions. It is not a Journal event, provider fact, delivery
proposal, runtime owner, task-work position, or scheduler. It is never
persisted, projected into production relations, or exported as a public test
seam. The implementation must use the existing cursor transition boundary and
existing controlled adapters; it must not add polling, a queue-priority rule,
`Effect.yieldNow`, a sleep, or a second concurrency authority.

The deliberate trade-off is that one top-level authored item no longer exposes
the internal arrival order of its members. That loss is correct for this
scenario because no causal edge authorizes an order. In return, the group must
be closed and exact: it cannot express arbitrary partially ordered stories,
nested control flow, optional members, causal or anchored selections,
non-Begin executor responses, or a resumable crash protocol. The narrow member
language rejects potentially useful cases rather than inventing within-group
causal or response-matching semantics. A future need for any of those meanings
requires a separate accepted phenomenon rather than widening this first
migration.

## Scenario-to-test mapping

All names below are planned acceptance tests. They are not claimed green until
the issue #309 implementation is independently reviewed and executed.

| Chronological result | Planned direct proof |
|---|---|
| Only noncausal exact `DalphSelects` and exact `Begin`/`ExecutorWorkExecuting` cases decode as members | `packages/dalph/test/cassettes/authored-domain.test.ts` — `accepts only noncausal selections and Begin Executing reports in a concurrent interaction group` |
| Empty groups, duplicate claim keys, two executor members with the same Begin/AttemptId key, causal or anchored selections, non-Begin or non-Executing reports, nested groups, lifecycle/crash controls, arbitrary other results, and terminal items fail decoding; nested Begin cannot bypass the top-level Begin→Executing invariant | `packages/dalph/test/cassettes/authored-domain.test.ts` — `rejects empty duplicate and ambiguous concurrent interaction groups`; `rejects causal selections and non-Begin-Executing reports inside a concurrent interaction group`; existing `rejects an authored Begin response that skips Executing`, extended with the nested negative case |
| The B1/C1/A1 group consumes in every one of the six sequential permutations, keeps its top-level position until the final member, emits one `onOccurrence`, advances once, and then admits strict D1 | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `consumes B worktree C worktree and A executing in all six orders before advancing once` |
| Simultaneous exact calls are serialized by the existing transition permit, consume every member once, and produce one group occurrence only after the final claim | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `serializes simultaneous exact group claims and emits one occurrence after the final claim` |
| Ambiguous membership fails schema decoding; foreign, duplicate, and downstream claims fail typed without advancing an incomplete group | `packages/dalph/test/cassettes/authored-domain.test.ts` — `rejects empty duplicate and ambiguous concurrent interaction groups`; `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `rejects foreign duplicate and downstream claims without advancing an incomplete group` |
| A missing member leaves the group current with no occurrence and no cursor-owned timeout decision | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `keeps an incomplete group current without inventing timeout semantics` |
| In a component fixture whose first item is the group, closing a cursor after one member and constructing a new scoped cursor recreates all three outstanding members; no matcher state or cursor position crosses the component lifetime | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `recreates every group member after its cursor scope is replaced` |
| Encoding and decoding preserve the closed group, exact claim keys, and controlled outputs | `packages/dalph/test/cassettes/authored-domain.property.test.ts` — `roundtrips valid concurrent interaction groups through the story-item boundary` |
| Presentation describes one unordered completed group without inventing a member order; the new tag has exactly one harness owner and every exhaustive presentation match handles it | `packages/dalph/test/cassettes/authored-presentation.test.ts` — `renders one completed concurrent interaction group without inventing member order`; `packages/dalph/test/cassettes/authored-coverage.test.ts` — `registers the concurrent interaction group with exactly one cursor owner`; `Match.tagsExhaustive` compilation in `packages/dalph/src/cassettes/authored-presentation.ts` |
| `ConcurrentTrackerReadBatch` still pairs each exact owner with its separate result and drains one surrounding position after both pairs | Existing `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations`; `drains repeatedly forked exact read operations without resetting the story position` |
| The maintained production story replaces only the B1/C1/A1 strict fragment with this group and still proves the DS01–DS13 chronology | Pending #268 composition in `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table` |

The direct issue #309 tests own matcher semantics. The downstream #268
capstone owns only the full production composition; it must not substitute for
the six-permutation, simultaneous-claim, typed-failure, schema, or presentation
proofs above.
