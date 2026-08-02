# Flat delivery Effect: production gap audit

Status: source-backed audit, revised after adversarial review and accepted in
[specification #174](https://github.com/dearlordylord/dalph/issues/174).
This document changes no Dalph runtime behavior and creates no implementation
ticket.

Audited sources:

- prototype commit `dc69e6cbf`, especially
  `prototypes/attempt-control-reducer/src/delivery.ts` and `DESIGN-NOTES.md`;
- production commit `3997fff9c` and current `master` delivery coordination;
- [ADR 0005](../docs/adr/0005-track-workflow-responsibility-per-subject.md),
  [ADR 0009](../docs/adr/0009-separate-frontier-from-bounded-admission.md),
  [architecture](../docs/ARCHITECTURE.md), and the canonical
  [tooling context](../docs/CONTEXT.md);
- superseded [decision #177](./issue-177-responsibility-composition-decision.md)
  and closed [ticket #178](https://github.com/dearlordylord/dalph/issues/178).

Evidence labels below are deliberate:

- **Source fact**: production or prototype source directly establishes it.
- **Accepted rule**: checked-in architecture, ADR, or accepted specification
  states it.
- **Inference**: proposed architecture derived from those facts; it is not
  implemented behavior.

## Accepted production composition

The prototype established the flat dataflow, but its broad
`executorResponsibilities` name conflicted with Dalph's canonical executor:
the executor owns one planned attempt and ends at safe suspension or Terminal;
it does not own claim acquisition, integration, cleanup, or tracker mutation.

The reviewed production shape preserves the composition and uses the distinct
derived phenomenon `TicketDelivery`:

```ts
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const deliveries = yield* ticketDeliveries(tickets)
  const settlements = yield* deliverySettlements(deliveries)
  const reflection = yield* reflectDeliverySettlements(settlements)

  return deliveryRuntimeRelation({
    trackerGraph,
    deliveries,
    settlements,
    reflection
  })
})
```

The explicit final assembly is important. `reflectDeliverySettlements` cannot
secretly capture graph, ticket-delivery, proposal, and finality state. The
outer Effect returns one `DeliveryRuntimeRelation` containing the relations
already visible above.

This is production acceptance code, not a facade over `runDeliveryActivation`.
Application entrypoints must eventually consume this relation and no competing
domain scheduler may remain.

## Why the previous plan failed

**Source fact.** The earlier body of #174 explicitly excluded both a current
signal contract and the complete settlement/reflection composition. It asked
for one immutable activation frame and one common fresh/recovered loop. Commit
`3997fff9c` correctly implemented that narrower request.

**Inference.** The implementation did not miss its specification; the
specification replaced the intended acceptance artifact. #177 then audited
the wrong endpoint, and #178 proposed a locally valid immutable-route cleanup
inside the assembly that should instead be replaced.

The repaired #174 body supersedes that scope. #178 is closed; its useful
immutable-route requirement now belongs to `DeliveryActionProposal` and the
single runtime interpreter.

## Line-by-line production gap

| Accepted relationship | Current production fact | Remaining gap |
|---|---|---|
| `TrackerGraphRelation` | `CurrentDeliveryRelation` is locally constructed inside `runDeliveryActivation`. | No production current graph relation or accepted-fact publication gateway exists. |
| `trackerGraph.signal` | Production exposes one-shot reads plus manual refresh calls. | The relation must begin as `GraphNotEstablished`, then publish the first permitted freshly accepted graph and later accepted revisions without an attachment gap. |
| `frontierOf(graph)` | Production's `RunnableFrontier` already includes claim, worktree, executor, pause, and integration transitions. | A distinct graph-only `DeliveryFrontier` is required; it cannot reuse the responsibility-aware transition type. |
| `boundedParallelTickets(frontier)` | Runtime admission currently combines ordering with live positions. | Desired bounded tickets must be descriptive, apply graph order/capacity without reading held positions, and remain distinct from admission. |
| `ticketDeliveries(tickets)` | Journal reduction tracks exact responsibility per operation/resource subject. | Production lacks a derived ticket lifecycle relating desired placement to every exact lower obligation and graph-negative placement. |
| `deliverySettlements(deliveries)` | Accepted results can enter serialized integration and candidate construction. | The composition must own those integration proposals while exposing zero established settlements until verification, promotion, and disposition exist. |
| `reflectDeliverySettlements(settlements)` | No accepted settlement-to-tracker completion protocol exists. | Current reflection must truthfully propose no tracker mutation rather than disappear from the governing composition. |
| `deliveryRuntimeRelation(...)` | `runDeliveryActivation` derives, admits, dispatches, refreshes, and decides finality in one function. | One explicit relation must assemble ordered proposals and current facts for one runtime interpreter. |

## Function colours and ownership

| Composition | Visible reading | Colour at this level |
|---|---|---|
| `frontierOf` | current graph state → evidence-bearing ticket placement | Projection |
| `boundedParallelTickets` | delivery frontier + policy → desired bounded tickets | Projection |
| `ticketDeliveries` | desired placement + exact lower obligations → current ticket deliveries and proposals | Projection, then reconciliation |
| `deliverySettlements` | ticket deliveries → integration proposals + established settlements | Reconciliation/action proposal |
| `reflectDeliverySettlements` | established settlements → tracker-reflection proposals | Projection/action proposal |
| `deliveryRuntimeRelation` | visible relations → one ordered proposal frontier and current runtime snapshot | Pure assembly |
| Runtime interpreter | ordered proposals + live resource availability → admitted typed action | Runtime, then named action interpreter |

Descriptive signal subscription performs no tracker, Git, executor, journal,
or integration action. Each lower relation contributes pure action proposals.
Exactly one runtime interpreter owns admission and action execution after
bootstrap closes.

Every proposal carries:

- one exact proposal identity;
- immutable route/provenance;
- established domain priority/order evidence;
- zero/one task-work position requirement; and
- any exact integration repository/ref resource requirement.

The assembled relation preserves lower domain order without consulting live
positions. Duplicate ownership of one proposal identity is a typed conflict,
not a deduplication rule. Runtime may exclude live owners and apply resource
admission, but it cannot reorder proposals, infer resources from operation
tags, or derive new domain actions.

## Current graph and accepted-fact publication

Bootstrap and runtime action ownership are sequential:

1. Bootstrap records a fresh Run beginning or validates/reduces recovered
   history, installs the publication gateway and current relations, then
   closes. It performs no tracker, Git, executor, integration, pause, or
   recovery boundary action.
2. Journaled `TrackerGraphRelation` initially publishes
   `GraphNotEstablished`. Reconstructed graph knowledge is not permission for
   new forward progress.
3. The single runtime interpreter performs required recovery safety proposals
   first. A recovered paused Run remains passive. When accepted ordering
   permits, the tracker relation contributes the fresh complete-graph read
   proposal.
4. The interpreter records the read intent, asks the tracker, validates the
   complete result, and sends the accepted observation through the gateway.
5. Under one serialization boundary, the gateway appends the fact, obtains its
   journal position, incrementally reduces it, and publishes the resulting
   current relations.

Every in-Run journal append that can affect current relations—including
Operator control—passes through that gateway. A fresh Run beginning is the
single lifecycle append before installation. Run termination is the single
post-runtime append after the gateway/action owner closes, or may pass through
the gateway immediately before shutdown.

A crash after journal append but before publication loses only process state;
restart recovers the accepted fact from the journal. Concurrent boundary
outcomes are reduced and published in accepted journal-position order, not
wall-clock completion order.

Per-region unreadable facts, constraints, conflicts, waits, and isolation are
descriptive relation values. They do not fail the whole signal or stop
independent regions. The error channel is reserved for invalid shared history
or a genuinely shared capability failure.

## Ticket delivery, not executor responsibility

`TicketDelivery` is derived and process-local. It may cover:

- a desired ticket before the first intent;
- exact claim or worktree responsibility;
- running or safely suspended planned-attempt executor work;
- terminal Completed/Failed knowledge while the graph remains unsettled;
- Terminal Accepted before or after integration responsibility is created;
- integration dependency/configuration/target waits;
- candidate construction or preserved non-convergence; and
- graph absence, membership/specification constraints, pause, isolation, or
  relinquishment while an exact obligation remains.

Selection creates this derived relationship but no journal occurrence. The
relation disappears when a ticket is no longer desired and no exact obligation
exists. It also disappears when the accepted complete graph reports success
and no exact obligation remains. Invalid shared history produces no actionable
relation and fails the Run closed.

Exact claim, worktree, planned-attempt executor, integration, and future
disposition responsibilities keep their current narrow types and authority.

## Honest settlement and reflection

An empty established-settlement collection does not imply an empty action
plan. `DeliverySettlementRelation` must propose currently implemented
integration queue/start/candidate actions while keeping its established facts
empty. Pending integration remains visible in ticket delivery and prevents
finality.

Current reflection proposes no tracker mutation. Any future settlement and
reflection protocol must feed its accepted tracker observation into this same
graph relation, but its intent, ambiguity, retry, promotion, cleanup, and
tracker-completion chronology requires separately accepted scenarios.

## Quiescence and finality

One process-local quiescence-probe identity requests one typed final graph-read
proposal. Its accepted observation re-enters the same graph relation and
satisfies that probe against the resulting revision. New accepted facts
invalidate the probe; an unchanged satisfied probe returns finality rather
than issuing another read.

`RunMayTerminate` requires the final accepted complete graph to report every
task in the live target closure completed successfully and no Dalph-owned
exact work/resource responsibility to remain. Otherwise quiescence returns
`RunMustRemainActive`. No indefinite polling is added.

## Size and cut lines

This is a substantial re-seaming, not a rewrite of accepted tracker, journal,
Git, executor, admission, pause, or integration protocols. Source review found
six coherent implementation cuts:

1. literal relation spine and domain contracts;
2. accepted-fact gateway and tracker-graph relation;
3. delivery frontier, bounded tickets, and ticket-delivery lifecycle;
4. pure action proposals and assembled runtime relation;
5. single runtime interpreter on a short-lived integration branch; and
6. atomic application cutover and deletion of the old assembly on that same
   integration branch.

Tickets 5 and 6 must merge together; allowing two production-capable
schedulers on `master` would violate the accepted architecture.

The exact ticket bodies and blockers require user approval before publication.
The accepted operational scenarios and test seams live in #174.

## Non-decorative acceptance gate

- All application entrypoints use the flat composition and runtime relation.
- The outer code explicitly wires graph, deliveries, settlements, reflection,
  and runtime assembly.
- Lower subscribers perform no actions; one runtime interpreter executes pure
  proposals.
- The runtime cannot import graph/frontier/ticket-delivery/settlement proposal
  derivation.
- Existing integration is reachable only through settlement proposals.
- Empty settlement/reflection facts do not fabricate completion.
- The old fresh/recovered merge, checked-turn lookup, manual graph refresh,
  and independent integration routing cannot remain as another scheduler.
- Dry, live-fake, recovered, and production Layers yield the same normalized
  `DeliverySemanticTrace` after establishing equivalent current graphs; their
  intentional lifecycle/persistence differences remain outside that trace.
