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

Some recovered stories consume their final controlled boundary response before
the coordinator has durably recorded the terminal candidate or verification
event. After that response, the harness waits for the exact required event and
the recovered coordinator together. If the coordinator fails or stops first,
the cassette returns that failure instead of waiting forever; if it records the
event first, the harness proceeds to the terminal assertions. This observation
does not retry or manufacture the event.

## A maintainer runs one maintained cassette to its authored end

### Starting situation

A Dalph maintainer opens the Reducer Lab. The checked-in maintained cassette
catalogs contain stories with their own tracker, claim, Git, executor,
integration-candidate, verification, promotion, control, and journal starting
facts. No real GitHub repository, Git worktree, executor process, or durable
journal is changed: each cassette declares controlled boundary results and the
production cassette runner constructs fresh in-memory adapters and a fresh
in-memory journal for that run.

The maintainer may reach the Docker-hosted Lab over an ordinary Orb HTTP host,
where browsers expose secure random bytes but do not expose `crypto.subtle`.
The Lab computes the same requested SHA digest locally with its browser-safe
cryptographic implementation, so production evidence storage executes without
requiring a secure origin or substituting a made-up digest.

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

- `hashes verification evidence without requiring browser crypto.subtle`
  checks the exact SHA-256 identity used by the browser evidence-store adapter
  without reading the secure-origin-only Web Crypto digest API.
- `runs every maintained cassette through production to its declared end`
  enumerates the exact three public catalogs, delegates every entry to its
  production runner, and requires complete story consumption.
- `reports the exact authored item when production cannot complete a cassette`
  runs a deliberately mismatched story and requires a visible failure rather
  than skipped input or synthetic success.
- `accepts successful recovered completion at the terminal assertion boundary`
  runs a maintained recovery story and requires its recovered coordinator and
  terminal assertions both to complete without hiding failures or waiting
  forever after a coordinator stops before its required terminal event.
- `fails recovered verification promptly when terminal evidence cannot be recorded`
  makes the controlled evidence digest fail after the final authored boundary
  and requires the recovered runner to return that failure rather than wait
  forever for an event it can no longer record.
- `shows only information that selects, explains, or diagnoses a maintained cassette`
  checks that the browser selector contains every catalog choice while one
  shared surface exposes the safety boundary, declared input, production
  ownership, and completion meaning for its current selection.

## A maintainer runs the whole catalog

### Starting situation and trigger

The same maintained catalog is loaded and no cassette run is active. The
maintainer chooses **Run all cassettes**.

### Ordered behavior and visible result

The Lab starts one catalog entry at a time through the same production runner
used by the single-story action. As it settles, the Lab starts the next
maintained entry until all have run. Browser cassette runtimes do not overlap
their controlled clocks and runtime layers; this is not Dalph's production
task-work capacity. A
failure is retained beside its exact catalog key and does not become a passing
result. Once every entry settles, the summary reports the exact completed and
failed counts; successful entries have consumed their complete authored stories.

There is no bounded production task concurrency claim here: this is a local
developer tool running isolated deterministic cassettes. No real boundary,
cleanup, or retry is introduced. Reloading the browser is the only cleanup and
discards all displayed results.

### Acceptance-test mapping

- `runs every maintained cassette through production to its declared end`
  is the command-independent execution proof for the whole catalog.
- `the real browser entry runs every maintained cassette and retains every terminal result`
  checks the browser update path and the exact completed/failed summary.
- `browser-smoke drives the real Orb application through every maintained cassette`
  runs through the package's `browser-smoke` command against `REDUCER_LAB_URL`, completes
  the insecure-origin verification cassette, then discovers the current maintained
  choice count from the ordinary selector and requires every choice to
  settle with no failure or Lab defect and exercises retained frame navigation.
- `runs browser Run all sequentially without changing its complete cassette set`
  holds five controlled runners, proves only one starts initially, then proves
  the next starts as the prior cassette settles and every choice retains its result.

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
the production runner that owns them in one ordinary cassette selector. There
is no second search or filter selection mechanism competing with that control.

The selected surface makes the human story name primary and retains the exact
catalog key, production runner, and controlled boundaries. A collapsed declared input
shows a readable one-column sequence and retains the exact JSON under a second
disclosure; both are labelled as input, not execution proof. An evidence
disclosure is absent until a run produces a result.

