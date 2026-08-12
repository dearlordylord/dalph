# Accept Linux supervisor Exit signals at the application host

Issue: [#210 Accept supervisor Exit signals and qualify Linux automatically](https://github.com/dearlordylord/dalph/issues/210)

This file narrows the production-host and Linux evidence owned by issue #210.
It consumes, but does not change, the application-lifecycle behavior accepted
in `issue-169-graceful-application-exit.md`. `SIGTERM` is the V1 Linux
supervisor signal. A remote Operator transport, a public production CLI, a
supervisor implementation, and macOS qualification remain outside this issue.

## A Linux supervisor stops an idle Dalph host

There is no person at the trigger instant. A Linux process supervisor controls
one Dalph child. The child has installed its signal adapter in the outer
application scope and holds the coordinator lock for one exact Git common
directory. Its Run journal either does not exist or contains only ordinary Run
workflow facts. No forward-progress owner or executor responsibility is live.

The supervisor sends `SIGTERM`. The adapter submits the same transport-neutral
Exit request exposed to an in-process Operator. The application closes
admission, flushes produced writes, closes process-local resources, releases
the coordinator lock, and reports the lifecycle result through the host
diagnostic seam. Only then does the host end with status zero. Closing the
outer scope removes the exact signal listener.

If the process dies before the typed result is reported, disappearance is not
success. A later child starts with no restored Exit mode and reads only the
ordinary journal prefix. Signal receipt, listener removal, and process death
are never appended as Run workflow occurrences.

The supervisor sees a structured `Succeeded` diagnostic followed by status
zero. Dalph must not translate `SIGTERM` into Pause, Run termination, or a
journal occurrence; report success merely because the child disappeared; or
retain a signal listener after its host scope closes.

Acceptance tests:

- `an idle Linux child reports successful Exit and status zero after SIGTERM`
- `removes the Linux supervisor signal adapter when the host scope closes`
- `signal receipt, scope closure, and unexpected death leave only the ordinary journal prefix`
  runs both graceful `SIGTERM` and unexpected `SIGKILL` children and proves no
  application-lifecycle entry reaches the Run journal.

## A Linux supervisor stops running controlled executor work

The child owns one exact planned attempt and its controlled executor has
reported `Running`. The task-work position, worktree, claim, WIP, and journaled
responsibility remain present. No real LLM boundary exists in this controlled
host fixture.

The supervisor sends `SIGTERM`. The same Exit boundary closes admission,
records the exact suspension intent, uses the fast controlled suspension path,
and records the correlated `SafelySuspended` report. Only that report releases
the process-local task-work position. The host emits `Succeeded` and ends with
status zero while preserving the workflow artifacts and ordinary journal
evidence.

If the child dies before the report, the child does not synthesize safe
suspension. Restart follows the existing planned-attempt recovery protocol.

The supervisor sees success only after exact suspension evidence. Dalph must
not wait for executor completion, send an LLM request, manufacture a report
from signal receipt, or delete preserved work.

Acceptance test:

- `a running controlled executor suspends before its Linux child exits zero`
  exercises the ordinary planned-attempt command protocol and observes the
  journaled suspension intent before the exact safe report and lifecycle result.

## Repeated Linux signals join one stuck atomic drain

The child has admitted one atomic owner and entered a controlled section that
does not return. The section's ordinary intent is already acknowledged. The
supervisor sends `SIGTERM`, waits until the child reports that the cutoff is
closed, and sends `SIGTERM` again before the original five seconds elapse.

Every signal receipt submits the same transport-neutral request. The first
request owns the cutoff and monotonic deadline; the later request joins it. No
later action starts. At the original five-second limit, the host emits one
`TimedOut` result and ends the process with nonzero status without waiting for
the supervisor to kill it.

The supervisor sees that the elapsed drain is measured from the first signal
and sees one nonzero process result. Dalph must not start another drain, reset
or extend the deadline, infer the atomic effect's result, append an Exit fact,
or wait indefinitely for the stuck section.

Acceptance tests:

- `repeated SIGTERM joins the original stuck Linux child drain and exits nonzero at five seconds`
  proves both the stuck boundary and unchanged original deadline.

## A successor child acquires the same coordinator lock

After either the idle-success child or the nonzero forced-termination child
has ended, the supervisor starts a second child against the exact same Git
common directory. The first child no longer exists; its Run journal contains
only workflow facts committed by ordinary protocols.

The successor asks the operating-system lock boundary for ownership. It
acquires the lock and reports readiness. It does not read an Exit result or
restore the prior process-local cutoff. No retry of the prior signal applies:
signals are operating-system deliveries to one process incarnation.

The supervisor sees the successor acquire ownership. Dalph must not leave a
live coordinator-lock holder after either process status, persist lifecycle
mode into the Run journal, or require an Exit-specific recovery path.

Acceptance test:

- `a successor Linux child acquires the coordinator lock after zero success and nonzero failed or timed-out Exit`

## Deliberately deferred

Issue #211 records equivalent evidence on supported Apple hardware. This Linux
automation does not qualify macOS. A production `dalph exit` command, remote
Operator identity, configurable signal, or supervisor-owned deadline needs a
separately accepted scenario.
