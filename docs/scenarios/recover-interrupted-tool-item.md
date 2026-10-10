# Recover an interrupted tool item before continuing its attempt

The owning coordinator reconciles its correlated Suspend command before admitting
Resume for the same planned attempt. This extends
[tool-effect containment](contain-non-converging-codex-tool-effects.md) and
[isolated containment](isolated-codex-containment.md) for the supported #495/#491
suspension/continuation composition. Tracker and Git still admit the workflow;
the execution substrate proves writer and independent storage custody.

## Boundaries and retained facts

An interrupted provider turn may retain a Started item because its completion
notification was lost. Stopping its containment does not mean the tool completed
and does not mean its limit expired. The private item's optional
`suspensionCustody` records these distinct facts as StopIntended then Stopped,
with the exact suspension turn and native launch. Started and LimitReached keep
their original dispositions, identities, timestamps and immutable deadline.
LimitReached remains a historical fence. No item receives a new allowance.

RequestSuspension and observation for the owning Suspend command retire
interrupted items. The exact recorded-Safe exception in L2 below also permits
ordinary destination observation to reconcile a late same-stopped-turn Started
append using fresh stopped-launch and independent storage proof, without any
signal. Passive observation never turns old historical evidence into authority to
signal a later writer. Other unresolved historical items make observation Unreadable.
Intent is appended before containment effects; stopped observations are appended
before Safe. Reopened reconciliation reads those destinations before another
idempotent native stop, which itself freshly observes exact launch identity,
process-group membership and launch-token descendants. The private storage lease
and its filesystem descriptors are independently revalidated around the proof.

Resume, guidance, replacement and terminal writer-custody observations freshly
reprove historical stopped launches. Retained timestamps are no admission
capability. If the old provider was stopped, Resume requires a successor provider
owned by the same reopened workflow. A stopped incarnation cannot host another
turn. If current custody or any old launch/storage observation is unavailable,
foreign or contradictory, no new writer or success observation is authorized.
Release and cleanup remain gated by the existing terminal writer-custody protocol.

Native launch history is read from the existing append-only private snapshots to
recover a Started item's launch and every exact launch retained by a Suspend stop
intent, including later interrupted turns with no item. All these launch
obligations remain in fresh admission, guidance, replacement and terminal proofs
after a newer turn is admitted. Contradictory exact-incarnation history is rejected. History is
never rewritten or used to infer that a process has stopped.

## Accepted chronologies and tests

All executor tests below are in
[codex-planned-attempt-executor.test.ts](../../packages/dalph/src/application/codex-planned-attempt-executor.test.ts).

| Chronology | Starting facts, trigger and required order | Tests and forbidden results |
| --- | --- | --- |
| 1. Interrupted item, safe suspension, continuation | One planned attempt, original Started item; owning Suspend persists intent, proves exact containment and independent storage, appends Stopped then Safe; successor provider freshly proves old custody before Resume. | `retires an interrupted item before same-attempt continuation and never renews its timer` asserts exact Run/Attempt/Worktree/Base, disposition and deadline, intent before stop before Safe before new turn. A controlled clock crosses the original deadline without another stop or new allowance. |
| 2. Expired item, aborted resumed turn | Reopen original LimitReached and later interrupted Running record; passive observation is Unreadable. Owning Suspend rechecks old and current launches, then Safe permits exactly one further Resume. | `reopens native LimitReached original item and aborted continuation through owning Suspend and Resume`, plus the Started variant, in [native recovery](../../packages/dalph/src/application/codex-tool-continuation-native.test.ts). Separate physical controller processes use native app-server transport, OS custody, filesystem locks and current-format private persistence. They retain one Run/Attempt/Worktree and exactly three authorized turns. No second Begin, claim or Run is issued. |
| 3. Uncertain/foreign/contradictory custody | At either Suspend or admission, proof is unavailable or disagrees. Owning observation stays Unreadable; Resume and guidance are refused. A later exact observation uses the same protocol. | `retained interrupted item blocks suspension and admission with … custody` covers unavailable launch, foreign item identity and storage. Store tests `fresh storage custody refuses missing, contradictory and released lease ownership` and `reads exact historical launch without clearing it and rejects contradictory launch history` cover independent proof. Existing negative controls below preserve replacement, shutdown and cleanup blocking. |
| 4. Crash during reconciliation | Crash after private Suspend intent, item StopIntended, native stop effect, item Stopped, or Safe append; reopen the same records and reconcile before retry. | `reopens tool suspension after … observation loss preserving …` covers all five cuts for Started and LimitReached. It asserts original deadline/disposition, retained fence, fresh stop before Safe and no extra turn/thread. Existing item-limit persistence tests cover the unchanged StopIntended → LimitReached boundary. |