For authored coordinator cassettes, each readable declared interaction comes
from the exhaustive production authored-story presenter while the item remains
typed. The defining Continue/Stop race, executor projections, and lost boundary
responses appear as concrete actor/action/boundary prose rather than raw `_tag`
names; the exact structured input remains in the secondary disclosure.

When the maintainer runs the selected cassette, its shared surface immediately stops displaying its
previous result, says that production code is running with controlled
boundaries, and disables overlapping commands. When the maintainer runs the
whole catalog, every retained cassette state immediately becomes running and
each receives its terminal result as soon as its own production runner settles;
the selector exposes those live states while the shared surface projects the
current choice. The Lab does not keep old green evidence visible and does not
wait for the slowest cassette before retaining faster results. The catalog
summary distinguishes not-run,
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
exact key, selects the linked problem in the shared surface, and
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
current during a rerun. The explicitly counted **Run all** command always
executes the complete maintained catalog.

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

**Run all** retains one state per cassette, but only the currently selected
cassette is projected into the shared surface. Selecting a previously
completed cassette later restores its retained terminal result in that one
surface. A problem link selects and focuses its failed cassette instead of
revealing another cassette UI.

The Lab must not create one article, workbench, chronology, Run button, or
evidence tree per catalog entry. A new selection must replace the old selected
surface rather than append to it.

The cassette control is an ordinary browser select containing every maintained
choice. Its label says **Choose cassette** and states the number of available
choices. Three standard option groups name the catalogs; each concise option
names the human story and current status while its value retains the exact key.
Opening the select must not run a cassette or replace the selected surface;
choosing an option is the only selection trigger. No search box, catalog
filter, status filter, or **Run shown** command appears.

After an authored cassette completes, the maintainer opens its Delivery
workbench and chooses **Next frame**. The already-rendered workbench stays
connected, the frame control advances from frame 1 to frame 2, and the graph
and task facts remain on frame 2 after the browser delivers its queued native
disclosure events. Closing and reopening the workbench preserves one usable
timeline. The Lab must not replace an open disclosure in response to its own
`toggle` event, blink the frame selector closed, or reset navigation to frame
1.

### Acceptance-test mapping

- `shows only information that selects, explains, or diagnoses a maintained cassette`
  checks the source/safety context, complete ordinary selector, one selected
  surface, runner and boundary facts, completion meaning, hidden pre-run
  evidence, and readable and exact declared input.
- `replaces stale evidence with live cassette progress and settles cassettes independently`
  holds two controlled UI promises, observes both choices become running,
  selects between them while the batch is active, and observes each retained
  terminal result as its runner settles.
- `presents concise execution proof before chronological journal and raw output`
  runs one real cassette and checks its runner, activation or protocol facts,
  journal ordering scope, exact event detail, and secondary raw result.
- `links, reveals, and retries cassette failures and Lab defects`
  injects one returned cassette failure and one unexpected rejected promise,
  then checks distinct visible states, problem selection, retry of both
  problem kinds, and recovered controls.
- `offers an explicit reload escape while a runner is still waiting` holds one
  runner promise open and checks that the isolated Lab exposes its reload
  recovery action.
- `uses one shared cassette surface and replaces it when selection changes`
  checks that all catalog choices drive one article and that changing the
  selected key replaces its identity, chronology, workbench applicability,
  action, status, and retained result without leaving the old UI visible.
- `keeps cassette selection and delivery frame navigation stable across disclosure toggles`
  checks the complete ordinary selector labels, runs an authored cassette,
  queues the disclosure's native-style toggle after opening, and proves the
  same workbench and timeline remain connected while Next and Previous frame
  navigation persist.

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
its zero-based coordinator-activation ordinal, and the authored story position
reached at publication time. It does not alter
the publication, select an action, append a journal event, or call a boundary.

The Lab projects each recorded publication through the literal production
`delivery` composition as soon as the controlled observer receives it. While
the cassette is still running, the shared workbench shows the newest completed
projection and says that it is following production. A maintainer may turn
**Follow live** off, move to an earlier frame with **Previous frame** or the
ordinary frame selector, and inspect that immutable frame while later
publications continue to arrive. Turning **Follow live** back on moves to the
newest available frame. An incoming publication must not replace the selected
cassette surface, close a disclosure, or reset a paused frame or selected task.

