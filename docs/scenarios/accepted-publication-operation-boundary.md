# Alice restarts an attempt while two Journal readers publish independently

Owning issue: [#413](https://github.com/dearlordylord/dalph/issues/413).
Status: accepted and implemented; #413 focused evidence runs in the ordinary
cassette suite. The separate 22-beat capstone runs by explicit request.

## Governing behavior

The accepted [journal-first tracker observation](journal-first-tracker-observations.md)
records a read intent before contacting the tracker and its exact outcome
before using the returned facts. The accepted [publication observer](accepted-publication-observer.md)
coalesces several accepted publications during one activation into one
nonconcurrent ordinary entry. The accepted [reactivation owner](reactivate-incomplete-runs.md)
retains only one activation owner. This scenario refines their shared
publication boundary: a Journal position records what is durable, while an
operation's accepted outcome identifies which facts can wake planning.

[D29–D32 process and durability](../DELIVERY-INVARIANTS.md#process-and-durability)
and [D33–D36 progress](../DELIVERY-INVARIANTS.md#progress) continue to govern
crash recovery and eventual work. Existing `finalityReadRequiresQuiescence` in
[`runActivation.qnt`](../../specs/runActivation.qnt) and `beginOccursAtMostOnce`
in [`plannedAttemptExecutor.qnt`](../../specs/plannedAttemptExecutor.qnt)
constrain the eventual finality and executor boundaries. Neither law models
the process-local publication ordering itself.

## Starting facts and trigger

Alice has changed task A's instructions. Dalph has one Run, A's immutable
previous attempt, and an accepted tracker graph in its Journal. Git owns A's
existing branch, Base SHA, and worktree. The executor owns its previous session.
The Operator requests an exact restart of A while the coordinator may perform
its own post-quiescence tracker read. The two reads have different operation
identities and causes; neither read is causally before the other.

## Chronology and visible result

1. Dalph accepts the Operator's restart direction, then the exact tracker-read
   intent before calling the tracker. The Journal immediately exposes both
   records to recovery. The intent alone is no tracker observation and cannot
   authorize the successor attempt or Run termination.
2. The coordinator may select and complete its post-quiescence graph read
   before or after the Operator's restart-authority read. Each result belongs
   to its exact read operation. A different arrival order cannot become a
   fabricated provider error in a controlled cassette.
3. The Operator records the exact tracker result, or a typed failed read, as
   that operation's accepted outcome. Delivery publishes a coherent accepted
   prefix through it. A successful result can wake the one reactivation owner;
   a failed read leaves the exact operation retained without erasing a wake
   already earned by another completed operation.
4. A second producer can accept an independent observation while A's read is
   pending. Dalph can publish and act on that producer's completed facts.
   Closing A's operation does not consume that independent publication.
5. Dalph checks A's exact tracker and Git authority before creating at most
   one successor claim, worktree, and executor start. Alice sees either that
   successor or a typed wait/failure. Several accepted records in one active
   refresh still cause at most one trailing ordinary activation, and that
   activation starts after the current one returns.

The same causal rule applies when an Operator integration-quarantine direction
and Dalph's target-lineage selection cross an activation boundary. The durable
direction must precede the lineage decision it authorizes; a cassette may not
require an unrelated activation-return occurrence solely to recreate a
particular scheduler order. Existing promotion and recovery edges remain.

## Crashes, retries, and forbidden results

If Dalph dies after the read intent but before the tracker response, restart
reconstructs the pending operation from the Journal and rereads the exact
authority. If the response occurred but its observation was not accepted,
restart reconciles that ambiguous boundary. If the observation was accepted
but the process died before its reactivation wake, restart reconstructs the
accepted prefix and can enter once. A callback from the old process cannot
publish into the new process. No process-local completion hint is durable
authority.

Dalph must not admit work or terminate from a read intent, silently lose an
independent accepted observation, duplicate a claim/worktree/executor command,
turn a valid alternate read order into a provider failure, or launch concurrent
Run activations. A retained failed read cannot cancel another operation's
completed-fact wake. No timer, sleep, fixed scheduler turn, or second owner is
part of this contract.

## Acceptance-test mapping

| Required result | Test seam |
| --- | --- |
| Intent-only prefix is published for recovery without admitting A | `reactive-delivery-relations.test.ts`: blocked tracker outcome and planning frontier |
| Independent completed operation survives A's retained failure | `journaled-run-bootstrap.test.ts` and `run-reactivation-owner.test.ts`: two exact operation identities |
| Either Restart read order yields one exact successor path | `changedAttemptRestartsCleanly` causal window and reversed-order negative control |
| Integration direction and lineage retain their causal edge across either permitted activation split | `capstone.execution.test.ts`: `maintained delivery capstone proves the #413 publication and integration interval through DS17` checks the exact DS01–DS17 prefix, including DS14–DS17 |
| Process death at each read/publication cut reconstructs from Journal without a duplicate effect | focused bootstrap/recovery tests |
| A completed position releases waiters, and cancellation removes an old waiter | `reactive-delivery-relations.test.ts`: blocked derivation and scoped cancellation |

The read-operation completion boundary should use accepted Journal outcome
evidence when that evidence already names the exact operation. Any additional
process-local signal is limited to a multi-record action with no such durable
outcome; it cannot replace Journal authority.

The 22-beat capstone's DS21 checkpoint now accepts both causal orders at the
last A–D settlement: E either still executes or has reported an accepted
terminal result and remains retained for integration. F and G still hold their
positions. This checkpoint is separate from the DS14–DS17 evidence above.
