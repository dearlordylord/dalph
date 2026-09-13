# Slow graph watcher: latest-state candidate

Status: researched and independently checked, 2026-09-13. No production change
or accepted wire-stream policy is introduced.

Alice watches the graph while a transport write is held. Dalph continues to
publish complete current states. Keeping every intermediate state indefinitely
is not required by the interview, but current-first and terminal state must
remain truthful. This checks whether installed Effect's one-value sliding
buffer can retain the latest state and then end after a final Closed value.

Source facts: `CurrentSignal.attach` promises a loss-free internal subscription
([relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts)).
Installed Effect `SubscriptionRef.make` uses `PubSub.unbounded({replay:1})` and
changes expose that publication stream (`node_modules/effect/src/SubscriptionRef.ts`).
The real runtime ends that stream inclusively at Closed
([delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts)).
Therefore merely waiting on HTTP `drain` does not prove bounded memory for its
upstream subscription. A transport policy cannot be inferred from the internal
loss-free contract.

Candidate chronology: attach once and retain current 0 separately; hold consumer
on change 1; publish 2–8 while a one-value sliding stage continues to drain the
source; require 8 next; then publish Closed and require Closed followed by EOF.
A second case holds the consumer while Closed itself arrives and verifies it
survives stream completion. These are controlled state values using the real
CurrentSignal and Effect buffer, not synthetic workflow progress.

## Observed result

Both focused cases passed in 3.61 seconds on the installed Effect version;
an independent run passed both in 3.85 seconds:

- With the writer released before Closed, changes received were Ready 1,
  Ready 8, Closed(final 8), then stream completion.
- With Closed published while the writer was still held, changes received were
  Ready 1, Closed(final 8), then stream completion.
- Both attachments separately retained current Ready 0. Values 2–7 were
  deliberately coalesced; Closed was not replaced by an EOF marker or lost.

Run:

```sh
pnpm exec vitest run --config research/prototypes/invokee-slow-watch/vitest.config.ts --reporter verbose
```

Test names are `sliding adapter retains latest state and Closed; close while
held=false` and the corresponding `true` case. Deferred gates establish the
held writer and upstream progress; one Effect scheduler yield lets the buffer
finish offering the last mapped value before the writer is released. Assertions
check the complete received sequence, including final state and termination.
The upstream markers precede the buffer offer; the scheduler yield is an
observed opportunity for that offer, not an explicit offer acknowledgement or
a proof covering every possible interleaving.

## Consequence and limits

A latest-state adapter is a viable candidate using existing library machinery.
It need not invent durable event replay, and can expose the initial current
value separately before coalescing later complete publications. This does not
change the loss-free internal CurrentSignal contract. Intermediate updates are
intentionally omitted, so this policy must be explicit if selected for a public
watch endpoint; it is inappropriate for journal-event delivery.

The one-value buffer bounds only that stage, not total process memory. The
upstream SubscriptionRef remains unbounded, serialization can hold a full graph,
and a stalled event loop or an oversized publication is not covered. A production
adapter still needs an explicit slow-client/disconnect rule and resource limits.
No HTTP, MCP, or real graph value was used in this small check; actual graph and
transport behavior are established by the separate full-host experiments.
