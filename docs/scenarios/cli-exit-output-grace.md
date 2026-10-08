# The Operator exits Dalph while the CLI receiver stops reading

## Accepted policy and scope

The Operator selected a short output grace followed by application termination
on 2026-10-08. The initial bound is 500 ms after the application Exit result is
available, capped by the original five-second deadline. Implementation owner: [issue #486](https://github.com/dearlordylord/dalph/issues/486).

This scenario refines
CLI observation and process completion only; it creates no workflow fact,
external request, retry, claim release or durable cleanup permission.

## Governing behavior

Read this chronology when implementing CLI publication cutoff, admitted-output
ownership or Node process completion after Exit. Preserve the
[graceful application Exit scenarios](graceful-application-exit.md#the-exit-drain-reaches-five-seconds),
[bounded production output](bounded-production-output.md), and D31–D32 in
[process and durability](../DELIVERY-INVARIANTS.md#process-and-durability).
The existing `applicationExit.qnt` laws and its
[scenario-to-test mapping](graceful-application-exit.md#scenario-to-test-and-model-mapping-required-at-handoff)
continue to own cutoff, five-second drain, exact responsibility and recovery.
This refinement does not replace their lifecycle result with an output timeout.

## G1 Historical preparation is active when Exit is requested

Starting facts: Alice runs the production CLI for an established unfinished Run.
The passive presenter is admitting or preparing a historical view. The tracker still owns
claims and task state, Git owns the exact attempt/worktree facts, and the
Journal retains the original workflow history.

Trigger: Alice sends SIGINT or a supervisor sends SIGTERM.

Chronology: the signal adapter enters the existing application Exit boundary.
The presenter closes admission for new ordinary publications and interrupts
owned optional preparation without first acquiring the output semaphore.
The application shell performs its existing drain independently. A view prepared
after cutoff cannot start a new ordinary write. An already-admitted record
belongs to the presentation scope until completion or output abandonment.

Visible result: a blocked cooperative historical reader does not hide the
lifecycle result or prevent applying the selected output grace.
Forbidden: new ordinary publication after cutoff, observer cancellation of
workflow work, hidden projection failure, synthetic Run disposition.

Crash/retry: a process loss creates no Exit workflow event. Restart reconstructs
the same Journal and reconciles existing intents under ordinary recovery;
a repeated signal joins the original cutoff and output allowance. The signal
adapter retains the first request's monotonic time before entering the shell;
a presenter scheduled later uses that retained time, never a fresh deadline.

Tests: `cli-exit-output-grace.test.ts` cases `Exit interrupts historical preparation
before waiting for output admission` and `an admitted record finishes before the
Exit record when the reader resumes within grace`.

## G2 The receiver resumes before output grace expires

Starting facts: an ordinary historical record has crossed the stdout boundary;
its receiver has stopped reading. Dalph may have accepted bytes without having
completed their delivery. The existing lifecycle drain is independent.

Trigger: Exit is requested; the lifecycle result becomes available.

Chronology: stop new ordinary publications and preparation. Allow the admitted
write to settle for at most 500 ms from result availability, shortened to the
remaining original five-second allowance. Final status and Exit output share
this same allowance. If the receiver resumes, finish the admitted record before
any final record. Return from the host callback, close resources and release
coordinator ownership under the existing host contract.

Visible result: complete records remain ordered, the existing lifecycle result
is reported, and the process uses its existing exit status without artificial
waiting after delivery completes.
Forbidden: interleaving records, resetting grace for each write or signal,
claiming that merely accepted bytes were delivered, extending the Exit deadline.

Crash/retry: death can leave partial stdout; the client must not treat a partial
line as a complete record. The authoritative Journal remains unchanged.

Test: `cli-exit-output-grace.test.ts` case `an admitted record finishes before the
Exit record when the reader resumes within grace` and physical resumed-reader
control over the actual stdio adapter and Node main.

## G3 The receiver remains stalled

Starting facts: as G2, but the receiver does not resume during the allowance.

Trigger: the single output grace expires.

Chronology: interrupt the passive presentation and its admitted-write wait.
Do not attempt another stdout failure record through the same stalled channel.
Carry the already-produced lifecycle result's requested status to the outer
application boundary. Return control so the production host can finalize its
resources and coordinator ownership. Once the main application scope has
finished, Node explicitly ends this process rather than relying on natural
termination of a pipe with pending bytes.

Visible result: undelivered output, including a partial record or a missing
final Exit record, is permitted. Process status reflects the exact lifecycle
result when host finalization succeeds: Succeeded selects 0; Failed/TimedOut
select 1. A host finalization failure selects 1 and remains diagnostic evidence;
it cannot be hidden by a Succeeded lifecycle result. Output abandonment is
explicit internal evidence and is never called a successful flush.
Forbidden: process termination before the host scope completes, invented safe
executor suspension or Run finality, extending deadlines or dropping Journal
history to make shutdown work.

Crash/retry: partial output is not replayed as a workflow mutation. A later
startup uses ordinary recovery for every retained responsibility. Repeated Exit
cannot create a fresh allowance.

Tests: `cli-exit-output-grace.test.ts` cases `stalled output abandons presentation
once within the original deadline` and `a repeated Exit does not extend output
grace`; physical paused-reader case proves exact exit/status and process absence.

## G4 The lifecycle deadline wins or the output pipe fails

Starting facts: an admitted output write is pending and a process-local drain
remains unresolved, or the receiver closes the pipe.

Trigger: the existing five-second drain produces TimedOut, or the actual stdio
adapter produces its typed write failure.

Chronology: TimedOut receives no extra output grace. Stop passive presentation,
retain the exact requested status 1 and finalize the host scope before Node
process completion. A conclusive write failure that arrives before grace
expiry keeps its existing typed output failure; no error is silently converted
into Succeeded and no retry is made.

Visible result: timeout remains non-graceful and output may be unavailable.
A real closed-pipe error remains a typed output failure. The presenter observes
an admitted writer's failure after that writer has settled, so cancellation of
the presenter cannot obstruct reporting that same failure.
Forbidden: treating missing stdout as delivered, inferring stopped writers
from an output timeout, restarting a deadline, or producing RunDisposition.

Crash/retry: unavailable delivery creates no new durable fact. Original custody
and intent reconciliation remain required at restart.

Tests: `cli-exit-output-grace.test.ts` cases `a late lifecycle result cannot extend
the original Exit deadline` and `a conclusive output failure keeps its typed
identity`; physical paused-timeout and closed-pipe controls.

## Qualification limits

These cases do not prove interruption of non-cooperative JavaScript or
uninterruptible resource finalizers. Such owners retain their existing lifecycle
and custody obligations. A physical presenter-only fixture is insufficient for
claiming production coordinator-lock release; the composed host and Node checks
must separately demonstrate callback return and completed scope finalization.

## Acceptance mapping for #486

- G1: `cli-exit-output-grace.test.ts` interrupts blocked historical preparation;
  its snapshot-admission variant proves the new preflight is also interrupted;
  its current-status case proves status can publish independently. Existing
  `production-cli.test.ts` preserves current-first ordering and projection errors.
- G2: `cli-exit-output-grace.test.ts` finishes an admitted record before Exit output;
  the physical `draining` and `paused-success` fixtures prove complete ordered
  records through the actual presenter, stdio, signal adapter and Exit shell.
- G3: grace tests cover expiry, repeated signals, delayed observer and finalizer failure;
  `supervisor-exit.test.ts` preserves the first timestamp across repeated signals;
  `production-host-exit.test.ts` proves callback return precedes resource and
  coordinator capability finalization. `node-main.integration.test.ts` proves
  actual process completion with unread stdout, including a failing finalizer.
  The physical `paused-abandon` fixture proves admitted pending-byte abandonment.
- G4: grace tests cover late results, TimedOut, typed failure and admitted failure
  after observers stop; existing CLI timeout coverage preserves status 1 and no
  RunDisposition. Physical `paused-timeout` uses the actual five-second shell;
  `closed` proves typed pipe failure and process/group absence without forced kill.

Physical evidence is retained at
`/workspace/dalph-refactor-evidence/20261008-cli-grace-implementation` with fixture
sources, identity manifest and exact process/group observations. The controlled
host test proves coordinator capability release ordering; these new checks do not
independently prove production OS lock release or Journal writer absence.
