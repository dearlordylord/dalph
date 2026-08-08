# Reducer Lab: run every maintained cassette through production

These scenarios add a throwaway Lab over all three production-owned maintained
cassette catalogs. They do not change a Dalph command, workflow decision,
tracker or Git request, durable journal fact, retry rule, cleanup action, or
production-visible result. The Lab imports the authored, target-promotion, and
integration-finality catalogs and their production runners; it does not define
another cassette catalog or workflow interpreter.

The shared authored-cassette harness also resolves a recovery scheduling race.
After an authored `CoordinatorProcessDies`, the recovered production
coordinator may ordinarily finish at the same turn that the story cursor
reaches its terminal assertion group. The harness accepts that successful
coordinator completion, then consumes the terminal group at its exact current
position and checks the returned journal. A failed recovered coordinator still
fails the cassette, and an earlier or mismatched story item still produces an
interaction mismatch. This changes deterministic test-harness chronology only;
the production coordinator, boundaries, journal events, and visible command
outcomes are unchanged.

## A maintainer runs one maintained cassette to its authored end

### Starting situation

A Dalph maintainer opens the Reducer Lab. The checked-in maintained cassette
catalogs contain stories with their own tracker, claim, Git, executor,
integration-candidate, verification, promotion, control, and journal starting
facts. No real GitHub repository, Git worktree, executor process, or durable
journal is changed: each cassette declares controlled boundary results and the
production cassette runner constructs fresh in-memory adapters and a fresh
in-memory journal for that run.

### Trigger and ordered behavior

The maintainer selects a catalog entry and chooses **Run cassette**. The Lab
passes that exact catalog value to `runAuthoredScenarioCassette`,
`runTargetPromotionProtocolCassette`, or
`runIntegrationFinalityProtocolCassette`, according to the production catalog
that owns it. The production runner validates the story, invokes the implemented
coordinator or protocol, and consumes each declared boundary result only when
production reaches the matching interaction.
The Lab does not search ahead, append journal rows, invoke a reducer directly,
or manufacture a successful result.

When the production run consumes the terminal assertion or observation, the
Lab displays the story name, completed status, exact consumed-item count, and
the production journal records returned by the runner. The maintainer may run
the same cassette again; every runner creates fresh controlled runtime state.
The authored runner also creates a fresh journal and Run identity, so a second
authored result does not reuse the first run's state. Protocol fixtures retain
their declared identities while replaying through fresh in-memory state.

### Visible and forbidden results

The maintainer sees whether production completed or stopped, how many authored
items were consumed, and the resulting production journal. The Lab must not
label a story complete when an item remains, silently skip an unsupported item,
replace implemented production behavior with a fake reducer, or mutate the
catalog value. Controlled cassette boundaries remain visibly identified as
controlled inputs rather than real GitHub, Git, or executor processes.

### Crash and retry

Browser-process loss discards the displayed result because the Lab has no
persistence. It cannot ambiguously change an outside system. Retrying by
choosing **Run cassette** starts the whole deterministic story again with fresh
in-memory adapters; recovery inside a cassette occurs only at an authored
`CoordinatorProcessDies` item and is handled by the production runner.

### Acceptance-test mapping

- `runs every maintained cassette through production to its declared end`
  enumerates the exact three public catalogs, delegates every entry to its
  production runner, and requires complete story consumption.
- `reports the exact authored item when production cannot complete a cassette`
  runs a deliberately mismatched story and requires a visible failure rather
  than skipped input or synthetic success.
- `accepts successful recovered completion at the terminal assertion boundary`
  runs a maintained recovery story and requires its recovered coordinator and
  terminal assertions both to complete without hiding failures.
- `renders every maintained cassette and its production execution evidence`
  checks that the browser view contains each catalog key and exposes status,
  consumed-item count, controlled-boundary provenance, and journal evidence.

## A maintainer runs the whole catalog

### Starting situation and trigger

The same maintained catalog is loaded and no cassette run is active. The
maintainer chooses **Run all cassettes**.

### Ordered behavior and visible result

The Lab starts each catalog entry independently through the same production
runner used by the single-story action. A failure is retained beside its exact
catalog key and does not become a passing result. Once every entry settles, the
summary reports the exact completed and failed counts; successful entries have
consumed their complete authored stories.

There is no bounded production task concurrency claim here: this is a local
developer tool running isolated deterministic cassettes. No real boundary,
cleanup, or retry is introduced. Reloading the browser is the only cleanup and
discards all displayed results.

### Acceptance-test mapping

- `runs every maintained cassette through production to its declared end`
  is the command-independent execution proof for the whole catalog.
- `the Run all command retains one terminal result for every catalog entry`
  checks the browser update path and the exact completed/failed summary.
