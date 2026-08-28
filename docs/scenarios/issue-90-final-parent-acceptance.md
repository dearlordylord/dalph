# Converge the bounded MVP and presentation parent acceptance

Issue: [Converge final parent acceptance](https://github.com/dearlordylord/dalph/issues/90)

Status: accepted by the owner on 2026-08-24 as the final audit leaf for the
reliable-code and working-MVP frontier.

This is an audit and bookkeeping change. It adds no Dalph runtime decision,
boundary call, journal event, provider mutation, retry, cleanup action, trace
schema, or Quint behavior, so a new operational chronology would be fictitious.
The chronological behavior remains in the accepted scenarios for #80–#89.

## Exact acceptance scope

This audit closes the bounded local journey in parent #34 and consumes the
completed presentation lane in parent #33. It does **not** declare all of parent
#24 or the complete 22-beat `docs/DELIVERY-STORY.md` implemented. The checked-in
delivery-story manifest still records 20 `NotImplemented` beats, and native
product lanes #26–#32 remain open. Those explicit gaps are the next product
frontier rather than defects hidden by this audit.

The stale issue phrase “every workflow operation” is replaced by two existing,
closed denominators:

1. `scripts/capability-registration.ts` owns the 16 production-capability
   families. Its gate requires every family, exact controlled and production
   contract execution or a source-backed typed N/A reason, implementation
   identity, and production-composition consumption. It also rejects an
   unregistered assembled Layer.
2. `packages/dalph/test/conformance/recovery-prefix-manifest.ts` owns the 17
   ambiguity/lifecycle families. Every P0–P6 test cut has an applicable endpoint
   or exact N/A reason and live evidence reference. Tracker completion remains
   the one accepted representative memory/SQLite dual-store trace; the other
   rows remain focused metadata and do not fabricate 17 duplicate matrices.

These denominators overlap intentionally—capability families describe provider
composition, while recovery families describe ambiguity and lifecycle
behavior. This audit consumes both and creates no third operation taxonomy.

## Evidence reviewed

- #79 mechanically registers the capability families and makes the gate part
  of `check:all`; #285 later split GitHub completion-claim and task-completion
  authority into distinct registrations, extending the denominator to 16.
- #80–#85 provide the schema-versioned production TraceReader, shared exact
  cursor, recovery/integration/operator facets, truthful actor and observation
  gaps, and bounded 105-task/120-occurrence navigation.
- #86 runs one no-crash task through real local Git repositories, worktree,
  SQLite, evidence, coordinator lock, child process, Integrator, promotion, and
  tracker completion.
- #87 overlaps A and B executor work, preserves journal-position integration
  order, serializes one target Integrator, and starts dependant D only after a
  later complete tracker graph proves both prerequisites successful.
- #88 kills the coordinator after Git applies the compare-and-set but before its
  outcome is journaled; restart rereads Git, reuses the original identities, and
  neither reruns the Integrator nor repeats promotion.
- #89 proves exact claim release and the resource ledger: successful worktrees,
  branches, and immutable evidence remain without cleanup authorization;
  temporary transfer refs, child processes, and the coordinator lock settle;
  harness-owned teardown removes only its exact fixture root.
- Production cleanup qualification separately proves typed authorization,
  unrelated-resource preservation, and reread-before-retry after a lost
  provider response.
- Domain/spec, architecture/authority/connascence, and standards/code-smell
  reviews for the significant changes repeated until no reasonable finding
  remained. The one rejected broad ordering proposal for #87 conflicted with
  the accepted #56 chronology and Quint model, so production kept the existing
  per-result FIFO rule.

## Final gates and bounded exception

On master candidate `14c65143c`, `pnpm check:all` passed 2,299 coverage tests
with 38 declared skips, 29 model-based tests, 91 maintained Reducer Lab
cassettes, package/type/Effect diagnostics, architecture and complexity gates,
98% aggregate coverage, 100% changed-line coverage, and the secret scan.
`pnpm check:quint` passed all deterministic, sampled, exhaustive, proof, and
negative-mutation checks in 340.73 seconds.

`pnpm check:lab:browser` reaches Chromium but this host cannot load
`libatk-1.0.so.0`. The documented `pnpm --dir prototypes/reducer-lab
browser:install` setup was attempted and cannot install system libraries because
`sudo` requires unavailable credentials. #85 explicitly accepts recording this
environment exception after that attempt; browser-smoke syntax and the
non-browser Lab checks pass.

## Acceptance-test mapping

- `runs every registered controlled and production implementation through its
  named contract family` plus the capability-registration negative cases prove
  the closed 16-family composition denominator.
- `keeps the recovery-prefix manifest closed and tied to current evidence`
  proves the 17-family recovery denominator, exact P0–P6 applicability reasons,
  and live evidence references.
- The named #86–#89 hermetic tests prove the bounded no-crash, concurrency,
  crash-recovery, tracker-release, and resource-census journey.
- The named #80–#85 TraceReader and Reducer Lab tests prove the shared
  presentation envelope and bounded large-run interaction.
- `pnpm check:all` and `pnpm check:quint` are the final repository and governed
  behavior gates.

The visible bookkeeping result is that #33 and #34 may close when their native
children are closed. Parent #24 remains open, with its closed children retained
as completed history and its open child lanes left visible.
