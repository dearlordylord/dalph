# Dalph reducer lab

The Lab uses Dalph's maintained cassettes as canonical, deterministic
chronologies. For authored coordinator stories it captures the exact coherent
publications produced by the real reactive runtime and projects each one through
the literal production `delivery` composition. The browser therefore shows the
production-observed task graph, exhaustive frontier, desired bounded tickets,
ticket-delivery standings and obligations, settlements, and actual held
task-work positions. Desired tickets and held positions remain visibly distinct.

Target-promotion and integration-finality cassettes still run through their real
protocol runners, but do not receive a fabricated task graph: those direct
protocol fixtures never execute the graph-level delivery composition. The Lab
does not contain a second workflow reducer or scheduler.

The browser offers the maintained catalog as one selector and projects only the
selected cassette into one shared surface. Choosing a new cassette replaces the
older graph, chronology, action, status, and evidence instead of appending
another complete UI. There is no competing search or filter surface: the
ordinary selector is the only way to choose a cassette. The explicitly counted
**Run all** command always runs the complete catalog. Batch results stay
retained behind the selector, while the shared surface presents only the chosen
cassette's graph-first delivery timeline, compact terminal execution summary,
journal evidence ordered within each Run, and secondary raw diagnostics. A
maintainer can run one selected story or retry every cassette failure and Lab
defect. Each run receives fresh in-memory runtime state and a deterministic test clock.
Authored runs additionally receive browser cryptography and a fresh production
Run identity; protocol fixtures retain their declared identities.

An authored cassette controls tracker, claim, Git, executor, integration,
verification, promotion, trace, and journal boundary results. Implemented
Dalph coordinator and protocol code executes normally. A mismatched or
unsupported story item fails at that item and is displayed as a failure; the
Lab never skips it or manufactures a completed result.

The browser build imports the production package sources directly. Its Vite
composition replaces only the unavailable Node platform layers; none of the
cassette runners depend on those adapters for their controlled boundary calls.

Install at the repository root and run the workspace package:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dalph/reducer-lab-prototype dev
```

Validate all maintained cassettes and the browser bundle:

```sh
pnpm --filter @dalph/reducer-lab-prototype typecheck
pnpm --filter @dalph/reducer-lab-prototype smoke
pnpm --filter @dalph/reducer-lab-prototype build
```

The accepted chronology and scenario-to-test mapping are in
`docs/scenarios/reducer-lab-maintained-cassette-catalog.md`.
