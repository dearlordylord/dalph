# Alice replays one complete seven-task Run

## Governing behavior

[#337](https://github.com/dearlordylord/dalph/issues/337) composes
[#256](https://github.com/dearlordylord/dalph/issues/256), including its
superseding autonomous-work/ordinary-refresh amendment, for #279. It changes
cassette evidence only. The production workflow, tracker authority, cleanup
protocol, and canonical passive status remain unchanged. #338 owns status
wiring, Reducer Lab, and the browser checkpoint.

Alice begins with five open tasks and capacity three. The exact chronological
starting facts, triggers, outside boundaries, visible results, and forbidden
outcomes are [the 22 delivery beats](../DELIVERY-STORY.md#the-beats), read with
#256's superseding amendment. Executor reports do not request graph reads or
repeat executing work. The final graph proves lifecycle success, never claims.

The authored runner starts with an empty Journal and uses one Run identity.
Alice changes B's instructions, lowers capacity, later continues B, reopens C,
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

When Dalph has recorded B or C's Suspend call but the executor has not replied,
the accepted journal still requires that attempt's position. Likewise, B's
accepted Resume and A's acquired integration target have exact committed cuts
before their next boundary. When Alice lowers capacity to two, the journal
records the new limit while A, C, and D still hold three positions; it must not
evict any of them. These cuts need not have a separate Delivery publication.
DS04, DS07, DS10, DS13, DS14, and DS21 use exact committed journal
checkpoints, canonical position/capacity reconstruction, and the prepared
trace's graph evidence. DS21 follows both E/F/G's accepted Begin reports and
A–D's settlements; admission does not wait for those settlements. DS18 uses
the actual G4 revalidation publication immediately before the authored await
marker. Other rows use actual captured publications; DS08 uses the actual
old-process owner-close interval. DS22 keeps its settlement publication and
separately checks the first actual capture where the exact settlement owner
has been removed, before Gfinal. An intermediate settled owner remains visible
until that removal; any other owner at the removal cut fails the empty-owner
assertion. No missing publication is
replaced with an invented frame or a later matching state.

| Outcome | Test in `issue-337-capstone.execution.test.ts` |
| --- | --- |
| One exact DS01–DS22 state table, identities, order, and counts | `maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` |
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

## Implementation checkpoint

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
declaration remains exactly 402 items (92,350 serialized bytes with the same
declaration digest). Final whole-candidate qualification and integration remain
pending. Coverage qualification remains with the user-authorized separate
handoff and is not rerun here.
