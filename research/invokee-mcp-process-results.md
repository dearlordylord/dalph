# MCP process cancellation and reconnection: research and validation

Status: executed, 2026-09-13. Research only. This probe adds no production
interface, durable command identity, deployment choice, or implementation task.

## Source question

An orchestrator's MCP client can cancel an in-flight request or close the stdio
server process. The versioned MCP lifecycle describes initialization and
transport shutdown; its stdio shutdown can escalate from EOF to signals.
The cancellation specification permits a cancellation to race with completion.
Neither event proves a business operation was undone.
[Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

The previous probe tested SDK signal behavior with InMemoryTransport. This
experiment uses the installed TypeScript SDK 1.29.0 Client and
StdioClientTransport to launch actual MCP server child processes. Each child
initializes, lists tools, and forwards tool requests to a separately launched
backend process. SDK version is pinned to the observed installation, not claimed
as latest.

The backend owns the existing real Dalph capacity service and live in-memory
journal. It does not run the production host, coordinator, tracker, executor,
or any synthetic task ticks. Its one controlled gate before capacity apply
exists solely to observe what happens when the MCP child disappears after
backend receipt. The backend intentionally does not tie that operation to the
HTTP caller's abort signal. This is an experimental ownership choice, not a
claim about a selected or implemented Dalph command boundary.

## Executed chronologies

Run:

```sh
node research/prototypes/invokee-mcp-process/run.mjs
```

The [disposable scripts](./prototypes/invokee-mcp-process/README.md) execute and
assert these sequences:

| Cut | Observed marker before interruption | Observation after interruption/reconnection |
| --- | --- | --- |
| Before forwarding | MCP handler reports `bridge-before-handoff` and waits | Request cancellation rejects the caller's wait; backend remains revision 1 with one beginning record |
| Backend received, before apply | Backend reports `backend-received-before-apply`; its state is still revision 1 | MCP child is closed and its OS PID is verified gone; backend remains alive; releasing its gate applies capacity 2; a fresh MCP child sees the same Run at revision 2 with two records |
| Backend success, before MCP response | MCP handler reports `bridge-after-backend-response` and waits | Cancelling and closing that child does not undo capacity 3; a third MCP child sees revision 3 with three records |
| Repeat last ambiguous request | Third MCP child sends the exact capacity/revision request again | `TaskWorkCapacityPolicyRevisionConflict`; record count remains three |

The final strengthened parent run and independent Luna rerun exited zero with
all assertions satisfied, including two server-side abort markers. Three distinct MCP
child sessions initialized and listed the two probe tools; all child exits were
verified. The independent backend survived both MCP child replacements. The emitted
liveness and exit fields are derived from observed state and verified exits. It was
then explicitly terminated, its exit awaited, and the exact scratch directory
removed. Probe output reports revision/record counts, not a guessed receipt for
which client won a request.

## What follows from the evidence

A normal stdio MCP bridge can be disposable while another process owns the
capacity operation. This did not require parent/child chat, a custom agent
standard, or the original MCP child remaining online to hand back a handle.

However, disconnection has no universal mutation result: the pre-forwarding
case changed nothing, while the already received and already acknowledged
cases changed policy. Reconnection must consult the operation's own authority;
for capacity that is the existing revision-aware policy and journal protocol.
This result does not make blind Unpause replay safe.

The gate in this probe is **before invoking the capacity service**, not inside a
SQLite transaction. State survives client replacement while the backend stays
alive; the in-memory backend provides no host-crash durability evidence. The
separate SQLite interruption experiment addresses commit and publication cuts.

This is real MCP initialization, tool calls, cancellation and process lifetime,
but it is not a deployed Dalph MCP feature or proof of the production host's
command surface. Graph subscription over MCP resources is not exercised here;
the graph-stream experiment uses a disposable HTTP observation adapter.

## Reproduction and source limits

The scripts reuse
[makeDalphCapacity](./prototypes/invokee-hosting/dalph-capacity.mjs), which imports
existing built Dalph contracts/orchestrator packages. MCP comes from the already
installed sibling package; an alternative installed SDK directory can be passed
as the first argument. No dependency installation or manifest/lock change is
made. The relevant installed SDK primary sources are
[client/stdio.js](/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js),
[server/stdio.js](/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js),
and
[shared/protocol.js](/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js).

Review strengthened cancellation evidence from generic request rejection to
explicit server abort markers, covered an already-aborted signal, and added
bounded waits and verified child termination fallback. One intermediate run hit
a 20-second stage-marker timeout before diagnostics identified individual
markers; it was not counted as a pass. Subsequent corrected parent and independent
runs passed. This experiment does not establish behavior under arbitrary system
load or production timeout policy.
