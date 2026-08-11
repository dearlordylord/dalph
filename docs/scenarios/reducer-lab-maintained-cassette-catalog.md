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

An authored cassette's Delivery workbench is a permanent section of the one
selected cassette surface, not a disclosure. Before execution it shows the
controlled declared graph with an explicit statement that production has not
observed it. Its **Run selected cassette** or **Rerun selected cassette** action
and current cassette status live inside that workbench beside the playback
controls, because they act on the visualization the maintainer is inspecting.
Direct protocol cassettes retain the same action in their selected surface
because they intentionally have no delivery workbench. As production publishes frames, the same mounted section gains
one timeline control strip and one current-frame surface. The maintainer does
not open, close, or rediscover the primary visualization.

The compact statement **Desired tickets are not held capacity** remains visible
beside the primary playback experience. Playback controls and the graph precede
the longer provenance, production-layer chain, and graph legend, which are
collapsed under **How to read this delivery graph** until the maintainer asks
for them. The visible playback help says that **Frame** moves to an adjacent
production publication, **Jump** moves to a frontier wave, held-position change, restart, or end,
and **Live** follows the newest publication. A timeline with no established
settlement says only **Established settlements in this timeline: 0** beside the
graph; the cross-catalog explanation of direct integration-finality behavior is
secondary reading-guide material rather than the primary result.

While **Follow live** is active, new frames update that current-frame surface.
The frame controls and the top of the graph remain at stable document
positions; variable change summaries and task facts appear after the graph so
their changing height cannot push the graph away from the maintainer. Choosing
**Previous frame**, **Next frame**, or an exact frame stops auto-follow and
keeps the chosen frame until the maintainer explicitly resumes **Follow live**.
With focus in the workbench, the keyboard's Left and Right Arrow keys move one
exact frame backward or forward, while `[` and `]` move to the previous or next
delivery landmark. The visible shortcut hint names this behavior.
When a button reaches the first or last frame and becomes unavailable, focus
moves to the persistent delivery-playback control group instead of falling out
of the workbench. The maintainer can immediately press the opposite Arrow key
to move away from that endpoint without clicking the graph or another control.
The same focus handoff occurs when repeated Left or Right Arrow presses start
from any playback button and reach an endpoint. When the shortcut starts
elsewhere in the workbench, that still-available element keeps focus and the
opposite Arrow key moves away from the endpoint directly.
An enabled playback button keeps its native focus, so repeated Space or Enter
activation continues moving in the same direction before the endpoint.
Rerunning the selected cassette replaces the old timeline handler, so one key
press still moves exactly once rather than replaying handlers from prior runs.
Repeated bracket input reuses the already-derived landmark index and remains
responsive at either end of the timeline; it does not repeatedly rescan every
production frame or enqueue redundant graph renders.
The exact selector retains every production publication. **Previous delivery
landmark** and **Next delivery landmark** skip repeated publications to the
stable eligible-frontier waves, full-capacity overlaps, one-holder releases,
coordinator restarts, and terminal publication. The staggered cassette reaches
A, B+C, restart, B+C+X, C, D+X, X, E+F, F, H+I, I, G, and the empty frontier
without scanning more than 24 landmarks. The complete
per-task matrix is a secondary **All task delivery facts** disclosure; the
graph and selected-task summary remain primary.

The maintainer may drag the graph as one canvas and zoom with pinch, wheel, or trackpad
or trackpad gestures; a compact visible hint names both gestures. **Reset graph view**
reruns the deterministic graph layout and restores its fitted pan and zoom
without changing the selected cassette, delivery frame, or task correlation.
The reset remains in place but disabled when the current frame has no
established graph, rather than offering a no-op action.

Disabled controls use ordinary unavailable-control styling and a not-allowed
cursor. They do not show a wait/loading cursor merely because navigation has
reached the first or last frame; running state remains explicit in the cassette
status text.

Opening a raw journal event names its journal position, event tag, and
available task/attempt context instead of repeating an indistinguishable
**Event JSON** label. Exact task evidence names the task it belongs to. The
catalog-level boundary sentence says which controlled boundaries are available
to the runner category; it does not claim that the selected cassette exercised
every one.

Selecting another cassette replaces the one shared surface and its workbench;
selecting the original cassette again restores its retained frame and task
selection.

