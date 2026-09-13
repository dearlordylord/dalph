# Invokee command semantics: capacity, wake, Unpause, and refresh

## Scope and method

This note traces the command boundaries already present in the research-branch
source. It does not propose a transport or claim behavior from the hosting
prototype that the production services do not provide. “Response lost” below
means the command effect completed but its caller did not receive the result.
“Caller cancelled” means interruption may occur while the command effect is
still running. Those are different events and have different evidence.

This note began as source research and was subsequently checked with the
[control replay probe](./prototypes/invokee-control-replay/README.md) and the
[real SQLite interruption probe](./invokee-command-interruption-results.md).
The latter corrects the original inference about cancellation during append:
the live Journal masks interruption across storage and accepted publication.

## Existing command boundaries

| Request | Existing boundary | What successful return proves | What it does not prove |
| --- | --- | --- | --- |
| Set capacity | `TaskWorkCapacityControl.apply` | The requested next policy revision was appended and the complete new policy returned. | Which network request caused an already-current value after a response is lost. |
| Run Unpause | `ControlDirectionApplication.apply`, reached through `JournaledRunBootstrap.operatorControl.applyControlDirection` | A new `ControlDirectionApplied` record was appended. In the live production composition, the accepted-control callback also completed before return. | That ordinary Run activation finished, or that retrying the same request will reuse the first record. |
| Wake | `RunReactivationOwner.hint(OperatorWake)` | The process-local owner finished handling the hint under its command gate. | Whether it queued, coalesced, was discarded because the Run was paused/stopped, began activation, or completed activation. |
| Refresh hint | `RunReactivationOwner.hint(TrackerNotification)` | The same process-local handling fact as wake. | A fresh graph, a task-specific refresh, or even that an active refresh was queued. |

### Capacity is a journaled compare-and-set

The request includes the exact `RunId`, desired `TaskWorkCapacity`, and
`expectedRevision` ([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L23)). The service reads the accepted policy, rejects a stale expected revision with the complete current policy, assigns the next branded revision, and appends one revision-keyed event
([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L90)). If another writer wins that key, it rereads and returns the winner as a revision conflict
([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L103)).

The focused tests prove these properties:

