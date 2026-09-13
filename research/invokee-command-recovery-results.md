# Persisted Unpause recovery research

## Question and expected chronologies

An attached client can disappear after an inactive Run's Unpause is durable but
before `JournaledRunBootstrap` tells the process-local reactivation owner. This
round asks whether the existing owner repairs that missed callback without a
blind Unpause retry.

The source predicts three different chronologies:

1. **The request owns the command and the current owner misses the callback.**
   The Run is paused, the owner's timer is stopped, and Unpause enters the live
   Journal. Interruption waits until SQLite and accepted-prefix publication
   finish, then lands before the bootstrap observer. Durable history says
   unpaused while the current owner's local projection remains paused. An
   operator wake is only a hint and is discarded while that local projection is
   paused, so it does not activate or reread control.
2. **A new owner is constructed from the same SQLite journal.** It installs its
   callbacks, reads current durable control, sees `RunUnpaused`, starts its
   timer, and admits its startup activation. It appends no control direction.
3. **The host scope owns the complete bootstrap command.** Interrupting the
   request waiter leaves the command fiber alive. After SQLite append and
   accepted-prefix publication, the same command reaches the actual owner
   observer exactly once. Starting from an accepted Pause at ordinal 1, its
   Unpause at ordinal 2 restarts the timer and activates. No retry is needed.

## Source findings before execution

The bootstrap invokes the accepted Run-control observer after the real control
application returns, outside the live Journal's interruption mask
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1062)).
The prior interruption probe established that cancellation requested inside
append can therefore become effective between accepted-prefix publication and
this observer.

`RunReactivationOwner` installs that observer before its initial durable read.
It then reads control once, preserving any callback that races with the read by
checking `controlRevision`
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L395)).
This ordering makes fresh construction current-first.

After construction, accepted control changes the owner's process-local
`controlState`. Pause stops the timer; Unpause starts it and offers one operator
wake only when the state actually changes
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L318)).
Ordinary hints consult that local state and return immediately unless it is
`RunUnpaused`
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L264)).
The installed accepted-fact-publication callback is itself only an
`AcceptedFactPublication` hint, and tracker notifications enter the same
`offerHint` gate
([owner installation](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L395),
[tracker source](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L296)).
There is no control reread in either hint path or the worker loop. Thus an
ongoing paused owner that misses Unpause has no source-visible reconciliation
path from a later accepted-fact publication, tracker notification, operator
wake, or timer tick; Pause already stopped its timer.

The owner starts its timer and enqueues a startup activation only after the
initial durable read says unpaused
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L401)).
Reconstructing the owner can therefore recover durable Unpause without applying
another control direction.

## Executable validation

Run from the repository root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-command-recovery/vitest.config.ts --reporter verbose
```

Observed on 2026-09-13 at repository commit
`f99a2343f5b5d90c08e84b536ffab4a8d562b1fb`:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    10.55s
```

### Current owner after the missed callback

The probe let the actual owner complete its startup activation and start its
timer. A normally accepted Pause at ordinal 1 reached the owner and stopped the
timer. Unpause at ordinal 2 then paused inside SQLite after its real INSERT. The
probe requested interruption, released the gate, and verified that the request
ended by interruption after the live Journal completed acceptance.

The resulting observations were:

```json
{
  "activations": 1,
  "controlObserverCalls": ["Pause"],
  "durableControl": "RunUnpaused",
  "durableOrdinals": [1, 2],
  "timerStates": ["Started", "Stopped"]
}
```

The bootstrap's durable read returned `RunUnpaused`, while the observer wrapper
showed that only Pause reached the owner. Sending `OperatorWake` completed but
left activation count at one and the timer stopped. This is a blocked
process-local state: hints do not reconcile the missed durable control fact.

### Fresh owner from the same journal