When the runner reaches the declared end, the workbench remains on the last
production frame when live following is enabled. The terminal result does not
append duplicate frames. If no publication has arrived yet, the Lab continues
to show only the controlled declared graph and says production has not yet
published delivery state. Direct protocol runners do not gain a fabricated
timeline.

At the production projection boundary a focused test checks the complete
identity chain in the one `DeliveryConsequences` value. The runner then derives
one serializable browser frame from that same value: observed graph, exhaustive
delivery frontier, bounded ticket placements, ticket deliveries and exact
obligations, settlements, and tracker-reflection meaning. The downstream
production action-planning composition then shows ordered proposals, isolated
derivation issues, or ownership conflicts for that same publication. These
are planned next actions: observing them performs nothing, and the Lab never
presents a proposal as an action that ran. It does not claim
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
report does. For a recovery cassette, every coordinator activation is visibly
separated, including later Recovered-to-Recovered restarts, and retains the
same exact planned attempt where the cassette does. The first frame of each
activation names its numbered restart boundary and summarizes which held
positions and exact obligations survived, changed, or disappeared. The
maintainer does not have to infer restart continuity only by comparing raw
JSON.

### Visible and forbidden results

The graph is the primary authored-cassette result, with prerequisite and
grouping edges, task lifecycle, frontier standing, bounded placement, ticket
delivery standing, exact obligations, settlement state, and held-position
correlation available per task. A frame identifies its production activation,
authored story position, accepted journal position, exact graph-read identity
and recorded position, graph and task revisions, capacity, and quiescence
disposition. The cassette chronology and raw journal remain available as the
control/evidence record rather than replacing the graph.

When a recovery publication has not yet established a graph, the Lab replaces
the large empty canvas with a compact explanation that there are no observed
tasks to select. Reconstructed held positions and ticket-delivery obligations
remain visible below; the Lab does not invite the maintainer to use an empty
graph summary.

The typed cassette-evidence projection derives the concise action-plan facts
while the exact production proposal union is still available. The browser does
not reparse raw diagnostic JSON to rediscover route, admission, ownership, or
correlation. The projection names the concrete production transition,
its task or attempt correlation, whether it must reserve or reuse a task-work
position, serialization with executor commands and Continue or Stop, or an
integration-target resource,
and any live operation it must wait for. When two proposals call the same
authority read for different workflow purposes, the concise summary names both
purposes. Exact obligation summaries distinguish executor-work, claim-release,
worktree, and integration responsibilities. Terms such as
`IdentityFreeWorkflowRoute` stay in the secondary exact JSON rather than
becoming the human action label.

No currently maintained authored cassette crosses the separate direct
integration-finality protocol and then triggers another graph-level delivery
publication. Consequently the authored workbench currently demonstrates the
settlement and tracker-reflection layers only in their exact empty state. It
says this explicitly; it must not imply that the current maintained catalog contains
a populated graph-level settlement frame, and it must not synthesize one from
the direct protocol cassette.

The Lab must not project a frontier from declared input, fabricate a privately
branded journaled graph observation, infer missing topology from durable task
membership, call a selected bounded ticket an admitted or held position,
equate executor completion with tracker completion or delivery settlement,
combine Fresh and Recovered publications into one activation, or restore the
deleted Lab-owned scheduler and synthetic selector facts. Browser loss discards
only this presentation. A retry reruns the cassette through fresh controlled
runtime state.

A populated graph must not also render or announce its empty-state sentence.
Graph nodes contain compact state labels; exact evidence and correlations stay
in selected-task facts. At a narrow viewport the frame control fits the
viewport, per-task facts remain readable without page-wide horizontal
overflow, and terminal journal evidence remains collapsed until requested.
At desktop width all six per-task meanings remain visible without an implicit
multi-screen horizontal scroll; opaque revisions and correlations wrap or stay
inside secondary disclosures. Simultaneous graph eligibility, selected desired
ticket, held position, and retained ticket-delivery standing use composable
visual encodings, so one fill rule must not erase another fact promised by the
legend. Selecting a task adds a separate interaction highlight without
replacing any of those domain encodings, and the legend identifies it as the
task whose exact facts are correlated below.

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
- `uses production authored prose for current story items` checks the defining
  Continue/Stop race and a read-only executor projection use the exhaustive
  typed production presenter rather than the Lab's generic tag formatter.