The Lab must not put the primary graph/frontier visualization in an accordion,
mount another workbench while frames arrive, move the graph because a change
banner grew, reset the chosen frame, or change page scroll merely because one
production frame replaced another.

### Acceptance-test mapping

- `derives delivery playback controls, landmarks, and endpoint focus from one pure state machine`
  drives the schema-backed Following-live/Inspecting-frame model through exact
  frame, landmark, live-update, and endpoint messages; checks all labels,
  availability, status, landmark reasons, and the single named focus command
  without a DOM renderer. The browser interprets that command as the one
  necessary focus-effect island.
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
- `keeps one permanent delivery workbench stable while frames and selections change`
  checks the complete ordinary selector labels, checks its Run/Rerun action is
  inside the authored workbench, runs an authored cassette, checks that
  playback and the graph precede the collapsed provenance, layer chain, legend,
  and direct-protocol caveat while the capacity distinction and exact
  Frame/Jump/Live meanings remain visible,
  proves the permanent section supports Next and Previous navigation, and
  restores the retained frame after selecting away and back.
- `shows production delivery frames before the authored cassette settles`
  pauses on a historical frame, opens its exact task facts, then proves later
  production publications and terminal settlement retain the same article,
  workbench, controls, frame DOM, chronology disclosure, and exact-facts
  disclosure.
- `browser-smoke` drives the real Orb page through more than ten live
  double-diamond publications, holds page scroll and graph position within two
  pixels, traverses the seven frontier waves, staggered held-position releases,
  and every activation boundary through at most 24 landmark
  actions, preserves the graph summary and selected task across a frame change,
  and requires unique position/tag/context labels for raw journal events. It
  also pans and zooms the graph, checks that its rendered pixels change, and
  uses **Reset graph view** to restore the deterministic fitted layout. With
  graph focus it drives Left/Right Arrow for exact frames and `[`/`]` for
  delivery landmarks, then reruns the cassette and proves one Arrow press still
  advances exactly one frame. It drives both click and Arrow navigation into
  exact-frame endpoints and
  proves focus remains on the persistent playback group so the opposite Arrow
  key moves away immediately, while an enabled intermediate button keeps focus
  for a second keyboard activation. A repeated-bracket stress check remains bounded
  and leaves the page responsive, and disabled navigation buttons expose a
  not-allowed rather than wait cursor.

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
those exact immutable publications, the current one-based Run activation
ordinal, and the authored story position
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

The frame chronology obtains its landmark wording from the typed authored
presenter used by the production cassette package. An ordinary tracker graph
return and the one activation-final complete tracker read remain distinct
landmarks; the Lab does not reinterpret raw story tags or infer a task from an
encoded attempt identity.

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
separated, including later-to-later activation restarts, and retains the
same exact planned attempt where the cassette does. The first frame of each
activation names its numbered restart boundary and summarizes which held
positions and exact obligations are unchanged, changed, disappeared, or newly
observed. For `acceptedResultRestartsIntoIntegration`, the first later frame
truthfully shows task A's executor responsibility and held position
disappearing, while its accepted-result integration obligation is newly added.
The maintainer does not have to infer restart continuity only by comparing raw
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

When a later-activation publication has not yet established a graph, the Lab
keeps the populated graph viewport dimensions and replaces its canvas contents
with an explanation that there are no observed tasks to select. Reconstructed
held positions and ticket-delivery obligations remain visible below; the Lab
does not invite the maintainer to use an empty graph summary or collapse and
expand the page while graph authority is temporarily absent.

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

The linked `authored:deliveryInvariantStory` is a scheduling and restart
chronology over the real production runtime, not the complete graph-delivery
capstone owned by issue #167. The Lab states the boundary calls that are and are
not present, so a maintainer does not infer accepted-result integration from a
later tracker lifecycle or mistake this chronology for the finished normal path.

The controlled executor reports coarse `Completed` results without accepted
commits. Later complete tracker reads report successful tasks; they prove
tracker lifecycle and release dependants, but do not prove Dalph integrated
those tasks. The cassette does not state who changed those tracker lifecycles,
so the reader must not invent an outside actor or a Dalph action. No Git
integration, verification, promotion, or completion-finality boundary is called
in this slice. A coordinator crash does not change those facts: restart
reconstructs exact executor-work responsibility, not integration responsibility.

