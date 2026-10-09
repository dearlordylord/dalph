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

Only requestSuspension and observation for the owning Suspend command retire
items. Passive observation never turns old historical evidence into authority to
signal a later writer. An unresolved historical item makes observation Unreadable.
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
recover a Started item's launch, or the launch of a later interrupted turn that
had no tool item. Contradictory exact-incarnation history is rejected. History is
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