After closing the first bootstrap and owner scopes, the probe opened SQLite
again, constructed a fresh bootstrap and owner, and did not submit another
control command. The fresh owner read the existing Unpause, started its timer,
and completed one startup activation:

```json
{
  "activations": 1,
  "controlObserverCalls": [],
  "durableControlRecords": 2,
  "timerStates": ["Started"]
}
```

The empty callback list is expected: recovery came from the mandatory durable
read, rather than replaying a callback or appending ordinal 3.

### Host-owned complete bootstrap command

In a separate fresh Run, the probe forked the complete
`bootstrap.operatorControl.applyControlDirection(Unpause)` effect into the
existing host/test scope after Pause at ordinal 1 had stopped the actual owner.
It interrupted only the request fiber waiting for the command while SQLite was
gated after INSERT. The command remained alive, finished after gate release,
and traversed the real bootstrap-to-owner callback:

```json
{
  "activations": 2,
  "commandOrdinal": 2,
  "controlObserverCalls": ["Pause", "Unpause"],
  "durableControlRecords": 2,
  "requestInterrupted": true,
  "timerStates": ["Started", "Stopped", "Started"]
}
```

The callback wrapper delegates to the actual owner callback before it returns.
The one Pause and one Unpause call, timer restart, and second activation prove
completion beyond journal/service success and show that host ownership closes
the identified paused-state gap for this command.

## Scenario-to-test mapping

| Operational chronology | Acceptance test |
| --- | --- |
| Alice's request owns Unpause; SQLite and the live Journal accept it, interruption skips the current owner's observer, and a later wake hint must not be described as recovery. | `an ongoing paused owner misses durable Unpause but a fresh owner reconstructs it without retry` |
| The process closes the stale owner and builds a new owner over the same SQLite Run; the durable Unpause starts its timer and startup activation without appending another direction. | `an ongoing paused owner misses durable Unpause but a fresh owner reconstructs it without retry` |
| The actual owner is paused; the host scope owns the complete bootstrap Unpause while Alice's waiter disconnects; ordinal 2 reaches the owner once, restarts its timer, and causes activation. | `a host-owned bootstrap command reaches the actual owner observer once after its waiter is interrupted` |

## Findings

**Proven:** the ongoing owner has no hint-driven repair for this missed callback.
Its durable Run is unpaused while its process-local state remains paused and its
timer remains stopped. Fresh owner construction repairs the projection from the
journal without a control retry. Host ownership of the complete bootstrap
command prevents this interruption cut because the request waiter does not own
the callback-bearing command fiber.

**Operational implication:** a caller must not interpret `wake` as Unpause
reconciliation. Wake is a hint and the paused owner rejects it before
activation. Blindly retrying Unpause would reach the observer, but it appends a
new direction and can override another client's intervening Pause. Existing
safe recovery is fresh owner reconstruction, or preventing request disconnect
from interrupting the complete accepted-command callback path.

The inverse missed-Pause case was not executed here. Source shows that a stale
unpaused owner could keep its process-local timer and request an activation,
but activation reconstructs the current journal before running delivery. The
current frontier then treats durable Run Pause as settlement-closed and filters
transitions to the explicit paused cleanup/reconciliation allowlist
([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L2430)).
Therefore this note does not claim that a missed Pause admits fresh task work;
the bounded source inference is extra process-local activations while durable
pause policy still governs the actual workflow frontier.

## Evidence limits

The probe uses the real SQLite store, live Journal, inactive
`JournaledRunBootstrap`, and actual `RunReactivationOwner`. Its activation
effect is controlled because a full repository delivery runtime is outside this
question. It observes activation calls and timer lifecycle through existing
owner options. The one-hour timer is not advanced; timer `Started`/`Stopped`
comes from the owner's actual lifecycle callbacks. The “host scope” is the
already-open Effect test scope, not a production repository host or network
server. The fresh case proves reconstruction in this composition; it does not
claim that every production process restart succeeds. No production file or
journal protocol was changed.
