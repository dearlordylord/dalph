# Handoff: Wayfind issue #132 activation ownership

Use the `wayfinder`, `domain-modeling`, `grilling`, `quint-modeling`, and
`effect` skills. This is a design/decision continuation, not production
implementation.

## Destination

Make [Activate fresh and recovered work through one loop](https://github.com/dearlordylord/dalph/issues/132)
implementation-ready by designing one coordinator activation loop and an
admission handoff whose invalid duplicate-owner states are unrepresentable and
model-checkable.

Use [the main control document](../issue-131-uncertainty-audit.md) and the live
`Activation seam inherited from #131` issue section. Do not restore a fixed
phase dispatcher or introduce a third scheduler/model.

## Decisions required

- Materialize the issue owner's accepted rederive-on-capacity-change decision:
  whenever a controller-snapshot change can permit future admission—including
  fresh provider evidence of non-consumption or reservation
  release/cancellation—the coordinator reads the current reconstructed
  managed-run state and controller snapshot and derives again; dormant
  controller waiters do not own the next position.
- Record the rejected controller-carried order-key alternative and show one
  concrete comparison trace. Account for changed fresh facts after restart:
  exact pre-crash frontier recreation is not required.
- Define exact transition identity before intent and stable operation identity
  after intent.
- Evaluate `Selected → Reserved → Granted → Owned →
  Released/Cancelled/Reconstructed` as candidate ephemeral model/controller
  phases. Give each accepted phase a concrete actor and creation/removal action,
  state its relationship to recorded operation intent, and reject or rename
  ambiguous phases. Do not create journal events, durable domain lifecycle
  states, or persisted frontier/resource state for this presentation.
- Define the public API so two fibers cannot own the same exact transition.
- Define changed-config-on-restart behavior: fresh occupied invocations may
  exceed the new limit; do not preempt them and admit nothing new until usage
  permits. Keep live resizing in issue #54.
- Extend the existing frontier-recovery Quint model and executable adapter;
  justify any third model against ADR 0010 rather than assuming one.

## Result required before implementation

Return an owner/action/boundary diagram, two readable ordering traces, the API
design for the accepted decision, the rejected alternative and its concrete
rejection reason, restart ownership rules, exact model
actions/invariants/counterexamples, required in-memory/SQLite lanes, and
patch-ready canonical issue/spec changes. Record the resolution in the existing
Wayfinder map/ticket structure and update the main ledger proof fields.
