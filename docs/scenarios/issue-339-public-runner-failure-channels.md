# Alice receives a failed command without corrupting structured stdout

## Governing behavior

This #339 repair preserves #260's accepted public wire and unexpected-defect
contract. Known typed failures retain their existing redacted structured
records. Unexpected defects use stderr and a nonzero process result, not a
fabricated public failure variant. It changes no workflow decision, provider
request, retry, Journal occurrence, signal ownership or Quint transition.

## Starting facts and trigger

Alice runs the ordinary built production command. Its shared Node runner owns
the host process result; the application owns SIGINT/SIGTERM and presentation.
Public stdout is schema-versioned newline-delimited JSON. The application may
already have written a known typed failure, or may have completed its workflow
before a scoped resource's finalizer fails.

Hosted verification rejected a human-readable `ERROR ... CodexAppServerFailure`
line on stdout in two public recovery cases. Effect's default main runner logs
terminal causes automatically. The exact underlying Codex failure is not yet
proven; this repair must not suppress that failure or claim those cases passed.

## Ordered calls and visible result

1. A known typed command failure follows the existing public mapper, including
   its redaction and best-effort output rules. The failed effect remains failed.
2. The shared Node runner disables Effect's additional terminal cause dump.
   It does not weaken the public decoder or alter the application effect.
3. If the terminal cause contains an unexpected defect, including a failed
   finalizer, the runner best-effort writes one static safe diagnostic to stderr.
   It does not serialize the cause, private payloads or provider transcripts.
4. Existing teardown still selects the process result from the original exit.
   Failure remains nonzero even when diagnostic output is unavailable. A normal
   success remains zero. Signal ownership stays exclusively in the application.

Alice receives only existing public JSON records on stdout. An unexpected
defect has a safe stderr diagnostic and a nonzero result. Scope disposal is not
graceful application Exit, Run termination, proof of provider failure or retry
permission. No crash/restart algorithm changes: the next invocation reads the
same owning authorities through ordinary recovery. No live provider call is
needed for the controlled runner tests.

## Forbidden results and scenario-to-test mapping

- Known typed failure with a private sentinel → actual built Node runner test proves
  status one and no additional terminal cause dump or private payload.
- Unexpected defect with a private sentinel → actual built Node runner test proves a
  static stderr diagnostic, no extra stdout/private payload and status one.
- Successful application followed by failing scoped finalizer → built runner test
  proves the same stderr-only defect result and nonzero status.
- Existing success and signal ownership → retain shared runner and public
  signal tests; no new process signal handler or Exit request is introduced.
- Actual public recovery and #339 throttle → retain strict built-process
  decoding and the original acceptance assertions. Any underlying Codex
  disposal failure remains separate work until its specific cause is proven.
