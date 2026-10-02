# Alice replays one complete seven-task Run

## Governing behavior

[#337](https://github.com/dearlordylord/dalph/issues/337) composes
[#256](https://github.com/dearlordylord/dalph/issues/256), including its
superseding autonomous-work/ordinary-refresh amendment, for #279. It changes
cassette evidence and the replacement admission repair described below. Tracker
authority, cleanup protocol, and canonical passive status remain unchanged. #338 owns status
wiring, Reducer Lab, and the browser checkpoint.

Alice begins with five open tasks and capacity three. The exact chronological
starting facts, triggers, outside boundaries, visible results, and forbidden
outcomes are [the 22 delivery beats](../DELIVERY-STORY.md#the-beats), read with
#256's superseding amendment. Executor reports do not request graph reads or
repeat executing work. The final graph proves lifecycle success, never claims.

This capstone explicitly substitutes for canonical beats 12–13: it restarts
B's suspended P1/F1 from the observed F2 specification, preserves P1/W1/K1
while B waits for capacity, then reconciles and begins P2/F2 after A becomes
terminal. `DELIVERY-STORY.md` and the separate controlled DS01–DS13 Continue
proof still describe B continuing and resuming its original attempt.

The authored runner starts with an empty Journal and uses one Run identity.
Alice changes B's instructions, lowers capacity, then restarts its safely
suspended F1 attempt as one F2 attempt at the observed target head. The new
attempt waits while A and D occupy the two slots; after A becomes terminal,
the runner reconciles and begins the F2 worktree once. P1, W1, K1, and the
existing work remain preserved. The production admission repair requires the
replacement's `ReconcileTaskWorktree` proposal to reserve or reuse a task-work
position. Replacement provenance does not inherit a released predecessor slot:
while A/D hold capacity two, no successor Git reconciliation is admitted. After
A releases its position, successor reconciliation and Begin may proceed. The
same rule applies when admission is reconstructed after reopening; it preserves
the original attempt and its resources rather than evicting an existing owner.

The controlled planner's task-local Fresh identity and separate replacement
namespace are test-only options; production planner defaults are unchanged.
Alice reopens C,
raises capacity, and adds F/G. A's accepted result crosses the rejected exact
head offer and Alice's exact FullRerun choice. The successor is Git-qualified
and promoted before A's focused success and exact claim cleanup settle.

Before terminal proof, ordinary disposition cleanup reads only A's predecessor
candidate locator, owner, revision, and stopped-writer facts. Its removal loses
the response. A later exact absence read reconciles the mutation without
another remove. Predecessor history/evidence and the successor resource remain.
B–G each follow ordinary distinct integration and finality, not A's FullRerun.
After their exact terminal reports release positions and all seven deliveries
settle, one later post-quiescence Gfinal read precedes one Completed record.
No application Exit is requested.

## Scenario-to-test plan

When Dalph has recorded B1 or C's Suspend call but the executor has not replied,
the accepted journal still requires that attempt's position. B's P1-to-P2
replacement has an exact committed cut; the P2 capacity wait is checked from
the actual pre-A-terminal publication and owner view, then P2's accepted Begin
has its own committed cut. A's acquired integration target also has an exact cut
before their next boundary. When Alice lowers capacity to two, the journal
records the new limit while A, C, and D still hold three positions; it must not
evict any of them. These cuts need not have a separate Delivery publication.
DS04, DS07, DS10, DS12, DS13, DS14, and DS21 use exact committed journal
checkpoints, canonical position/capacity reconstruction, and the prepared
trace's graph evidence. DS21 follows both E/F/G's accepted Begin reports and
A–D's settlements, and precedes F's terminal report; admission does not wait
for those settlements. E's independent terminal report may already be accepted
at this cut. If so, E has released its position but remains a retained
integration obligation; otherwise E still holds its position. F and G remain
held in either chronology. This fixture-only correction changes no Dalph
runtime behavior. DS18 uses the actual G4 revalidation publication immediately
before the authored await
marker. Other rows use actual captured publications; DS08 uses the actual
old-process owner-close interval. DS22 keeps its settlement publication and
separately checks the first actual capture where the exact settlement owner
has been removed, before Gfinal. An intermediate settled owner remains visible
until that removal; any other owner at the removal cut fails the empty-owner
assertion. No missing publication is
replaced with an invented frame or a later matching state.

The runtime admission boundary is independently proved by
`packages/orchestrator/src/coordination/run/fresh-workflow.test.ts`:
`continues a valid restarted replacement successor without resurrecting its original fresh commitment`.
It rejects successor reconciliation at full capacity in initial and reopened
admission, then admits it after A releases its position. The complete-story DS12
check proves the actual pre-A-terminal B2 capacity wait with A/D as holders;
DS13 proves B2 Begin after A terminal and before A queues for integration.

| Outcome | Test in `capstone.execution.test.ts` |
| --- | --- |
| One exact DS01–DS22 state table, identities, order, and counts | `maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` |
| Exact F1-to-F2 Restart, one replacement, preserved P1 responsibility, capacity wait, and one P2 Begin/finality | `maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` |
| Exact predecessor-only cleanup, response-loss reconciliation, preserved history/evidence | `completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup` |
| Deterministic replay of the same declared chronology | `replays the maintained capstone with the same exact chronology` |
| Honest catalog and document publication | `delivery story manifest names the executed capstone and contains no unsupported beat` |

The authored harness has these focused acceptance checks. An owner starts with
the application process, consumes only explicitly authored notifications, and
ends with that process. A generic death between boundary calls waits for any
in-flight operator command to finish; an after-journal death remains owned by
the exact append callback. Neither death is a workflow Journal occurrence.

| Harness scenario | Focused test |
| --- | --- |
| First notification arrives after initial execution, without a preceding crash | `authored-owner-lifetime.test.ts`: `installs one owner before a later explicit notification without inventing a startup notification` |
| Declared death occurs after an activation returns, then a new process receives a later timer | `authored-owner-lifetime.test.ts`: `consumes each idle-boundary process death once before installing the next owner` |
| A provider-boundary mismatch is a defect, not permission to restart | `authored-owner-lifetime.test.ts`: `propagates an unrelated authored boundary failure without restarting its owner` |
| Predecessor candidate removal loses its response | `authored-candidate-cleanup.test.ts`: `reconciles one lost FullRerun predecessor removal through fresh absence and settlement` |
| Cleanup revision provider names a foreign predecessor | `authored-candidate-cleanup.test.ts`: `refuses a revision read for a different predecessor session before authorization or mutation` |
| The same settlement owner is first settled and then actually removed | `delivery-capstone-owner-removal.test.ts`: `selects exact removal after the same owner's settled snapshot` |
| Settlement has been recorded but its action owner has not yet closed | `delivery-capstone-owner-removal.test.ts`: `does not mistake same-ID settled lifecycle for owner removal` |
| Exact owner disappears while a different owner remains | `delivery-capstone-owner-removal.test.ts`: `does not skip a foreign remaining owner to find a later empty capture` |
| Owner removal is missing or belongs to a replacement activation | `delivery-capstone-owner-removal.test.ts`: `fails closed when no removal capture exists`; `does not accept removal from a replacement activation` |

The existing #274–#278 tests retain their boundary-specific crash and negative
controls. This composition does not replace their independent evidence. In
particular, restart preserves C's original attempt and reconciles pending
commands, A's predecessor cleanup never deletes history/evidence, a crash after
Gfinal requires another later read, and lost termination acknowledgement never
authorizes another append. No synthetic crash occurrence enters the Journal.

## Historical implementation checkpoint

The receipts below describe an earlier fixture revision, not current-candidate
proof. Its 402-item and 15-activation totals are historical measurements, not
acceptance requirements. Current proof checks the complete authored occurrence
inventory, one Run identity, chronological checkpoints, settlements, and Completed
termination.

The harness starts the existing production owner from process entry and
rebuilds it only at the declared process cut. The focused owner, causal-sync,
cleanup, playback, observation-chronology, and prepared-reader checks pass
(27 tests across six files). Before the independent checkpoint, cleanup, and
replay assertions were added, the public execution test passed: 402 exact
authored occurrences, 15 activations, seven distinct
settlements, A's qualified FullRerun successor, two separate Gfinal reads, and
one later Completed record. No extra crash or forged return is needed.

The expanded public acceptance suite now passes all three tests. It checks all
22 chronological checkpoints, exact predecessor cleanup and seven-task
finality, and complete normalized semantic equality across two actual fresh
Runs. DS22 independently correlates the last settlement owner and checks its
exact removal; its intermediate `SettledBeforeMaterialization` capture remains
part of the replay. Candidate identities normalize only their fresh Run atom
at the two source-defined identity fields, preserving task/revision and
malformed or foreign identity distinctions. Sealed manifest hashes are
independently verified, not discarded for comparison.

Five cheap owner-removal controls and three identity controls also pass. The
development fast gate passes across 930 files with zero diagnostics. These are
scoped receipts, not a claim that final whole-candidate qualification passed.
Truthful catalog/manifest publication is implemented, and all three
delivery-story link tests pass. The complexity-only E/F/G profile refactor also
passes the six focused owner/capstone tests without acceptance weakening; its
declaration at that historical revision remained exactly 402 items (92,350 serialized bytes with the same
declaration digest). Final whole-candidate qualification and integration remain
pending. Coverage qualification remains with the user-authorized separate
handoff and is not rerun here.

## A bounded return keeps its exiting activation identity

The maintainer replays the accepted ten-task cassette through the same
process-owned Run owner. No person triggers these individual controlled steps.
B/C recovery and A/B/C/D/E settlement already happened; F and X have their
original attempts and current claims, and their executor sessions still owe
terminal reports. The current activation has read its one post-quiescence
complete graph. The controlled executor then publishes X's and F's exact
Accepted reports, and Dalph reads F's and X's current claims. The journal keeps
both accepted-result integration responsibilities unsettled.

Dalph's current activation returns `RunMustRemainActive(UnsettledResponsibility)`.
The cassette's paid graph selection independently declares
`expectedBoundary: CoordinatorActivationReturned` in its causal anchor. The
adapter checks that declared return at the actual exit, then queues the exit
with its original activation ordinal. The owner may admit a trailing entry before the exit consumer
runs; the consumer records the return with the exit's original ordinal. The
next queued ordinary activation reads the current complete graph,
check F/X claims again, read the later complete graph, and integrate F then X.
The maintainer sees activation 7's return followed by activation 8's graph and
claim calls. Removing the return marker must fail at the next authored
Dalph selection; the adapter must not silently discard an exit that precedes
an owed boundary call or attribute it to the successor activation.

Some owner exits happen while the cassette is waiting at an operator command,
explicit hint, process death, or terminal assertion. An active-work refresh
can also return after its graph read before a queued ordinary entry reads
its own graph. Those seams may leave their finality reason unasserted. The
post-quiescence case above explicitly declares its owed return on the paid
graph selection. The passive Accepted reports follow that graph and still
require a later activation graph; removing the return marker therefore leaves
the independently declared return obligation unsatisfied. This preserves the
same chronology under master's `bf027ef15` return-ownership implementation.
The controlled responses are definite; there is no added crash or provider
retry, and this amendment changes cassette validation only, not the Dalph
workflow or outside-system protocol.

| Scenario outcome | Acceptance test |
| --- | --- |
| Paid graph, exact X/F acceptance and current claims precede activation 7's return; fresh activation 8 facts precede F/X finality | `double-diamond-activation-chronology.test.ts`: `returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts` |
| Missing return fails at its exact next owed graph selection | `double-diamond-activation-chronology.test.ts`: `rejects omission of the actual double-diamond activation return before its owed next graph` |
| Unasserted idle exits and declared process loss remain valid owner seams | `authored-owner-lifetime.test.ts`: `consumes each idle-boundary process death once before installing the next owner` |
| The uninterrupted capstone retains its actual owner chronology | `capstone.execution.test.ts`: existing three public acceptance tests |


## Controlled original and replacement identity

The controlled first admission plans B at task-local Fresh slot zero, independent
of cross-task arrival order. That exact P1/F1 remains immutable through Suspend
and Restart. The planner uses a separate replacement namespace for Restart:
`attempt:B:0` is original P1/F1, and `attempt:B:replacement:1` is P2/F2 at H2.
The latter has its own branch and worktree, while exact slot/Base/specification
replay returns the same successor identity. Production planning and default
controlled planners are unchanged. This is a test-boundary identity refinement,
not permission to replace an immutable plan or bypass Restart validation.
The accepted capacity barrier is unchanged: P2 waits while A/D occupy both slots;
after A terminal, it reconciles and Begins exactly once.

Focused mapping: `plan.property.test.ts::keeps replacement slot one distinct
from an initial task-local B slot zero` proves original/successor identities,
exact F2/H2, distinct resources and same-request replay. Existing default
replacement property controls remain; `restart.test.ts::rejects a replacement
when the planner returns a non-distinct successor` remains the negative boundary.
The full capstone's capacity/finality checks remain required separate evidence.

### Controlled Fresh identity arrival order

The capstone planner assigns Fresh identity slots independently for each task.
B and C both receive slot zero whether B or C reaches planning first. A Restart
uses the distinct replacement namespace and durable slot one, retaining exact F2
and Base authority. The default planner continues to use its existing Run-wide
Fresh ordinal. This controlled identity choice changes no production workflow
behavior or capacity barrier. Opposite-order controls in `plan.property.test.ts`
prove both B/C arrival orders and replay of the exact Restart successor.

## Concurrent controlled Git lineage reads

The capstone's test-only Git service binds each ordered response queue to its
exact immutable attempt. Independent attempts can observe different target heads
in either arrival order without consuming each other's facts. Within each attempt,
the accepted continuation, Restart or integration stage consumes the next exact
Base/head observation. Missing responses, wrong Bases and unconsumed responses
reject the cassette. `authored-target-lineage.test.ts` covers opposite order,
same-Base/different-head ownership and fail-closed consumption. This changes only
controlled test evidence; production Git services remain unchanged. A FullRerun
keeps A's H1 Base and observes H2 in A's fourth stage. Original B's Restart
observation belongs to B:0; its replacement owns a separate H2 queue.

The controlled baseline adapter reads the shared local target head using the
fixture's pinned observation Base. That Base belongs to the test Git provider;
it does not replace the successor attempt's immutable H2. Baseline tests in
`authored-target-lineage.test.ts` prove a replacement with a different Base can
read the current head, while an unreadable pinned observation remains a wait.
C's capacity-return specification/claim/worktree chain keeps its exact
AttemptContinuation graph authority from the safe-revalidation marker. The
later empty WorkflowEstablishment graph cannot replace that predecessor; the
positive/negative control is in `capstone-post-return-causality.test.ts`.

Within the current-head group, multiple facts for one immutable Base must agree
on ancestry. Identical facts retain their declared multiplicity and consume only
once per read. Conflicting same-Base/head ancestry facts reject without advancing
the group. The two corresponding `authored-target-lineage.test.ts` controls
prevent Base matching from silently choosing between contradictory results.
