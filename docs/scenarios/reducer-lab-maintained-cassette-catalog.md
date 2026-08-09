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
- `shows only information that selects, explains, or diagnoses a maintained cassette`
  checks that the browser selector contains every catalog choice while one
  shared surface exposes the safety boundary, declared input, production
  ownership, and completion meaning for its current selection.

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
- `the real browser entry runs every maintained cassette and retains every terminal result`
  checks the browser update path and the exact completed/failed summary.

## A maintainer finds, follows, and diagnoses the cassette that matters

### Starting situation and trigger

A Dalph maintainer opens the Lab against one exact source revision. Forty or
more maintained cassettes may be present across authored coordinator,
target-promotion, and integration-finality catalogs. No cassette is running.
The maintainer may not already know a catalog key or which production runner
owns the behavior they need to inspect.

### Ordered behavior and visible result

The Lab first states that this is a local deterministic harness, identifies the
source revision, and says that no GitHub issue, Git repository, executor
process, or durable journal will be changed. It groups selectable choices by
the production runner that owns them. A search narrows choices by human story name,
exact catalog key, category, runner, controlled-boundary description, or any
declared input value. Search words may occur separately and all must match. A
category filter and a terminal-status filter independently narrow the view.
When a match exists only inside the exact input, the selected surface shows the
matching snippet instead of appearing without an explanation.

The selected surface makes the human story name primary and retains the exact
catalog key, production runner, and controlled boundaries. A collapsed declared input
shows a readable one-column sequence and retains the exact JSON under a second
disclosure; both are labelled as input, not execution proof. An evidence
disclosure is absent until a run produces a result.

When the maintainer runs the selected cassette, its shared surface immediately stops displaying its
previous result, says that production code is running with controlled
boundaries, and disables overlapping commands. When the maintainer runs the
whole catalog, every retained cassette state immediately becomes running and
each receives its terminal result as soon as its own production runner settles;
the selector exposes those live states while the shared surface projects the
current choice. **Run shown** is offered only for a narrowed view and runs only the choices admitted by the current
filters. Status-filtered visibility updates at each state change. The Lab does not
keep old green evidence visible and does not wait for the slowest cassette
before showing faster results. The catalog summary distinguishes not-run,
running, cassette-completed, cassette-failed, and Lab-defect counts. It explains
that cassette completion means reaching the declared end, which may include an
expected protocol failure. After a single run it no longer claims that the
whole catalog is merely ready.

A selected completed cassette shows a compact execution summary: the runner, coordinator
activations and Run identity when those concepts apply, and interpreted
journal or terminal facts. Protocol-specific counters remain under a secondary
diagnostic disclosure. Journal records appear separately, grouped by Run
identity and described as chronological only within each Run.
The complete returned object remains available only under **Raw execution
result**.

A failed cassette leads with its exact consumed count and failed item when
known, followed by a concise error. Raw cause and stack detail remain under
**Raw diagnostic**. When the typed failed result cannot return partial journal
records, the concise evidence explicitly says they are unavailable. The
aggregate result links both failed cassettes and Lab defects by human story and
exact key, clears concealing filters before focusing a linked problem, and
offers **Retry problem cassettes**. If the browser composition itself unexpectedly
rejects instead of returning a cassette result, the affected cassette and aggregate
summary retain a distinct Lab defect and controls become usable again. While any
runner is still waiting, **Reload Lab and discard displayed results** provides
an explicit escape and names the local diagnostic state that it discards.

### Visible and forbidden results

Every visible label or value helps the maintainer select a cassette, understand
the safety boundary, follow current execution, verify completion, or diagnose
a stop. Category is not repeated in a prefixed title, empty evidence panels do
not appear, a journal count is not presented as correctness proof, declared
input is not presented as observed output, and an earlier result never appears
current during a rerun. Filtering changes **Run shown** but never changes which
catalog entries the explicitly counted **Run all** command executes.

Browser loss discards this local presentation state and cannot ambiguously
change an outside system. Retrying repeats the selected deterministic
cassette through fresh controlled runtime state as described above.

### One selected cassette owns the shared Lab surface

The catalog controls expose the maintained cassettes as choices rather than
rendering one complete browser UI per cassette. On first load the first
admitted cassette is selected and exactly one shared cassette surface shows its
name, exact key, declared chronology, Run command, status, applicable delivery
workbench, and terminal evidence. When the maintainer selects another cassette,
that cassette replaces all content in the same surface. No workbench, status,
chronology, or evidence from the previous selection remains visible beside it.

Search, catalog, and status filters narrow the selectable choices. If they
exclude the current selection, the first remaining choice replaces it; if no
choice remains, the shared surface says that no cassette matches. **Run all**
and **Run shown** still execute their exact catalog sets and retain one state per
cassette, but only the currently selected cassette is projected into the shared
surface. Selecting a previously completed cassette later restores its retained
terminal result in that one surface. A problem link selects and focuses its
failed cassette instead of revealing another cassette UI.

The Lab must not create one article, workbench, chronology, Run button, or
evidence tree per catalog entry. A new selection must replace the old selected
surface rather than append to it.

### Acceptance-test mapping

- `shows only information that selects, explains, or diagnoses a maintained cassette`
  checks the source/safety context, complete grouped selector, one selected
  surface, runner and boundary facts, completion meaning, hidden pre-run
  evidence, and readable and exact declared input.
- `searches declared behavior without changing the maintained run-all catalog`
  checks token-AND declared-behavior search, independent category filtering,
  and the filter-independent full-catalog command.
- `replaces stale evidence with live cassette progress and settles cassettes independently`
  holds two controlled UI promises, observes both choices become running, and
  observes the first leave the running choices while the shared surface moves
  to the second before that runner settles.