The returned successful tracker graphs are a test seam that lets the production
frontier continue while issue #167 remains open. Issue #167 must replace that
substitution with an accepted executor result and the real integration,
verification, promotion, tracker-completion, and completion-finality calls for
every task while preserving this graph and restart chronology.

The focused slice's initial tracker graph is
`A -> {B, C} -> D -> {E -> H, F -> I} -> G`, and capacity is two. Production
first exposes only A in the frontier. A later complete tracker read proves A
successful and exposes B and C together. Both acquire exact task-work positions
before the coordinator process dies.

While that coordinator process is dead, Alice adds tracker task X with A as its
prerequisite and makes X another prerequisite of G. Alice changes the tracker;
she does not add directly to Dalph's derived frontier. Because this edit happens
outside Dalph, there is no Dalph boundary call or journal event to author for
the edit itself; the cassette's next complete tracker-read return is the first
fact Dalph can observe and present. The Journal still
contains the exact unfinished B and C executor-work responsibilities and no
terminal or safe-suspension report for either attempt. No Git, integration, or
cleanup boundary participates in this slice because none of these executor
results is accepted for integration.

The next Run establishment reads the retained Journal, reconstructs the same B
and C planned attempts, and recreates two anonymous process-local task-work
positions from those unfinished responsibilities. It does not restore a slot
identity, process-local owner, fiber, or old position map. The next ordinary
complete tracker read observes X and the changed G prerequisites. X becomes
graph-eligible, but B and C occupy both positions, so no X executor work begins
and no X attempt is planned yet.

The executor then reports B Terminal while C remains Running. B's report leaves
one position unheld but does not itself permit another frontier task to start or
prove B complete; the graph keeps B
open and the Lab separately shows C as the remaining holder. C then reports
Terminal in a later production publication. Only after no current executable
responsibility remains does an ordinary complete tracker read report B and C
`CompletedSuccessfully`. That observation exposes D and the already-observed X,
and those two tasks begin together. No terminal executor report is used as a
substitute for this tracker observation.

D and X report Terminal in separate production publications, so the Lab first
shows both positions held, then X as the remaining holder, then neither held.
The later complete tracker read proves both successful and exposes E and F.
Those tasks begin together; E reports Terminal first while F remains visibly
held, then F reports Terminal. The later successful tracker observation exposes
H and I, which likewise begin together and release their positions in separate
publications. G remains blocked until a later tracker observation proves H, I,
and X successful. G then begins and reports through the same ordinary executor
protocol. A final complete tracker read produces an empty eligible frontier.

The Lab shows this rolling consumption on the production-observed graph rather
than making each pair look like one atomic batch. A represented task uses
composable node styling for graph eligibility, desired placement, retained
  responsibility, and held position. If a closed task remains in the complete
  tracker graph, its terminal lifecycle and retained responsibility remain
  composable facts on that real node. If the complete graph omits the task, or
  the later activation has not yet established a graph, the Lab must not invent
  a tracker node. It keeps the graph dimensions stable and shows that exact
  responsibility in a mismatch rail beside an anonymous capacity-position
  summary. For a held position the rail names the exact task, Run, attempt,
  graph placement, obligation, and capacity occupancy; without a holder it says
  explicitly that the responsibility does not occupy capacity.

Retrying the cassette starts fresh controlled boundary state and repeats the
same chronology. Within one run, restart must not plan replacement B or C
attempts, admit X before a position is available, infer task success from an
executor Terminal report, discard a responsibility because Alice closed or
removed its tracker task, or draw an absent responsibility as if it were a
current tracker node.

The separate `authored:deliveryFinalitySpine` crosses the ordinary production
completion-finality boundary for A while leaving B open. After A's promotion,
the controlled tracker returns
the exact active claim, applies the exact replacement, later publishes a
complete successful graph, returns the exact completion claim, and applies its
deletion. Dalph itself records `IntegrationFinalitySettled`; the next
production delivery publication contains the task-scoped settlement and its
descriptive tracker reflection. The Lab does not call the direct protocol
runner, append a settlement, or infer one from executor completion. Tracker
lifecycle remains outside authority and exact Dalph settlements are counted
separately. Later graph answers report C through G successful, but this cassette
contains no executor or integration chronology for those tasks and does not
invent who changed them.

