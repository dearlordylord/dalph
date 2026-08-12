# Suspend running executor work during application Exit

Issue: [Suspend running executor work during application Exit](https://github.com/dearlordylord/dalph/issues/205)

Status: implemented from the accepted executor chronology in
[`issue-169-graceful-application-exit.md`](issue-169-graceful-application-exit.md).

## Alice exits while one exact planned attempt is running

Alice is the Operator. One activated Run retains an unfinished executor-work
responsibility for task A's immutable planned attempt. Its latest exact
`(RunId, AttemptId)` report is `Running`, so Dalph retains its task-work
position. The tracker owns A's claim, Git owns its branch and worktree, the
executor owns whether all activity is safely suspended, and the Run journal
contains the attempt plan, responsibility, commands, and reports. The
application lifecycle contains no Run workflow fact.

Alice submits the transport-neutral Exit request. The application shell closes
forward-progress admission before starting its executor-family drain. The
active Run derives every exact attempt whose newest journaled executor evidence
is `Running`; it does not allocate an executor identity, operation identity, or
replacement attempt. For each attempt, Dalph uses the ordinary executor
protocol to append `PlannedAttemptExecutorCommandIntended` with command
`Suspend` before it calls `requestSuspension`. That boundary cannot call
`startOrContinue`, send an LLM request, or ask the executor to finish.

When the executor returns the same correlation with `SafelySuspended` or
`Terminal`, Dalph appends the ordinary report. That evidence makes the exact
task-work position no longer required. Only after every running attempt reaches
that boundary may the shell finish its ordinary owner, resource, and
coordinator-lock release and report `Succeeded`. The claim, planned worktree,
WIP, evidence, attempt, and later workflow obligations remain unchanged.

If the call returns `Running`, the attempt remains unsafe and the drain waits
only until the original five-second application deadline. A foreign or
contradictory report is recorded by the ordinary executor protocol and becomes
a typed drain diagnostic rather than safe evidence. If response loss or process
death occurs after the intent append, no safe report is invented and no second
suspension command or fresh executor projection begins during Exit. The
unfinished exact responsibility remains for ordinary startup recovery, which
consults the executor through its existing recovery boundary. Re-delivered Exit
requests join the same application drain and deadline.

Alice sees `Succeeded` only after exact safe-or-terminal evidence. Otherwise
she sees the shared failure or timeout outcome supplied by the application
lifecycle. Dalph must not infer suspension from fiber interruption or process
death, release the position for missing, running, or foreign evidence, resume
or replace the attempt, start reconciliation, remove its claim or worktree, or
append an application Exit fact to the Run journal.

## Scenario-to-test mapping

| Concrete outcome | Passing evidence |
| --- | --- |
| Derive the exact running attempt without another identity. | `discovers the exact running planned attempt from accepted Run history without another identity` |
| Append the ordinary suspension intent before the fast non-LLM call, then append exact safe evidence. | `records the exact suspension intent before the fast call and records safe evidence afterward` |
| Treat an exact terminal response as a safe boundary without waiting for another executor outcome. | `accepts an exact Terminal suspension response as the attempt's safe Exit boundary` |
| Request suspension independently for every exact running attempt retained by the Run. | `requests suspension for every running exact planned attempt retained by the Run` |
| Reject a foreign executor report, record the contradiction, and retain unsafe status. | `rejects a foreign suspension report and records the contradiction without releasing safety` |
| Preserve an acknowledged intent without manufacturing a report when the response is lost. | `retains an acknowledged suspension intent when the fast call has no response` |
| Do not retry or begin a fresh executor projection when Exit finds an already-unresolved executor command. | `does not retry or project an already-unresolved executor command during Exit` |
| Close admission, suspend the running attempt, preserve the Run journal as workflow-only history, then report application success. | `Alice exits successfully only after the running exact attempt is safely suspended` |
| Keep the active Run services alive until the executor-family drain settles; idle Runs still close normally. | `keeps the active Run alive until its exact executor-family Exit drain finishes`; `an idle application Exit closes its runtime, releases the coordinator lock, and journals no Exit fact` |
| Preserve a pre-cutoff Run whose executor drain registers after the driver's first capture, and start that late drain under the original deadline. | `drains an admitted Run that registers after the Exit driver captured its first executor set` |
| Prevent a pre-cutoff Run scope from unregistering its executor drain between the cutoff and driver capture. | `keeps a pre-cutoff executor drain registered when its Run scope closes before driver capture` |
| Exact safe-or-terminal evidence controls position release for every model trace. | `application-exit.mbt.test.ts`; `applicationExit` model tests and negative controls named in the issue-203 mapping |

The authored application cassette is request → cutoff → exact running executor
work reached a safe boundary → produced writes flushed → process-local resources closed → lock
released → result reported → process end requested. Its recorded Run cassette
contains only the pre-existing responsibility and report followed by the
ordinary suspension intent and exact safe-or-terminal report.

## Deliberately deferred boundary families

Issue #206 owns tracker and Git calls, #207 owns integration/evidence atomic
sections, and #208 owns cleanup dispositions. Issue #205 adds none of their
release or retry policies. Issue #209 composes every family under forced host
termination; #210 owns supervisor signal transport and the production host
process adapter.
