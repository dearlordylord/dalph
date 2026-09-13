# Client interruption and graph subscription validation

Follow-up: [research conclusion](invokee-research-conclusion.md) covers the
subsequent callback recovery, actual MCP-host composition, changing graph,
slow-watcher candidate and scope review.


Status: research and disposable validation, 2026-09-13. No Dalph runtime change,
implementation task, public API, or deployment architecture is introduced.
Work is isolated on `research/invoker-invokee-interview`, from source commit
`684aba853903cf1d1fc7f33e6af666f2bf37c915`.

## What happens to the caller

Alice starts Dalph for one repository. Her orchestrator attaches, watches task
progress, and requests a capacity change or Unpause. The orchestrator's request
or MCP process can disappear at several different moments. Dalph's existing
services determine what happened; disconnection alone cannot answer that question.

The earlier [real-host experiment](./invokee-real-host-results.md) proved that
one observation client could die while the same host completed actual delivery.
This round tests the missing boundaries rather than adding a client feature.

## Findings and implications

| Concrete event | Executable evidence | Consequence for a later design |
| --- | --- | --- |
| A request is interrupted before it calls capacity or Unpause. | No command record; a later request applies once. | Being received by an adapter is different from reaching the command service. |
| Cancellation arrives after SQLite INSERT or after COMMIT while the real live Journal is still appending. | Cancellation remains pending until storage and accepted publication finish; one command record exists. | The journal already protects this interval. Request interruption is not a rollback mechanism. |
| A caller repeats a request whose result it lost. | Capacity reports a revision conflict with no second change; Unpause records a new ordinal. | Recovery must follow each operation's semantics. A generic blind retry is unsuitable. |
| The exact inactive bootstrap is interrupted during Unpause append. | Unpause ordinal 1 persists, but its registered control observer is not called; retry records ordinal 2 and calls it. | Protecting append does not protect the complete command. Callback ownership/recovery remains a concrete issue before a remote command boundary is ready. |
| A request waits on a command forked into an existing host scope, then is interrupted. | The command continues and commits after its controlled gate is released. | Commands can belong to the host without requiring the original caller to remain online. This experiment does not select a supported adapter. |
| A real stdio MCP child disappears after a separate backend receives a capacity request. | The backend survives, applies capacity after gate release, and a fresh MCP child reads the same Run and revision. | A conventional disposable MCP bridge is feasible; MCP process lifetime need not own the operation. |

Exact scenarios, test names, commands and limits:
[SQLite and bootstrap interruption](./invokee-command-interruption-results.md),
[MCP process replacement](./invokee-mcp-process-results.md).

## Watching the graph

The [graph stream experiment](./invokee-graph-stream-results.md) uses the
unchanged production host and one current-signal attachment per client. Its
wire projection derives graph, frontier and status inputs from a single runtime
publication. The fixture uses controlled tracker and executor responses with
real Git, SQLite and delivery adapters.

It checks initial state, later publications on the same connection, client
process death without host Exit, a fresh subscriber's current-first state, and
retained final state followed by stream closure. Two smaller checks isolate an
update at attachment and an eight-value burst while the subscriber is held.

The accepted journal position is not a sequence number for every runtime
publication: status can change without another journal record. The live graph
can therefore be observed without treating journal history as a graph event
log. A reconnect reads current state; these probes do not promise replay of
every state missed while disconnected.

## What remains undecided

The evidence supports investigating one independent host with disposable
CLI/MCP clients. It does not select a transport or turn that arrangement into a
production feature. The following limits remain relevant to that decision:

- Command ownership must cover work before append and callbacks after it, with
  truthful outcomes when the response is lost. The bootstrap observer result is
  a demonstrated gap; it is not evidence about the reactivation owner's timer
  or later reconciliation, which the probe does not instantiate.
- The graph experiment keeps its disposable observation server alive through
  host finalization to deliver `Closed`. Production shutdown ordering, slow
  network handling, memory limits and a public projection remain unselected.
- The actual MCP experiment uses a separate in-memory capacity backend. The
  actual-host graph experiment uses HTTP. Their separate successes are not an
  end-to-end production MCP-host qualification.
- SQLite cancellation hooks bracket COMMIT; no experiment here kills the host
  inside SQLite's engine commit or qualifies crash recovery at that midpoint.
- Executor registration/leases, organic human access and recursive planning
  remain the broader pivot questions. These experiments neither answer those
  questions nor impose a parent/child conversation or handle-return protocol.

These are research findings and remaining decisions, not an implementation
backlog. No tasks are created without the user's explicit request.

## Validation and review record

The command experiment passed seven focused tests in the producing agent and
an independent parent run. The MCP process experiment passed in the parent and
an independent Luna run, including three verified child exits and two server
abort markers. The graph experiment passed three cases in the producing agent
and independent parent run; the final retained-state assertion was then
strengthened and the affected suite rerun.

Review corrected the earlier inference that cancellation could interrupt the
live Journal midway through append, replaced a callback imitation with the
actual inactive bootstrap, strengthened MCP cancellation/exit evidence, and
required graph subscription cleanup to await its fibers. Review also narrowed
retry/final-Exit claims to the exact cases exercised and checked the final
Closed payload against the retained source state. Earlier research
notes now point here or state the corrected boundary explicitly.

All retained scripts are disposable and remain under `research/prototypes/`.
Production sources, package configuration and models are unchanged. Focused
probe execution, syntax/link checks and diff checks are the relevant gates;
production `check:all` and exhaustive Quint checks add no coverage for this
research-only change and were not run for this round.
