# Alice receives a failed command without corrupting structured stdout

## Governing behavior

This #339 repair preserves #260's accepted public wire while correcting its
unexpected-defect contract. Known typed failures retain their existing
redacted structured records. Unexpected defects use a structured stderr
diagnostic and a nonzero process result, not a fabricated public failure
variant. It changes no workflow decision, provider request, retry, Journal
occurrence, signal ownership or Quint transition.

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
   finalizer, the runner projects the Cause before teardown into one bounded
   structured diagnostic. The projection keeps the Node-main boundary, reason
   kind, exact error tag/name, operation and safe message assembled from
   nonsecret structured fields, plus the same facts for a bounded nested cause
   chain. A bounded call-site projection retains function, repository-relative
   or module identity, line and column while removing absolute/private path
   prefixes and the stack's free-text message line. It never copies arbitrary
   detail, request, response, body or provider transcript fields. Exact
   configured credentials are replaced even when they occur inside an
   otherwise safe field.
4. The runner best-effort writes that diagnostic as one JSON line on stderr.
   The diagnostic states whether reason, cause-chain or text limits omitted
   information. Service-manager logs, hosted logs and the controlled hermetic
   reader can therefore retain the same actionable report. Dalph's workflow
   Journal does not acquire runtime-diagnostic authority.
5. Existing teardown still selects the process result from the original exit.
   Failure remains nonzero even when diagnostic output is unavailable. A normal
   success remains zero. Signal ownership stays exclusively in the application.

Alice receives only existing public JSON records on stdout. An unexpected
defect has a safe structured stderr diagnostic and a nonzero result. Scope
disposal is not
graceful application Exit, Run termination, proof of provider failure or retry
permission. No crash/restart algorithm changes: the next invocation reads the
same owning authorities through ordinary recovery. No live provider call is
needed for the controlled runner tests.

## Forbidden results and scenario-to-test mapping

- Known typed failure with a private sentinel → actual built Node runner test proves
  status one and no additional terminal cause dump or private payload.
- Unexpected defect with a useful nonsecret tag, operation, safe message,
  nested cause and credential/provider-private sentinels → actual built Node
  runner test decodes the diagnostic, proves the useful cause chain survives,
  proves the sentinels and arbitrary private fields do not, and observes status
  one with no extra stdout.
- Hostile oversized fields and cause chains → cause-projection component test
  proves one valid JSON line inside the exact UTF-8 byte cap, explicit
  truncation, and no secret value.
- Successful application followed by failing scoped finalizer → built runner
  test proves the finalizer's structured stderr-only defect result and nonzero
  status.
- Existing success and signal ownership → retain shared runner and public
  signal tests; no new process signal handler or Exit request is introduced.
- Actual public recovery and hermetic qualification → their owned stderr
  readers retain and decode the same bounded diagnostic when a child exits one;
  focused interference tests use its boundary and cause facts to identify the
  shared failure without changing public stdout or authorizing a retry.

## Typed startup failures and finalization

Under [#430](actionable-failure-diagnostics.md), the Node runner also emits the
sanitized stderr diagnosis for a typed failure that reaches its boundary.
An intentional `DalphCommandExit` alone remains silent; its command has already
selected the public disposition. A separate scoped close failure is still
reported. A private-store configuration failure before Run allocation names the
configuration boundary and advises an absolute, current-owner directory with
0700 permissions, without exposing its path or changing permissions.

`node-main.integration.test.ts` exercises actual child-process status and
stdout/stderr, including Completed and Cancelled Run records followed by
provider-close failure. `production-running-host.test.ts` separately proves
those Run dispositions through real Git/SQLite host composition. A failed
process finalizer does not retroactively invalidate delivery or Run termination.

## Controlled unreadable process facts during public recovery

[#345](https://github.com/dearlordylord/dalph/issues/345) accepts the controlled
owned-process and recovery chronologies. The qualification executable supplies
EACCES at `CodexProcessNative.readFile`, outside the production routing code.
The public fixture's own live, same-owner `/proc/<pid>/environ` is unreadable;
permission failure cannot establish absence or authorize clearing its retained
launch. This is controlled evidence, not a reproduction of the historical
hosted cause. The qualification-only switch cannot change the shipped CLI.

The existing terminal-tracker fixture still selects one Run and publishes its
ordinary terminal disposition, then reports the failed provider close with
status one and a sanitized `NodeMainExit` diagnostic on stderr. The SQLite
journal contains one Run beginning and no claim acquisition. The private launch
remains retained, with no retained task attempt. Without injection, the
same fixture exits zero and clears its launch.

The cleanup fixture seeds its Run with the exact local remote-publication
endpoint and branch used by its built CLI configuration. A generic simulated
destination is not authority for this production recovery invocation. After
`RunSelected`, its Git fixture holds the original worktree-list observation;
Alice sends application Exit and releases that observation. Without injection,
the public status closes and Exit succeeds without a Run disposition. With
unreadable census evidence, Exit fails: the process exits one, emits exactly
one failed application Exit disposition and a sanitized lifecycle diagnostic,
and retains its launch. It emits neither a successful closed status nor Run
completion. The stdout stream itself ends with the child process. Neither path
starts a task turn or mutates a tracker claim.

Both named cases in `production-public-recovery.integration.test.ts` run with
and without injection. They decode every nonempty OS stdout line as
`ProductionCliRecord`, independently decode stderr, assert exact diagnostic
categories/dispositions, and reject configured credential sentinels in raw
stderr. `built public recovery rejects a dirty stdout negative control` inserts
one diagnostic line at the same native fault and proves the stdout reader fails
with `InvalidPublicStdoutRecord`.

`codex-owned-process-eacces.test.ts` exercises retained launch reconciliation
before successor spawn using memory and real private-filesystem stores. Exact
owned stat refusal and possibly owned unreadable token census both preserve the
original launch and forbid destructive signals and successor creation. Memory
reconciliation retries reread the same refusal; filesystem reconciliation
exercises one owner acquisition, leaving later lease-owner reconciliation to its
existing tests. SQLite is the workflow-journal lane in the built recovery tests,
not the private process store. The process-policy suite separately covers
foreign versus same/unknown UID, newly inert processes, and PID reuse after the
failed environment read. These test/qualification changes alter no shipped
workflow, ownership predicate, retry rule, or diagnostic routing.

Passing controlled checks do not establish the cause of the historical hosted
EACCES, qualify its original hosted revisions, or close #345.