- `presents concise execution proof before chronological journal and raw output`
  runs one real cassette and checks its runner, activation or protocol facts,
  journal ordering scope, exact event detail, and secondary raw result.
- `links, reveals, and retries cassette failures and Lab defects`
  injects one returned cassette failure and one unexpected rejected promise,
  then checks distinct visible states, filter-safe navigation, retry of both
  problem kinds, and recovered controls.
- `offers an explicit reload escape while a runner is still waiting` holds one
  runner promise open and checks that the isolated Lab exposes its reload
  recovery action.
- `uses one shared cassette surface and replaces it when selection changes`
  checks that all catalog choices drive one article and that changing the
  selected key replaces its identity, chronology, workbench applicability,
  action, status, and retained result without leaving the old UI visible.

## A maintainer watches an authored cassette move through delivery

### Starting situation

A Dalph maintainer opens the local Lab and selects one maintained authored
coordinator cassette. The cassette declares controlled tracker graphs, an
initial task-work capacity, and the ordered tracker, Git, executor, control,
and terminal interactions that its production runner will receive. No outside
GitHub issue, Git repository, executor process, or durable journal is changed.

Before execution, the Lab may show the cassette's declared task graph as
**controlled input**. Production has not observed that graph yet, so the Lab
shows no production frontier, bounded placements, held positions,
responsibilities, or settlements. Direct target-promotion and
integration-finality protocol cassettes do not run the graph-level delivery
composition, so those cassettes retain protocol evidence and do not receive an
empty or fabricated graph workbench.

### Production execution and captured delivery publications

The maintainer chooses **Run cassette**. The ordinary authored cassette runner
starts the production coordinator. Production asks the controlled tracker for
the graph, records accepted graph observations and later workflow facts, and
the production reactive delivery layer publishes each coherent input revision
that the ordinary runtime consumes. A read-only cassette observer records
those exact immutable publications, the current Fresh or Recovered activation,
and the authored story position reached at publication time. It does not alter
the publication, select an action, append a journal event, or call a boundary.

After the production runner reaches the cassette's declared end, the Lab sends
each recorded publication through the literal production `delivery`
composition. At that production boundary a focused test checks the complete
identity chain in the one `DeliveryConsequences` value. The runner then derives
one serializable browser frame from that same value: observed graph, exhaustive
delivery frontier, bounded ticket placements, ticket deliveries and exact
obligations, settlements, and tracker-reflection meaning. It does not claim
that the browser DTO retains Effect services, private graph brands, or relation
object identities. The recorded runtime facts separately retain the actual
task-work capacity and exact held
`(RunId, AttemptId)` positions; the Lab does not call desired tickets or a
frontier an allocation.

For a dependent-task cassette, the maintainer can select consecutive frames
and see the tracker-observed A-to-B prerequisite graph, A selected while B is
excluded, A's terminal executor report releasing its task-work position while
B remains graph-blocked, and only a later tracker observation of A's successful
lifecycle making B eligible. For a pause cassette, a Pause direction alone
does not release A's held position; the frame after the exact safely-suspended
report does. For a recovery cassette, Fresh and Recovered frames are visibly
separated and retain the same exact planned attempt where the cassette does.

### Visible and forbidden results

The graph is the primary authored-cassette result, with prerequisite and
grouping edges, task lifecycle, frontier standing, bounded placement, ticket
delivery standing, exact obligations, settlement state, and held-position
correlation available per task. A frame identifies its production activation,
authored story position, accepted journal position, graph revision, and
capacity. The cassette chronology and raw journal remain available as the
control/evidence record rather than replacing the graph.

The Lab must not project a frontier from declared input, fabricate a privately
branded journaled graph observation, infer missing topology from durable task
membership, call a selected bounded ticket an admitted or held position,
equate executor completion with tracker completion or delivery settlement,
combine Fresh and Recovered publications into one activation, or restore the
deleted Lab-owned scheduler and synthetic selector facts. Browser loss discards
only this presentation. A retry reruns the cassette through fresh controlled
runtime state.

### Acceptance-test mapping

- `shows an authored cassette declared graph only as input before production observes it`
  checks that the graph is labelled controlled input and that delivery output
  is absent before execution.
- `captures every authored delivery frame from the real production publication and delivery composition`
  checks every authored run returns current-first and established delivery
  frames; `records the initial and later exact production bundles without
  changing their delivery source chain` checks the observer's exact publication
  and the complete `DeliveryConsequences` identity chain before the browser DTO
  is derived.
- `shows the production-observed graph frontier bounded tickets and held positions`
  runs a maintained authored cassette and checks the browser workbench against
  its returned delivery frames.
- `shows grouping relationships exact obligations and settlement state` checks
  a production-observed parent relation becomes a grouping edge and that the
  task table exposes exact obligations and current settlement state.
- `keeps a dependant blocked after executor completion until a later tracker observation`
  checks the maintained dependent-task timeline rather than inferring release
  from the declared story.
- `separates desired tickets from exact held task-work positions`
  checks that bounded placements and runtime position holders are distinct
  visible fields.
- `keeps a paused task held until the exact safe-suspension report` checks the
  Pause direction and Running report leave A's exact attempt in the held map,
  and only the declared `SafelySuspended` report releases it.
- `separates Fresh and Recovered delivery frames across authored coordinator death`
  checks activation boundaries and exact attempt correlation in a maintained
  recovery cassette.
- `does not fabricate a graph workbench for direct protocol cassettes` checks
  that target-promotion and integration-finality cassettes retain only their real
  protocol evidence.
