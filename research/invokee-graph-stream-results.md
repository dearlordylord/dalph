# Graph stream attachment: research question and validation record

Status: passed on 2026-09-13 against source revision
`684aba853903cf1d1fc7f33e6af666f2bf37c915`. The chronology and pass criteria
below were recorded before the disposable probe was implemented. This work
changes no production source and selects no supported wire protocol.

## Question

Can a separately launched observation client attach to the existing production
host's current runtime signal, receive its current graph/status publication and
later publications without reconnecting, disconnect without ending delivery,
and let a fresh subscriber receive the latest value first? When the host's
runtime closes, can the stream report the exact final value and then end?

The earlier real-host `/watch` probe answered only client-lifetime ownership. It
wrote one snapshot and held the response; it did not subscribe to runtime
changes. This experiment must use one `observation.current.attach` per watch so
the attachment's `current` and `changes` preserve the source contract.

## Chronology and pass criteria

1. Start the unchanged production host over a disposable Git/SQLite fixture and
   hold the controlled Codex turn before its result is produced.
2. Launch an OS watch client. From one runtime attachment, send its current
   publication. The client must observe the selected Run, one graph task and the
   runtime publication's own accepted journal position.
3. Release the Codex result. The same client, without reconnecting, must receive
   a later `Ready` publication with changed task or delivery status. Record its
   accepted position, but do not require that position to advance: runtime
   publications can change without accepting another journal record.
4. Hold the controlled tracker completion response, terminate the first client,
   and await its process exit. The host callback and delivery fiber must remain
   alive, with no application Exit request.
5. Launch a fresh watch client before releasing tracker completion. Its first
   item must exactly equal the current value captured by that new server-side
   attachment for the same Run; it must not need the first client's cursor.
6. Release tracker completion. The unchanged workflow must reach durable
   accepted executor, integration, promotion, confirmed tracker completion and
   `Completed` Run termination evidence.
7. After terminal evidence is observed, release the host callback. The external
   disposable observation server remains alive while host finalization publishes
   `Closed`; the fresh client must receive that retained final publication and
   then observe normal stream closure. Join the host before fixture cleanup.

Two controlled `CurrentSignal` checks cover races that a full workflow timing
does not isolate:

- publish immediately after attachment and before consuming `changes`; the
  subscriber must receive the attached current value followed by that update;
- attach a deliberately slow consumer, publish a bounded burst, and observe the
  entire ordered burst. This is finite in-process buffering evidence only; it
  does not prove a bounded-memory policy.

## Projection boundary

Each wire item is a disposable projection of one
`DeliveryRuntimeObservationState`. `Ready` derives Run identity, accepted
journal position, normalized task graph, graph frontier and Run/task statuses
from that one state. `Closed` projects only its retained `final`. It does not
combine `acceptedHistory.get` with a separate runtime read.

The graph and frontier remain the existing opaque normalized runtime facts. The
probe does not introduce a public DTO, promise executor association, or expose
mutable authority. Reads and watches stay passive.

## Source evidence

- `packages/orchestrator/src/coordination/delivery/relations.ts:62-104`
  defines a passive `CurrentSignal`, makes `attach` a scoped, loss-free
  current-first subscription, and derives `get` and the declarative
  current-first `changes` stream from that attachment.
- `packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts:293-350`
  defines `NotReady`, `Ready` and `Closed`, retains the final `Ready` value on
  close, refuses publications after close, and ends the public signal after its
  `Closed` item.
- `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts:1150-1161`
  exposes the runtime observation signal and Run termination source from the
  already-built Run. `acceptedHistory` is a different signal
  (`journaled-run-bootstrap.ts:370-391`), so the projection deliberately does
  not combine it with runtime state.
- `packages/dalph/src/application/production-host.ts:551-595` passes that signal
  to the host callback after Run establishment and closes Run/foundation
  resources only after the callback returns.

## Evidence

Run from the interview worktree root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-graph-stream/vitest.config.ts --reporter=verbose
```

The producing agent passed all three experiments in 9.76 seconds. An
independent parent run passed in 7.62 seconds. After strengthening the retained
Closed payload assertion, the final affected suite passed in 8.90 seconds,
with the real-host case taking 1.66 seconds. The first OS client received a one-task
`Ready` publication at accepted position 16. Its Run and task status
classifications were both `[Waiting, Progressing]`. Without reconnecting, it
received a later publication at position 20 whose classifications were
`[Waiting, Waiting]`. This is a concrete status change in one continuously held
subscription, rather than a position-only comparison.

The test then terminated that client with `SIGTERM` and awaited its process
exit. The host fiber was still running and the application Exit request count
remained zero. A fresh OS client attached to the same Run. Its first decoded
wire value exactly equalled the server's value from that attachment's
`current`; at position 41 its Run and task classifications were both
`[Progressing]`. This proves current-first reattachment for the process-local
source. It does not imply that position is a stream sequence or reconnect
cursor. A runtime publication may change while `acceptedAt` stays equal.

After the controlled tracker response was released, the unchanged workflow
reported `Completed`. SQLite journal assertions found an accepted executor
result, successful target promotion and confirmed successful tracker
completion. The external disposable server then received `Closed` with a
retained final `Ready`. The received Closed payload exactly matched the
host signal's retained Closed state after JSON serialization. The second
client exited normally with code 0, and the host joined. The server finalizer destroyed open responses, awaited interruption
of every retained subscription fiber, and then closed the listener. Client
cleanup kills and awaits any child still retained. Both observed child exits
were explicitly awaited, and the host and transport resources closed before
the fixture cleanup finalizer ran.

The attachment-boundary check observed current `0` and then the publication
`1` made before consuming `changes`. The gated slow-consumer check received the
exact ordered burst `[1,2,3,4,5,6,7,8]` after values 2 through 8 were published
while processing value 1 was blocked. That finite result establishes retention
for this controlled burst only. It says nothing about a bounded-memory policy.

Earlier executions usefully rejected three harness assumptions: `acceptedAt`
was initially treated as mandatory evidence of every status change; an Option
was compared to a plain value; and sleeps under the test clock were used to
coordinate the slow consumer. A later run exposed an unavailable Effect API in
the HTTP writer, and exact object equality across JSON lost representation
details. The final probe uses status classifications, explicit Deferred gates,
JSON-boundary comparison, and Node writable `drain`/`close` handling.

This establishes current-first and later publication delivery for this
disposable HTTP adapter and the installed Effect source. Git, SQLite,
coordinator, workflow, executor adapter and integrator are real production
components; GitHub responses and Codex turn execution are controlled. The
observation server intentionally lives outside the host callback so it can
deliver `Closed` while the host finalizes. That harness ordering does not prove
that a future host-owned transport will flush its final frame before teardown.
The passing burst also does not qualify slow-network behavior despite this
adapter waiting for Node writable `drain`.

No durable event replay, reconnect cursor, supported wire schema,
bounded-memory policy, authentication, MCP behavior, executor association, or
production Dalph attachment API was tested or selected.

## Scenario-to-test mapping

| Concrete chronology | Focused test |
| --- | --- |
| First OS client watches a status change, exits; fresh client receives current state while the same host continues, then receives retained Closed and EOF. | `streams one production host current-first through change and truthful closure` |
| Publisher updates after attachment and before the subscriber consumes changes. | `retains a publication made at the attachment boundary` |
| Consumer is held on value 1 while values 2–8 are published, then resumes. | `buffers a bounded burst for an attached slow subscriber` |

The full-host fixture has one task. It validates streaming the graph/status
publication, not a multi-task blocker change or recursive task insertion.
