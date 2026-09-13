# Host lifetime: source inspection and targeted validation

Follow-up: the [real-host composition experiment](./invokee-real-host-results.md)
now passes the previously open five-step client-disconnection chronology. The
limits below describe this earlier validation round.

Status: research only, 2026-09-13. No production source changes or implementation
tasks. Source baseline is research commit `0b9c9d2b3` in the isolated interview
worktree. These checks use controlled provider boundaries, not live GitHub or
Codex services.

## Alice keeps one Dalph host running

Alice starts Dalph for one repository and root. The host acquires the repository
coordinator lock, opens its journal, selects a Run and begins the existing
workflow. The source-derived design constraint is that a future client attach
inside that owner's lifetime. Starting
another host per client would contend for the lock rather than share delivery.

[`withDecodedProductionRepositoryHost`](../packages/dalph/src/application/production-host.ts#L556)
builds foundation and Run layers inside one Effect scope. Its callback starts
only after `awaitEstablished`; callback completion or activation failure ends
that scope. The callback exposes current observations, history, termination and
application Exit, but not the command services. Therefore passive observation
has an existing public seam; full attachment commands do not yet have one.

The current [`live-cli.ts`](../packages/dalph/src/application/live-cli.ts#L111)
puts presentation inside that callback. Presentation completion returns from it;
SIGINT/SIGTERM use the application Exit boundary. Merely wrapping the current
public CLI in MCP does not make that CLI an independently hosted service.
This is source evidence, not an experiment with a future attachment transport.

## Executed validation

Command:

```sh
pnpm exec vitest run packages/dalph/src/application/production-host.test.ts -t 'cold production host records one beginning|default production graph keeps one owner'
```

Result: one file passed; two tests passed, eighteen intentionally unselected.
Vitest reported 6.76 seconds. The selected cases are existing tests, unchanged.

| Concrete check | What was observed | Limit |
| --- | --- | --- |
| `cold production host records one beginning before the first GitHub delivery read` | Actual host composition records `WorkflowRunBegan` then `TaskTrackerReadIntentRecorded`; Codex/GitHub adapters acquired once; workflow and Codex receive the same Exit shell | Tracker call is deliberately held; no task executor completes |
| `default production graph keeps one owner per mutation capability while H2 fails before every boundary and fresh H2 recovers` | First host acquires each listed instrumented service once; a second host through a symlink fails with `CoordinatorLockHeld` before additional boundaries; after first callback release a fresh host recovers the same Run | Hosts run within the test process; this does not exercise remote clients or native worker interaction |

See the [unchanged test source](../packages/dalph/src/application/production-host.test.ts#L692)
for the first chronology and
[ownership chronology](../packages/dalph/src/application/production-host.test.ts#L1484)
for the second. The competitor attempt is an explicit forbidden-path check,
not an inference from a passing aggregate count.

A separate focused CLI check also passed:

```sh
pnpm exec vitest run packages/dalph/src/application/production-cli.test.ts -t 'fails once when public stdout is lost'
```

Result: one test passed, fifty-seven intentionally unselected; 5.12 seconds.
The [test](../packages/dalph/src/application/production-cli.test.ts#L625) supplies a
controlled host callback and failing output. It proves one typed output failure,
one write attempt and zero graceful Exit requests. It does **not** directly
exercise live host cleanup. Combining this with the host scope source explains
why failing presentation is different from a remote client merely disappearing:
callback failure ends the scope even without an explicit graceful Exit request.

## What a further experiment would need to establish

The retained [hosting probe](./invokee-hosting-results.md) already exercises OS
client disconnection with synthetic work. Repeating that probe with a different
socket would add little evidence about actual Dalph delivery.

A useful additional probe would combine the real host with controlled provider
responses: observe a real task executor waiting for a response, terminate a
separate observation client, then release that response and observe subsequent
workflow progress for the same Run while coordinator ownership remains held.
The probe must not confuse a later integration pause with a held executor
response, or callback release/recovery with uninterrupted delivery.

The existing
[hermetic controller](../packages/dalph/test-support/production-hermetic-controller.ts#L149)
encapsulates its endpoint and spawns the public `run` command; it does not expose
an attachment host. Its
[provider state](../packages/dalph/test-support/production-hermetic-provider-state.ts#L67)
accepts a boundary observer but no dedicated pre-Codex-response gate. It is
useful source material, not a ready-made proof harness for this chronology.

No public host or test-support API has been changed to make a prototype fit.
A disposable harness using existing seams remains possible, but building an
entire attachment implementation merely to run it would exceed this research.
The actual-host/client/executor composition claim remains unvalidated. The
checks above narrow the uncertainty to attachment and cancellation composition,
rather than repository ownership or initial Run establishment in this controlled
single-process fixture. This does not establish live-provider or native-worker
behavior.