The Lab must not project a frontier from declared input, fabricate a privately
branded journaled graph observation, infer missing topology from durable task
membership, call a selected bounded ticket an admitted or held position,
equate executor completion with tracker completion or delivery settlement,
combine publications from distinct Run activations into one activation, or restore the
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
  typed production presenter rather than the Lab's generic tag formatter. It
  also checks the production-authored activation-final tracker-read landmark
  remains distinct from an ordinary tracker graph return.
- `explains the tracker's classification of an ambiguous completion request` checks
  the production-authored presenter explains the exact request-result lookup
  and outcome without exposing only its raw story tag.
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
  checks activation ordinals, every initial-to-later and later-to-later
  activation boundary, and exact attempt correlation in a maintained
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
- `explains restart continuity at the first later activation boundary` selects the
  first frame of activation 2 and checks the visible restart marker plus task A's
  changed accepted-result obligation and disappeared held position.
- `keeps graph-not-established frames dimensionally stable and truthful`
  checks an empty later-activation projection retains the populated graph
  viewport height and explains that there is no observed task to select while
  journal-recovered delivery facts remain available.
- `names concrete planned transitions and their admission requirements` checks
  Pause and accepted-result frames name the exact human action, task/attempt,
  task-work or integration-target resource requirement, and live-operation
  wait when present while retaining the raw proposal separately.
- `settles a promoted authored task through the real completion-claim boundary`
  checks the exact accepted result, promotion, replacement
  intent/attempt/outcome, later fresh
  successful tracker observation, deletion intent/attempt/outcome, and
  `IntegrationFinalitySettled` order, plus a non-empty production settlement
  and tracker-reflection frame. It also proves the cassette does not fabricate
  whole-Run termination.
- `consumes a staggered graph while reconstructed positions delay restart-added X`
  runs `authored:deliveryInvariantStory` through the public authored runner and
  checks the exact prerequisite edges, B/C reconstructed positions, X's later
  tracker observation, and the staggered B+C → C → D+X → X → E+F → F → H+I → I
  → G position chronology. It requires a later successful tracker observation
  before each deeper admission and real executor responsibility plus terminal
  evidence for every task.
- `preserves the double-diamond middle positions across coordinator restart`
  checks B and C hold exact task-work positions before process loss, the first
  later-activation publications retain the same Run and attempt correlations,
  and X receives neither an attempt nor a position until a later publication
  has observed it and both reconstructed holders have reported Terminal.
- `shows represented and off-graph responsibilities without inventing tracker nodes`
  drives established and graph-not-established frames through the Lab
  presentation. It checks the mismatch rail names each exact held Run/attempt,
  `GraphNotEstablished` placement, obligation, and occupancy without creating a
  topology node. `composes simultaneous graph ticket held and delivery encodings`
  separately checks represented responsibility styling composes on a real node.
- `shows an absent responsibility in the mismatch rail without inventing a graph node`
  renders an established-graph presentation fixture from an exact maintained
  held-responsibility frame and checks `AbsentFromCurrentGraph` stays in the rail.
  The production ticket-delivery projection test
  `retains an exact attempt across outside-bound, closed, and absent graph placements`
  proves that exact placement is produced when a complete tracker graph omits
  the task; the presentation test does not replace that production proof.
- `counts one delivery settlement once across repeated production publications`
  checks repeated publications carrying A's exact settlement report one
  distinct settlement and separately report their publication count. It also
  checks the workbench explains that tracker `CompletedSuccessfully` lifecycle
  values do not prove Dalph executed or settled those tasks.
- `keeps every delivery-story beat linked to maintained evidence or an explicit implementation gap`
  checks the document's 22 stable beat IDs, exact catalog keys, explicit gap
  reasons, and generated manifest block in both directions.
