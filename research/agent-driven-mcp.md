# Agents directing Dalph through MCP

Research date: 2026-09-13. This is documentation-only research: it changes no
Dalph runtime behavior, accepted scenario, or domain definition. Proposed APIs
and acceptance seams below are discussion material, not implementation authority.

## Start with the person and the work

Alice asks her planning agent to deliver three GitHub issues. Two are independent;
the third depends on one of them. The agent asks Dalph to proceed within an agreed
scope and a limit of two executing task attempts. Dalph checks GitHub, plans each
attempt against an exact Git Base SHA and worktree, and starts work through an
executor adapter. Alice opens a graph view while her planning agent does something
else. If that agent disappears, Dalph still knows which work it owes observation,
integration, and cleanup. No agent needs to remember to return a semaphore token.

This suggests an independently supervised Dalph service with MCP as one interface.
The planning agent chooses goals and resolves exceptional choices; Dalph carries
out the already authorized workflow. The browser, command line, and MCP adapter
read the same projections and submit controls to the same workflow. This preserves
the repository's [authority split](../docs/ARCHITECTURE.md#authority-and-reconciliation)
and [executor boundary](../docs/ARCHITECTURE.md#planned-attempt-executor-boundary).

## Protocol facts that materially affect the design

The official versioning page currently identifies **2026-07-28 as Current**. This
is stronger evidence than the older announcement whose title still says release
candidate. Current requests carry protocol metadata individually; older revisions
use an initialization handshake. These are protocol facts, not evidence that any
particular installed host implements the new revision. [Official versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning).

| Concern | Current protocol evidence | Dalph implication, proposed |
| --- | --- | --- |
| Independent server | Streamable HTTP permits an independent server serving multiple clients. Current HTTP uses POST and request-scoped SSE, removes protocol sessions and the GET stream, and does not support Last-Event-ID replay. | Keep Run identity and durable workflow obligations outside transport identity. |
| Disconnect | Closing an HTTP response stream cancels that request. | A dropped graph subscription ends observation, not the Run. Finish short durable-admission calls quickly; do not represent an entire delivery as one ordinary open request. |
| Resources | Resources expose URI-addressed contents; hosts decide presentation. | Expose graph/frontier data, but supply a graph UI explicitly rather than assuming the host renders one. |
| Watching | subscriptions/listen opens a notification stream with an acknowledged subset of requested filters. | Check acknowledgment and fall back to reads if graph updates are unsupported. |
| Sampling | Sampling is deprecated as of 2026-07-28; new implementations should not adopt it. | Do not choose sampling as the foundation for spawning or supervising executors. |

Sources: [HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation),
[resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources),
[subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions),
[sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling).

The dated Tasks extension permits a server to return an asynchronous task handle
when the client declares support. It provides `tasks/get`, `tasks/update`, and
`tasks/cancel`; the result must be durably queryable before its creation response.
Task cancellation is cooperative: acknowledgment does not prove execution stopped.
Task data can expire. A protocol task marked completed can contain a tool error.
Each task request requires authorization checks. These semantics are insufficient
as proof of Git integration, issue closure, executor quiescence, or worktree removal.
Use transport tasks as optional wrappers around Dalph operations, retaining the
Dalph Run and attempt identities separately. The citation is the **dated
2026-07-28 extension**, not its adjacent draft page. [Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks).

For comparison, the 2025-11-25 transport says disconnect should not be interpreted
as cancellation, supports optional session IDs and optional SSE replay, and its
resource API uses `resources/subscribe`. Mixing those semantics with the current
revision would produce incorrect recovery behavior.
[Older transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[older resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources).

## A useful API offloads a workflow, not a checklist

Prefer a small proposed surface such as:

- `inspect_run`: graph, frontier, current admission limits, outstanding work, and
  explanations of why each blocked task cannot proceed. Include observation
  provenance and freshness, rather than presenting cached GitHub facts as current.
- `direct_run`: submit a desired scope or an exact supported control using a
  caller request identity; return the durable receipt and Run reference promptly.
- `inspect_request`: recover the result after the caller lost the receipt.
- `submit_attempt_evidence`: allow an appropriately authorized executor adapter
  to submit evidence associated with its exact attempt.
- `resolve_decision`: answer one identified exceptional choice against the
  observed revision it concerned; reject stale or competing answers explicitly.

Names are illustrative. In particular, goal/scope mutation is not an accepted
current Dalph command merely because it appears here. A raw interface comprising
`claim`, `mkdir_worktree`, `spawn`, `close_issue`, `delete_worktree`, and
`release_slot` moves the existing human checklist into the planner's context.
Those boundaries belong inside Dalph's workflow interpretation.

The durable receipt means Dalph accepted responsibility, not that the external
mutation or delivery succeeded. Request deduplication needs its own accepted
identity/payload-conflict rules; JSON-RPC request IDs alone are insufficient as a
cross-process application contract. Once an intent could have crossed GitHub,
Git, or executor boundaries, the existing reconcile-before-retry rule still applies.

## Viewing the graph without keeping the planning agent awake

Offer a read-only browser view linked from `inspect_run`. Its current graph and
frontier are projections of tracker observations and workflow history. Keep an
explicit distinction between a historical cursor and current status, consistent
with [existing context](../docs/CONTEXT.md). The browser can stay open independently
of the agent host. MCP resources can expose the same serialized projection for
hosts that support resources; an ordinary inspection tool covers hosts that do not.

For live updates, treat notifications as invalidation hints and reread a coherent
projection. On reconnect, subscribe, receive acknowledgment, read a fresh snapshot,
and coalesce notifications received during that read into another read. This
avoids depending on replay and closes the snapshot/subscription race. A selected
historical cursor remains fixed while a separate current-status indicator updates.
If a UI needs every event rather than current state, give it Dalph's explicit
history-reading cursor; do not reuse a transport event ID as a journal position.

The graph can be real-time while the planner sees only meaningful changes: work
completed, a decision became necessary, or its selected scope settled. Avoid
feeding every process observation back into the model context. MCP notifications
do not by themselves guarantee that a host will schedule a new model turn.

## Handles grant permission; they do not carry cleanup responsibility

Give a child a reference to its exact attempt and narrowly scoped permission to
read its instructions, report evidence, and ask for clarification. The service
validates every operation against the authenticated caller and the attempt.
Separate resource identity from authorization and from the executor's evidence of
safe suspension or termination. Possession of an ordinary task ID should not
grant authority to delete a worktree or close an issue.

MCP's HTTP authorization supports operation-specific OAuth scopes and insufficient
scope responses; it does not define Dalph's attempt-scoped delegation semantics.
Those are an application design, including expiration, revocation, caller binding,
and payload replay handling. A child presenting a report still needs an execution
substrate that can establish the report's claimed quiescence.
[Current authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

An agent cannot be obliged to return a handle after it crashes or loses context.
Consequently, handle expiry, parent disconnection, or a lease timeout cannot prove
that a child stopped writing. Dalph retains the exact unfinished responsibility,
queries the executor, and releases task-work capacity only at the accepted safe
boundary. Worktree disposal follows its separate disposition protocol. Cleanup
may remain pending after execution capacity is legitimately freed; neither state
should be hidden behind one generic “done” bit.

## Who executes, and what MCP cannot choose

| Organization | Benefit | Required capability / limitation |
| --- | --- | --- |
| Dalph starts provider sessions through an executor adapter | Service can continue observing children when the planning host disappears. | Provider must expose start correlation, passive observation, safe stop/suspend evidence, and interaction with the same session. |
| Planning host creates its native sub-agents | Reuses the planner's native delegation and messaging UX. | A host bridge must register and observe exact children; a prompt asking children to check in cannot establish survival or termination. |
| Child pulls authorized work from Dalph | Workers can exist independently and know only their current assignment. | Requires a worker/session protocol and adoption rules; checkout expiry alone cannot release execution capacity. |

MCP defines tool/resource exchange, not a portable child-agent launch, message,
session-adoption, or process-quiescence API. The runtime adapter must supply those
facts. A thin stdio MCP adapter forwarding to a supervised Dalph service is another
deployment option; if the stdio child is the entire service, its lifecycle remains
tied to its host unless a separately specified supervisor changes that relationship.

For mixed clients, retain ordinary tools that return prompt durable receipts and
inspection results. Add resources, subscriptions, and transport-task wrapping only
where actual host capability tests justify them. Implement explicit protocol-era
adapters if supporting both versions; do not advertise an unsupported extension.
No live client support or provider mutation was tested in this research.

## Proposed chronological acceptance seams

These tests do not exist as a result of this note. Before implementation, accepted
scenarios must resolve these proposals and link their governing invariants.

| Scenario with starting facts and trigger | Ordered boundaries, crash/retry, visible and forbidden result | Proposed test seam |
| --- | --- | --- |
| Alice's planner requests two independent GitHub tasks with capacity two; neither has a claim, plan, or executor session. | Dalph durably accepts the request, checks tracker facts, journals each boundary intent, plans exact Git resources, and starts admitted executors. Lose the receipt after acceptance; retry the same request and recover the same responsibility. Alice sees two attempts, never four. | `reuses accepted direction after the planner loses its response` |
| Alice closes her planning host while two exact attempts are executing; their responsibilities exist in the journal and their worktrees still exist in Git. | Subscription/request teardown ends observation. Supervisor keeps Dalph alive, or restart reconstructs obligations and queries each executor. No new execution position is admitted merely because the host disappeared. Alice reconnects and sees existing attempts. | `keeps occupied execution positions when the planning host disconnects` |
| Alice watches a graph at one journal cursor while a current tracker observation changes. | Subscribe/acknowledge, read snapshot, reconcile concurrent invalidations; disconnect and repeat without relying on SSE replay. Git and executor mutations do not apply because this is observation only. The historical cursor stays fixed and the live projection catches up. | `catches graph changes across snapshot and subscription reconnect` |
| A child with permission for attempt A reports work for attempt B while both exist. | Validate caller, exact attempt scope, revision, and evidence before any workflow acceptance. Reject the report; no GitHub/Git mutation occurs. Retry remains rejected. No crash window crosses a mutation because validation precedes it. | `rejects a child's report for another attempt` |
| A child says it finished, but its execution substrate still reports activity and Git still holds its worktree. | Record/inspect the report as appropriate, ask the owning executor for accepted lifecycle evidence, preserve unresolved obligations, and show the wait. Do not free capacity or dispose resources from a chat message, expired handle, or cancellation acknowledgment. | `retains responsibility until executor quiescence is proved` |

No implementation or model changed, so runtime tests and model checking were not
run for this note. Source review checked version distinctions, ownership
boundaries, and the separation of proposed behavior from existing authority.