- a successful change is reconstructable as revision 2 and contributes exactly one capacity-change record ([task-work-capacity.test.ts](../packages/orchestrator/src/control/task-work-capacity.test.ts#L130));
- replaying the same revision returns the complete current policy and appends nothing ([task-work-capacity.test.ts](../packages/orchestrator/src/control/task-work-capacity.test.ts#L172)); and
- when a competing writer commits the requested revision, the losing caller rereads that writer’s policy ([task-work-capacity.test.ts](../packages/orchestrator/src/control/task-work-capacity.test.ts#L206)).

Concrete response-loss chronology:

1. A client sends `{ runId, capacity, expectedRevision }`.
2. Dalph reads the expected current policy and acknowledges the append.
3. The command returns the new complete policy, but the connection loses that response.
4. The client repeats the exact request.
5. Dalph sees a newer revision and returns `TaskWorkCapacityPolicyRevisionConflict` with the complete current policy; it does not append a second change.

That establishes state convergence after a lost response. It does not establish
per-request exactly-once attribution: the current value alone cannot identify
which disconnected caller wrote an equal capacity.

Production currently reaches capacity through a runtime control lease
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1129)). A lease is acquired only while that exact runtime accepts control, and Run closing waits for acquired leases to release
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L499), [journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L637)). The live Journal masks interruption across storage append and accepted-record
publication, inside its publication permit. The
[SQLite interruption probe](./invokee-command-interruption-results.md)
confirms that cancellation requested at the post-INSERT or post-COMMIT hook
remains pending until append and accepted publication finish. Cancellation can
still prevent invocation or interrupt work outside that protected region; lease
finalization alone does not explain command lifetime. Repeating the exact
capacity request either performs the still-missing revision or returns the
current policy as a revision conflict. Forking the command into an existing
host scope can additionally keep pre-append work alive when a request ends.

### Unpause records a direction; it has no replay identity

`ControlDirectionApplication.apply` decodes an exact Run or Task subject, reads
accepted history, counts prior direction records, assigns the next ordinal, and
appends a `ControlDirectionApplied` record under that ordinal
([protocol.ts](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.ts#L34)). Its semaphore serializes applications made through that one service instance
([protocol.ts](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.ts#L60)). The request has no command identity or expected ordinal.

The production bootstrap rejects a Run subject whose `RunId` differs from its
selected Run. It applies against live runtime controls when available and falls
back to the established journal when the runtime is inactive. After a successful
append, it invokes the accepted Run-control observer
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1054)). For a changed Run-level Unpause, that observer starts the timer and offers one `OperatorWake`; repeating Unpause while already unpaused changes no owner state and offers no additional wake
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L318)).

Concrete response-loss chronology:

1. A client requests Run-level Unpause for the exact `RunId`.
2. Dalph appends a new direction record and the live owner processes the accepted-control callback.
3. Dalph returns the appended journal record, but the connection loses it.
4. If no other direction intervened and the client repeats Unpause, Dalph
   appends another direction record at the next ordinal. The owner sees no state
   transition on that repeat and does not queue another wake.

A more consequential chronology is also allowed by the source:

1. Client A’s Unpause is appended, but A loses the response.
2. Client B deliberately applies Pause, which becomes the current durable
   direction.
3. Client A blindly repeats its original Unpause because it cannot identify the
   first application.
4. Dalph appends a new Unpause ordinal and overrides B’s intervening Pause.

Unlike capacity, Unpause has no `expectedRevision` check that could reject this
blind replay and return the intervening state. This chronology is
**validated by the disposable control replay probe below**, although not by
the cited package tests.

The source test deliberately applies four directions, including distinct Run
and Task Unpause commands, and proves four records without claiming downstream
effects ([protocol.test.ts](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.test.ts#L103)). A SQLite test proves an acknowledged direction remains reconstructable when the caller discards its response
([protocol.test.ts](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.test.ts#L223)). It does not test retrying a lost Unpause response.

Cancellation differs from ordinary response loss. An interruption can prevent
append from starting, but the live Journal defers it across storage append and
accepted publication. After that protected region, interruption can prevent the
bootstrap's accepted-control callback from running. The
[SQLite interruption results](./invokee-command-interruption-results.md)
distinguish these cuts. The existing request has no durable identity with which
a retry could reopen the same application. Durable final direction can be read
from history; exactly-once occurrence and callback publication are not provided.

### Wake is an ephemeral hint, not an admission result

The owner explicitly defines every hint as a “non-authoritative request” and
exports only `hint(...): Effect<void>`
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L24), [run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L77)). Under its command gate, it silently returns when stopped or paused. Otherwise it may place a message in the one-slot queue, coalesce it into an existing trailing obligation, or strengthen that obligation
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L258)). Only the later worker distinguishes ordinary wake from an authority refresh and calls the corresponding activation effect
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L351)).

Concrete response-loss chronology:

1. A client asks the host to wake a Run.
2. A direct call to `hint(OperatorWake)` returns `void` after the owner’s gate handling.
3. The response is lost.
4. Neither caller nor adapter can reconstruct from that return whether the hint was queued, coalesced, or discarded.
5. Repeating the wake is compatible with the hint’s non-authoritative, coalescing semantics, but it still yields no receipt for activation start or completion.

On caller cancellation, the hint may be interrupted before it obtains the
command gate. It then has no durable evidence and may never reach the owner’s
queue. A host-scoped runner could keep the hint effect alive after a request
fiber disconnects, but that is an **adapter guarantee**, not a property of the
current owner interface.

### Refresh is a payload-free authority hint

