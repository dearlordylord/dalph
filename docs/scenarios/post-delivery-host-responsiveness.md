# Keep the host responsive after delivery

Issue: [#466](https://github.com/dearlordylord/dalph/issues/466).
The issue accepts these chronologies. Existing finality and
[application Exit](graceful-application-exit.md) rules continue to govern.

## Alice reads status after the last delivery settles

The tracker has completed the admitted tasks, Git has published their commits,
and the journal retains the same Run's delivery and cleanup observations. Many
earlier tracker reads can precede one post-quiescence reconfirmation. No task
count proves Run termination. When Dalph checks termination and Alice asks a
public client for descriptor/status, checking causal graph knowledge must finish
without starving the host. A later read supersedes another only through its
explicit predecessors or a typed reconfirmation reference. Conflicting maximal
reads still forbid termination; journal position alone cannot establish freshness.
No new tracker, Git or executor call is required by this pure check.

## Alice requests Exit with or without a watch

After those delivery obligations settle, Alice sends SIGINT. The same application
cutoff, owned drains and five-second Exit budget apply with an active passive
watch or without one. Public clients retain the same Run identity. Dalph reports
the actual success, failure or timeout; process disappearance alone proves no
graceful success. The causal check must not indefinitely block signal handling.
The graph index changes neither resource finalizers nor watch buffering.

The initialized Codex app-server already owns a child scope and its process
resources. If Exit's deadline interrupts a caller waiting for that scope to
close, Dalph must retain one parent-owned close operation until every registered
finalizer finishes. The caller can report the original timeout; cancellation
cannot abandon remaining finalizers after the child scope has been marked
closed. Joining this close again observes the same operation, without another
signal, replacement server, startup budget, or invented stopped-writer proof.
The parent scope retains this responsibility through its own teardown. A
permanently blocked finalizer remains unresolved; this repair supplies no
fictional process-absence evidence or new termination policy.

## Alice restarts after interrupted finalization

If the host dies after delivery but before a terminal append, its journal remains
unfinished. Alice first proves stopped writers through the owning reconciliation
boundary, then restarts the same Run. Dalph checks the retained graph knowledge
under the same causal rules before appending independently proved termination.
It cannot redeliver, replace an attempt or erase an unresolved fence. The pure
check performs no effects, so a crash inside it requires neither an intent nor
a retry of an outside mutation.

## Scenario-to-test mapping

| Outcome | Evidence |
| --- | --- |
| Retained-scale reconfirmation completes within a bounded child process; pure re-evaluation after interruption preserves the result | `finishes finality checking after a thousand graph reads within the host response budget` |
| Causal and contradictory histories retain the original predicate | `matches independent causal maximality for generated tracker histories`; existing `store.test.ts` graph termination rejection/acceptance cases |
| Actual built public clients remain responsive after delivery and reconnect without starting work | `Alice and two public clients observe one Run without starting work and reconnect after delivery` in `production-running-host.test.ts` |
| Exit, exact writer proof, watch drain, and same-Run startup recovery | Existing acceptance mappings in `running-executor-application-exit.md`, `running-host-clients.md`, and `rejected-provider-result-recovery.md`; focused owning suites run with this repair |
| A timeout after initialized startup leaves one close owner alive and completes both pending resource finalizers when their boundary releases | `Exit timeout cannot abandon initialized startup scope finalizers` in `codex-server-startup.test.ts` |

The pressure test directly exercises the synchronous finality boundary implicated
by the retained journal. Existing host/Exit/recovery tests prove their owning
protocols; they do not claim to reproduce every detail of the original provider
run. No deadline or authority rule changes.
