# Issue 204 application Exit runtime mapping

Issue: [Exit an idle activation through one shared lifecycle gate](https://github.com/dearlordylord/dalph/issues/204)

This file maps the accepted chronologies in
`issue-169-graceful-application-exit.md` to the executable evidence delivered
by issue #204. It adds no behavior beyond those accepted scenarios.

## Alice exits an idle Dalph application

Alice's first request closes admission. Dalph lets any journal write already
started by an admitted owner finish, closes the active Run scope without
terminating the Run, releases process-local runtime resources, releases the
exact coordinator lock, reports `Succeeded`, and requests process end with
status zero. Application lifecycle trace entries never enter the Run journal.

- `exits successfully within five seconds after flushing writes and releasing local ownership`
  replays the maintained application-lifecycle authored cassette and proves the
  idle drain order, status-zero request, and unchanged non-Run recording seam.
- `an idle application Exit closes its runtime, releases the coordinator lock, and journals no Exit fact`
  proves runtime closure → lock release → process-end-request ordering through
  the application-shell request boundary. Its recorded workflow-occurrence
  projection remains empty because the only Run record is `WorkflowRunBegan`.
- `continues every application-owned local drain after one sibling reports failure`
  proves one local close failure cannot skip another registered Run drain or
  the exact coordinator-lock release, and the shared result retains the failure.
- `allows a successor immediately after the application explicitly releases ownership`
  proves both controlled and Node coordinator-lock adapters release the exact
  lock and reject later mutations through the released capability.

## Exit meets a process-local admission preparation

The runtime prepares an owner before reserving protocol, capacity, or
integration resources. If Exit closes admission before registration, the
runtime removes those reservations and no registered owner appears afterward.

- `Exit rolls back delivery reservations prepared before owner registration`
- `rolls back a preparing reservation when Exit closes admission before owner registration`
- `closes admission before success and waits for a pre-cutoff owner before releasing the lock`

## Exit races with Pause, Unpause, Run finality, and another Exit

A Pause append admitted before the cutoff finishes and remains durable. Pause
and Unpause requests reaching the boundary afterward receive
`ApplicationExiting`. Exit interrupts an idle activation before its proposed
Run termination can be appended. Repeated Exit requests await the same result;
the second request does not create a new five-second deadline.

- `flushes an already-started Pause append before successful Exit and preserves the applied direction`
- `rejects an unapplied Operator Pause after the application Exit cutoff`
  exercises both Pause and Unpause.
- `starts no tracker stabilization read after the application Exit cutoff`
  proves a late G2 cannot acquire its stabilization owner.
- `records a stabilization read admitted before Exit but starts no phase-two action`
  proves an already-linearized G2 may record its accepted observation but
  cannot authorize phase two or a later termination append.
- `finishes an already-admitted Run termination append before successful Exit`
  blocks the exact termination append after owner registration, closes Exit,
  and proves the append becomes durable before lock release and success.
- `rejects a Run activation that reaches the application after the Exit cutoff`
  proves startup records no `WorkflowRunBegan` after Exit has been accepted.
- `rejects an activation queued before Exit when it reaches the cutoff after the active Run closes`
  proves a pre-cutoff caller cannot carry a stale admission decision through
  the bootstrap semaphore and start a later activation.
- `coalesces repeated Exit requests without resetting the fixed five-second deadline`
  starts the second request after four monotonic seconds and proves both calls
  receive the one `TimedOut` result and one nonzero process-end request at the
  original fifth second.
- `joins repeated Exit requests to one result and never registers a later owner`
  proves every requester observes the exact shared result `Deferred`.
- `one application Exit driver and cutoff are shared by every Run bootstrap`
  proves two separately constructed Run bootstraps register with one injected
  application shell and therefore share one cutoff, drain registry, result,
  coordinator-lock owner, and process-end request.

## Process death before a successful result

Closing the application scope before its drain completes leaves the result
unreported. A newly constructed application starts in `Serving`; it restores
neither the prior cutoff nor an Exit result.

- `an authored process-death cut before the Exit result persists no cutoff or successful result`
  replays the maintained request → process-death cassette, closes the
  application scope during its pending drain, observes no result, and proves a
  fresh application lifecycle begins in `Serving`.
- `reopens an unfinished Run normally after an authored Exit death cut`
  supplies the retained `WorkflowRunBegan` history to a fresh application and
  proves ordinary activation enters without restoring or replaying Exit.
- `an idle application Exit closes its runtime, releases the coordinator lock, and journals no Exit fact`
  proves the recorded Run projection contains no Exit marker for a later
  startup to restore or replay.

## Produced-write failure and fixed deadline

If the idle slice cannot acknowledge an already-produced journal write, it
still closes local resources and releases the coordinator lock before reporting
the typed `Failed` result and requesting nonzero process end. A drain that does
not settle by the original five-second monotonic deadline reports `TimedOut`.

- `reports a flush failure only after releasing idle process resources and the coordinator lock`
- `reports timeout with an earlier produced-write diagnostic at the original fifth second`
- `coalesces repeated Exit requests without resetting the fixed five-second deadline`
- `times out instead of interrupting a non-idle Run whose family owner has not drained`
  proves #204 does not manufacture safe suspension or release the coordinator
  lock while later boundary-family policy is still absent.
- The `applicationExit` Quint model, negative mutation profile, and temporal
  checks retain the fifth-tick and no-reset invariants.

## Deliberately deferred boundary-family behavior

Issue #204 does not decide how an admitted executor, tracker request, Git call,
integration/evidence section, or cleanup disposition reaches its own safe
boundary. Issues #205–#208 own those policies and their controlled adapters.
Actual host-process termination and signal transport remain owned by #209 and
#210; #204 produces the typed graceful/non-graceful process-end request but does
not claim that an operating-system process ended.
