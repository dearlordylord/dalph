# Gracefully exit the Dalph application

Issue: [Specify graceful Dalph application Exit](https://github.com/dearlordylord/dalph/issues/169)

Status: operational behavior and focused model boundary accepted on 2026-08-10.
The accepted implementation-ticket edges are recorded below; this Wayfinder
changes no runtime behavior itself.

These scenarios change no Dalph runtime behavior by themselves. Issue #169 is
planning-only; focused implementation tickets must consume the accepted
chronologies and test seams.

An Operator command and a process-supervisor signal enter one transport-neutral
application-lifecycle protocol through different application-shell adapters.
Accepting the request closes one process-wide admission gate. V1 activates at
most one unfinished Run; startup fails closed before activation if it discovers
several. The following five seconds are available only for fast suspension,
the suspension intent and report writes required by that exact protocol,
already-produced journal writes, and release of process-local resources. Dalph
never sends an LLM message, waits for executor work to finish, starts fresh
reconciliation merely to make shutdown cleaner, or disposes a durable workflow
resource during this drain.

Graceful application Exit is not Pause, Run termination, task cancellation,
attempt abandonment, executor restoration, or coordinator death. Its request
and result are application-lifecycle values outside every Run workflow journal.

Dry-run, controlled-fake, test, and production interpreters use this same
request, cutoff, drain-action, and result algebra. Production alone asks its
process-lifecycle port to end the host process. Dry-run and tests use a
controlled port that records the exact would-be status without terminating the
test host; it cannot manufacture a Run workflow fact or claim that an operating
system process ended.

## Alice exits Dalph while no call or managed responsibility is active

### Starting situation

Alice is the Operator. The Dalph application holds the operating-system lock
for canonical Git common directory D. It may have established one unfinished
Run, but that Run has no live action owner, in-flight boundary call, held
process-local reservation, or running executor work. Its journal retains its
own workflow facts and no application Exit fact. If no Run has been
established, the same lifecycle chronology applies without Run workflow
history.

The task tracker owns task facts and claims, Git owns refs and worktrees, and
each Run journal owns only its recorded workflow history. No outside authority
must be read to make the already-idle process recoverable.

### Trigger and chronological behavior

1. Alice sends one graceful Exit request through the Operator-facing adapter.
2. The application shell accepts the request and closes the process-wide Exit
   admission cutoff as one indivisible decision.
3. No later proposal, control direction, Run stabilization read, or other
   forward-progress action can acquire a live owner.
4. Dalph flushes already-produced journal writes, closes scoped fibers, releases
   process-local reservations, and releases its coordinator lock. It does not
   release tracker claims, remove worktrees, terminate Runs, or clean durable
   workflow resources.
5. Before five seconds have elapsed from the cutoff, the shell reports
   `Succeeded` to Alice and exits with status zero.

If the process dies before step 2, the request may disappear and no durable
workflow fact changes. If it dies between steps 2 and 5, Alice has no successful
Exit result and a later startup treats the process loss as ordinary coordinator
death. Exact redelivery while the first request is live joins the same Exit
drain; it does not reset the five-second limit.

Alice sees one successful result and a stopped process. Dalph must not append an
Exit request or completion to a Run journal, manufacture Run termination, turn
the request into Pause, or infer success merely because the process disappears.

### Acceptance-test seam

- `exits successfully within five seconds when no action is active`
- `closes admission before reporting a successful idle Exit`
- `releases process-local ownership without disposing durable Run resources`
- `journals no application Exit request or result`
- `uses the same lifecycle algebra in dry-run without ending the test host`

## A supervisor requests Exit while a tracker or Git call is in flight

### Starting situation

There is no person at the trigger instant. A process supervisor controls the
running Dalph application. Run R has one live action owner for an exact tracker
or Git request. Dalph acknowledged the request's ordinary workflow intent before
sending it across the boundary. The outside system may have applied the request,
but Dalph has not recorded a conclusive result.

### Trigger and chronological behavior

1. The supervisor's lifecycle adapter receives its graceful-stop signal and
   submits the same transport-neutral Exit request used by the Operator adapter.
2. The shell closes the Exit admission cutoff. The existing action remains the
   owner of its exact protocol; no later action is admitted.
3. If the boundary result is already available, the owner records it and stops
   before the next forward-progress action.
4. Otherwise Dalph interrupts the local wait where the adapter permits. If the
   smallest accepted tracker or Git boundary cannot be interrupted, its owner
   may use only the remainder of the same five-second drain to return; Dalph
   records an already-produced result but starts no later protocol phase. At
   the limit, that still-live call follows the timed-out forced-termination
   chronology. Dalph does not issue a fresh tracker or Git read during Exit.
   An acknowledged intent without a recorded result remains unresolved and
   therefore recoverable.
5. Dalph removes the live owner and releases its process-local reservations.
   The exact claim, worktree, ref, integration resource, and workflow
   responsibility remain unchanged.
6. If every other Exit condition is satisfied before the fixed limit, the shell
   may report `Succeeded` even though this ordinary workflow request remains
   ambiguous: success proves recoverability, not the outside request's outcome.

If the process dies at any cut point, restart reads the acknowledged intent and
checks the tracker or Git before repeating the request. A successful graceful
Exit creates no alternate startup mode; the same reconciliation occurs when a
later invocation needs that responsibility.

The supervisor observes success only after the local action owner is gone and
the durable intent remains readable. Dalph must not wait indefinitely, invent
an outcome, send a duplicate request, begin reconciliation during Exit, or
dispose the resource named by the unresolved intent.

### Acceptance-test seam

- `leaves an interrupted tracker request behind an acknowledged intent for restart reconciliation`
- `records an immediately available Git result and starts no later action`
- `does not start fresh reconciliation during the Exit drain`
- `can exit successfully with a recoverable ambiguous boundary outcome`
- `bounds a non-interruptible tracker or Git call by the original Exit drain`
- `starts no later tracker or Git protocol phase after that call returns`

## Alice exits while executor work is running

### Starting situation

Alice is the Operator. Run R retains planned attempt P for task A and its exact
`(RunId, AttemptId)` correlation. The executor has reported `Running`. Dalph
holds P's task-work position and may hold other process-local guards. The
tracker claim, planned worktree, WIP, evidence, and responsibility must survive.

The executor owns whether all activity for P is safely suspended. Killing an
inner worker or interrupting a Dalph fiber does not prove that condition.

### Trigger and chronological behavior

1. Alice requests Exit and the shell closes the Exit admission cutoff.
2. Dalph records the existing planned-attempt suspension-command intent required
   by the ordinary executor protocol, then calls `requestSuspension` for P.
3. The production executor adapter uses a fast control path. It sends no LLM
   message and does not ask the executor to finish its work.
4. If the executor reports exact `SafelySuspended` or `Terminal` before the
   drain limit, Dalph records that report. Only that report permits release of
   P's task-work position.
5. Dalph preserves P, its worktree, WIP, claim, evidence, and every later
   workflow obligation. If all application-level Exit conditions are now met,
   the shell reports `Succeeded` and exits zero.

If process death or the drain limit arrives after the suspension intent but
before the report, Dalph does not record safe suspension and does not durably
release P's position. The process-local position disappears with the process;
restart reconstructs it from the unfinished exact responsibility and consults
the executor through its accepted recovery boundary.

Alice sees either successful Exit after confirmed suspension or a non-graceful
timeout result. Dalph must not send an LLM message, await terminal completion,
infer suspension from process death, allocate a replacement attempt, or delete
preserved work.

### Acceptance-test seam

- `uses the fast non-LLM executor suspension path during Exit`
- `exits successfully after every running attempt confirms exact safe suspension`
- `retains the unfinished attempt when suspension is unresolved at timeout`
- `never waits for executor completion during Exit`

## Exit arrives during a non-interruptible atomic boundary

### Starting situation

Run R has one live action owner inside the smallest accepted non-interruptible
section of an integration, journal, evidence, or cleanup protocol. Its required
intent is already acknowledged. The action has not started its next protocol
phase.

### Trigger and chronological behavior

1. An Operator or supervisor requests Exit and the shell closes the cutoff.
2. Dalph gives the admitted owner only the remainder of the same five-second
   drain. It does not extend or reset the limit.
3. If the atomic section returns in time, Dalph records any already-produced
   result, releases the local owner, and starts no later protocol phase.
4. If the section still has not returned when the limit expires, the shell
   reports `TimedOut` best-effort and forcefully ends the process with a nonzero
   status. It does not run unbounded cleanup first.
5. A later startup uses the acknowledged intent and the owning external system
   to reconcile the possibly ambiguous effect.

No person is promised that a non-interruptible section will finish. Dalph must
not exceed the fixed limit in order to call Exit graceful, roll back an outside
effect automatically, or record an outcome it did not observe.

### Acceptance-test seam

- `lets an admitted atomic section finish only within the remaining Exit drain`
- `starts no later protocol phase after an atomic section returns under Exit`
- `forcefully terminates at five seconds while an atomic section remains active`

## Dalph dies before a requested Exit reaches a successful result

### Starting situation

The shell has received an Exit request. Depending on the cut point, it has not
yet closed admission, or it has closed admission and begun the drain. Run R has
the workflow history established before process death; there is no journaled
application Exit fact.

### Trigger and chronological behavior

1. The process dies before returning `Succeeded` to its requester.
2. The requester observes connection loss, a signal result, or missing success;
   silence does not become an Exit outcome.
3. On later startup, Dalph scans and validates ordinary Run histories. It does
   not look for an Exit marker or restore the old process-local cutoff.
4. It reconstructs exact unfinished responsibilities and reconciles each
   unresolved workflow intent through the tracker, Git, or executor that owns
   its outcome.
5. The new invocation admits work only through ordinary establishment,
   description, planning, and runtime rules.

Dalph must not infer graceful Exit from a missing process, replay the lost Exit
request, synthesize safe suspension, or skip recovery because the prior shell
had begun draining.

### Acceptance-test seam

- `treats death before an Exit result as ordinary startup recovery`
- `does not persist or replay the prior process Exit cutoff`
- `does not infer safe suspension or graceful success from process death`

## The Exit drain reaches five seconds

### Starting situation

The Exit admission cutoff is closed. At least one executor has not confirmed
safe suspension, one local action has not relinquished ownership, or one
accepted atomic section remains active. The exact workflow history committed
before the timeout remains crash-consistent.

### Trigger and chronological behavior

1. Five seconds elapse on a monotonic clock measured from the original cutoff.
2. The shell stops the graceful drain. It reports `TimedOut` through any
   still-available lifecycle response and diagnostic seam on a best-effort
   basis.
3. The shell forcefully terminates remaining local activity and ends the Dalph
   process with a nonzero status. It does not wait for an outside supervisor to
   make the application's timeout effective.
4. The forced termination creates no workflow occurrence and proves no executor
   suspension, external outcome, cleanup disposition, or Run termination.
5. A supervisor may independently enforce its own process policy, but its timer
   and implementation are outside Dalph and this specification.
6. A later startup follows the ordinary recovery chronology for every retained
   responsibility and unresolved intent.

The Operator or supervisor sees that graceful Exit timed out rather than
succeeded. Dalph must not reset the clock for a repeated request, extend the
drain for cleanup, or rewrite forced termination as graceful completion.

### Acceptance-test seam

- `forcefully terminates with nonzero status at the fixed five-second limit`
- `reports timeout without manufacturing workflow outcomes`
- `restarts after timeout through ordinary unresolved-intent reconciliation`

## A quick drain operation fails conclusively

### Starting situation

Alice or a process supervisor initiated the Exit request and is waiting for its
typed result. The Exit admission cutoff is closed. Dalph is performing several
independent quick drain operations. One executor rejects its exact suspension
request or the journal rejects a write that must be acknowledged before
graceful success. Other useful quick suspension, flush, or local-release
operations may still be running within the original five-second limit.

### Trigger and chronological behavior

1. Dalph retains the conclusive error as application-lifecycle diagnostic
   evidence. It records no invented workflow outcome for the failed operation.
2. The error makes `Succeeded` unreachable for this drain, but Dalph does not
   interrupt independent useful quick drain operations merely to fail faster.
3. Dalph starts no replacement operation, fresh reconciliation, LLM request, or
   durable-resource cleanup. It only lets the already-started useful drain work
   settle within the original limit.
4. If no useful quick drain operation remains before the limit, the shell
   reports `Failed` with the accumulated diagnostics and forcefully terminates
   the process with a nonzero status immediately.
5. If useful drain work remains unresolved when five seconds elapse, the shell
   reports `TimedOut`, includes every earlier conclusive failure in its
   diagnostics, and follows the timeout forced-termination chronology.
6. Joined Exit requests receive the same result and diagnostics.

A later startup uses ordinary workflow history and outside authority. Dalph
must not wait out an otherwise idle clock after failure is conclusive, call the
failed executor safe, turn a journal error into an acknowledged write, or
discard preserved workflow resources.

The requester sees one shared `Failed` result with the accumulated diagnostics,
or `TimedOut` with those diagnostics when useful drain work remains at the
limit. The requester must not see `Succeeded`, a fabricated workflow outcome,
or a reset deadline.

### Acceptance-test seam

- `finishes independent useful drain work before reporting a conclusive failure`
- `forcefully terminates immediately when failure is conclusive and no useful drain work remains`
- `reports timeout with earlier failure diagnostics when useful drain work remains at five seconds`
- `returns the same failure and diagnostics to every joined Exit request`

## Startup follows successful Exit and ambiguous interruption identically

### Starting situation

In the first history, the prior shell reported `Succeeded` after all running
executors became safely suspended and all local owners disappeared. In the
second history, the prior process died or timed out with an acknowledged
workflow intent lacking its observation. Neither history contains an
application Exit event.

### Trigger and chronological behavior

1. A person or supervisor starts Dalph again with an exact allocated Run and
   target according to ordinary Run-entry rules.
2. Dalph validates complete Run history without selecting a graceful-versus-
   crash restoration mode.
3. In the successful-Exit history, recorded safe-suspension reports and other
   workflow outcomes are available as ordinary evidence; current authority is
   still read wherever the responsibility's continuation protocol requires it.
4. In the interrupted history, unresolved intents cause their ordinary owning
   protocols to reconcile before retry.
5. Process-local gates, owners, positions, timers, and Exit results are never
   restored. Positions are reconstructed from exact unfinished
   responsibilities under the existing rules.

The person may know the prior shell result, but startup does not treat that
result as workflow authority. Dalph must not skip fresh reads after successful
Exit or impose extra recovery events after ambiguous interruption.

### Acceptance-test seam

- `uses one ordinary Run entry after both graceful Exit and process death`
- `uses recorded safe suspension but still performs required current reads`
- `reconciles unresolved intents without an Exit restoration mode`

## Exit races with Pause, Unpause, Run termination, and another Exit

### Starting situation

Alice submits Pause or Unpause for Run R while a supervisor submits Exit. In a
separate test lane, the same Run R has enough established evidence to propose
its final termination record. The application has not yet linearized these
requests against its process-wide cutoff.

### Trigger and chronological behavior

1. The application control boundary orders each application or workflow action
   against the indivisible Exit admission cutoff.
2. A Pause or Unpause applied and journaled before the cutoff remains durable.
   Exit does not reverse it.
3. After the cutoff, an unapplied Pause or Unpause request receives typed
   `ApplicationExiting` and is not journaled.
4. A Run-termination owner admitted before the cutoff may finish only its
   current quick local journal boundary. If a pre-cutoff stabilization read
   returns after the cutoff, Dalph may record that already-produced observation
   but cannot admit the later termination append. Only a termination append
   already linearized before the cutoff may finish. Exit does not start
   stabilization or fresh authority reads to make R terminate.
5. R remains recoverable unless it was already durably terminated. Exit
   manufactures no Run-wide or task-scoped control direction.
6. Repeated Exit requests join the same drain and receive its one eventual
   `Succeeded`, `Failed`, or `TimedOut` result. They neither create another
   drain nor reset its clock.
7. A several-unfinished-Run starting situation does not apply in V1: ordinary
   startup discovery rejects it before constructing an activation or accepting
   Run work. Supporting several active Runs requires a separate accepted
   architecture change and does not enlarge this Exit model.

Alice sees either her already-applied workflow direction or
`ApplicationExiting`; she never sees an Exit request presented as Pause. Dalph
must not apply a control request after the cutoff or treat unfinished R as
terminated.

### Acceptance-test seam

- `orders applied Pause before Exit without erasing it`
- `rejects unapplied Pause and Unpause after the Exit cutoff`
- `does not stabilize or terminate a Run merely to complete Exit`
- `coalesces repeated Exit requests without resetting five seconds`
- `rejects several unfinished Runs before constructing an Exit-capable activation`

## Authority and ownership map

| Boundary | Owns | Dalph retains or reports |
| --- | --- | --- |
| Operator or process supervisor | initiation of one application Exit request | process-local request source only; no authenticated person identity |
| Application shell | Exit admission cutoff, one five-second drain, typed lifecycle result, and requested process exit code | reports that result and requested code to its adapter; no durable Exit history |
| Run workflow runtime | live action owners, fibers, admission reservations, and process-local positions | nothing durable; all are released or disappear at process death |
| Run workflow journal | acknowledged workflow intents, observations, responsibilities, executor reports, and Run lifecycle | workflow history only; no Exit request, result, timeout, signal, or coordinator-death event |
| Task tracker | current task, claim, dependency, grouping, and lifecycle facts | exact journaled intents and observations required by existing protocols |
| Git | refs, commits, worktrees, lineage, and integration state | exact journaled intents and observations required by existing protocols |
| Dalph executor | complete planned-attempt work and exact running, safely-suspended, or terminal report | exact correlation, command intents, and reports in the Run journal |
| Execution substrate | executor-internal sessions and processes | no direct Dalph inference; only the executor's normalized report crosses the boundary |
| Operating system | actual process existence, signal delivery, termination, and observed exit status | Dalph retains no OS authority; a caller or supervisor may observe termination and status, while disappearance alone is not graceful proof |

## Domain placement

The application-lifecycle protocol requires exhaustive, typed request source,
drain result, application-exiting rejection, and fixed-duration values at the
application shell. They are not production workflow occurrences and do not
enter the workflow-event registry, occurrence projection, Run reducers, or Run
journal schema.

The existing planned-attempt suspension command intent and exact executor
report remain workflow facts. Exit reuses `requestSuspension`; its production
adapter must establish that the call is a fast non-LLM control path. A new
executor identity, executor-internal stage, cancellation outcome, or Exit-
specific safe-suspension report is forbidden.

Already-sent evidence and cleanup calls follow their existing protocol shape.
An interruptible call may leave a recoverable ambiguity only behind its
acknowledged exact intent. The smallest accepted non-interruptible evidence or
cleanup section may finish only within the remaining Exit drain. Exit starts no
new evidence production or durable-resource disposition and never changes an
exact cleanup disposition merely to make process shutdown succeed.

## Focused Quint model decision

Issue #169 requires one new subject-scoped application-lifecycle model. It is
the eighth governed model under ADR 0010 because the process-wide admission
cutoff, drain clock, application-shell result, and forced termination have a
different lifecycle and executable consumer from every Run workflow model.

The application is one actor coordinating shared runtime state, so the model
uses plain Quint rather than Choreo. It contains one V1 Run, several fixed
forward-owner and executor-attempt slots, and these distinct state families:

- application lifecycle: serving, draining, reported success or failure, and
  process gone through graceful, failed, timed-out, or unexpected termination;
- admission handoff: idle, preparing process-local reservations, or one exact
  registered forward-progress owner;
- typed boundary owners: interruptible ambiguity-crossing call, atomic section,
  or already-authorized Run-termination journal boundary;
- exact executor attempts: not started, running, suspension intent recorded,
  fast suspension called, safely suspended, or terminal;
- drain resources: produced journal writes, Exit-only action owners,
  process-local reservations and fibers, and coordinator-lock ownership; and
- a minimal durable projection proving that workflow intents, applied controls,
  Run termination, and durable resources change only through their existing
  protocols while the workflow Exit-record count remains zero.

Five abstract monotonic ticks govern the model. The fifth tick atomically
produces timed-out forced termination when success has not occurred. The model
proves tick ordering and non-reset; injected-clock application tests prove five
real seconds on macOS and Linux.

The model must prove at least:

- admission permission and live-owner registration cannot straddle the cutoff;
- no forward-progress owner appears after the cutoff, while only enumerated
  Exit-drain actions may begin;
- exact safe-or-terminal evidence releases only its correlated attempt;
- an ambiguous tracker, Git, evidence, or cleanup effect is recoverable only
  behind an acknowledged exact intent;
- success requires acknowledged produced writes, no live owner, no unsafe
  executor, no reservation or fiber, and a released coordinator lock;
- repeated Exit joins one drain without resetting its clock;
- Exit starts no LLM request, fresh reconciliation, stabilization read,
  durable-resource cleanup, or later Run-termination action;
- failure terminates nonzero after useful quick work settles, while timeout
  terminates nonzero on the fifth tick; and
- Exit request, result, timeout, failure, and process death never enter Run
  workflow history or survive as application-lifecycle state after restart.

## Scenario-to-test and model mapping required at handoff

| Scenario | Focused Exit-model evidence | Existing model or protocol retained | Required executable evidence |
| --- | --- | --- | --- |
| Idle Exit | cutoff, empty drain, write flush, lock release, success-report ordering | coordinator-lock lifecycle | application-shell test with injected clock and lock |
| In-flight tracker or Git call | typed interruptible owner becomes known result or durable recoverable ambiguity | tracker/Git reconcile-before-retry protocols | runtime cut-point test plus reopening reconciliation test |
| Running executor | suspension intent, fast call, exact safe-or-terminal release; foreign report negative control | `plannedAttemptExecutor` | controlled-executor adapter proving no LLM call and exact report correlation |
| Non-interruptible atomic boundary | atomic owner finishes before tick five or remains until timed-out termination | owning integration, evidence, journal, or cleanup protocol | deterministic return/stuck cut-point tests |
| Death before successful result | unexpected process loss cannot report success or persist lifecycle state | `runActivation` | authored cassette death cut points and ordinary reopening test |
| Five-second timeout | ticks never reset; fifth tick atomically force-terminates | none; wall-clock mechanics are application-shell owned | injected monotonic-clock and nonzero-process-result tests |
| Conclusive quick failure | useful independent drain work settles; failure or later timeout is shared by joined requests | exact failing boundary retains its own error semantics | concurrent drain test with early failure and stuck-work lanes |
| Startup after success or ambiguity | lifecycle state is absent after process loss | `runActivation` and owning reconciliation models | one ordinary Run-entry test for both histories |
| Pause, Unpause, termination, and repeated Exit races | cutoff linearization, post-cutoff rejection, joined result, no timer reset | `controlDirectionApplication` and Run finality protocol | deterministic race tests around the shared admission boundary |
| Several unfinished Runs | no Exit-model action: starting situation is rejected in V1 | `runActivation` startup discovery | existing/focused test rejects several unfinished Runs before activation |

Every seam above requires a passing application-shell, runtime, controlled-
executor, reopening, or cassette test. Aggregate coverage and package checks do
not replace the mapping. A maintained authored cassette may carry
application-lifecycle entries for Exit request, cutoff, timeout, failure, and
process death, but projection must include only workflow occurrences actually
recorded by Dalph.

The new model requires its own production-backed conformance adapter over the
application shell, runtime owner registry, and controlled lifecycle boundary.
It must also receive collected `*Test` scenarios, explicit invariant and witness
gate entries, exhaustive verification, mutation analysis, and negative controls
for every forbidden transition. Existing Run-scoped models must not acquire
application-lifecycle state merely to reuse a file.

## Focused implementation tickets and blocking edges

Issue #169 remains planning-only. Its native GitHub sub-issues deliver the
accepted behavior in dependency order:

1. [#203 Model the graceful application Exit lifecycle](https://github.com/dearlordylord/dalph/issues/203)
   is blocked by #169 and establishes the canonical model, lifecycle decision
   kernel, and production-backed conformance seam.
2. [#204 Exit an idle activation through one shared lifecycle gate](https://github.com/dearlordylord/dalph/issues/204)
   is blocked by #203 and establishes the shared cutoff, idle success, joined
   requests, control/finality races, journal flush, and coordinator-lock release.
3. [#205 Suspend running executor work during application Exit](https://github.com/dearlordylord/dalph/issues/205),
   [#206 Preserve interruptible tracker and Git calls during application Exit](https://github.com/dearlordylord/dalph/issues/206),
   [#207 Bound integration verification and evidence work during application Exit](https://github.com/dearlordylord/dalph/issues/207),
   and [#208 Preserve exact cleanup dispositions during application Exit](https://github.com/dearlordylord/dalph/issues/208)
   are independently blocked by #204 and qualify their distinct boundary
   families through complete scenario/test/model slices.
4. [#209 Force application termination after drain failure or five seconds](https://github.com/dearlordylord/dalph/issues/209)
   is blocked by #205, #206, #207, and #208 and composes their useful quick work
   under the accepted failure and timeout outcomes.
5. [#210 Accept supervisor Exit signals and qualify Linux automatically](https://github.com/dearlordylord/dalph/issues/210)
   is blocked by #209 and supplies the production host/signal seam plus real
   Linux subprocess evidence without inventing a remote Operator transport.
6. [#211 Manually qualify graceful application Exit on macOS](https://github.com/dearlordylord/dalph/issues/211)
   is blocked by #210 and is deliberately human-only without the
   `ready-for-agent` label. It records exact platform, toolchain, commit,
   command, timing, status, and coordinator-lock evidence unavailable in the
   Linux agent environment.

Every implementation issue repeats its owned operational outcome and requires
its own scenario-to-test/model mapping, authored/recorded cassette evidence,
focused tests, domain/spec review, architecture/connascence review, strict code
review, and `pnpm check:all`. Modeled changes also update and run the governing
Quint checks in the same dependency path.