The closest existing refresh request is `TrackerNotification`; it carries no
task IDs ([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L24)). When the worker processes that hint while unpaused, production invokes
`runWorkflowWithActiveWorkAuthorityRefresh`
([production.ts](../packages/dalph/src/application/production.ts#L303)). That activation establishes the exact Run and captures the accepted unfinished attempts whose current executor lifecycle is `Executing`; terminal, replaced, abandoned, safe, or ambiguous responsibility does not enter the immutable subject set
([run-activation-opportunity.ts](../packages/orchestrator/src/coordination/run/run-activation-opportunity.ts#L80), [run.ts](../packages/orchestrator/src/coordination/run/run.ts#L444)).

Wake’s response-loss and cancellation chronology applies unchanged. A
successfully returned `void` does not prove a fresh read occurred. The hint may
have been suppressed, coalesced, or followed by activation failure. Task IDs in
a future boundary can only be advisory with the current owner: there is no
existing targeted-hint field to carry them. A whole-Run activation can be a
sufficient initial implementation, but its response must describe hint
submission rather than completed refresh unless the service gains a truthful
completion result.

## Reconciliation with earlier hosting research

The [hosting research](./invokee-hosting-research.md) was corrected in this round:
its operations table and wake/Unpause discussion now distinguish hint handling
from activation, qualify wake on a paused-to-unpaused transition, and explain
why blindly repeating Unpause can override an intervening Pause. It no longer
claims that `void` reveals paused/closed disposition or completed refresh.

## Targeted Unpause replay validation

The disposable [invokee-control-replay probe](./prototypes/invokee-control-replay/README.md)
uses the built `@dalph/orchestrator` exports for the real
`ControlDirectionApplication`, live in-memory journal, and journal-history
reducer. Run from the repository root:

```sh
node research/prototypes/invokee-control-replay/run.mjs
```

The validation run exited successfully and printed these durable directions:

| Actor and event | Direction | Application ordinal | Journal position |
| --- | --- | ---: | ---: |
| Client A; returned response discarded | Unpause | 1 | 2 |
| Client B; response received | Pause | 2 | 3 |
| Client A; exact request replayed | Unpause | 3 | 4 |

The intermediate reconstruction after B’s direction was `RunPaused`. The final
reconstruction after A’s replay was `RunUnpaused`, confirming that A’s blind
replay appended a new direction and overrode B’s intervening Pause. The probe
asserts the three direction/ordinal pairs and both effective states, so a
different result makes the one command exit unsuccessfully. It retains A’s
first returned record only as harness evidence; simulated client A does not
receive it.

This evidence is limited to response loss after A’s first command returned. It
does not exercise interruption during append, concurrent processes, HTTP, or
the production reactivation owner’s callback. It confirms journal and reducer
semantics; it does not establish how many activations the live owner would run.

## Proven, inferred, and open

**Proven by source and focused tests**

- Capacity is revision-checked, conflict returns the complete current policy,
  and exact stale replay appends nothing.
- A successfully returned control-direction application is journaled and
  reconstructable after its response is discarded.
- Changed accepted Unpause starts the timer and offers ordinary wake.
- The targeted built-package probe proves that Unpause, intervening Pause, and
  exact Unpause replay append ordinals 1, 2, and 3 and reconstruct to
  `RunUnpaused`.
- Wake and tracker refresh are payload-free, process-local, coalescing hints with
  a `void` result; paused and stopped paths silently return.
- Tracker notification and timer use the active-work authority-refresh path;
  `OperatorWake` uses ordinary Run entry.

**Lifetime boundaries checked in the later interruption probe**

- Interruption can prevent a command from reaching append or affect callbacks
  outside the protected append. The SQLite probe establishes that the live
  Journal itself defers interruption across storage and accepted publication.
- An adapter that forks a command into the existing host scope can make client
  disconnection independent from command completion, but that guarantee must
  be stated and tested at the adapter boundary.

**Source-derived but not covered by the package’s cited focused tests**

- Repeating Unpause appends another ordinal. With no intervening direction the
  live owner has no state transition. The disposable research probe now covers
  the separate journal/reducer case in which an intervening Pause is overridden;
  it does not cover the live owner callback.

**Open in the current boundaries**

- Recovery after a host crash or storage failure at an ambiguous commit boundary;
  request cancellation inside the live Journal is now covered by the later probe.
- Durable per-request identity and exactly-once replay for Unpause.
- A truthful queued/coalesced/paused/stopped disposition for wake or refresh.
- A task-ID-scoped refresh request and a result proving that its fresh read
  completed.
