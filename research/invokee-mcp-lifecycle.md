# MCP lifecycle: specification and installed SDK probe

Status: research and targeted validation only, 2026-09-13. No Dalph production
changes, SDK installation, manifest/lock changes, or implementation tasks.
This note uses the versioned 2025-11-25 specification and the locally installed
TypeScript SDK 1.29.0; it does not claim either is the latest available version.

## An agent closes its MCP connection

The versioned specification establishes initialization before normal operation:
the client sends `initialize`, negotiates version/capabilities, then sends
`notifications/initialized`. Closing a stdio connection may progress from
closing the child server's input to SIGTERM and SIGKILL. Consequently, an MCP
child process is not a suitable sole lifetime owner for work that must survive
that client. That last conclusion is an inference for Dalph, not an MCP
requirement to use any particular host architecture.
[Source: MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

For an ordinary in-flight request, `notifications/cancelled` identifies the
request. Receivers should stop its processing and release associated resources;
completed or uncancellable requests may ignore the notification. The sender
should ignore a late response. Cancellation can race with completion, so it
cannot be treated as proof that a business action did not happen. Task-augmented
MCP requests use a separate cancellation mechanism; MCP protocol tasks are not
Dalph tracker tasks, and no mapping is selected here.
[Source: MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

## Executed SDK evidence

The [disposable probe](./prototypes/invokee-mcp-lifecycle/README.md) imports the
SDK already installed in the sibling Dnd checkout. It uses the actual Client,
Server, initialization and request handling code with the SDK's InMemoryTransport.
The two peers share one process. There is no stdio, HTTP, OS child, or Dalph host.

```sh
node research/prototypes/invokee-mcp-lifecycle/run.mjs
```

Observed result: exit zero; SDK version `1.29.0`.

| Chronology | Observation |
| --- | --- |
| Initialize, start a held tool request, cancel the client's request with AbortController | Server handler's signal changes from not aborted to aborted; client request rejects |
| Initialize a fresh pair, start a held tool request, close the client connection | Server handler's signal changes from not aborted to aborted; client request rejects |

The probe waits for handler entry before either trigger and asserts that its
signal is initially not aborted. This prevents a pre-cancelled request or a
handler that never started from falsely satisfying the observation. Each pair
closes in a finalizer; a five-second watchdog fails a stalled probe.

The installed primary source explains these results:
[`shared/protocol.js`](/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js)
handles cancellation by aborting the matching request controller and connection
closure by aborting all in-flight request controllers. The probe verifies those
paths; it does not assume that all SDK transports have identical OS lifecycle
behavior.

## What this resolves, and what it leaves open

A connection close is sufficient to abort the SDK handler's signal in this
version. Therefore “we will never map EOF to Dalph Exit” does not by itself
establish command survival: an adapter could still propagate the handler's
signal into a command already performing effects. That is a source-grounded
inference, not a tested failure in Dalph.

The application needs a truthful distinction between stopping the client's
wait and cancelling business work. Exactly where an operation becomes
host-owned remains unselected and unvalidated. Cancellation should remain
meaningful for request-local reads and watches; this evidence is not a reason
to ignore every cancellation signal.

This probe does **not** establish a real MCP process reconnecting to Dalph,
accepted commands surviving process death, durable redelivery, streaming graph
updates, or human access to workers. A larger synthetic host would repeat the
existing hosting experiment without proving those claims. No such host was
built in this round.