- `keeps a dependant blocked after executor completion until a later tracker observation`
  checks the maintained dependent-task timeline rather than inferring release
  from the declared story.
- `separates desired tickets from exact held task-work positions`
  checks that bounded placements and runtime position holders are distinct
  visible fields.
- `keeps a paused task held until the exact safe-suspension report` checks the
  Pause direction and Running report leave A's exact attempt in the held map,
  and only the declared `SafelySuspended` report releases it.
- `separates every coordinator activation in a multi-restart delivery timeline`
  checks activation ordinals, every Fresh-to-Recovered and
  Recovered-to-Recovered boundary, and exact attempt correlation in a maintained
  multi-restart cassette.
- `distinguishes competing claim reads and exact responsibilities after Stop recovery`
  checks same-boundary reads retain their different workflow purposes, the
  executor/Continue-or-Stop serialization is visible, and executor-work and
  claim-release responsibilities remain distinct.
- `shows graph observation provenance quiescence and planned actions` selects
  an established paused publication and checks its exact graph-read
  correlation, `RunPaused` passive disposition, and the downstream
  action-planning result without implying any proposal ran. When that one
  publication consumed several declared interactions, it also checks the
  visible chronology retains both the concrete Operator Pause and the later
  executor Running report instead of showing only the final raw tag.
- `retains every conflicting production proposal owner in the delivery frame`
  evaluates one exact captured publication whose production proposal owners
  collide and checks that the serializable frame retains the conflict instead
  of presenting either proposal as an action that ran.
- `projects every isolated action-planning issue through its typed maintainer meaning`
  evaluates one exact captured publication containing each of the three
  production planning-issue variants and checks that the visible evidence
  names Dalph's blocked action and the concrete missing evidence, provenance,
  or contradictory policy reason without presenting any proposal as executed.
- `shows production delivery frames before the authored cassette settles`
  holds an authored runner open, publishes exact projected frames through its
  controlled observer, and checks that the running shared workbench follows
  new frames until Follow live is turned off, then preserves the inspected
  frame until following is enabled again; `notifies the read-only delivery
  observer before returning the terminal authored result` checks the production
  cassette boundary publishes every exact revision before its terminal result.
- `explains restart continuity at the Fresh to Recovered boundary` selects the
  first Recovered frame and checks the visible restart marker plus held-position
  and obligation continuity.
- `keeps graph-not-established recovery frames compact and truthful` checks an
  empty recovery projection has no large canvas and explains that there is no
  observed task to select while recovered delivery facts remain available.
- `names concrete planned transitions and their admission requirements` checks
  Pause and accepted-result frames name the exact human action, task/attempt,
  task-work or integration-target resource requirement, and live-operation
  wait when present while retaining the raw proposal separately.
- `states when the maintained authored catalog has not exercised a populated settlement layer`
  checks zero-settlement frames identify that current catalog limitation and
  do not claim a populated tracker-reflection example.
- `keeps multi-task chronology landmarks attributable` checks task lifecycle
  landmarks include the task identity instead of rendering indistinguishable
  repeated lifecycle fragments.
- `keeps populated graphs truthful and delivery evidence usable at narrow width`
  checks the graph shadow empty state is hidden for a populated projection,
  narrow task facts retain their labels, and journal chronology is collapsed
  by default.
- `keeps every per-task meaning visible at desktop width` checks the task-state
  presentation does not hide held positions, obligations, or settlements
  behind multi-screen horizontal overflow.
- `composes simultaneous graph ticket held and delivery encodings` checks a
  task with several simultaneous facts visibly retains every legend encoding
  instead of a later fill rule erasing selected-ticket meaning.
- `keeps selected-task feedback separate from delivery encodings` checks task
  selection visibly changes the graph while preserving the frontier, desired
  ticket, held-position, and retained-standing encodings.
- The real-browser command listens for a delivery-frame event before the
  selected cassette's settled event, proves the article is still Running when
  a real frame appears, and then checks final auto-follow, rewind, disclosure
  stability, and the complete current-catalog terminal summary.
- `does not fabricate a graph workbench for direct protocol cassettes` checks
  that target-promotion and integration-finality cassettes retain only their real
  protocol evidence.
