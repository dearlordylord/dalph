# Compose application Exit drain failure and timeout

Issue: [#209](https://github.com/dearlordylord/dalph/issues/209)

This file maps the accepted chronologies in
[`issue-169-graceful-application-exit.md`](issue-169-graceful-application-exit.md)
to issue #209's executable evidence. It adds no lifecycle signal transport or
real host-process adapter; issue #210 owns those outer Linux boundaries.

## One executor suspension fails while other quick work is useful

Alice has requested Exit. The one application cutoff is closed. One registered
Run's exact executor suspension reports a conclusive diagnostic while another
already-admitted owner, produced journal-write flush, and process-local release
can still make the retained workflow recoverable. Dalph starts these independent
quick drains concurrently. It starts no replacement attempt, tracker or Git
reconciliation, later integration phase, LLM request, or durable cleanup.

The executor failure is retained as application-lifecycle evidence as soon as
that family settles. Dalph lets the other useful quick work settle inside the
original five seconds, releases the coordinator lock only afterward, reports
one `Failed` result to every joined requester, and asks the process boundary for
nonzero forced termination. The application cassette contains the request,
cutoff, quick-family observations, one typed result, and one process-end
request. The Run cassette contains only its ordinary workflow facts.

Executable evidence:

- `finishes independent cross-family quick drains before reporting one shared conclusive failure`
  proves the executor and process-local families both start before either is
  allowed to finish, the earlier atomic owner releases without a successor,
  the maintained authored cassette matches the production trace, and the one
  result requests nonzero termination.
- `reports a direct executor-family drain failure and still performs every later quick drain`
  proves the transport-neutral boundary still flushes produced writes, closes
  process-local resources, and releases the coordinator lock after a direct
  executor failure.
- `continues every application-owned local drain after one sibling reports failure`
  proves independently registered process-local drains do not suppress one
  another's useful work.
- `retains a settled local-drain failure when its sibling remains stuck at the fifth second`
  proves each child publishes its diagnostic before the whole process-local
  family settles, so a useful stuck sibling cannot erase an earlier failure.
- `orders settled local-drain timeout diagnostics by registration rather than completion`
  proves concurrent child completion cannot make the typed diagnostic order
  depend on scheduler timing.
- `Alice exits successfully only after the running exact attempt is safely suspended`
  replays the production executor protocol and compares its ordinary recorded
  Run facts with the application-lifecycle authored cassette.

If Dalph dies before reporting the result, no application result is inferred.
`an authored process-death cut before the Exit result persists no cutoff or successful result`
and `reopens an unfinished Run normally after an authored Exit death cut`
prove that a fresh application restores neither the timer nor Exit mode and
uses ordinary Run establishment over the retained journal prefix.

## Useful work remains at the original fifth second

A registered executor suspension has already failed conclusively, but an
admitted atomic integration-family owner remains unresolved. A second Exit
request joins after the cutoff. The injected monotonic clock reaches five
seconds from the first cutoff. Dalph reports one shared `TimedOut` result with
the earlier executor diagnostic, asks for nonzero forced termination, and does
not release the atomic owner, manufacture executor safety, append a cleanup
disposition, or write an application Exit fact to the Run journal.

Executable evidence:

- `reports timeout with an earlier executor failure while an atomic owner remains stuck`
  proves the earlier family diagnostic remains visible, both joined requests
  receive the same result, the deadline is not reset, and exactly one nonzero
  process-end request is made.
- `retains a settled executor failure when another executor drain remains unconfirmed`
  proves each registered executor publishes a conclusive diagnostic before the
  entire executor family settles.
- `forcefully terminates at five seconds while an atomic integration section remains active`
  proves the owner remains registered and the typed process result requests
  forced status one.
- `reports timeout with an earlier produced-write diagnostic at the original fifth second`
  proves the same diagnostic retention for the journal-write family.
- `coalesces repeated Exit requests without resetting the fixed five-second deadline`
  proves a request joined at four seconds receives the original fifth-second
  result.
- `Alice receives timeout when the suspension response still reports the attempt running`
  proves missing executor evidence never becomes safe suspension.

## Model and negative-control mapping

The production shell consumes the existing `applicationExit` decision algebra;
issue #209 does not add a model action or loosen an invariant.

| Concrete outcome | Governing model or executable negative control |
| --- | --- |
| Failure waits for useful independent quick work. | `conclusiveFailureWaitsForUsefulQuickWork`; `earlyConclusiveFailureIsDetectedTest` |
| The fifth tick wins while unresolved work remains and retains prior diagnostics. | `fifthTickAtomicallyForcesTimedOutTermination`; `timeoutBeforeFifthTickIsDetectedTest`; `fifthTickWithoutForceIsDetectedTest` |
| Failure and timeout request nonzero termination. | `failureAndTimeoutRequestNonzeroForcedTermination`; `zeroStatusFailureIsDetectedTest` |
| Joined requests share one result and deadline. | `joinedRequestNeverResetsTheDrain`; `joinedRequestsReceiveOneSharedResult`; their timer-reset and result-divergence negative controls |
| Forced termination manufactures no workflow fact or durable disposition. | `applicationLifecycleNeverEntersWorkflowHistory`; `exitNeverDisposesDurableWorkflowResources`; `workflowExitRecordIsDetectedTest`; `durableResourceDisposalIsDetectedTest` |
| Restart restores no application lifecycle. | `restartRestoresNoApplicationLifecycleState`; `restoredLifecycleModeIsDetectedTest` |

`replays application Exit decisions through the production lifecycle kernel`
runs the existing production-backed MBT across these decisions. The final
`applicationExit` positive, negative-mutation, witness, and exhaustive proof
gates remain the formal evidence for the unchanged model.

## Deliberately deferred outer boundary

Issue #209 ends at the typed process-lifecycle request. Issue #210 installs the
Linux supervisor-signal adapter and real child-process host, proves the actual
operating-system status and process disappearance, and keeps macOS qualification
for issue #211. Neither deferred ticket may change the shared drain, diagnostics,
or original five-second decision without a newly accepted scenario.
