# Real-host disconnection and reconnection: executed evidence

Status: passed, 2026-09-13. Research only, with no production code, public command,
package manifest, lockfile, runtime documentation, or implementation tasks changed.
The unchanged production source baseline is `1ff575e01606b1b688201153d7f1dc08f6369d95`.

## Alice's client disappears while delivery is waiting

The experiment creates a disposable Git repository with a base commit, one open
controlled tracker task, no claim or executor, and an empty SQLite journal.
It builds `productionRepositoryHostGraph` and enters
`withDecodedProductionRepositoryHost`. Those existing production components
acquire coordinator ownership and run the real delivery workflow. The fixture
substitutes only GitHub/Codex boundaries and supplies observation hooks.

The actual planned-attempt executor adapter calls a controlled Codex service.
A wrapper holds that call before the fixture produces its result. The task
worktree and its planned attempt already exist; the result cannot be produced
until the experiment releases the gate. This is controlled executor I/O, not
an actual model or Codex app-server process.

The host callback owns a disposable loopback HTTP observation server. A separate
Node process receives one task/Run snapshot and keeps its response connection
open. The experiment waits for the printed snapshot, sends SIGTERM to that
client, and awaits its actual signal exit. Only afterward does it release the
provider gate. The fixture produces a real Git commit in the real task worktree;
the existing workflow accepts it, integrates it, promotes the target, confirms
tracker completion and completes the Run.

A second Node process requests a new snapshot at the same endpoint while the
original host callback is still open. The host fiber is checked unfinished both
after the first client's exit and after the second client's observation. This
is uninterrupted host ownership, not shutdown followed by recovery.

## Scenario-to-assertion mapping

All assertions reside in
[host-probe.test.ts](./prototypes/invokee-real-host/host-probe.test.ts), under the
case `keeps one real production host delivering after an OS observation client disconnects`.

| Requested step | Concrete observation/assertion | Result |
| --- | --- | --- |
| 1. Start the real host with a waiting executor | Wait for the existing host observation and gated `CodexAppServer.startTurn` call | Reached; one graph task observed |
| 2. Attach an OS observation client | Await its first stdout JSON, check Run identity and task inventory | Journal position 16 |
| 3. Disconnect while executor waits | Send SIGTERM, await exit, assert signal and unfinished host fiber before releasing provider | `{code:null, signal:SIGTERM}` |
| 4. Release response and observe delivery | Await controlled completion boundary and actual Run termination; later inspect persisted journal | Accepted result, integration, promotion, confirmed completion; disposition Completed |
| 5. Reconnect to same Run | Fresh OS client exits normally after snapshot; compare Run identity and accepted position; original host still unfinished | Same Run, journal position 58, exit code 0 |

The probe also starts a competing host against the same repository while the
first owns it. It receives `CoordinatorLockHeld`; instrumented provider state
and journal position are unchanged across that attempt. Coordinator acquisition
and journal opening counts remain one. Persisted history contains exactly one
`WorkflowRunBegan`. Application Exit request count through reconnect is zero.

The first observed position is compared with the second, not with an initial
synthetic tick. The persisted evidence checks are:

- `PlannedAttemptExecutorWorkReported` with terminal `Accepted` result;
- `IntegratorRunResultRecorded` with `PreparedCandidate`;
- `IntegratorRunCandidateGitObserved` with a commit observation;
- `TargetPromotionObservedSuccess`;
- `TaskTrackerFactsObserved` containing focused confirmation of
  `CompletedSuccessfully`, supported by the controlled provider's completed state.

These establish downstream workflow progress. A completion request or intent
alone would not satisfy the assertions.

## Executed command and repeatability

```sh
pnpm exec vitest run --config research/prototypes/invokee-real-host/vitest.config.ts --reporter=verbose
```

The worker run and independent parent run passed. The parent's final run reported
one file/one experiment passed: 5.41 seconds in the experiment, 24.68 seconds
including source transformation/import. Both observed positions 16 and 58,
one coordinator acquisition, one Run beginning and zero Exit requests.
The assertion requires advancement, not these particular numeric positions.

Earlier attempts exposed research-harness errors in dependency resolution and
assumptions about Effect fiber polling and the termination result shape. Those
were corrected in the harness only. No Dalph behavior was modified to make the
experiment pass. Independent review also corrected server ownership, child-exit
cleanup, scoped SQLite reading and insufficient integration evidence.

After reconnection, the callback is explicitly released and the host fiber
joined. That closes its server and resources. A separate scoped SQLite reader
then verifies persisted records and closes before fixture deletion. Normal and
failure cleanup await remaining child exits. The exact created directory is
removed and checked absent. This disposal is the probe's cleanup of its own
fixture; it is not additional proof of every Dalph Git-cleanup disposition.

## Interpretation and limits

**Established:** the current real host can own delivery independently of a
separately launched observation client. That client can disappear while an
executor call waits, actual delivery can then finish, and a later client can
observe the same Run without a second coordinator. No production API extension
was necessary to answer this observation-only composition question.

**Not established:** a shipped CLI/MCP attachment facility, remote command
cancellation, durable network redelivery, a native agent conversation, or host
process crash/recovery. The host runs in the test process through existing source
APIs; the public Dalph binary is not launched. GitHub is a controlled tagged-call
to GraphQL-fixture adapter, and Codex is a controlled service boundary. Git,
SQLite, workflow, executor/integrator adapters and OS observation clients are
real within that fixture.

The `/watch` endpoint emits exactly one snapshot and holds the connection.
There are no later streamed updates. Thus this is disconnection plus later
snapshot reconnection evidence, not qualification of real-time graph delivery.
The snapshot also combines a journal cursor with a separately read current
runtime value; it deliberately does not establish a coherent public wire schema.

This resolves the five requested steps. It creates no implementation tasks and
selects no production transport or command-admission architecture.