- `shows the staggered double-diamond frontier being consumed on one graph`
  checks the same returned frames through the Lab presentation model, including
  the initial and post-crash topology, X's fresh appearance, every rolling
  frontier/held overlap, reconstructed B/C responsibilities, anonymous capacity
  positions, and the off-graph responsibility rail.
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
  stability, and the complete current-catalog terminal summary. Its
  `drives the staggered double-diamond frontier through every production wave, held-position release, and restart`
  checkpoint additionally observes the graph while the linked cassette is
  still Running, traverses its exact prerequisite edges and rolling parallel
  states, checks X appears only after the later tracker observation, and checks
  the B/C attempt correlations and anonymous occupied positions on both sides
  of restart through the actual served application. At phone width it also
  proves the exact restart correlations wrap without widening the document.
  Before execution it also checks the visible explanation says the chronology
  contains coarse executor completion and later tracker-success observations,
  but no accepted-result integration, and names issue #167 as the owner of
  replacing that test seam.
- `does not fabricate a graph workbench for direct protocol cassettes` checks
  that target-promotion and integration-finality cassettes retain only their real
  protocol evidence.

## A maintainer reads the journal-derived integration order beside task-work capacity

### Starting situation and trigger

A Dalph maintainer selects the maintained authored cassette whose executor
returns an accepted Git commit and whose production runner carries that result
across coordinator process loss. The exact executor report is already durable
before Dalph records an integration responsibility for the configured
repository/ref target. In later frames the same responsibility crosses the
durable integration-start cutoff. Another production FIFO test supplies two
same-target responsibilities so their relative order is not inferred from a
single-item example.

The maintainer runs the cassette and inspects delivery publications beside the
task-work capacity strip. No person asks Git or the tracker to change anything
merely by opening this view. The Lab receives the same immutable production
publication it already uses for graph, ticket, responsibility, and settlement
evidence.

### Projection and visible result

For each frame, the Lab projects every exact queued or started integration
responsibility while its production value remains typed. It groups entries by
exact repository/ref target and orders each group by the responsibility's
journal position. Each entry names its target-relative position, task, Run,
attempt, accepted commit, durable queued position, and whether it is still
queued before the cutoff or has started past the cutoff. An accepted result
whose durable integration responsibility has not yet been recorded is shown
separately as awaiting order and receives no invented queue position.

This **integration order** is the maintainer-facing merge-queue view. It is a
pure projection, not a second queue authority: Dalph writes no queue row,
ordinal, timestamp, or completed-ID set. The process-local integration-target
position is also not reconstructed from this order. A started responsibility
therefore does not claim that the current process holds the target resource;
the existing action-planning evidence remains the place to inspect acquire,
use-held, and release requirements.

When no accepted result or integration responsibility exists, the compact
empty state says so instead of presenting task-work capacity as if it were the
whole delivery pipeline. When the coordinator dies and the cassette is rerun,
the journal-derived order remains the same; the browser performs no external
mutation and has no ambiguous response to retry.

The Lab must not sort by graph order, task ID, DOM arrival, or a fabricated
queue ordinal; put an accepted-but-not-journaled result into the ordered list;
equate integration order with task-work capacity; or display a started item as
proof of current process-local target ownership.

### Acceptance-test mapping

- Existing production test `preserves same-target order while a blocker wait
  leaves another target usable` proves that the journal-derived admission
  order prevents same-target leapfrogging while another target may proceed.
- `projects exact integration order from typed delivery obligations` checks
  queued, started, and accepted-awaiting-responsibility frame evidence without
  reparsing diagnostic JSON or inventing an ordinal.
- `shows integration order separately from task-work capacity` renders the
  maintained cassette's accepted-but-not-ordered, queued, and started frames,
  proves their journal positions and exact correlations, and keeps the
  process-local ownership disclaimer visible. The production FIFO test above
  owns the multiple-same-target ordering claim.
- The real-browser checkpoint `shows the accepted result enter and start its
  journal-derived integration order` drives the maintained accepted-result
  cassette through the served application and checks the waiting, queued, and
  started visible states.

## A maintainer inspects continuation authorization in the selected recovery cassette

### Starting situation and trigger

A Dalph maintainer opens Reducer Lab at one source revision and selects the
maintained authored cassette `authored:coordinatorProcessDeathContinues`, the
recovery story delivered by issue #171. Its production runner is the ordinary
`runAuthoredScenarioCassette`; the returned `CassetteLabResult` contains the
fresh in-memory workflow-journal records for that run. No GitHub issue, Git
repository, executor process, or durable journal outside the cassette run is
changed.

