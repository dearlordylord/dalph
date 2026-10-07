# Deliver every accepted runtime occurrence through a bounded mailbox

Dalph hands relation evaluations and exact action completions to one delivery
runtime consumer. A held consumer must backpressure producers instead of growing
an unbounded mailbox. No person sends mailbox messages directly; Alice sees
ordinary task progress, precise failure, or the existing Exit disposition.

Issue: [#414](https://github.com/dearlordylord/dalph/issues/414).
The accepted contract preceded implementation in commit
`d34370a0f`; the inspected original Base
`77c81ba4de4339d1b7d537e458fb62a3bfa62881` had an unbounded mailbox.
The integrated runtime now owns a scoped, suspending one-item mailbox. The
parent audit below changes this document only; application and test bytes remain
unchanged, so it cannot change runtime behavior.

## Governing behavior and boundary

Preserve [reactive delivery](run-reactive-delivery-actions.md), including exact
live ownership and journal-first recovery, and
[graceful application Exit](graceful-application-exit.md). Preserve D1 under
[identity](../DELIVERY-INVARIANTS.md#identity), D12–D15 under
[admission](../DELIVERY-INVARIANTS.md#admission-and-capacity), D16–D17 under
[preservation](../DELIVERY-INVARIANTS.md#preservation), and D21–D22 under
[ambiguity](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence).
The mailbox changes no workflow operation, durable fact, admission capacity,
cleanup disposition, or Run finality rule. It adds process-local backpressure.
The preserved admission decisions are constrained by
[freshTaskAdmission.qnt](../../specs/freshTaskAdmission.qnt):
`everyEntryWasWithinItsObservedCapacity`,
`ambiguousClaimIntentRetainsEntryReservation`, and
`responsibilityHandoffNeverCreatesAdmissionGap`. Preserved Exit decisions are
constrained by [applicationExit.qnt](../../specs/applicationExit.qnt):
`forwardOwnerRegistrationRequiresServing`,
`successfulExitRequiresRecoverableBoundary`, and
`exitNeverDisposesDurableWorkflowResources`. These existing models retain their
scope; they do not prove this whole runtime wait graph. The production-boundary tests below must prove it.

The inspected implementation is
[run-delivery-runtime.ts](../../packages/orchestrator/src/coordination/delivery/run-delivery-runtime.ts),
with [production runtime tests](../../packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts).
Its existing event algebra is `EvaluationChanged`, `ActionCompleted` (exact
proposal, Exit, publication proof and acknowledgement Deferred), and
`RelationFailed` (the original Cause). Keep that algebra.

## Installed API semantics and chosen bound

The installed `effect` is `4.0.0-beta.106`. Its local
`node_modules/effect/src/Queue.ts` is the API evidence: `bounded(1)` calls
`make({ capacity: 1 })`; `make` defaults to strategy `suspend` and does not
acquire a scope or register shutdown. `offer` appends to the FIFO or suspends
in `offerRemainingSingle` when full. `takeUnsafe` removes the oldest message
and calls `releaseCapacity`, which admits suspended offers in registration
order. Interruption removes the suspended offer entry. `offer` returns a
boolean: a closed queue returns false, not an accepted occurrence.
`shutdown` clears buffered messages, resumes blocked single offers with false,
and interrupts open-queue takers. Shutdown is therefore abandonment at scope
closure, not a lossless drain or successful acknowledgement. `Deferred.succeed`
is single-assignment; waiting is interruptible in an interruptible fiber.

Choose one queued item with suspending offers and scoped ownership. The bound
limits queued messages, not the consumer's current item, pending completion
map, upstream stream buffers, or one suspended offer per active producer. Do
not claim a bound on all process memory. Sequential relation consumption stops
pulling more evaluations while its offer is blocked. Each admitted child offers
only one completion and then waits for acknowledgement. No dropping, sliding,
coalescing, unsafe offer, persistent queue, or configurable capacity is allowed.
The implementation must own queue closure and interrupt producer/acknowledgement
waits; it must never interpret a false offer as successful delivery.

## Causal wait analysis

The following lists every mailbox producer and runtime wait at the inspected
boundary. Progress assumes boundary services return or are interrupted, the
held consumer is released, and required accepted publications eventually arrive;
backpressure cannot make an unavailable outside authority succeed.

| Actor / boundary | Wait and held ownership | Edge that permits progress |
| --- | --- | --- |
| Initial attachment | `attachCurrentSignal` peels current; initial observation and admission synchronization precede the loop | No initial mailbox offer; attachment lifetime belongs to the phase scope |
| Relation subscriber | Sequential `Stream.runForEach` offers evaluations; `catchCause` offers the exact relation Cause | Neither offer holds `selectionGate`; subscription-ready Deferred is signalled before changes are pulled |
| Admission consumer | Sweep reserves and installs a child under the selection gate and uninterruptible reservation handoff | `installInterruptibleDeliveryChild` waits only for child readiness, grants `mayStart`, then yields; it never joins execution, offer or acknowledgement |
| Action child | Materialization and lease observation may acquire the selection gate; executor and `awaitJournalPosition` precede completion offer | Gate permits are released before offering; one completion is offered outside the gate, then the child awaits its Deferred |
| Accepted publication service | `awaitJournalPosition` captures the journal position, registers under its separate relation gate, then waits outside that gate | Reactive refresh sets its SubscriptionRef and completes publication waiters independently of runtime mailbox consumption |
| Runtime consumer | Admission sweep, quiescence classification, then `Queue.take`; capacity-wait freshness can call `awaitJournalPosition` before taking | Neither take nor freshness wait holds selection gate; producer offers do not require this consumer to finish a producer |
| Completion consumer | Applies under selection gate; success may enter `pendingCompletions` until accepted prefix and predecessor removal permit settlement | It returns to take more events without awaiting the child; evaluation application retries pending completions; acknowledgement happens after the gate is released |
| Interrupted child | `releaseInterruptedOwner` acquires selection gate and uses existing rollback disposition | Consumer interruption releases its permit; release does not await an offer, acknowledgement or child join |
| Phase closure | Scoped relation subscriber and interruptible children stop; standalone runtime releases integration targets and closes observation | No drain-before-interrupt or acknowledgement-before-interrupt requirement may be introduced |

Production publication evidence is in
[reactive-delivery-relations.ts](../../packages/orchestrator/src/coordination/delivery/reactive-delivery-relations.ts):
`refresh`, `completeCatchUpWaiters`, and `planningCatchUp.awaitJournalPosition`.
Runtime observation writes a SubscriptionRef in
[delivery-runtime-observation.ts](../../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts);
its optional observer is passive and production is inert by default.
The handoff readiness protocol is in
[delivery-child-handoff.ts](../../packages/orchestrator/src/coordination/delivery/delivery-child-handoff.ts).

Thus a full mailbox creates producer → free slot → consumer, with no reverse
consumer → that producer completion edge. A child awaiting the gate does not
hold the mailbox or gate. A child waiting for acknowledgement has already
released the gate and its offer. A pending completion frees the slot before
waiting for a future evaluation, so that evaluation can enter even at capacity
one. The freshness wait can complete through relation publication without
requiring the runtime subscriber's blocked offer to finish. No larger domain
bound or new scheduling policy is needed for these edges.

This proof forbids moving an offer under the gate, joining a child during
admission/settlement, waiting for an acknowledgement inside the consumer, or
making publication callbacks synchronously await runtime consumption. Controlled
observers used to hold the consumer must be released by the test coordinator,
not by a blocked producer. The join task must verify these assumptions in the
actual composition; a newly discovered reverse edge blocks implementation
until eliminated without changing workflow meaning.

## S1 — A held consumer backpressures relation evaluations

Starting facts: one phase has attached to a coherent current evaluation for the
exact Run and subscribed once. No new tracker edit, claim, Git mutation or
executor session is needed; fixed controlled facts suffice. The test holds the
consumer at its observation boundary while a single relation producer has a
finite sequence of distinguishable valid evaluations E1, E2, E3.

1. The producer yields E1; its offer succeeds into the one available slot.
2. It yields E2; its offer blocks while the consumer remains held. It cannot
   pull E3 or signal that E2's handoff succeeded.
3. The test releases the consumer. Taking E1 frees capacity for E2; successive
   takes allow E3. Record each applied evaluation occurrence, not just the final
   snapshot, and assert E1, E2, E3 once each in that order.

Alice's workflow outcomes remain unchanged; the producer now visibly waits at
the controlled boundary. Dropped, duplicated or reordered accepted occurrences
are forbidden. Independent completion producers may interleave; assert only
FIFO admission order and each producer's causal sequence, never a total order
between independently ready fibers. An accepted occurrence means a successful
true offer during the live phase; a suspended offer is not yet accepted.
Cancellation between steps 1–3 follows S4; process death discards this volatile
handoff and follows durable recovery, not mailbox replay. No retry of an
accepted offer or durable action is authorized by backpressure.

## S2 — Independent completions drain and acknowledge exactly once

Starting facts: distinct proposals A and B are already admitted with exact live
owners and ordinary reservations. Their controlled executors finish independently;
accepted publication proofs identify their own results. Hold the consumer and
fill its one slot with a relation occurrence before releasing both results.

1. Each child captures its exact execution Exit, obtains the required accepted
   publication proof on success, creates its acknowledgement, and offers one
   `ActionCompleted` outside the selection gate. Full-slot offers suspend.
2. Release the consumer. Each take admits another blocked offer. For a proof
   ahead of `latest`, the consumer retains the completion without acknowledging
   or joining its child, then takes the evaluation that catches up and removes
   the predecessor. Include this lagged-publication case, not just immediately
   settleable results.
3. Settlement validates Run/proposal identity, completes or rolls back the exact
   reservation, settles its owner, and succeeds that completion's Deferred once
   after leaving the gate. Each child returns only after that acknowledgement.

Assert one outcome/settlement per proposal, exact result identities, eventual
child termination, and no causal successor before predecessor acknowledgement.
No producer holds the selection gate while waiting for space or acknowledgement;
no consumer waits for a child it must acknowledge. Independent A/B order is
unspecified. Eventual acknowledgement is conditional on a live phase and the
required successor publication, not promised after cancellation or relation
failure. Those interruptions follow S3/S4 and preserve responsibility; they
must not fake successful acknowledgement. Crash after durable result but before
offer/acknowledgement uses existing journal reconstruction, not result reexecution.

## S3 — Relation failure reaches the existing consumer precisely

Starting facts: the phase is live, optionally with admitted actions or a pending
completion. The relation changes stream fails with a known Cause while the
consumer is held and the mailbox is full.

1. After preceding offers, the subscriber's `catchCause` offers `RelationFailed`
   carrying that same Cause; it waits for capacity rather than dropping failure.
2. Release the consumer while keeping the phase live (an outstanding live owner
   prevents ordinary quiescence from ending the fixture early). It consumes the
   preceding accepted occurrences and then fails through `Effect.failCause`.
3. Scope closure interrupts remaining children and invokes existing rollback.

Assert exact failure identity/Cause and no successful quiescence or fabricated
completion. Initial attachment failure remains its direct failure path and
needs no queued failure. A phase already legitimately closed does not promise
delivery of later relation changes; cancellation is S4, not a retry of the
relation failure. A crash before consuming failure proves no successful phase
result; restart consults durable authority normally.

## S4 — Cancellation and Exit stop blocked handoffs causally

Starting facts: test separately a relation offer blocked on a full slot, a child
completion offer blocked on a full slot, and a child awaiting acknowledgement
for a retained completion. Include a live owner with recorded intent, and the
before-intent reservation case. Alice requests existing application Exit, or
the owning phase scope is interrupted; these are distinct from task cancellation
workflow operations.

1. Interrupt the owning runtime while those waits are proved entered. Scope
   ownership stops the relation subscriber and interruptible child fibers;
   queue lifecycle must not leave a blocked offer alive or proceed from false
   offer into an orphan acknowledgement wait.
2. Child interruption runs `releaseInterruptedOwner` under the released gate.
   Existing before-intent rollback releases only process-local reservations;
   after durable intent or ambiguity retains the existing durable responsibility.
3. Standalone runtime cleanup releases its process-local integration targets
   and closes observation. Application Exit follows its existing suspension,
   drain deadline and precise success/failure/timeout disposition.

Assert subscriber and child finalizers complete within a controlled test budget,
no successor starts, and no `ActionOutcome`, task completion, Run termination,
claim release, or durable-resource deletion is invented by mailbox shutdown.
No acknowledgement is required for abandoned messages. Do not await draining a
full queue before interrupting its producers. An interruption caught by the
relation failure handler must not become an uninterruptible shutdown offer.
Crash before Exit disposition leaves it unproven; unmatched intents survive,
and restart reconciles tracker/Git/execution authority before ambiguous retries.
The mailbox is never persisted or replayed. This contract adds no new Exit
success criterion or production timeout/configuration.

## S5 — Ordinary delivery preserves admission, publication and quiescence

Starting facts: the production composition has one Run, coherent accepted
journal facts, eligible independent proposals, ordinary capacity and exact
resource controllers. Use controlled service Layers with the real runtime,
admission, publication and relation composition; no live provider is required.

1. Attach current-first, publish observation and synchronize admission. Admit
   only eligible work within the existing task-work and integration constraints;
   materialize identities only after admission.
2. Run actions, publish accepted facts through the actual reactive relation,
   consume their evaluations and exact completions, and release owners only at
   the existing publication/acknowledgement boundaries.
3. Return the existing exact passive, reconfirmation, cleanup or capacity-stalled
   quiescence as applicable. Include the capacity wait whose accepted publication
   is newer than `latest`, and ordinary accepted successor work before quiescence.

Alice sees the same ordered durable intent/observation boundaries and final
workflow decision. Neither a free mailbox slot nor an empty mailbox proves task
or Run completion. No extra admission, identity allocation, tracker request,
publication, finality or cleanup policy is authorized. Process-local mailbox
ordering does not impose global journal publication order on independent work.
Cancellation and crash at any boundary preserve S4 and existing journal-first
recovery; this specification adds no retry route.

## Scenario-to-test mapping

The joined tests call `runDeliveryRuntimePhase` or `runDeliveryRuntime` through
production service boundaries. Controlled Layers, Deferred barriers and exact
occurrence counters hold the consumer; no provider fixture is needed.

The focused files are
[backpressure tests](../../packages/orchestrator/src/coordination/delivery/runtime-mailbox-backpressure.test.ts)
and [independent preservation tests](../../packages/orchestrator/src/coordination/delivery/runtime-mailbox-preservation.test.ts).
The latter does not use queue capacity as its oracle.

| Scenario | Joined production-boundary tests | Preservation anchors in run-delivery-runtime.test.ts |
| --- | --- | --- |
| S1 | Backpressure: `backpressures the real relation subscriber and applies every evaluation in FIFO order`; holds the consumer, allows the subscriber to continue with `Effect.yieldNow`, forbids the third pull, then asserts occurrences 2, 3, 4 exactly | `processes a changed frontier without a caller-supplied runtime boundary` |
| S2 | Backpressure: `drains independent completions and acknowledges lagged publications exactly once`. Preservation: `S2/S5: distinct completions retain owners until publication, settle once, then admit the successor`; asserts exact result objects and successful predecessor child exits while the successor stays live | `keeps an action owner until its accepted successor publication reaches the runtime`; `settles pending completions in their publication arrival order when one evaluation releases both`; both causal-successor acknowledgement cases |
| S3 | Preservation: `S3/S4: a held consumer preserves preceding occurrences and stops live producers on failure or cancellation` (Failure branch), `S3/S4: relation failure or phase cancellation abandons a pending completion without an outcome`, and `S3: attachment failure preserves the exact cause and admits no action` | `fails with the exact relation cause before admitting any proposal`; `returns a relation failure published after actions have started`; `rolls back an owner when its pending completion loses the relation` |
| S4 | Backpressure: `interrupts a full-mailbox subscriber without draining or acknowledging`, `cancels independent completion offers blocked behind a relation occurrence`, and `interrupts children awaiting acknowledgement of retained completions`. Preservation: the two S3/S4 cases above, `S4: application Exit interrupts the registered authority wait and forbids successor admission`, and `S4: fresh claim cancellation releases before-intent admission and retains recorded-intent responsibility` | `interrupts every scoped live action without manufacturing completion`; `releases acquired integration ownership and its relation subscriber on interruption`; `interrupts an admitted tracker owner under Exit and starts no successor action`; `retains fresh admission when the first claim-intent append outcome is unknown` |
| S5 | Preservation: the S2/S5 case above, `S5: a newer accepted capacity publication admits its ordinary read before exact quiescence`, and `S5: accepted journal facts pass through production reactive publication before runtime quiescence` | `does not allocate an operation or attempt identity before admission`; `reacts to an accepted action result through its owning fact signal`; `consumes an already accepted publication before returning a post-G2 capacity wait`; `cuts admission for cleanup but drains an existing owner through its accepted completion` |

The helper-only tests `returns a completion producer only after its exact
acknowledgement` and `interrupts rejected offers after scope closure instead of
waiting for acknowledgement` supplement these actual-runtime proofs. They do
not replace them. Scope interruption joins the runtime and its scoped children;
subscriber finalizers, closed observation and empty integration ownership are
asserted independently. Successful predecessor fiber exits prove actual
acknowledgement rather than an executor-body finalizer alone.

The join negative control replaces only `Queue.bounded<Event>(1)` with
`Queue.unbounded<Event>()` in the production mailbox, runs the S1 test, and
restores the original source in a `finally` block. It must exit 1 at the
`thirdPulled` missing-backpressure assertion (`expected true to be false`),
then the restored focused files must pass. A setup failure, timeout or unrelated
assertion supplies no negative-control evidence. No production selection switch
is introduced.

The shared fresh-frontier fixture records an accepted `WorkflowRunBegan` with
an explicit fixed Base before graph observations. This supplies the existing
production fresh-work eligibility requirement; it changes no runtime policy.
Affected runtime completion and admission tests remain required at the joined
candidate. No aggregate count substitutes for the named scenario assertions.


## Parent acceptance audit — 2026-10-07

Dalph's runtime hands each accepted occurrence to the consumer through
`makeRuntimeEventMailbox`, which acquires `Queue.bounded(1)` and registers
`Queue.shutdown` at scope closure. False offers interrupt instead of entering
an acknowledgement wait. The parent inspected integrated Base
`4ad871aa9afc54a067005c40d9bedd0d5d1a8ceb`, whose complete tree equals joined
candidate `9443fe54eddad3ae559df8b6ebd17830c5aea299` (`git diff` is empty).
This documentation reconciliation preserves those qualified application bytes.

The retained join evidence is `/tmp/mailbox-acceptance-audit.md`,
`/tmp/mailbox-negative-final.log`, `/tmp/mailbox-negative.log` and
`/tmp/mailbox-submit-coherent.log` in the execution host. The parent read those
artifacts and the join execution transcript; child acceptance status alone is
not evidence. These host-local artifacts are not portable repository links.

All commands below ran through `mise exec --` on the joined candidate:

- `pnpm exec vitest run` selected both mailbox files,
  `run-delivery-runtime.test.ts`, `delivery-runtime-admission.test.ts`,
  `delivery-runtime-admission-loop.test.ts`,
  `delivery-runtime-admission-sweep.test.ts` and
  `coordination/admission/fresh-task-admission.test.ts`: exit 0 after restoring
  the negative mutation. The S1–S5 table above identifies each required
  assertion rather than relying on the 191-test total.
- `node /tmp/mailbox-negative.mjs`: harness exit 0, child exit 1. Only the
  production queue constructor changed to unbounded; S1 failed at line 177,
  `Deferred.isDone(thirdPulled)` (`expected true to be false`). The script
  restored source in `finally`. An earlier spurious passing mutation before
  the scheduler yield refinement supplies no evidence.
- `pnpm check:submit`: coherent run exit 0, including artifact preparation,
  formal controls, `check:fast`, the full code-lint census and memory cassettes.
  Its earlier interrupted run supplies no evidence. The optional Base-scoped
  tooling fixture probe was skipped because `DALPH_DIAGNOSTICS_BASE` was unset;
  changed lint included integrated changes relative to original master.
- Joined documentation links and changed-file formatting: exit 0. The joined
  fresh independent review found no reasonable blocking findings for
  `dd8e17caef0b5356e446c0049543c4f7aac6ce09..9443fe54eddad3ae559df8b6ebd17830c5aea299`.

S1 proves a successful first handoff, blocked second handoff, resumed pulling
and exactly ordered evaluation occurrences. S2 combines the saturated runtime
completion case with the independent preservation case: exact result objects,
publication arrival order, successful predecessor child exits while a successor
remains live, and one settlement each. S3 proves the original relation Cause
survives preceding occurrences and abandons pending completion without an
outcome. S4 separately covers blocked relation offers, blocked completion
offers, retained acknowledgement waits, Exit authority-wait interruption,
process-local cleanup and before/after-intent reservation dispositions. S5
covers real reactive journal publication, newer capacity publication and exact
ordinary quiescence through the mapped production runtime tests.

The causal analysis remains valid in the integrated source: offers and child
acknowledgement waits occur outside `selectionGate`; admission waits only for
child readiness; pending completion application returns to consumption;
publication waiters progress independently of runtime offers. Subscriber failure
handoff is explicitly interruptible, and scope closure interrupts children and
closes the queue without draining or inventing acknowledgement. Thus the full
slot introduces no consumer wait on its blocked producer.

Limits remain deliberate: controlled production composition proves these
in-process boundaries, not live providers, every possible scheduler, or a total
process-memory bound. Independent producers have no imposed global order.
Scope closure abandons volatile messages and preserves durable responsibility;
no crash replay or retry policy is added. Existing formal models constrain
admission and Exit, not this entire wait graph. No broad gate, fresh model proof,
coverage census or hosted CI pass is claimed. The submission cassette suite's
21 skipped tests are not acceptance evidence for S1–S5; those required cases
passed in the focused selection. Dalph retains publication, completion and
resource-cleanup ownership.
