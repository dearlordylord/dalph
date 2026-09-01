# Consume one bounded causal cassette interaction group

Owning issue: [#309](https://github.com/dearlordylord/dalph/issues/309)

Status: refined scenario accepted by the repository owner on 2026-09-01 after
the owner replied `ok` to the exact acceptance request. An uncommitted
implementation candidate exists, and the concluding independent Standards and
Spec implementation re-reviews are clean. Commit and push remain pending. The
earlier five-root implementation and its 120-permutation evidence are
superseded because they omitted four causal predecessor relationships in the
#268 chronology. The downstream #268 capstone remains unclaimed and pending.

This change affects only the controlled authored-cassette harness. It does not
change production workflow semantics, provider requests, delivery scheduling,
or Journal history. It lets one maintained cassette preserve four real
within-group predecessor relationships without imposing an order on the
remaining production interactions.

## Governing behavior

The
[three-register rule](../OPERATIONAL-SCENARIOS.md#three-registers-of-the-same-behavior)
requires a cassette to record the production chronology rather than replace
it with a scheduler order. The accepted
[#268 DS01–DS13 capstone](https://github.com/dearlordylord/dalph/issues/268)
composes [Delivery Story beats 1 and 2](../DELIVERY-STORY.md#the-beats). At its
first activation, Dalph may select plans, prepare worktrees, and receive
executor Begin responses on separate Effect fibers. That concrete cut needs a
partially ordered cassette representation; it does not create a new production
scheduling rule.

The
[#269 exact C1 Begin chronology](issue-269-independent-work-retained-priority.md#an-accepted-c-position-closes-capacity-before-the-relation-lists-it)
owns C1's intent-before-call and accepted-report behavior. This scenario
preserves the ordinary plan-before-worktree and worktree-before-Begin
relationships where they exist in the #268 cut. It adds no order between
independent D, E, B, C, and A lanes.

The
[#267 reverse-completion scenario](issue-267-exact-causal-active-work-cassette.md#reverse-completion-does-not-cross-two-focused-reads)
already gives `ConcurrentTrackerReadBatch` a distinct two-phase meaning: each
tracker-read selection acquires an exact causal owner and only that owner's
result completes it. This scenario preserves that construct and both of its
regressions unchanged.

Issue #309 refines the existing cassette-only `ConcurrentInteractionGroup`.
It does not add a parallel group abstraction. The group remains a closed set
of cursor-visible interactions, but each member now names one exact authored
role and the authored roles that must already be consumed before that member
may be claimed. No Quint law governs test-cursor playback order, and this
scenario adds no formal production concurrency rule.

## Starting situation and exact interactions

The affected person is a Dalph maintainer running the production workflow
algebra through controlled tracker, Git, executor, Journal, and cassette
Layers. No target-application user triggers this cut. The maintainer is
checking that one maintained production cassette accepts every order allowed
by the real causal relationships.

The concrete trigger is the maintainer starting the focused cassette test (and,
later, the maintained #268 capstone) against the controlled Layers. No live
GitHub request, Git mutation, executor process, or durable Journal append is
performed by the group matcher itself. Consequently, a lost provider response
and provider retry do not apply to this harness behavior; the ordinary
production protocols still own those cases. Process loss is relevant only to
the cursor's process-local matcher and is bounded explicitly under scope
replacement below.

The current Run exists. Exact task identities A through E and the immutable
A1, B1, and C1 planned attempts are available to the ordinary workflow. Exact
D1 and E1 identities are carried by the current plan proposals but are not yet
durable planned attempts. The strict cassette prefix has already consumed the
A1, B1, and C1 plan selections and the A1 worktree selection. Those earlier
interactions make `X_A` a root inside this cut while the B1/C1 worktree
selections and D1/E1 plans are still outstanding. The next top-level item is
one bounded nine-member group containing these exact authored roles:

| Authored role | Existing controlled interaction | Predecessor roles |
|---|---|---|
| `P_D` | Dalph selects `RecordTaskAttemptPlan` for task D, attempt D1 | none |
| `P_E` | Dalph selects `RecordTaskAttemptPlan` for task E, attempt E1 | none |
| `W_B` | Dalph selects `ReconcileTaskWorktree` for task B, attempt B1 | none |
| `W_C` | Dalph selects `ReconcileTaskWorktree` for task C, attempt C1 | none |
| `X_A` | A1 `Begin` receives `ExecutorWorkExecuting` for A1 | none |
| `W_D` | Dalph selects `ReconcileTaskWorktree` for task D, attempt D1 | `P_D` |
| `W_E` | Dalph selects `ReconcileTaskWorktree` for task E, attempt E1 | `P_E` |
| `X_B` | B1 `Begin` receives `ExecutorWorkExecuting` for B1 | `W_B` |
| `X_C` | C1 `Begin` receives `ExecutorWorkExecuting` for C1 | `W_C` |

Thus the group has exactly four direct predecessor edges: `P_D` to `W_D`,
`P_E` to `W_E`, `W_B` to `X_B`, and `W_C` to `X_C`. No other direct edge is
authored; in this exact one-edge-per-lane graph, every other pair is
incomparable. In particular, `X_A` is independent of all four two-node lanes,
and completing one lane does not authorize or delay another.

Each selection retains its complete existing `DalphSelects` operation,
including the operation tag and exact branded task and attempt identities.
That complete operation is its interaction claim key. Each executor member
retains the existing request `Begin`, exact branded `AttemptId`, and controlled
output `ExecutorWorkExecuting`; its claim key is `Begin` plus the exact
attempt identity, not the returned report payload. The current Run correlation
continues to come from the controlled adapter. The cassette neither stores nor
infers another Run identity.

The six selection members prove only that the ordinary workflow selected
their operations at its existing trace seam; they do not prove a Journal or
Git boundary completed. The three executor members are existing controlled
executor-response items; their later Journal acceptance remains owned by the
ordinary executor protocol. Completing the group proves only that all nine
exact interactions occurred in an order permitted by the four edges.

The next strict item is the first activation's
`CoordinatorActivationReturned` result. It is a join: the cassette must not
admit that activation return until all nine group members have been consumed.

## Every permitted schedule consumes one group

The nine interactions have 22,680 valid sequential orders: `9! / 2^4`, because
the four independent two-node lanes each constrain only predecessor before
successor. The acceptance test deterministically enumerates and asserts every
one of those topological orders. It does not sample schedules or infer
coverage from a few representative permutations.

The existing controlled tracker, Git, and executor Layers continue to invoke
the same cursor operations; production code does not call a special
concurrent-story API. The first call matching an enabled member constructs one
process-local matcher for the current top-level group. Every claim passes
through the cursor's existing one-permit transition boundary. Under that
permit, the cursor:

1. matches the incoming existing call identity to exactly one unconsumed
   member's claim key;
2. verifies that every role named by that member's predecessor list has been
   consumed;
3. consumes only that exact role; and
4. leaves the top-level story position unchanged while any role remains.

Consuming `P_D`, for example, enables `W_D` but changes nothing about E, B, C,
or A. A call for `W_D` before `P_D` is consumed matches a known member but is
not enabled; it fails typed and consumes nothing. After `P_D` is consumed, the
same exact `W_D` call may claim that member through the ordinary controlled
boundary.

The first eight successful claims return to their production fibers without
advancing the strict story or emitting a completed top-level occurrence. The
ninth claim empties the outstanding-role set. The cursor then emits exactly
one completed-group occurrence through its existing `onOccurrence`
observation and advances the top-level position exactly once. Only then may
the strict `CoordinatorActivationReturned` item be consumed.

Completion commit and occurrence publication remain inside the existing
one-permit cursor transition and are uninterruptible as one local boundary.
A strict successor that arrives while publication is blocked waits on that
same permit, and interruption cannot leave an advanced group without its
occurrence. The controlled `onOccurrence` callback therefore must not invoke
another consuming operation on the same cursor while group completion is
being published; doing so would re-enter the permit it already observes.

The five initially enabled roots (`P_D`, `P_E`, `W_B`, `W_C`, and `X_A`) may
reach the cursor simultaneously. After their four predecessors have been
claimed, the four successors (`W_D`, `W_E`, `X_B`, and `X_C`) may likewise
reach it simultaneously. The existing permit serializes only the in-memory
matcher transitions. It does not order production fibers, provider calls,
Journal records, or delivery decisions, and it grants no workflow permission.

### Visible and forbidden results

The maintainer can run every one of the 22,680 valid schedules and a
simultaneous-call case. Each run consumes every role exactly once, emits one
completed group after the ninth role, advances the top-level cursor once, and
then admits the activation return. Presentation identifies the group and its
four edges without presenting the incidental runtime claim order as authored
meaning.

Dalph's cassette harness must not consume a successor before its own
predecessor, impose an edge between independent lanes, accept the activation
return before all nine interactions, consume one incoming call as two roles,
or convert a missing interaction into a timeout result.

## Closed member language, roles, and schema validity

The cassette-only phenomena are:

- **Concurrent interaction group**: one finite non-empty top-level authored
  story item containing a closed partially ordered set of cursor-visible
  interactions.
- **Concurrent interaction role**: the exact unique authored name of one
  member within its group. It identifies a node for predecessor references; it
  is not a production actor, journal identity, scheduler position, or claim
  key.
- **Concurrent interaction predecessor roles**: the exact roles that must
  already be consumed before one member is enabled.
- **Concurrent interaction claim key**: the existing incoming call identity
  by which the cursor claims one enabled member, independent of the member's
  role and controlled output.
- **Outstanding group roles**: the process-local set of exact roles not yet
  consumed by the current cursor.
- **Completed group occurrence**: the single top-level cassette occurrence
  emitted only after the outstanding set becomes empty.

The V1 member interaction union remains exactly two cases:

1. `DalphSelects` with one complete exact operation and with neither `causal`
   nor `causalAnchor` present. Its claim key is the exact operation, including
   its tag and every branded operation field.
2. `PlannedAttemptExecutorWorkReported` with request `Begin` and controlled
   output `ExecutorWorkExecuting`. Its claim key is `Begin` plus the exact
   report `AttemptId`; the report tag and payload are controlled output rather
   than additional matching identity.

Each member carries exactly one role and an explicit predecessor-role list,
which may be empty. Schema decoding rejects:

- an empty group;
- an empty or duplicate role;
- duplicate claim keys, including two executor members with the same `Begin`
  and `AttemptId` but different encoded output;
- a member that repeats one predecessor role in its predecessor list;
- a predecessor role that is absent from the same group;
- a member that names its own role as a predecessor;
- any direct or indirect cycle;
- a selection member carrying `causal` or `causalAnchor` fields; and
- a member outside the closed two-case union, including nested groups,
  `ConcurrentTrackerReadBatch`, lifecycle or crash controls, non-Begin
  executor requests, safely suspended or terminal reports, and terminal story
  items.

The nested schema preserves the existing invariant that a `Begin` response is
`ExecutorWorkExecuting`. Nesting cannot bypass that validation. Role names do
not replace claim keys: roles express authored graph structure, while exact
existing operation/request identities match calls. Both must be unique so one
call and one predecessor reference have one unambiguous owner.

`ConcurrentTrackerReadBatch` remains a separate phenomenon. It still requires
an exact causal owner at read selection and a separate exact result for that
owner; its surrounding position advances only after every owner/result pair
drains. It is neither nested in nor lowered into this group.

## Failure, non-arrival, retry, and scope replacement

At the existing controlled boundary, a claim fails with a typed cassette
interaction error when the incoming identity is foreign, matches an already
consumed role, matches a successor whose predecessors are incomplete, or is a
strict downstream interaction presented before the group completes. The
failure consumes no role, emits no occurrence, and does not advance the
top-level story. A representative test covers each failure kind, while the
exhaustive test presents every successor before its own predecessor across the
four edges and verifies the same no-mutation result.

Invalid authored membership is rejected during schema decoding before
playback. The cursor never chooses between duplicate roles or keys, repairs a
dangling reference, removes a self-edge, or breaks a cycle by arrival order.

An early successor failure does not poison the cursor. For each of the four
edges, a direct test presents the successor before its predecessor and observes
the typed failure with no mutation; it then consumes the predecessor on that
same cursor and retries the same exact successor. That retry succeeds exactly
once. Presenting the successor once more fails typed rather than returning its
controlled output again. Earlier valid claims remain consumed after a later
invalid call; the harness does not rewind accepted occurrences or pretend that
the failed test run continued successfully.

Absolute non-arrival has no timeout meaning. If one interaction never reaches
its controlled boundary, the group remains current and emits no occurrence. A
test supervisor may diagnose or stop the run, but elapsed time does not consume
the missing role, create a workflow fact, or admit the activation return.
Deterministic tests observe the cursor position and occurrence count directly;
they add no sleep, yield, scheduler turn, or cassette deadline.

The matcher, role sets, and cursor permit are in-memory harness state scoped to
one cursor. A component-lifetime test starts a fixture with this nine-member
group, consumes a proper non-empty subset, and closes Scope 1 normally. Scope
2 constructs a fresh cursor from the same authored story and finds all nine
roles outstanding. It inherits no matcher, consumed role, permit, or cursor
position from Scope 1.

This proves component replacement, not literal process recovery. If the test
process dies, a later full cassette run likewise starts at the story's
beginning, but issue #309 adds no durable matcher or resumable playback
protocol. Production crash recovery remains owned by the relevant provider,
executor, and Journal protocols.

## Authority boundary and trade-offs

The group records how the controlled harness accepts production interactions
that have already reached their existing seams. It is not a Journal event,
provider fact, delivery proposal, runtime owner, task-work position, or
scheduler. It is never persisted, projected into production relations, or
exposed through a new production or runtime seam. Authored cassette JSON is
already an exported provisional test boundary, so this refinement deliberately
changes that test schema. The implementation must reuse the existing cursor
transition boundary and controlled adapters; it must not add polling, queue
priority, `Effect.yieldNow`, sleep, timeout, or a second concurrency authority.

The deliberate trade-off is a narrow causal graph instead of either a flat
unordered bag or a general story language. The flat five-root group was
smaller, but an expert would reject it because it erased the plan-before-
worktree and worktree-before-Begin facts and could accept an impossible
production chronology. A general nested DAG would be more reusable, but an
expert would reject it here because arbitrary story-item tags and control flow
have no accepted matching, validation, or authority semantics. The chosen
closed nine-node group captures every and only interaction needed by the #268
cut, with explicit roles and predecessors.

Holding the existing transition permit through completed-group publication
delays a pending interruption until the controlled observation callback
finishes and rules out consuming-callback re-entry. That narrow cost is
accepted because releasing the permit or restoring interruptibility earlier
would let the strict successor overtake the group occurrence or let
interruption lose it. The callback remains cassette-local observation work;
this does not add another production authority or general callback queue.

Exhaustively checking 22,680 schedules costs more than the superseded 120-order
test. That finite cost is accepted because enumeration proves the entire exact
partial order without scheduler sampling or timing. The construct remains
bounded: it adds no optional members, nested groups, durable progress, generic
workflow DAG, or timeout policy. Any future widening requires its own accepted
scenario.

## Scenario-to-test mapping

These direct acceptance tests define the implementation evidence. Their
results become accepted implementation evidence only after implementation
review; the downstream #268 composition remains separate and pending.

| Chronological result | Planned direct proof |
|---|---|
| The closed selection/Begin member union decodes with one exact role and explicit predecessor roles | `packages/dalph/test/cassettes/authored-domain.test.ts` — `accepts exact roles and predecessor roles in a causal concurrent interaction group` |
| Empty groups; invalid or duplicate roles; duplicate keys; repeated predecessor roles within one member; dangling, self, or cyclic predecessor references; causal selection fields; invalid member tags; and invalid Begin responses fail decoding | `packages/dalph/test/cassettes/authored-domain.test.ts` — `rejects invalid roles keys edges and member tags in a causal concurrent interaction group`; existing `rejects an authored Begin response that skips Executing`, extended with the nested case |
| The exact nine-node #268 cut consumes in all 22,680 topological orders, preserves all four edges and no others, emits once after the ninth member, advances once, and then admits the activation return | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — collision-free canonical partition proof plus the five deterministic first-root shards under `consumes the nine-node delivery cut in all 22680 causal orders before advancing once` |
| For each of the four edges, presenting the successor early fails typed without mutation; consuming its predecessor and retrying that exact successor on the same cursor succeeds once, while another retry fails typed | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `retries each exact successor once after its predecessor follows an early typed failure` |
| X_A, X_B, and X_C return their exact controlled `ExecutorWorkExecuting` payloads and attempt identities after their own predecessor constraints are satisfied | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `returns each exact controlled executor report from its authored group node` |
| Representative foreign, duplicate, and premature activation-return claims fail typed without advancing an incomplete group | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `rejects foreign duplicate and downstream claims without advancing an incomplete group` |
| The five enabled roots may claim simultaneously, and the four enabled successors may claim simultaneously after their predecessors, while one permit produces one final occurrence | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `serializes simultaneous roots and successors and emits once after the causal join` |
| A blocked completed-group occurrence cannot be overtaken by the strict activation return, and interrupting the ninth claimant cannot lose the group occurrence | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `publishes the completed group before admitting the strict successor even when interrupted` |
| Missing members leave the group current with no occurrence and no cassette-owned timeout | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `keeps an incomplete causal group current without inventing timeout semantics` |
| A replacement cursor starts with all nine roles outstanding after an earlier scope consumed a proper subset | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `recreates all causal group roles after its cursor scope is replaced` |
| Encoding and decoding preserve unique roles, unique predecessor lists, predecessor edges, exact claim keys, and controlled outputs; generated repeated predecessor roles fail decoding | `packages/dalph/test/cassettes/authored-domain.property.test.ts` — `roundtrips valid causal concurrent interaction groups through the story-item boundary`; `rejects generated duplicate predecessor roles in a causal concurrent interaction group` |
| Presentation renders all nine roles and exactly four direct edges, states that absent direct edges may still be transitively ordered, and invents no direct edge or claim order; the tag has exactly one cursor owner and exhaustive matches handle it | `packages/dalph/test/cassettes/authored-presentation.test.ts` — `renders one causal interaction group without inventing claim order`; `packages/dalph/test/cassettes/authored-coverage.test.ts` — `registers the concurrent interaction group with exactly one cursor owner`; exhaustive compilation in `packages/dalph/src/cassettes/authored-presentation.ts` |
| `ConcurrentTrackerReadBatch` still pairs each exact owner with its result and drains its surrounding position only after both pairs | Existing `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations`; `drains repeatedly forked exact read operations without resetting the story position` |
| The maintained production story replaces the exact nine strict interactions with this group, keeps the activation return as the following strict join, and still proves DS01–DS13 | Pending #268 composition in `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table` |

The direct #309 tests own schema, matcher, ordering, concurrency, failure, and
presentation semantics. The downstream #268 capstone remains pending and owns
only the full production composition; it cannot substitute for the direct
22,680-order evidence.