The new durable boundaries are item StopIntended and Stopped metadata appends.
The existing private Suspend intent and Safe observation are also exercised.
Native stop is an uncertain effect, tested after effect/before item observation.
There is no new public event, claim, tracker mutation or Git effect, so crashes at
new journal/claim/Git boundaries are inapplicable. Notification replay after
retirement is ignored, preserving evidence; command replay freshly proves custody
without renewing deadlines. Existing Resume intent/turn reconciliation remains
responsible for ambiguous turn/start effects.

[Public native controls](../../packages/dalph/src/application/codex-app-server-public.test.ts)
include `escalates a real resistant writer and recovers after its leader exits
before close`, `revalidates exact descendant identities before stopping owned
activity`, `reconciles application lease owner identity before spawning`,
`classifies controlled Unix launch identity observations before replacement`,
and `reconciles controlled detached process-group ownership before close`.
The executor's `Suspend reconciliation rechecks stopped custody behind a retained
tool fence` and `item stopping never waits for an already admitted guidance
acknowledgement` preserve fresh proof and shutdown concurrency. The isolated
executor consumer suite preserves the outer workflow's report/custody behavior.

## Compatibility and production handoff

No journal event or private checksum-frame format version changes. Current-format
records without the additive metadata decode unchanged. Recovery appends through
the ordinary store API; it never edits historical frames, deletes fences or
fabricates Completed effects. An older runtime must not be used to continue a
newly retired item, because it does not understand the new stopped disposition.

The minimum runtime repair consists of the executor reconciliation/timer logic,
private store typed evidence and launch-history/storage-proof methods, and native
app-server proof methods. Publication does not replace a running host's source.
Parent #501 must pin the accepted commit in an isolated runtime, perform combined
`check:submit` and #491 acceptance, safely stop the original owner, then reopen the
same Run/private namespace and reconcile the owning Suspend before Resume.
StartWork cannot discharge this retained executor responsibility.

The physical fixture uses a small local protocol provider, not a model or live
tracker. Its native process view is limited to its disposable child containment;
resistant-descendant proof is covered separately by the existing physical control.
The leaf does not claim production #491 recovery or full qualification. Candidate
SHA, terminal exits, log digests, failed diagnostics and fresh review closure are
retained in the leaf's candidate-bound evidence handoff.

The focused production build exposed TS7056 declaration-size errors in
`running-host-contract.ts`. Named codecs retain the same decoded and encoded
wire types and the same runtime schema objects; the envelope annotation retains
its original schema type. The focused Dalph build and running-host contract/HTTP
consumer tests cover this declaration-only prerequisite to pinning a real runtime.

The Started physical recovery case also stops a distinct successor incarnation
with a known Started item, appends a late unknown Started after Safe, exits that
controller and reopens again. An unavailable fresh read for that exact launch
blocks Resume without another turn; a later exact read retires the late suffix
and admits one fourth turn under the same attempt. The independent store test
`recovers no-item containment obligations from exact Suspend history and rejects
foreign queries` retains the no-item history ownership control. Tests `ignores a queued retired
item completion at … without an unreadable projection` enqueue early and expired
completions while Suspend holds admission; neither can alter retired evidence or
poison later observation. These repairs introduce no additional durable boundary:
they read existing stop intents and ignore already retired notifications.

## Owning Pause and fresh Unpause observations

The Operator applies whole-Run Pause at the owning host. This suffix preserves
chronology 2 and [whole-Run Pause](pause-whole-run.md): retained Executing
responsibility permits an exact Suspend request, never continuation or inferred
stopped custody. The executor still owns every native launch and independent
storage proof above. [D3](../DELIVERY-INVARIANTS.md#identity), [D31](../DELIVERY-INVARIANTS.md#process-and-durability),
and the existing suspension
and continuation protocols remain governing; this suffix adds no provider
allowance, task claim, Begin, Run, history edit, or synthetic completion.

**W1.** The original #495 planned attempt remains Executing after LimitReached
and an interrupted resumed turn. A correlated passive Unreadable observation
cannot erase that responsibility when the Operator applies Run Pause. Dalph
records exact Suspend intent, then the executor freshly proves and stops owned
launches, records Stopped, and only then reports Safe. Repeated Pause after Safe
cannot request another Suspend. Unpause requires fresh tracker graph,
specification and claim, plus Git worktree and lineage admission, before one
Resume of the same Run/Attempt/Worktree/Base. Foreign, contradictory, and
terminal evidence cannot provide suspension or continuation authority, including
when followed by another unreadable observation.

**W2.** #503 starts on Base `203235bcef8314b3938e45cb312f0302d58c01a7`.
Pause reaches exact Safe at position 6326, a passive observer publishes
TemporarilyUnavailable at 6327, and Unpause is accepted at 6328. Dalph requests
one fresh lifecycle attachment after that Unpause or a later owner activation.
A fresh unavailable or contradictory answer remains a wait with no command.
A freshly proved exact Safe answer clears the earlier unavailable projection,
even when it repeats the accepted lifecycle report. Dalph records the fresh
observation, not another distinct Safe report. Tracker and Git still admit the
same-attempt Resume. No new Begin is selected. Each completed attachment closes
before its publication can wake a successor owner; an old finalizer cannot
remove the successor's wait.

Crashes after Pause, Suspend intent, stop effect, Safe, and Resume intent reopen
the accepted history and reconcile the destination before retry. The tool's
original disposition, deadline and identities remain immutable. There is no
new tracker/Git mutation or public event type in this repair, so new mutation
crash cuts at those boundaries do not apply. Existing fresh admission reads
and executor stop/storage crash cuts continue to apply.

| Accepted outcome or cut | Focused acceptance evidence |
| --- | --- |
| W1: Pause selects exact Suspend across passive Unreadable; reopening Suspend intent stays valid | [recovery activation](../../packages/orchestrator/src/coordination/run/recovery-activation.test.ts): `lets owning Run Pause override an unreadable executor projection (Suspend intended: %s)` |
| W1: intent precedes executor call | [executor workflow protocol](../../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts): `records owning Pause suspension intent before contacting the executor after executing state becomes unreadable` |
| W1: foreign, lifecycle contradiction, terminal, and later unreadable evidence refuse both commands | Same protocol file: `owning Pause cannot suspend or resume after %s evidence even when followed by unreadable state` |
| W1/W2: outer cuts after Pause, Suspend intent, stop effect, Safe, Resume intent | Same protocol file: `reopens owning workflow after %s and reconciles before retrying the same attempt`; executor private crash cuts remain chronology 4 above |
| W2: stale unavailable, absent, unreadable and foreign projections get one read; a fresh negative answer refuses continuation and another read in that activation | Recovery activation: `refreshes stale passive … once after Unpause and refuses a fresh unavailable observation`; `does not schedule another passive executor read after an unresolved … projection` |
| W2: attachment closure, publication wake, successor ownership, repeated explicit wake | [passive observer](../../packages/orchestrator/src/coordination/run/passive-planned-attempt-observer.test.ts): `closes the old observer before publication wakes a fresh owner and preserves the successor wait`; `closes fresh unavailable and Safe attachments and rereads on each explicit wake`; existing fresh-process reattachment tests |
| W1/W2: physical stopped custody, same attempt, unchanged deadline, actual passive owner, owning planner, fresh tracker/Git admission, exactly one Resume, repeated Pause | Native recovery tests from chronology 2 now call [owning workflow composition](../../packages/dalph/test-support/owning-tool-recovery.ts), using the real native lifecycle observer and ordinary journal protocols. Tracker and Git reads use controlled providers; no live tracker is mutated. |

The physical fixture retains the original native private records across separate
controller processes; its public fixture begins with an accepted executing
chronology. It proves the outer recovery suffix, not reopening the production
#491 journal. Parent #501 must depend on this repair, wait for all original
leaves, qualify the combined candidate with `check:submit`, then pin a separate
runtime and reopen the original Run after proving only its own host writers
stopped. Leaf acceptance alone does not demonstrate production W1/W2 recovery.

## Late old-turn notifications after Safe (#505)

The provider may buffer a previously unknown Started notification while the
owning Suspend stops the exact launch and appends Safe. The lifecycle observer
must reread the current typed attempt under its admission gate before handling
that old-turn notification, even after Safe publication or observer closure.

**L1.** One Running attempt owns Suspend intent. A buffered old-turn Started
arrives after Safe: preserve its actual Started disposition, timestamp and
original policy deadline, append StopIntended and Stopped custody through the
store, and freshly verify the recorded stopped launch and independent storage.
Completed and Malformed late notifications cannot arm a timer, manufacture a
completion, or stop another turn. Once a successor turn is admitted, callbacks
for the retired turn have no authority over it. Closed attachments own no
notification consumer. Existing queued completed retirement controls remain.

**L2.** Reopen SafelySuspended with original LimitReached and current Started
already Stopped, plus unknown same-stopped-turn Started appended after Safe.
The outer journal may already contain an unsettled Resume intent (production
Resume7), with no response. Reconcile that command's destination through the
ordinary executor observation; do not issue a new Suspend, Begin, claim, Run or
Resume. The Safe record's exact recorded Suspend launch authorizes only fresh
stopped proof, never signalling. Append distinct item StopIntended before proof,
then Stopped after independent storage revalidation. The original disposition
and deadline remain immutable. Fresh Safe observation still reproves all old
launches before the owning workflow's tracker/Git admission permits continuation.

| Accepted boundary, crash cut or negative | Scenario-to-test manifest |
| --- | --- |
| L1: unknown Started, Completed and Malformed buffered under actual lifecycle attachment while Suspend holds admission; after Safe no timer/stop or unreadable projection | Executor: `binds queued unknown … notification to its suspended turn`; existing `ignores a queued retired item completion at … without an unreadable projection`; `closed old-turn attachment cannot stop an admitted successor on late notifications` |
| L2: reopen after late append, reconciliation StopIntended append, uncertain native proof, Stopped append, or fresh Safe observation; reconcile retained Resume destination without another command/turn | Executor: `reopens Safe late tool suffix after … before reconciling retained Resume` uses reopened checksummed native private storage at all five cuts and asserts fresh proof on retry, immutable Started/deadline, one thread/turn |
| L2: different turn/incarnation/correlation; live, foreign, contradictory or unreadable native proof; released or contradictory independent storage | Executor: `denies Safe late suffix continuation with … custody without signalling`; no additional stop, no Resume, retained Safe and Started evidence |
| L2: physical stopped-launch/storage proof for post-Safe unknown item and retained same-attempt continuation after controller exit | [Native driver](../../packages/dalph/src/application/codex-tool-continuation-driver.test.ts), exercised by both native recovery tests above: stop `known-current-item`, then append `late-after-safe` through store API after final Safe; Started reopens in the admit controller, unavailable native proof retains StopIntended then fresh proof admits the same attempt; LimitReached observes fresh Safe in the recovery controller |
| Outer admission and attachment closure/publication | Existing W1/W2 workflow protocol, recovery activation, passive observer and owning native composition mapping above |

No new public event, tracker/Git mutation or allowance is introduced. New
journal/claim/Git crash cuts are therefore inapplicable; the existing unsettled
Resume protocol owns its durable intent and reconciliation. Safe suffix recovery
uses recorded launch history, never generic Unreadable authority or death as
proof. Failed proof retains custody and denies continuation without signalling.

Root separately pins the published repair, proves original owner writers stopped,
and reopens the same production #491 Run to settle Resume7. Leaf tests cannot
claim that production recovery, #503 full native qualification, or #501 combined
`check:submit` has completed.
