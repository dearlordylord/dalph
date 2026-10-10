# The Operator exits while Dalph is acquiring its production host

## Governing accepted behavior

This maps existing behavior into the shipped CLI composition. It introduces no
new product policy. The [idle NoRun Exit chronology](graceful-application-exit.md#alice-exits-dalph-while-no-call-or-managed-responsibility-is-active)
and [provider startup S6](shared-codex-provider-home.md#s6-exit-keeps-its-original-fixed-drain)
require application-level Exit, one cutoff and the original five-second drain.
Provider startup keeps its existing intent, exact containment, startup deadline
and custody reconciliation. [CLI output grace](cli-exit-output-grace.md) owns
only presentation after a result exists. No application Exit fact enters a Run
journal, and missing process/output never proves stopped foreign writers.

## B1 The request arrives before the first acquisition

Starting facts: CLI configuration passed decoding; the host constructed its one
application shell. No foundation/provider acquisition or Run beginning occurred.
Chronology: register ownership of the pending acquisition before installing the
signal transport. SIGINT/SIGTERM enters that shell; its first request interrupts
only the acquisition's forward wait and prevents starting the blocked acquisition.
The registered drain observes its completed outcome before Succeeded. Repeated
signals join the same result and retained first timestamp.
Visible result: application-only lifecycle reporting and status, no RunSelected
record or invented RunId. Forbidden: acquiring resources after that cutoff,
constructing a replacement shell or persisting an Exit mode.
Crash/retry: no acquisition effect was attempted; ordinary startup remains the
next invocation. Tests: `production-host-acquisition.test.ts`, `Exit before the
acquisition start permits no boundary call`.

## B2 Coordinator and Journal are acquired before provider initialization

Starting facts: the exact production host holds coordinator ownership and opened
SQLite; no selected observation has been acknowledged. Provider startup may own
an exact retained intent, admission descriptor or acknowledged child.
Chronology: the early signal transport requests the same shell. Acquisition stops
forward progress on its first request. Existing provider startup races that same
request and joins its cached exact cleanup. The host acquisition drain observes
that outcome. Foundation resources stay in the enclosing host scope until the
caller reports the lifecycle result and returns; finalization releases them.
Visible result: truthful Succeeded/Failed/TimedOut and existing private startup
intent/absence evidence, with application-only output if no observation reached
the caller. An admitted Run beginning, if any, remains its own Journal fact; lack
of RunSelected output does not prove no Run exists.
Forbidden: another initialize/Begin after cutoff, deleting unresolved custody,
using an unlocked descriptor as foreign-writer proof or manufacturing selection.
Crash/retry: reconcile original startup/launch identity and namespace before a
permitted retry; do not reset the startup or Exit deadline.
Tests: acquisition tests `acquired resources remain owned through lifecycle
reporting`, and composed `production-host-exit`/native CLI probe with real
coordinator/SQLite; preserve the exact queued/pre-initialize S6 tests in
`codex-app-server.test.ts`.

## B3 Cleanup is unresolved or conclusively fails

Starting facts: acquisition is active and its already-acquired resource cleanup
cannot finish, or acquisition/finalization produces a conclusive failure.
Chronology: at five seconds the same shell can report TimedOut without claiming
cleanup completion. The acquisition owner retains its exact cleanup until it
settles; canceling a result wait cannot abandon the writer fence. Host finalizers
still own process completion. A conclusive typed acquisition failure keeps its
identity even when Exit is concurrently requested; successful Exit cannot erase it.
Visible result: exact timeout/failure and retained unresolved custody. Forbidden:
extra startup drain, false successful cleanup, swallowed typed error or retry.
Crash/retry: existing S4/S6 reconciliation and stopped-writer proof apply.
Tests: acquisition tests `the lifecycle timeout remains observable while owned
acquisition cleanup is pending` and `Exit cannot replace a conclusive acquisition
failure`; preserve `Exit times out at its original five seconds while startup
cleanup remains unresolved` in `codex-server-startup.test.ts`.

## B4 Acquisition finishes normally

Starting facts: no Exit request prevented the complete selected host observation.
Chronology: retire the acquisition-only drain, then invoke the existing callback
in the same host resource scope. The already-installed transport remains owned
there; the selected presenter uses its first request/result observations.
Visible result: existing records, host lifetime and failure identity. Forbidden:
closing foundation resources on acquisition-fiber completion, duplicate signal
installation, or making a passive output adapter own workflow admission.
Crash/retry: unchanged selected-Run and provider protocols.
Tests: acquisition tests `normal acquisition retires its drain without closing
host resources` and `normal acquisition retains its fiber children until the host scope closes`, existing production host/CLI/host-watch checks and first-signal
transport tests. Application-only output uses the existing lifecycle diagnostic
shape and public redacted disposition, under the same output allowance; it emits
no selected-Run record or new workflow fact.
