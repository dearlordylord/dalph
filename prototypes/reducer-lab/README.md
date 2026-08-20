# Dalph reducer lab

The Lab uses Dalph's maintained cassettes as canonical, deterministic
chronologies. For authored coordinator stories it captures typed story
occurrences, exact coherent Delivery publications, and process-local delivery
runtime owner changes in one capture order. Each moment retains its coordinator
activation and authored story position. The browser follows the newest moment
by default and lets the maintainer rewind without moving the inspected moment
when later observations arrive. It therefore shows the
production-observed task graph, exhaustive frontier, desired bounded tickets,
ticket-delivery standings and obligations, settlements, and actual held
task-work positions. A permanently visible secondary source explanation shows
the literal `delivery` composition and marks changed rows only when a Delivery
publication changed them; a story-only or runtime-only moment carries forward
the last values and says that no Delivery publication occurred. Live integration
color comes only from the observed runtime owner, never from story prose or a
proposal. Desired tickets and held positions remain visibly distinct.

Application-Exit, concrete Codex executor, target-promotion, and
integration-finality cassettes run through their real production boundaries,
but do not receive a fabricated task graph, source explanation, or runtime
chronology: those direct protocol fixtures never execute the graph-level
delivery composition. Application-Exit facts
stay outside every Run journal, while Codex thread and turn facts stay private
behind the generic executor boundary. The Lab does not contain a second
workflow reducer or scheduler.

The browser offers the maintained catalog as one selector and projects only the
selected cassette into one shared surface. Choosing a new cassette replaces the
older graph, chronology, action, status, and evidence instead of appending
another complete UI. There is no competing search or filter surface: the
ordinary selector is the only way to choose a cassette. The explicitly counted
**Run all** command always runs the complete catalog. Batch results stay
retained behind the selector, while the shared surface presents only the chosen
cassette's graph-first delivery timeline, compact terminal execution summary,
journal evidence ordered within each Run and collapsed until requested, and
secondary raw diagnostics. A
maintainer can run one selected story or retry every cassette failure and Lab
defect. Each run replaces the prior process-local chronology and receives fresh
in-memory runtime state and a deterministic test clock.
Authored runs additionally receive browser cryptography and a fresh production
Run identity; protocol fixtures retain their declared identities.

An authored cassette controls tracker, claim, Git, executor, historical
integration, trace, and journal boundary results. Direct non-integration
cassettes control application drains, process-end decisions, the Codex app
server, private executor storage, owned activity observations, Git, and
evidence storage. Implemented Dalph coordinator and protocol code executes
normally. A mismatched or unsupported story item fails at that item and is
displayed as a failure; the Lab never skips it or manufactures a completed
result. Removed candidate/verification catalogs are not loaded as regression
evidence; maintained cassettes exercise the current outer Integrator boundary.

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

Install the pinned Chromium browser and its system libraries once (the system
package step requires root or passwordless sudo on Debian/Ubuntu):

```sh
pnpm --dir prototypes/reducer-lab browser:install
```

Then drive an ephemeral, self-hosted Lab through real Chromium:

```sh
pnpm check:lab:browser
```

The accepted chronology and scenario-to-test mapping are in
`docs/scenarios/reducer-lab-maintained-cassette-catalog.md`.
