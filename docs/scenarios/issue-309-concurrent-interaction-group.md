# Consume one bounded causal cassette interaction group

Owning issue: [#309](https://github.com/dearlordylord/dalph/issues/309)

Status: the refined nine-node scenario was accepted by the repository owner on
2026-09-01 after the owner replied `ok` to the exact acceptance request. Its
implementation and direct evidence are committed at `e6d98926f`, pushed, and
clean under the concluding independent Standards and Spec implementation
re-reviews. The earlier five-root implementation and its 120-permutation
evidence are superseded because they omitted four causal predecessor
relationships in the #268 chronology.

The amendment headed **Accepted amendment: compose independent specification-
to-lineage authority lanes** was accepted by the repository owner on 2026-09-01
after the owner replied `accepted` to the exact acceptance request. Its canonical
domain, runtime, and exhaustive evidence commits are `bd6fbc57e`, `caf5e9710`,
and `49bacf465`; they are integrated on this branch as `ea8253fd3`, `c303dbc98`,
and `ffd167a3f`. The direct amendment evidence is green at 89/89 tests across
the six domain, bounded-group, property, reactivation-return, and presentation
files, plus 9/9 targeted integration tests across the scenario, residual,
active-work, and coverage files. The three package builds, workspace typecheck,
and Effect diagnostics are green, with 666/666 files checked and zero Effect
diagnostics. A fixed-point comparison at `0253bda69` preserves the 16 known
broad-suite reds, including two normal timeouts; the one additional stale
projection assertion was migrated to the accepted exact-`AttemptId`, no-neighbor-
consumption result. The downstream #268 composition remains pending and is not
included on this branch.

This change affects only the controlled authored-cassette harness. It does not
change production workflow semantics, provider requests, delivery scheduling,
or Journal history. It lets one maintained cassette preserve real bounded
predecessor relationships without imposing order on independent production
interactions.

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

| Chronological result | Direct proof |
|---|---|
| The closed selection/Begin member union decodes with one exact role and explicit predecessor roles | `packages/dalph/test/cassettes/authored-domain.test.ts` — `accepts the four exact interaction forms in a causal concurrent group` |
| Empty groups; invalid or duplicate roles; duplicate keys; repeated predecessor roles within one member; dangling, self, or cyclic predecessor references; causal selection fields; invalid member tags; and invalid Begin responses fail decoding | `packages/dalph/test/cassettes/authored-domain.test.ts` — `rejects invalid roles keys edges and member tags in a causal concurrent interaction group`; existing `rejects an authored Begin response that skips Executing`, extended with the nested case |
| The exact nine-node #268 cut consumes in all 22,680 topological orders, preserves all four edges and no others, emits once after the ninth member, advances once, and then admits the activation return | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — collision-free canonical partition proof plus the five deterministic first-root shards under `consumes the nine-node delivery cut in all 22680 causal orders before advancing once` |
| For each of the four edges, presenting the successor early fails typed without mutation; consuming its predecessor and retrying that exact successor on the same cursor succeeds once, while another retry fails typed | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `retries each exact successor once after its predecessor follows an early typed failure` |
| X_A, X_B, and X_C return their exact controlled `ExecutorWorkExecuting` payloads and attempt identities after their own predecessor constraints are satisfied | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `returns each exact controlled executor report from its authored group node` |
| Representative foreign, duplicate, and premature activation-return claims fail typed without advancing an incomplete group | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `rejects foreign duplicate and downstream claims without advancing an incomplete group` |
| The five enabled roots may claim simultaneously, and the four enabled successors may claim simultaneously after their predecessors, while one permit produces one final occurrence | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `serializes simultaneous roots and successors and emits once after the causal join` |
| A blocked completed-group occurrence cannot be overtaken by the strict activation return, and interrupting the ninth claimant cannot lose the group occurrence | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `publishes the completed group before admitting the strict successor even when interrupted` |
| Missing members leave the group current with no occurrence and no cassette-owned timeout | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `keeps an incomplete causal group current without inventing timeout semantics` |
| A replacement cursor starts with all nine roles outstanding after an earlier scope consumed a proper subset | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `recreates all causal group roles after its cursor scope is replaced` |
| Encoding and decoding preserve unique roles, unique predecessor lists, predecessor edges, exact claim keys, and controlled outputs; generated repeated predecessor roles fail decoding | `packages/dalph/test/cassettes/authored-domain.property.test.ts` — `roundtrips every closed causal group member and predecessor graph through the story-item boundary`; `rejects generated duplicate predecessor roles in a causal concurrent interaction group` |
| Presentation renders all nine roles and exactly four direct edges, states that absent direct edges may still be transitively ordered, and invents no direct edge or claim order; the tag has exactly one cursor owner and exhaustive matches handle it | `packages/dalph/test/cassettes/authored-presentation.test.ts` — `renders one causal interaction group without inventing claim order`; `packages/dalph/test/cassettes/authored-coverage.test.ts` — `registers the concurrent interaction group with exactly one cursor owner`; exhaustive compilation in `packages/dalph/src/cassettes/authored-presentation.ts` |
| `ConcurrentTrackerReadBatch` still pairs each exact owner with its result and drains its surrounding position only after both pairs | Existing `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations`; `drains repeatedly forked exact read operations without resetting the story position` |
| The maintained production story replaces the exact nine strict interactions with this group, keeps the activation return as the following strict join, and still proves DS01–DS13 | Pending #268 composition in `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table` |

The direct #309 tests own schema, matcher, ordering, concurrency, failure, and
presentation semantics. The downstream #268 capstone remains pending and owns
only the full production composition; it cannot substitute for the direct
22,680-order evidence.

## Accepted amendment: compose independent specification-to-lineage authority lanes

This section records accepted behavior and its direct implementation evidence.
The accepted nine-node group and its evidence above remain implemented and
unchanged; this amendment adds the authority-lane behavior without rewriting
that prerequisite.

### Governing behavior

The accepted
[#268 capstone](https://github.com/dearlordylord/dalph/issues/268) requires
Alice's edit to B to flow through one active-work graph refresh, focused
instruction reads, current tracker and Git facts for the still-healthy
executing attempts, and then B's safe suspension. The accepted
[#266 A/B/C chronology](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously)
owns the production decision: after B's F2 result proves B1 constrained, A1
and C1 each continue through their own current claim, planned-worktree, and
target-lineage facts, and only B1 receives `Suspend`. This amendment does not
change that decision or authorize another read.

[D21 Intent before an ambiguity-crossing effect](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
requires the exact tracker-read intent before the owning tracker call and its
observed result afterward. D23 in that same heading keeps unreadable claim
evidence distinct from absence, and D24 forbids a selection at one boundary
from implying that the following result boundary succeeded. The exact inherited
production executable scenarios are
[`active-work refresh recovers ordinary authority reads without a private refresh protocol`](../../packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts),
which tables claim-read intent-before-call and response-before-observation, and
[`records one exact claim observation and replays it without another provider read`](../../packages/orchestrator/src/workflow-journal/journaled-claim-observation.test.ts),
which records one intent/result pair and reuses the completed observation.

[D29 Authority separation](../DELIVERY-INVARIANTS.md#process-and-durability)
continues to keep the cursor role set, permit, and occurrence process-local.
No Quint law governs controlled cassette playback order. The production
claim-result constraints remain the inherited `foreignClaimIsNeverChanged` and
`unreadableClaimCannotAuthorizeReplacement` laws in
[`taskFactReconciliation.qnt`](../../specs/taskFactReconciliation.qnt), with
their existing executable scenarios `foreignClaimStopsOnlyATest` and
`unreadableClaimCannotAuthorizeProgressOrLossTest` in
[`taskFactReconciliation_test.qnt`](../../specs/taskFactReconciliation_test.qnt).
Those laws constrain how Dalph uses a returned claim; they do not authorize or
model this cassette matcher.

The accepted
[#269 full-capacity handoff](issue-269-independent-work-retained-priority.md#full-capacity-yields-to-one-queued-active-refresh-without-losing-d-or-e)
owns the preceding activation return, queued hint handoff, and later ordinary
G1 read. The active-refresh cut starts after that G1 result, before its focused
specification reads. The executing restart is the strict process-start prefix
proved below; the second group belongs only to the later post-hint active
refresh. This amendment adds no activation, hint, capacity, admission, or
executor scheduling rule.

The downstream composition remains governed by
[#268](https://github.com/dearlordylord/dalph/issues/268) and its pending
boundary draft at branch `work/issue-268-delivery-story-capstone`, path
`docs/scenarios/issue-268-delivery-story-capstone.md`. That file is not yet
composed on this branch, so this amendment deliberately does not publish a
broken relative link to it. Its headings **Governing behavior and blocking
edge**, **The capacity revision commits before process death is exposed**, and
**C Safe commits before Continue B is exposed** remain the reviewable
governing locations. The capacity boundary still has a known committed-but-
unacknowledged revision counterexample: death must remain unavailable in that
run until the durable capacity result is reconciled in a later run. The Safe
boundary still requires the exact accepted and published C2 Safe report before
Continue B; provider return, early interruption, or an ambiguous commit cannot
authorize Continue. Those counterexamples are open blockers to accepting the
suffix as sound. This #309 amendment neither closes them nor treats a green
local matcher test as downstream acceptance. The pending #268 draft's restart
authority-lane language must also be removed in favor of the strict probe-
proved prefix below before that boundary scenario can be accepted.

The accepted nine-node #309 behavior above owns the closed group, authored
role/predecessor graph, exact claim, cursor-permit transition, one completion
publication, failure/no-mutation, non-arrival, and scope-replacement semantics.
This amendment preserves all of those rules and adds only the two exact tracker-
result member forms required by the two active-refresh cuts.
The separately exact projection cursor contract applies only to the strict
restart prefix. The amendment does not supersede or rewrite the nine-node
scenario.

The earlier draft began after all focused specification results because the
current cassette places them in one `ConcurrentTrackerReadBatch`. A completed
production probe disproves that barrier. On probe commit `c305b3543`, this exact
command passed both characterizations:

```text
pnpm vitest run packages/dalph/src/application/production-reactivation.test.ts -t "allows one (restart|active-refresh) authority lane"
```

The two passing tests are `allows one restart authority lane to reach claim
while independent specification reads remain in flight` and `allows one
active-refresh authority lane to reach claim while independent specification
reads remain in flight`. The restart characterization uses different lifecycle
facts and does not govern #268's executing-restart cut: probe `bb40c4c8c` below
proves that exact cut performs zero specification, claim, worktree, or lineage
selections. The active-refresh case held D's specification read on a
deterministic `Deferred` and observed A reach its exact claim read before
release. It made C terminal, leaving A and D as the exact independent unchanged
lanes. That active result supports the later post-hint A/D group below. The 2/2
result remains characterization evidence, not accepted #309 implementation
evidence or a passing #268 capstone.

`ConcurrentTrackerReadBatch` remains implemented and unchanged for cuts that
really require all selected reads to drain together. It cannot own either
active-refresh cut below: its surrounding position advances only after every
selection/result pair, while the probes prove one task may cross from its own
specification result to its own claim read before an independent specification
result exists. This amendment does not widen, nest, or remove that construct.

### The maintainer reaches the active-refresh specification-to-lineage lanes

The affected person is a Dalph maintainer running the accepted #268 production
workflow algebra through the controlled tracker, Git, executor, Journal, and
cassette Layers. Alice's earlier tracker edit changed B's instructions from F1
to F2; Alice does not issue another command at this cut. No target-application
user triggers an individual boundary call.

The current Run has exact planned attempts A1 `attempt:A:0`, B1
`attempt:B:1`, and C1 `attempt:C:2`. Their accepted lifecycle reports are
`ExecutorWorkExecuting`, and their exact claims and planned worktrees still
exist. The Journal already contains the three plans. In the current
uncommitted #268 composition candidate, the accepted nine-node group has
drained, the first activation has returned
`RunMustRemainActive(RunnableTransition)`, the sole reactivation owner has
coalesced the notification and timer hints, and its later activation has
recorded and completed G1 through the ordinary tracker-read protocol.

Those preceding group and activation facts are the accepted #309/#269
composition prerequisite for this cut, not source already committed on the
#309 branch. If downstream #268 discards its current composition candidate, it
must first restore that prerequisite from the accepted behavior above; this
amendment does not absorb or re-specify it.

G1 says A, B, and C remain open, in the Run, and free of unfinished blockers.
The concrete trigger is publication of that exact G1 result. The ordinary
delivery runtime may then select A's, B's, and C's focused specification reads
on independent Effect fibers. A's own F1 result authorizes its current-claim,
worktree, and lineage checks without waiting for C's F1 result. C has the same
independent lane. B's F2 result proves the task-local constraint that will
select `Suspend(B1)`; B has no claim/worktree/lineage tail in this cut. No one
task's result establishes another task's result.

After the accepted nine-node composition collapses its earlier cut, the
current uncommitted #268 candidate places the whole three-task specification
batch at cassette position 48, then strict `Q_A, R_A, W_A, L_A, Q_C, R_C,
W_C, L_C` at positions 49 through 56. Replacing only positions 49–56 would
leave the false batch barrier in place. The corrected replacement scope is the
exact top-level span 48–56. The candidate's current failure at exact position
51 remains evidence of a false cross-lane constraint, not permission to impose
a different order. The committed pre-composition source on this #309 branch
has later ordinals; this amendment makes no ordinal claim about that source.

### Exact fourteen-node active-refresh chronology

The accepted replacement for the candidate's top-level positions 48 through 56
is one bounded fourteen-member `ConcurrentInteractionGroup`:

| Role | Existing controlled interaction | Direct predecessor roles |
|---|---|---|
| `S_A` | Dalph selects exact noncausal `ReadTaskWorkSpecification(taskId A)` | none |
| `T_A` | The controlled tracker returns exact A/F1 `TaskWorkSpecificationReadReturned` | `S_A` |
| `Q_A` | Dalph selects exact noncausal `ReadTaskClaim(taskId A)` | `T_A` |
| `R_A` | The controlled tracker returns exact `TaskClaimCurrentReadReturned(taskId A)` | `Q_A` |
| `W_A` | Dalph selects exact noncausal `ReadTaskWorktree(taskId A, attemptId attempt:A:0)` | `R_A` |
| `L_A` | Dalph selects exact noncausal `ReadTargetLineage(taskId A, attemptId attempt:A:0)` | `W_A` |
| `S_B` | Dalph selects exact noncausal `ReadTaskWorkSpecification(taskId B)` | none |
| `T_B` | The controlled tracker returns exact B/F2 `TaskWorkSpecificationReadReturned` | `S_B` |
| `S_C` | Dalph selects exact noncausal `ReadTaskWorkSpecification(taskId C)` | none |
| `T_C` | The controlled tracker returns exact C/F1 `TaskWorkSpecificationReadReturned` | `S_C` |
| `Q_C` | Dalph selects exact noncausal `ReadTaskClaim(taskId C)` | `T_C` |
| `R_C` | The controlled tracker returns exact `TaskClaimCurrentReadReturned(taskId C)` | `Q_C` |
| `W_C` | Dalph selects exact noncausal `ReadTaskWorktree(taskId C, attemptId attempt:C:2)` | `R_C` |
| `L_C` | Dalph selects exact noncausal `ReadTargetLineage(taskId C, attemptId attempt:C:2)` | `W_C` |

The direct edges are exactly the five consecutive edges in
`S_A -> T_A -> Q_A -> R_A -> W_A -> L_A`, the one edge `S_B -> T_B`, and the
five consecutive edges in
`S_C -> T_C -> Q_C -> R_C -> W_C -> L_C`: fourteen nodes and eleven edges.
There is no cross-lane edge. In particular, Q_A is enabled immediately after
T_A even while T_C is blocked, which is the concrete overlap proved by the
production probe. Same-lane transitive order remains true without being
misreported as extra direct edges.

Enabled members from different lanes may arrive simultaneously at every
stage. Each incoming call passes through the cursor's existing one-permit
transition, consumes one exact role, and returns to its production fiber. The
permit serializes only cassette matcher state; it does not serialize tracker or
Git calls and grants no production permission.

After the fourteenth successful claim, the cursor publishes exactly one
completed group occurrence and advances the top-level story exactly once. The
next strict item remains B1's existing
`PlannedAttemptExecutorWorkReported(request Suspend, output
ExecutorWorkExecuting)` boundary. It is the specified join after both
unchanged-task tails and B's exact F2 result. B's later passive Safe report,
position release, D Begin, pre-death D projection, and every later #268 item
remain unchanged.

That strict successor now has direct production characterization rather than
only cassette-position evidence. The current rule in
`packages/orchestrator/src/coordination/run/recovery-activation.ts` suppresses
every active-refresh subject's `SuspendPlannedAttemptExecutorWork` while the
frontier still contains any active authority-read transition: graph,
specification, claim, worktree, or target lineage. Only after every healthy
subject's remaining lineage transition settles does the constrained subject's
one Suspend appear.

The committed and pushed +260-line characterization change is commit
`5578b8daa8778e98a14f9a61e93dd2cf393d69ce` on
`origin/probe/issue-309-suspend-causality`, based on `c305b3543`, and touches only
`packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`.
Its exact test `settles A then C lineage before exposing exactly one constrained
B F2 suspension` starts healthy A, changed B/F2, and healthy C. B drops out
before claim and Git reads; A and C both reach lineage. After A settles while C
remains the sole lineage transition, the frontier contains zero B Suspend.
After C settles, it contains exactly one Suspend B. The new focused test was
1/1 green, the full acceptance file 13/13 green, and the relevant production
pair 2/2 green; oxlint, ESLint, dprint, and diff checks were green. At the time
of the characterization, the hook was blocked only by the unchanged known
capstone dprint baseline. This is committed characterization evidence, not
accepted #309 implementation evidence or a passing #268 capstone.

### Executing restart is one strict projection-and-return prefix

After D begins, the existing strict story records D's current executor
projection, reads G1 again, returns the activation, applies capacity two, and
then declares coordinator process death. No person triggers restart. The new
process reconstructs exact attempts A1 `attempt:A:0`, C1 `attempt:C:2`, and D1
`attempt:D:3` from the Journal and current tracker graph and re-establishes each
passive executor owner. The tracker, executor, Journal, and Git retain their
existing authority.

Committed production probe `bb40c4c8c`, exact test `completes the startup graph
read then serially reattaches A C and D before the next graph read` in
`packages/dalph/test/scenarios/production.test.ts`, proves this exact executing-
restart chronology:

```text
startup graph -> P_A -> P_C -> P_D -> next graph
  -> CoordinatorActivationReturned(RunMustRemainActive(UnsettledResponsibility))
```

The first tracker graph read completes before any projection. The existing
process-scoped `PassivePlannedAttemptObserver.attachmentGate` then admits exact
A, C, and D reattachments one at a time. Blocking A's `lifecycle.attach` keeps
C, D, the next graph read, and the activation return unavailable. Each P is a
strict top-level
`PlannedAttemptExecutorProjectionReturned(ExecutorWorkExecuting)` item for its
branded AttemptId (`attempt:A:0`, `attempt:C:2`, or `attempt:D:3`). The probe
observed exactly three projection calls, zero Begin, Resume, or Suspend
commands, and zero S/T/Q/R/W/L specification, claim, worktree, or lineage
selections. There is therefore no restart `ConcurrentInteractionGroup`, no
restart member graph, and no restart group occurrence to publish.

Strict projection matching still replaces the argumentless
`consumeExecutorProjection` plus `currentStoryItem` peek with cassette-only
`consumeExecutorProjectionFor(attemptId: AttemptId)`. The controlled executor
passes the already requested exact AttemptId, and the cursor atomically matches
only the current strict projection with the same tag and report AttemptId under
its existing permit. For a foreign, early, or duplicate AttemptId, the cursor
fails closed by returning `Option.none` without consuming a neighboring
projection. The controlled optional observer translates that absence to
`NoReport`; it does not widen the executor's runtime error channel. This changes
no executor or passive-owner production API and does not duplicate the existing
attachment gate. The fixed A/C/D prefix records this exact #268 fixture; it is
not a reusable task-priority, FIFO, scheduling, or production-authority rule.

This retains the inherited
[#265 exact restart reattachment](issue-265-passive-executor-observation-through-restart.md#a-later-dalph-process-reattaches-to-the-exact-codex-attempt):
the later process reads each exact attempt's current projection without another
Begin, and unavailable or contradictory evidence cannot manufacture progress.
After the next exact graph result, issue #268 owns the strict activation return
with exact `RunMustRemainActive(UnsettledResponsibility)`. Only after that return
settles may the strict `CassetteOffersRunReactivationHints` item expose
TrackerNotification and Timer. A missing projection, graph result, or activation
return leaves its own strict boundary current; restart does not infer it from
process age or another attempt.

### Later post-hint refresh has two independent authority lanes

After the strict restart return settles, TrackerNotification or Timer may
trigger the next ordinary active refresh. The current Run still has exact A1
`attempt:A:0` and D1 `attempt:D:3` executing with their exact claims and planned
worktrees. The ordinary graph and durable plan facts that precede this cut
remain #268-owned. No person issues another command.

The active-refresh characterization at `c305b3543` held D's specification read
on a deterministic `Deferred` and proved that A reaches its exact claim read
before D's result exists. The accepted later group therefore contains exactly
two independent six-node chains:

- `S_A^h -> T_A^h -> Q_A^h -> R_A^h -> W_A^h -> L_A^h`; and
- `S_D^h -> T_D^h -> Q_D^h -> R_D^h -> W_D^h -> L_D^h`.

S selects exact noncausal `ReadTaskWorkSpecification`; T returns that exact
task's `TaskWorkSpecificationReadReturned`; Q selects exact noncausal
`ReadTaskClaim`; R returns that exact task's
`TaskClaimCurrentReadReturned`; W selects `ReadTaskWorktree` for the same exact
task/attempt; and L selects `ReadTargetLineage` for that task/attempt. The group
has exactly twelve nodes and ten direct consecutive-chain edges, with no A/D
cross-lane edge. A's Q is enabled after A's T even while D's T is blocked, and
the reverse is equally permitted by the authored graph.

The twelfth claim publishes one completed group occurrence and advances once.
The next strict item is exact C2
`PlannedAttemptExecutorWorkReported(request Suspend, output
ExecutorWorkExecuting)`. The committed three-attempt probe above establishes the
role-generic production rule: a constrained active-refresh subject's Suspend
is suppressed while any healthy subject retains an authority transition and is
exposed exactly once only after the last healthy lineage settles. Applied to
this cut, healthy A and D must both finish their exact chains before constrained
C2 Suspend becomes available. This is a join, not an A-before-D order or a new
permission to suspend. The downstream #268 suffix remains pending for its
separate capacity/death and Safe/Continue blockers.

### Returned results remain distinct from selections and requested projections

The accepted cassette-only phenomenon is **controlled current task-claim read
return**: the exact interaction at which the controlled task tracker returns
the current result for the task named by its existing `readTaskClaim(taskId)`
boundary. It is distinct from `Q_A` or `Q_C`, where Dalph merely selects the
read. Selection is not evidence that the tracker returned, and the return is
not another selection.

T is likewise the **controlled task-work specification read return**, distinct
from S selecting `ReadTaskWorkSpecification`. Its complete authored
specification is the controlled value returned for that exact TaskId. P is the
**controlled planned-attempt executor projection return**, distinct from the
passive observer asking `lifecycle.attach` for one exact AttemptId. The cassette
does not invent a Dalph selection event for that executor call. These three
result boundaries describe existing controlled adapter returns, but only T and
R are group members; none is a Journal fact, production scheduler decision, or
authority grant.

At the accepted `e6d98926f` baseline, the controlled tracker adapter consumes
a strict `TaskClaimCurrentReadReturned` item before it calls
`currentObservation(taskId)`. The cursor therefore advances while the injected
tracker read may still be blocked or may later fail. Adding that existing item
to the group without changing the adapter would make R a pre-return control
token and could publish the group before the tracker result exists. An expert
would reject that false chronology.

This amendment therefore includes one narrow controlled-adapter sequencing
and cursor-contract correction for the current-return item:

1. The workflow emits `OperationSelected` for exact `ReadTaskClaim`, and the
   authored runner consumes exact noncausal Q. The ordinary journaled
   claim-read protocol then records and acknowledges
   `TaskTrackerReadIntentRecorded` for that operation before it calls the
   controlled tracker adapter. Both the exact selection and its durable intent
   therefore precede the authority effect; neither becomes the result.
2. The controlled adapter first uses a cassette-private, exact-task atomic
   dispatch for the existing strict `TaskClaimReadReturned` and
   `TaskClaimReadFailed` overrides. That dispatch either consumes the one exact
   strict tag and task identity or returns no override without consuming a
   current-return item. It does not inspect a current story item and then make
   a separate claim.
3. If no strict override exists, the current-return branch is one idiomatic
   `Effect.uninterruptibleMask`. Its sole `restore(...)` region is the injected
   authority call `currentObservation(taskId)`. The adapter holds no cursor
   permit across that restored read. `currentObservation` obtains the
   controlled adapter's retained authored observation when present or calls the
   injected tracker's read-only `readTaskClaim(taskId)` boundary when absent.
   Failure or interruption while that authority call is blocked returns its
   existing typed failure or interrupted exit with R outstanding, no group
   occurrence, and no cursor advance.
4. When the restored authority read succeeds, execution re-enters the mask.
   The adapter validates that the returned `TaskClaimObservation` names the
   exact requested task and, still masked, invokes cassette-only
   `consumeTaskClaimReadFor(taskId: TaskId)`. That operation acquires the
   existing cursor permit and atomically matches only
   `{ _tag: "TaskClaimCurrentReadReturned", taskId }`, checks its same-group
   predecessors, claims that exact R, updates cursor state, advances if this is
   the final member, publishes completion, and releases the permit. If no
   current-return item is authored at this boundary, it returns no item and the
   adapter keeps the baseline current-observation behavior. The linearization
   point is successful exact-task validation followed immediately, without a
   restored interruptible gap, by entry into that masked handoff. After it, a
   pending interruption is delayed until R has been consumed and any group
   occurrence published exactly once. As the mask exits, the caller may
   observe the pending interruption instead of receiving the already-obtained
   observation; a retry then fails typed as a duplicate rather than returning
   the result a second time.

No tracker call is made while the cursor permit is held, and no public
diagnostic hook, production API, provider callback, or second observation seam
is added. A blocked tracker read therefore cannot block an independent cursor
claim by retaining the permit. Q and the ordinary durable read intent remain
before the authority effect, while R now truthfully records that the controlled
result already exists. The mask includes exact-result validation,
post-validation entry, permit acquisition, state change, position advance, and
occurrence publication. It restores interruptibility only for the authority
read. Masking only the state write, or composing a separately uninterruptible
handoff after an interruptible validation, would leave a gap in which
interruption could lose a result the adapter already obtained.

The `StoryCursor` contract therefore replaces the argumentless
`consumeTaskClaimRead` operation with exact cassette-local result operations.
The current-return operation is exactly
`consumeTaskClaimReadFor(taskId: TaskId)`. It constructs the tag-plus-branded-
task claim key internally and never selects the first or next enabled R by
encoded member order. In particular, `consumeTaskClaimReadFor(C)` cannot claim
`R_A` when both A and C are enabled, even if A appears first in the authored
member array. Predecessor validation, duplicate detection, exact claim, state
update, and publication remain one transition under the already accepted
permit. There is no peek-then-claim window, second lock, queue, or concurrency
authority.

The adapter call site passes its requested branded `TaskId` to that exact
operation only after obtaining and validating a current observation. Existing
strict explicit-result and failure call sites migrate from the argumentless
union consumer to the exact-task strict dispatch described above; their
ordinary cassette results and failure semantics do not change. Cursor
residual, scope, and direct strict tests likewise pass the exact task identity,
and no argumentless result consumer remains able to take another task's item.
These operations belong only to `StoryCursor` and the controlled authored
tracker Layer. They are not added to `WorkflowInterpreter`, `TrackerMutation`,
the tracker provider, or any other production authority surface.

This sequencing change must be narrow. Existing strict
`TaskClaimReadReturned` items deliberately supply an authored observation, and
existing strict `TaskClaimReadFailed` items deliberately return
`TaskClaimReadFailure` without first obtaining a successful current
observation. Moving every task-claim story item after `currentObservation`
would introduce an extra underlying read, could fail before applying an
authored observation, and could make the authored unreadable item impossible
to consume. Those two strict paths retain their current behavior. Ordinary
strict `TaskClaimCurrentReadReturned` cassettes keep their result value and
order relative to surrounding strict items, but their cursor occurrence moves
to the truthful point after the current observation succeeds. Their callers
also use the exact-task cursor contract, so this correction cannot consume a
neighboring task's strict current-return item.

There are two controlled-harness trade-offs. First, the read-only current
observation may succeed and the later R claim may then prove foreign,
premature, duplicate, or task-contradictory. The adapter returns no observation
to its caller in that case, changes no tracker record, and leaves the group
unchanged. Group claim failures remain typed
`AuthoredCassetteInteractionMismatch` failures. A strict authored task
contradiction retains the controlled adapter's existing fail-closed defect
style rather than returning the foreign result. Spending one harmless
read-only controlled observation before discovering that authored mismatch is
accepted; fabricating R before a result or widening production authority is
not.

Second, once exact-task validation succeeds and execution continues into the
masked handoff,
interruption responsiveness is deliberately weaker. An interruption that
arrives while permit acquisition or completion publication is blocked is
remembered and delivered only after exact R is consumed and published; the
caller may observe interruption even though cassette state proves R occurred.
That delayed interruption is accepted because the alternative permits a
successful authority result to exist without its authored post-result boundary.
The promise that no R is fabricated applies only to authority failure or
interruption before exact result validation. It does not apply after the
linearization point, and retry after that point is a duplicate, not an
ambiguous second authority observation.

The current two-case closed member union cannot express any returned tracker
result. Its `DalphSelects` case can express S, Q, W, and L, while its executor
case can express only a `Begin`/`ExecutorWorkExecuting` response. Top-level
`TaskWorkSpecificationReadReturned` and `TaskClaimCurrentReadReturned` are
rejected when nested in that union. Replacing T or R with another
`DalphSelects` would erase the exact result boundary that makes the following
same-task edge truthful.

The accepted amendment changes the closed member union from two to
exactly four cases by adding only these two existing result forms:

1. `TaskWorkSpecificationReadReturned`, carrying the existing exact authored
   specification. Its claim key is its tag plus branded `TaskId`; body, title,
   and derived fingerprint remain controlled output rather than matching
   identity.
2. `TaskClaimCurrentReadReturned { taskId }`. Its claim key is its tag plus
   branded `TaskId`. The existing `readTaskClaim(taskId)` boundary exposes no
   `AttemptId`, `OperationId`, claim owner, claim token, or claim payload, so
   none is invented.

Two T members for one task or two R members for one task therefore duplicate
an exact claim key even when their output payloads differ. Schema decoding
rejects each ambiguity before playback. The different tags keep a task's
specification and claim results disjoint. Complete S/Q/W/L operations remain
their existing exact selection keys.

S/Q/W/L remain the group's accepted noncausal `DalphSelects` form. The initial
active group is already strictly after its exact G1 return and durable plans;
the later A/D group is already after the strict restart return, reactivation
hint, and its #268-owned graph/plan prefix. Their local predecessor lists own
only S-to-T-to-Q-to-R-to-W-to-L. The production
operation's existing OperationId, journal intent, and predecessor evidence
remain in the workflow protocol; the cassette group neither deletes nor
re-authorizes them. Allowing `causal` or `causalAnchor` fields inside the group
would create a second overlapping predecessor registry and is rejected by the
closed schema.

The existing `consumeTaskWorkSpecificationFor(taskId, context?)` cursor path is
extended to claim exact T from this group atomically under the existing permit;
it does not fall back to an enabled sibling task.

Projection handling is a separate strict-story correction, not a member-union
widening. It replaces the argumentless `consumeExecutorProjection` plus
`currentStoryItem` peek with cassette-only
`consumeExecutorProjectionFor(attemptId: AttemptId)`. That operation atomically
matches only the current strict
`{ _tag: "PlannedAttemptExecutorProjectionReturned", report: { attemptId } }`
under the same cursor permit. The controlled executor's
`observe` and passive lifecycle `attach` paths pass their already requested
exact AttemptId. A foreign, early, or duplicate AttemptId returns
`Option.none` at the exact cursor boundary, and the optional executor observer
returns `NoReport`; neither path takes another recovered attempt's projection.

Those cursor operations are test-harness contracts. They do not add a method
to `TrackerMutation`, `PlannedAttemptExecutorLifecycleObservation`,
`WorkflowInterpreter`, a provider, or the passive observer. They add no
production API, lock, queue, ordering rule, or authority. In particular, the
cassette cursor permit does not replace or widen the passive observer's
existing process-global attachment gate.

Every other returned or control tag remains outside the group, including
`TaskClaimReadReturned`, `TaskClaimReadFailed`, tracker-graph results,
task-specification failures, executor command projections or passive lifecycle
changes, `PlannedAttemptExecutorProjectionReturned`, lifecycle/crash controls,
terminal items, `ConcurrentTrackerReadBatch`, and a nested
`ConcurrentInteractionGroup`. No optional fifth case or generic story-item
escape hatch is added.

The three result-boundary terms are intentionally absent from `CONTEXT.md`:
they name bounded controlled-cassette matcher boundaries, not production facts,
current authorities, workflow events, or user-visible concepts. No ADR is
warranted. The choice is implementation-specific, cassette-only, and
reversible; it records no hard-to-reverse production decision.

### Early arrival, retry, non-arrival, and scope replacement

The accepted group's failure/no-mutation rule applies to every new member. If
`consumeTaskClaimReadFor(A)` attempts `R_A` before `Q_A`, the cursor returns the
existing typed interaction failure and consumes no role, emits no occurrence,
and advances no top-level position. On that same cursor, Q_A may then succeed,
the exact R_A may succeed once, and another exact A call fails typed as a
duplicate. The same chronology applies independently to every Q/R pair in the
initial A/C and later A/D groups. Calling the operation with a foreign exact branded `TaskId`
also fails typed without mutation; it cannot fall through to the first enabled
A, C, or D result.

The same rule covers each other edge. T before its S, Q before its T, W before
its R, or L before its W fails typed without mutation and succeeds exactly once
after the missing predecessor consumes. At the separate strict prefix, P with
a foreign AttemptId, the same P twice, or P before its exact strict position
returns `Option.none` at the cursor and `NoReport` from the optional observer
without taking another projection. An invalid call in one lane does not rewind
successful roles in another lane or add a cross-lane dependency.
Foreign interactions, already-consumed members, B Suspend before the
fourteen-node initial join, reactivation hints before the strict restart
return, and C Suspend before the twelve-node later join all fail typed without
consuming, publishing, or advancing anything.

Absolute non-arrival has no timeout meaning. If any active member never reaches
its existing boundary, that group stays current, publishes no occurrence, and
does not admit B Suspend. If one of the three strict restart projections, the
next graph result, or the strict activation return never arrives, that exact
strict position remains current and hints stay unavailable. If any later A/D
member never arrives, the twelve-node group remains current and cannot admit a
strict C Suspend successor. The amendment adds no timeout, sleep, yield, wait
policy, poll, retry scheduler, or second concurrency authority. Deterministic
tests inspect cursor position and occurrence count directly.

The matcher remains process-local to one cursor scope. If Scope 1 consumes any
proper non-empty subset of either group and closes normally, Scope 2 creates a
fresh cursor from the same authored story with every role in that group
outstanding. No consumed role, permit, position, or completion occurrence
crosses the scope boundary. A fresh cursor also restarts the surrounding strict
projection and activation-return positions from the authored story. This
proves cassette component replacement. Production restart remains owned by the
Journal, tracker, Git, executor, and process-scoped passive observer described
above.

Completion keeps the already accepted publication trade-off: the final claim
updates matcher state, advances once, and invokes `onOccurrence` while holding
the existing uninterruptible one-permit transition. A strict successor that
arrives while publication is blocked cannot overtake it. The callback remains
non-reentrant and must not call another consuming operation on the same cursor.
Holding the permit may delay local interruption through callback completion;
that bounded cassette-only cost remains preferable to losing or reordering the
single completion occurrence. The exact current-result handoff deliberately
extends that same protection to waiting for the permit: once the validated R
handoff begins, interruption cannot strand the result before its state change
or publication.

### Maintainer-visible success, block, and failure

On success, the maintainer sees the fourteen initial active roles consume in any order
allowed by their three lanes, one group occurrence publish, and B Suspend
become the next exact strict item. After restart, the maintainer sees the
startup graph, exact strict P_A, P_C, and P_D, the next graph, and the exact
#268-owned
`CoordinatorActivationReturned(RunMustRemainActive(UnsettledResponsibility))`.
Only then do reactivation hints become current. On the later refresh, the
maintainer sees all twelve A/D roles consume in one of 924 valid orders and one
group occurrence publish, then sees the one strict constrained C Suspend.

On a block, the current exact projection, group member, join, or activation
return remains outstanding and its successor is unavailable. Elapsed time,
another lane's progress, and another task's identity do not repair it. On an
authored group-member or activation-return mismatch, the maintainer receives
the existing typed cassette failure with cursor position and identity
unchanged. An optional projection mismatch instead returns `Option.none` at the
cursor and `NoReport` at the observer, also without advancing. On an underlying
authority failure, the existing production failure remains the result and no R
is fabricated. These are test-maintainer outcomes only. Alice and every target-
application user see no new command, UI state, provider request, task order, or
runtime API.

### Exact schedules and rejected alternatives

The active graph has exactly `14! / (6! * 2! * 6!) = 84,084` topological
orders. Direct evidence constructs the three canonical lane sequences,
enumerates every disjoint interleaving, proves 84,084 unique fingerprints, and
executes every one deterministically under the repository's normal test bound.
This is larger than the earlier 70-order draft but still bounded enough to
prove the exact active cut without scheduler timing.

The later A/D graph has exactly `12! / (6! * 6!) = 924` topological orders.
Direct evidence constructs the two canonical lane sequences, enumerates every
disjoint interleaving, proves 924 unique fingerprints, and executes every order
deterministically under the normal test bound. Each run consumes all twelve
roles once, preserves exactly ten direct edges, publishes one occurrence after
the twelfth member, and does not admit strict C Suspend early.

The schedule/schema evidence includes three maintainer-visible negative
controls. Deliberately dropping one direct A/D edge must make the expected-edge
and early-successor property fail. A generated duplicate role and a generated
dangling/invalid predecessor must each fail schema decoding before playback.
The same controls apply to the initial fourteen-node fixture. They prove the
enumerator and schema gates are collected and non-tautological. Sampling is
rejected because all 924 schedules fit the repository's normal bound.

A different strict reorder is rejected. Putting all of A before C or D repeats
the observed defect; reversing task order merely reverses false edges; and a
hand-authored alternation invents others. A flat unordered bag is also rejected
because it would admit T before S, Q before T, R before Q, W before R, or L
before W.

A general story DAG or wider returned/control union is rejected because these
cuts have semantics for only the four closed interaction forms named above.
Arbitrary tags, nested groups, optional members, and control flow would need
new matching, validation, failure, authority, and presentation rules. Two
narrow existing-result cases cost more schema surface than the earlier R-only
draft, but they are the minimum that can state the production-proved authority
lanes without erasing result boundaries.

`ConcurrentTrackerReadBatch` is rejected for these cuts. It correctly owns an
exact selected-read/result batch where every pair must drain, but cannot expose
one task's T-to-Q transition while another T remains blocked and cannot
represent claim or Git members. Widening or nesting it
would conflate two established cassette phenomena and still need cross-
construct predecessor edges.

Adding an `OperationId`, attempt, or claim payload to R's key is rejected
because the existing result boundary supplies none of them. The narrower
tag-plus-task key accepts the trade-off that same-task duplicate results are
unrepresentable in one group; rejecting that ambiguous authored state is safer
than fabricating identity.

Keeping the argumentless `consumeTaskClaimRead` is rejected. With A and C
authority reads both selected and in flight, C may complete before A even when
R_A appears first in the authored member array. A consumer that claims the next
enabled current-return can cross-deliver C's completion to R_A, falsely advance
A's lane, and leave C's real R outstanding. Peeking at the story or enabled
member before a later exact claim is also rejected because another completion
can change matcher state between those operations. One atomic tag-plus-branded-
task claim under the existing permit is the smallest contract that preserves
truthful reverse completion.

Keeping argumentless `consumeExecutorProjection` is rejected because the exact
requested AttemptId is already available and the strict story must not
cross-deliver a neighboring projection. Conversely, putting the projections in
the concurrent group is rejected by the executing-restart probe: they form the
observed strict startup prefix A then C then D for this exact authored fixture,
and blocking A blocks C, D, and the next graph read. This records no reusable
task-priority or FIFO production rule. Removing the process-global attachment
gate is also rejected: the amendment records current behavior and has no
authority to widen executor projection concurrency.

Authoring any S/T/Q/R/W/L group between the executing-restart graph and return
is rejected because `bb40c4c8c` observes zero such selections. A permissive
group there would not merely remove false order; it would require interactions
the production run never performs and block the truthful strict return.

Reusing the existing cursor permit and completion publication is preferable to
a second queue or scheduler. It preserves one transition owner and the accepted
non-reentrant callback constraint. The trade-off is local serialization of the
few matcher updates, not production serialization. No production authority,
Journal fact, derived frontier, resource position, or provider request is
added or persisted.

### Accepted scenario-to-test mapping

The following names are the direct implementation evidence for the accepted
amendment. Rows explicitly assigned to downstream #268 remain pending and are
not claimed as #309 implementation evidence.

| Chronological result | Current executable proof or downstream status |
|---|---|
| The closed four-case member union decodes exact noncausal selections, Begin/Executing responses, exact specification results, and exact current-claim results; encode/decode preserves every valid member and edge | `packages/dalph/test/cassettes/authored-domain.test.ts` — `accepts the four exact interaction forms in a causal concurrent group`; `packages/dalph/test/cassettes/authored-domain.property.test.ts` — `roundtrips every closed causal group member and predecessor graph through the story-item boundary` |
| Duplicate tag-plus-TaskId T/R keys even with different outputs, unsupported returned/failure/control tags including executor projections, causal selections, invalid executor members, batches, and nested groups fail decoding | `packages/dalph/test/cassettes/authored-domain.test.ts` — `rejects ambiguous specification and claim keys and every unsupported grouped interaction`; `rejects causal selections and non-Begin-Executing reports inside a concurrent interaction group` |
| One task's exact T consumes through `consumeTaskWorkSpecificationFor` and enables only its Q while another task's selected specification result is Deferred; foreign, early, and duplicate task results fail without mutation | `packages/dalph/test/cassettes/scenario.test.ts` — `lets A reach claim while an independent grouped specification result remains in flight`; `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `claims exact specification and current-claim results once without crossing task lanes` |
| After Q, a blocked controlled `currentObservation` leaves exact R, occurrence, and position untouched; authority failure or interruption while that Deferred is blocked fabricates no R | `packages/dalph/test/cassettes/scenario.test.ts` — `does not fabricate an exact current-claim return before controlled authority success`, with deterministic result, failure, and pre-result-interruption cases |
| One `Effect.uninterruptibleMask` restores interruptibility only around the authority read; before-result interruption leaves R outstanding, while post-validation interruption blocked on permit/publication is delayed until exact R publishes once and retry fails duplicate | `packages/dalph/test/cassettes/scenario.test.ts` — `does not fabricate an exact current-claim return before controlled authority success`; `delays interruption after exact validation until the masked current-claim handoff publishes once` |
| With A/C or later A/D claim reads both selected and in flight, deterministic tables release each pair in both orders; each exact result claims only its own R once, never cross-delivers, and its group advances only after both exact chains complete | `packages/dalph/test/cassettes/scenario.test.ts` — `correlates both completion orders of in-flight current-claim results with their exact group roles` |
| Ordinary strict current returns move to the truthful post-result point; strict explicit `TaskClaimReadReturned` and `TaskClaimReadFailed` retain no-preliminary-read semantics; all strict and residual callers migrate to exact task-aware cursor operations | `packages/dalph/test/cassettes/scenario.test.ts` — `does not fabricate an exact current-claim return before controlled authority success`; `preserves exact-task explicit and unreadable strict claim-read cassette semantics`; `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `consumes the authored cursor's optional and terminal public probes` |
| The active cut is exactly two six-node unchanged-task chains plus B's two-node specification lane, fourteen nodes and eleven edges; 84,084 canonical fingerprints are unique and every schedule consumes before strict B Suspend | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `partitions all 84084 active-refresh orders by three canonical lane positions`; 31 executable cases named `executes bounded B-position chunk 1 of 31` through `executes bounded B-position chunk 31 of 31` under the `consumes every active-refresh specification-to-lineage order before B Suspend` suite |
| Production suppresses B Suspend while either healthy A/C authority lane remains, then exposes exactly one constrained B1 Suspend after both settle | Commit `5578b8daa8778e98a14f9a61e93dd2cf393d69ce`, `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts` — `settles A then C lineage before exposing exactly one constrained B F2 suspension`; `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — the 31 executable `executes bounded B-position chunk 1 of 31` through `executes bounded B-position chunk 31 of 31` cases |
| The later post-hint cut is exactly two independent six-node A/D chains, twelve nodes and ten edges; all 924 canonical fingerprints are unique and execute before strict C Suspend | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `partitions and consumes all 924 post-hint A D authority orders before C Suspend` |
| Dropping one required edge makes the expected-edge/early-successor property fail, while generated duplicate roles and dangling predecessors fail schema decoding for the fourteen- and twelve-node fixtures | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.property.test.ts` — `detects every missing direct edge and the newly early successor in the initial A B C authority cut`; `detects every missing direct edge and the newly early successor in the later A D authority cut`; `rejects generated duplicate roles in the initial A B C authority cut`; `rejects generated invalid predecessors in the initial A B C authority cut`; `rejects generated duplicate roles in the later A D authority cut`; `rejects generated invalid predecessors in the later A D authority cut` |
| T-before-S, Q-before-T, R-before-Q, W-before-R, and L-before-W each fail typed without mutation and succeed after retry in the initial A/C and later A/D lanes; foreign and duplicate exact TaskId claims do the same | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `rejects and retries every predecessor edge in both active-refresh groups`; `rejects foreign and duplicate exact result identities without mutation` |
| Startup graph then strict P_A, P_C, P_D then next graph then UnsettledResponsibility is the exact restart; blocking A blocks the suffix, with exactly three Executing projections, no Begin/Resume/Suspend, and zero S/T/Q/R/W/L selections | Commit `bb40c4c8c`, `packages/dalph/test/scenarios/production.test.ts` — `completes the startup graph read then serially reattaches A C and D before the next graph read` |
| `consumeExecutorProjectionFor(attemptId)` atomically returns the current exact strict projection; a foreign, early, or duplicate exact AttemptId returns `Option.none`, and the controlled optional observer returns `NoReport`, without consuming a neighbor | `packages/dalph/test/cassettes/scenario.test.ts` — `fails closed at cursor and executor-projection boundaries`; `matches the strict A C D restart projection chain by exact AttemptId without command calls`; `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `keeps requested executor projections ordered even in a causal tracker story` |
| Simultaneously enabled S/Q and later cross-lane members consume once through the existing cursor permit; each active group's final member publishes once and advances once before its proved strict successor | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `serializes simultaneously enabled authority lanes and publishes each bounded join once` |
| Foreign, duplicate, premature B Suspend, premature restart hint, or premature C Suspend claims fail typed without mutation; non-arrival adds no timeout; scope replacement restores every group role and strict position | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `rejects foreign duplicate and downstream claims for both active cuts`; `keeps incomplete active cuts current without timeout`; `recreates every authority role after cursor scope replacement`; `packages/dalph/test/cassettes/authored-reactivation-return.test.ts` — `keeps restart hints unavailable before the production finality result` |
| Presentation renders the initial eleven and later ten direct edges, distinguishes same-lane transitive truth, presents every cross-lane pair as incomparable, and keeps exactly one cursor owner with exhaustive matches | `packages/dalph/test/cassettes/authored-presentation.test.ts` — `renders one causal interaction group without inventing claim order`; `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `partitions all 84084 active-refresh orders by three canonical lane positions`; `partitions all 924 post-hint A D authority orders by two canonical lane positions`; `packages/dalph/test/cassettes/authored-coverage.test.ts` — `registers the concurrent interaction group with exactly one cursor owner` |
| The accepted nine-node group still executes 22,680 schedules, and `ConcurrentTrackerReadBatch` still pairs reverse-completing reads and drains only its unchanged true-batch uses | `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `partitions all 22680 causal orders exactly once by their first enabled root`; `executes every causal order whose first enabled root is P_D`; `executes every causal order whose first enabled root is P_E`; `executes every causal order whose first enabled root is W_B`; `executes every causal order whose first enabled root is W_C`; `executes every causal order whose first enabled root is X_A`; `packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts` — `selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations`; `drains repeatedly forked exact read operations without resetting the story position` |
| The later A/D production overlap stays executable independently of cassette matching | Commit `c305b3543`, `packages/dalph/src/application/production-reactivation.test.ts` — `allows one restart authority lane to reach claim while independent specification reads remain in flight`; `allows one active-refresh authority lane to reach claim while independent specification reads remain in flight` |
| After the strict restart graph/projection prefix, exact `CoordinatorActivationReturned(RunMustRemainActive(UnsettledResponsibility))` settles before TrackerNotification or Timer hints; wrong, duplicate, early, failed, or interrupted returns do not fabricate settlement | `packages/dalph/test/cassettes/authored-reactivation-return.test.ts` — `keeps restart hints unavailable before the production finality result`; `settles the reconstructed restart return once before delayed interruption and later hints` |
| The role-generic production rule suppresses constrained C Suspend while either healthy A/D authority lane remains and exposes it exactly once after both settle | Commit `5578b8daa8778e98a14f9a61e93dd2cf393d69ce`, `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts` — `settles A then C lineage before exposing exactly one constrained B F2 suspension`; `packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts` — `partitions and consumes all 924 post-hint A D authority orders before C Suspend` |
| Capacity revision two must settle before process death, including the committed-but-unacknowledged counterexample; this remains a #268 blocker | No current executable test on this branch; downstream #268 owns this blocker. |
| Exact accepted and published C2 Safe ordinal two must settle before Continue B, including committed ambiguity without another Suspend; this remains a #268 blocker | No current executable test on this branch; downstream #268 owns this blocker. |
| After the nine-node prerequisite is composed, #268 uses the fourteen-node initial group then strict B Suspend, the strict executing-restart graph/projection/graph/return prefix with no authority group, and the later twelve-node A/D group then strict C Suspend; DS01–DS13 remain unchanged | Current downstream baseline: `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table`. No current executable test on this branch proves the pending #268 composition in this row. |

The accepted direct #309 tests own only the new member schema, exact
specification/claim/projection correlation, truthful claim-adapter sequencing,
lane graphs, matcher, failure/no-mutation, permit, scope, and presentation
behavior.
The unchanged downstream #268 test remains the sole full production-composition
proof. That composition remains pending; this amendment does not claim that
#268 passes and deliberately includes no #268 source or test composition.
