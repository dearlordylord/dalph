# Bound one Codex tool effect without losing its planned attempt

Issue: [#398](https://github.com/dearlordylord/dalph/issues/398).

Status: accepted executor scenarios on 2026-10-02. These chronologies specify
a runtime change; their test names below are required seams until implementation
provides passing evidence. The scenario document alone changes no runtime
behavior.

## Governing behavior

When an item limit expires, read [the exact Codex attempt and recovery
boundary](codex-app-server-executor.md#dalph-safely-suspends-and-later-resumes-codex-work)
and [cancellation of an unusable production
Run](cancel-unusable-production-run.md#stop-proof-remains-unavailable). This design refines the
executor's private handling of one owned Codex turn. It preserves the latter's
stop-proof and abandonment rules; exceeding a limit does not itself apply
Operator cancellation. The generic planned-attempt executor still exposes only
its existing executing, safely suspended, or terminal reports.

The [planned-attempt executor
boundary](planned-attempt-executor-boundary.md#dalph-and-the-controlled-fake-executor-restart-together)
and `plannedAttemptExecutor.everyCallHasOneDurableIntent` and
`plannedAttemptExecutor.beginTurnCrossesAtMostOnce` in
[the formal model](../../specs/plannedAttemptExecutor.qnt) govern generic
command/report correlation. [D16](../DELIVERY-INVARIANTS.md#preservation),
[D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), and
[D29–D31](../DELIVERY-INVARIANTS.md#process-and-durability) govern retained
work, stop intent, ambiguity, and recovery. This design preserves those rules
and adds only executor-private item limits; none gives an internal item a
workflow identity.

## Decision and limits

Codex's [app-server item notifications](https://developers.openai.com/codex/app-server)
identify one private item inside an owned turn. The Codex executor observes
`item/started` and `item/completed` for tool-effect items and
starts a monotonic timer for that exact `(app-server incarnation, thread,
turn, item)` identity. The authoritative `item/completed` event settles the
timer. A provider heartbeat, text delta, or another item's completion does not
reset it. The executor must also reconcile the exact turn and containment when
notification delivery is incomplete; it cannot infer completion from silence.
It persists the item start observation with its wall timestamp and incarnation
so restart can reconstruct an elapsed bound without resetting the timer; an
unreadable or reversed clock fails closed.

The default maximum for an individual tool item is **60 seconds**. Before
`turn/start`, a production configuration may name an exact command profile
with a larger maximum, up to **90 minutes**, for known long checks. App-server
exposes a command string and working directory, not a guaranteed executable
and argument array. A profile therefore matches the complete, canonical
command text and exact planned working directory. A shell script, JavaScript
tool call, substring match, or an item whose command cannot be decoded
receives the default. The profile is frozen for the attempt. An active item
cannot ask for an extension. The implementation
must reject nonpositive, unbounded, or over-maximum values at configuration
admission. A check that cannot be represented by an exact command item can be
run under a separately supervised gate; it receives no implicit exception.

Elapsed time is the enforced budget. Write count, byte volume, write rate, and
repeated text are retained as diagnostic evidence when cheaply available, but
do not decide safety: a finite generator can legitimately write a great deal,
and a harmful loop can repeatedly overwrite the same bytes. This policy does
not claim to decide semantic usefulness. The short default limits damage while
the explicit profile is the deliberate decision to allow a long operation.
The limit starts when the executor observes `item/started`; a missing start
notification cannot give an already running item a fresh 60 seconds after
restart. In that case the executor reconciles the turn from its retained
`turn/start` intent and provider history. If the provider history cannot prove
an item start time, the original turn-start time is the conservative deadline
anchor; the executor records a stop intent once that anchor's default limit
has expired. A malformed notification for an owned tool item also triggers
the stop path. Neither case grants a fresh allowance on restart.

On expiry, the executor durably records a private stop intent naming the owned
turn, item, containment incarnation, configured deadline, and reason before it
asks Codex to interrupt the turn or signals any process. It uses the existing
exact containment close and stopped-writer proof from #390, including resistant
descendants. If the provider interruption is unresponsive, containment close
still proceeds. It preserves the dirty worktree, rollout, and private evidence.
After conclusive stop, the executor retains an explicit private
`ToolEffectLimitReached` disposition. Its public passive projection is
`Unreadable` with a sanitized limit reason; the Journal's earlier executing
report remains the latest report until the Operator chooses cancellation or
another accepted action. It never turns a cut-off item
into a successful result, terminal failure, or safely suspended work by
elapsed time alone. An unavailable or contradictory stop proof retains the
responsibility and blocks replacement, release, and cleanup.

The executor owns all item names, timers, configuration and process evidence.
The orchestrator's Journal retains only its existing planned-attempt command
intent and observed executor report; it does not acquire item or review stages.
The exact worktree remains the sole target of the attempt. Any implementation
that cannot prove a containment boundary includes every tool writer must fail
closed at executor admission rather than treat process disappearance as proof.

## The self-matching edit keeps writing

Alice has started one Run and Codex has one owned turn for its exact planned
attempt and dirty worktree. The Journal records one Begin intent and an
executing report. Codex emits `item/started` for a JavaScript tool call. That
call repeatedly edits a file and recreates its own match; it emits no
`item/completed`.

At 60 seconds for this item, the executor records the private stop intent,
requests interruption, and closes the exact owned containment. It observes
every writer stopped before retaining the limit disposition. Alice sees an
unusable attempt requiring an explicit recovery choice and can inspect the
preserved worktree and evidence. She does not see a completed attempt. A later
Operator cancellation follows #390's separate abandonment and claim release.
The executor must not retry the JavaScript call, issue another Begin, or keep
the same writer active after claiming the limit was handled.

Acceptance seams: positive `cuts a self-matching Codex item at its exact
default deadline and retains dirty evidence`; independent negative `does not
reset the active item deadline on provider heartbeats or unrelated items`.

## A quiet long check has an explicit allowance

Alice's production configuration admits one exact `pnpm check:all
--candidate=<planned Base SHA>` command profile with a 65-minute item limit
before the turn begins. Codex starts that exact command item. It makes no
worktree edits for more than 60 seconds while a legitimate check runs. The
executor observes the same item and leaves it running within its declared
allowance. It accepts `item/completed` only for that identity and then resumes
ordinary turn observation. The gate's own custody and deadline remain
independent and may stop the check sooner.

The executor must not give the longer allowance to an arbitrary JavaScript
wrapper, a similar-looking command, another attempt, or an item whose
arguments cannot be decoded. It must not infer check success from quietness.

Acceptance seams: positive `allows the exact configured quiet check past the
default item deadline`; independent negative `rejects a wrapper and a
lookalike command from the long-check allowance`.

## A finite generator writes many bytes

Codex starts one generation item in the same worktree. It writes many files
quickly and emits its exact `item/completed` before 60 seconds. The executor
settles that item's timer and lets the turn continue. Git still owns the
resulting files; the executor does not treat write volume as terminal evidence
or discard the worktree. If generation needs longer, Alice must have admitted
an exact longer command profile before the turn; an in-flight request to
extend it has no effect.

Acceptance seams: positive `lets a high-volume finite item complete within
its declared time`; independent negative `does not extend an active item's
deadline after high-volume output`.

## A tool descendant resists ordinary termination

The item expires while a child capable of writing the worktree ignores ordinary
termination. The executor records stop intent, asks Codex to interrupt, then
requests containment termination and bounded forced escalation. It waits for
the execution substrate to prove the exact incarnation and every owned writer
stopped. Until then it retains the private stop intent and the generic
executor responsibility. A later successful proof records the limit
disposition; a missed grace period is a typed unresolved stop, never safe
suspension. The dirty files and transcript remain.

Acceptance seams: positive `escalates a resistant tool descendant and proves
the exact writer set stopped`; independent negative `retains responsibility
when one resistant descendant survives the stop grace`.

## Dalph crashes after recording stop intent

The private stop intent is durable, but Dalph dies before or during provider
interruption and before the stopped-writer observation. On restart, the same
planned attempt and private record are reopened. The executor does not start a
new turn or replay Begin. It reconciles the exact containment incarnation,
repeats only the idempotent close needed to finish that intent, and records a
stop observation only after the execution substrate proves it. The Journal
still has the original attempt responsibility and no fabricated report. Alice
sees a pending recovery or its resolved limit disposition.

Acceptance seams: positive `reopens a durable item stop intent and finishes
exact containment close without another Begin`; independent negative `does
not restart the item when the prior interruption response was lost`.

## Restart sees contradictory process evidence

On restart, the private stop intent names incarnation X, but the process
census reports a reused PID, an unexpected surviving descendant, or an
unreadable member. The executor records the contradiction and leaves the
attempt unresolved. It retains the claim, responsibility, dirty worktree and
evidence. Alice sees the exact stop-proof blocker. Another passive read or
Operator cancellation may reconcile it through #390; neither retries the
tool nor allocates replacement work before proof.

Acceptance seams: positive `keeps a contradictory retained item stop pending
with its exact worktree and claim`; independent negative `does not treat PID
absence or reuse as stopped-writer proof`.

## Implementation order and proof boundary

1. Add a private item identity, immutable per-attempt limit policy, and
   durable stop-intent/observation records to the Codex executor store. Prove
   the six scenarios above with a controlled clock, app-server notifications,
   and a replaceable execution-substrate census.
2. Wire item notifications and exact profile decoding through the Codex
   app-server adapter. A lost or malformed notification must fail closed.
3. Reuse #390's containment close and recovery path. Prove the resistant
   descendant and crash-prefix cases with real disposable processes on each
   supported host. A host unable to prove complete tool-writer containment
   cannot enable the runtime limit feature for production.
4. Run each focused positive and independent negative test above, the existing
   #390 cancellation and Codex executor suites, and `pnpm check:fast` on the
   coherent implementation. A complete test mapping and scoped review close
   before a runtime handoff. The full local gate remains an explicit
   maintainer diagnostic under the current check policy.

This design does not change Dalph runtime behavior by itself: it adds only a
specification and prospective test seams. The implementation must establish
passing evidence before the issue can claim runtime containment.