The maintainer chooses **Run selected cassette** and, after the production
runner settles, opens the selected result's continuation-authorization
evidence. This is a read-only inspection of facts already returned by the
production runner. The Lab does not define another cassette, reducer, or
causal validation rule.

### Ordered production and Lab behavior

The production runner first records one executor-work responsibility for task
A's exact planned attempt. The typed cassette lifecycle control disposes the
first coordinator activation; it is a harness control and is not a workflow
journal event. The next production activation keeps the same Run and attempt,
records fresh tracker observations for the active-task graph, task-work
specification, and exact claim, and records a fresh Git observation for the
exact planned worktree. It then records one generic
`PlannedAttemptContinuationAuthorized` fact naming those four observation
operation identities before the executor command. The existing executor
protocol later records a `Running` or `Terminal` report for the same exact
`(RunId, AttemptId)`; the maintained recovery cassette reaches its Terminal
report.

The Lab decodes the returned production `journalRecords` and presents three
durable prefixes for this cassette: the records through the fresh authority
observations before authorization, the authorization fact before an executor
report, and the later `Running` or `Terminal` report. It shows each graph,
specification, claim, and worktree operation identity with its intent and
observation positions, the authorization position, and the structured Run/attempt
pair. It also inspects every typed planned-attempt, responsibility,
authorization, and report fact for the selected Run, so a replacement attempt or
additional responsibility cannot be hidden by selecting the first one. The
selected result labels the executor boundary as `ExecutorReportObserved` only
because the typed report is present; a command-intent record alone is shown as
`CommandIntentRecorded`, not physical executor contact.

### Invalid witness fixtures and executor boundary

The Lab makes in-memory missing, stale, later, and wrong-attempt witness
fixtures from the returned records, each ending at the last pre-authorization
observation and containing no authorization, command-intent, or report fact.
For each fixture it calls the exported
production `evaluatePlannedAttemptContinuationAuthorization` through the Lab
contact-decision adapter. A rejected pre-contact evaluation is shown as executor
contact unavailable with `NoCommandIntent`; the adapter performs no executor
call. If a fixture contains only the durable command intent, the Lab labels it
`CommandIntentRecorded`, which is still not physical executor contact. Only a
typed `Running` or `Terminal` report produces `ExecutorReportObserved`. The Lab
does not copy the production chronology or identity validation into a second
reducer.

### Crash, retry, and visible result

The browser has no persistence, so browser loss discards this local evidence
and cannot ambiguously change an outside system. Rerunning the selected
cassette invokes the same #171 production runner with fresh controlled runtime
state and a fresh Run identity; the projection is derived again from that
returned journal. There is no outside retry, cleanup, or process qualification
to perform because every boundary is a controlled cassette adapter.

The maintainer sees the exact durable prefixes, the four witness operation
identities, the authorization, and the later report under the selected result.
The Lab must not treat the lifecycle control as a recovery event, allocate a
replacement attempt, invent a separate executor invocation identity, or allow
missing, stale, later, or wrong-attempt evidence to advance to executor
contact.

### Acceptance-test mapping

- `projects maintained continuation prefixes and fails invalid witnesses closed`
  runs the exact maintained #171 catalog entry through
  `runAuthoredScenarioCassette`, projects the pre-authorization,
  post-authorization-before-report, and terminal prefixes, and sends missing,
  stale, later, and wrong-attempt pre-authorization fixtures through the shared
  production evaluator. Every invalid fixture has no command/report contact
  evidence, remains executor-contact unavailable, and is marked
  `NoCommandIntent`; an intent-only control fixture is marked
  `CommandIntentRecorded` without claiming physical contact.
- `shows continuation authorization prefixes and retained Run/attempt identity`
  mounts the selected Lab result and checks that the three durable prefixes,
  four witness operation identities, one generic authorization, and every
  structured planned-attempt/responsibility/authorization/report correlation
  are visible; its typed replacement-attempt fixture checks that a second
  responsibility, authorization, and report cannot be hidden by selecting the
  first attempt, while the restart fixture checks task A's old responsibility
  and held position are `Disappeared` and accepted integration is `Added`.
- The same two tests check that the responsibility, authorization, and
  `Running`/`Terminal` report use one exact `(RunId, AttemptId)` and introduce
  no recovery-named event or replacement attempt.
