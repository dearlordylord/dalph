# Declarative Effect story and validation stack
Status: exploratory design note. This records a promising way to describe the
control plane and possible ways to validate it. It changes no production
behavior, accepts no new requirement, and does not replace the terminology or
protocols in `docs/ARCHITECTURE.md` or accepted ADRs.

## Context

The prototype discussion is looking above an individual planned-attempt
controller. The goal is to see whether one Effect can read like one universal
story at one abstraction level: relationships among the tracker graph, its
frontier, bounded parallel tickets, executor responsibilities, and the facts
eventually reflected into the tracker.

The story should be declarative. Words such as “poll,” “take N,” “start,” and
“loop” describe one possible interpreter. They should not be mistaken for the
model itself. A projection may change deterministically when its input changes;
the resulting loss of an executor responsibility is a legitimate fact for the
executor implementation to reconcile. The high-level story therefore does not
imply sticky selection.

The current accepted architecture separately derives a runnable frontier and
then deterministically chooses a bounded admission set. “Bounded parallel
tickets” is candidate language at a higher level, not a decision to collapse
those concepts or replace [ADR 0009](../docs/adr/0009-separate-frontier-from-bounded-admission.md).

## Candidate story

> The graph is a signal; frontier, bounded tickets, and responsibilities are
> projections; delivery settlement is reflected back into the graph.

The corresponding relationship is provisionally:

```text
tracker graph
    → frontier
    → bounded parallel tickets
    → executor responsibilities
    → delivery settlement
    → tracker graph
```

This is a relationship, not an imperative procedure. An Effect interpreter may
realize it through subscriptions, repeated observations, reconciliation, and
boundary calls, but those mechanics sit below this story.

Executor completion alone is not delivery settlement. The required
consequences may include serialized work by the singleton integration agent,
resource disposition, cleanup, and tracker mutation. This note deliberately
does not expose each consequence as a top-level stage. They may be hidden in a
composed `DeliverySettlement` story unless one of them independently affects a
property being discussed at this level.

The words `signal`, `projection`, `responsibility`, and `delivery settlement`
are candidates for the prototype. They are not yet additions to Dalph's
canonical glossary.

## Mathematical reading

The model can be understood without subscription language by treating its
values as functions of logical time:

```text
graph            : Time → TrackerGraph
frontier         : Time → Frontier
boundedTickets   : Time → Set Ticket
responsibilities : Time → Set Responsibility
settlements      : Time → Set DeliverySettlement
```

Pure functions or relations connect those values at each logical instant. An
imperative runtime is one interpretation that works toward agreement among the
external authorities and those declared relationships. Temporary disagreement
must remain representable so that interruption and restart do not disappear
from the model.

## Candidate validation stack

No single technique validates every part of this idea.

| Technique | Candidate responsibility | Does not establish |
|---|---|---|
| Effect story | Executable composition of the projections, responsibilities, settlement stories, and injected boundaries | That all concurrent or crash interleavings are safe |
| Pure and property-based tests | Determinism, bounds, idempotence, permutation independence, and other algebraic projection laws | Runtime recovery or adapter behavior |
| Quint | Small-state exploration of responsibility changes, interruption, restart, serialized integration, settlement, and tracker reflection; safety invariants and reachable counterexamples | That the TypeScript implementation conforms to the model |
| Model-based or conformance tests | Compare observable Effect transitions or traces with transitions allowed by the Quint model | Correctness of real Git, tracker, journal, or executor adapters unless those adapters are exercised separately |

Lean or another proof assistant could prove theorems about the pure projection
functions, but it is not currently justified. Effect test services remain the
natural way to drive signals and boundary outcomes deterministically. Adapter
contract and bounded end-to-end tests remain necessary for behavior owned by
Git, the tracker, journal storage, processes, and the executor substrate.

## Properties worth considering later

The property set should be derived only after the story's nouns and boundaries
settle. Likely candidates include:

- executor responsibilities never exceed the bounded projection;
- at most one integration responsibility acts on the accepted target at once;
- executor completion alone cannot produce tracker completion;
- removing a ticket from the bounded projection can be reconciled without
  losing its still-outstanding preservation or disposition obligations;
- restart can reconstruct enough current facts to continue toward the same
  declared relationships; and
- tracker reflection occurs only after the accepted meaning of delivery
  settlement holds.

These are candidate properties, not accepted Dalph requirements. In
particular, the exact contents and ordering of delivery settlement remain open.

## Next prototype step

Write only the outer Effect story first. Its code should expose the graph
signal and the named projections while delegating executor responsibility and
delivery settlement to composed stories. It should not yet expose worktree
preparation, executor-session restoration, integration commands, cleanup
commands, polling, retry, or wake-up mechanics.
