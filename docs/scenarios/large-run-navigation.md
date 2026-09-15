# Navigate a large observed Run without losing identity

Issue: [Harden large-run navigation and legibility](https://github.com/dearlordylord/dalph/issues/85)

Status: accepted by the owner on 2026-08-24 for the reliable-code and
working-MVP frontier.

This is presentation-only behavior. It reads the schema-versioned
`TraceAtCursor` envelope already produced by `TraceReader`; it does not change
Dalph workflow decisions, journal facts, provider calls, retry budgets, or a
Quint model.

## Alice navigates a bounded large observed history

### Starting situation

Alice opens Reducer Lab on one maintained production-backed Run. Its selected
cursor contains 105 tracker-owned tasks and at least 120 projected workflow
occurrences. The trace preserves exact task-graph prerequisite and grouping
edges, workflow-causal operation edges, outside-authority acknowledgements,
and process-local resource-serialization relationships. Several consecutive
executor-work reports share one occurrence family but retain distinct
`(RunId, JournalPosition)` identities and exact occurrence payloads.

The Run is already committed. No tracker, Git, executor, Integrator, journal
append, or cleanup boundary is available to this presentation.

### Trigger and chronological behavior

1. Alice selects the large Run and an exact production cursor. Reducer Lab
   renders the task graph and history directly from that `TraceAtCursor`.
   The graph offers zoom, pan, fit, task focus, and a non-canvas summary.
2. Alice pans and zooms the graph, selects a task in either the canvas or the
   summary, and chooses one exact history occurrence. The graph, history,
   relationship list, and inspector all identify the same selected task or
   occurrence. Focusing a task fits its node without changing the selected
   journal cursor. Reset/fit restores a readable whole-graph view.
3. Alice moves Back or Forward to another production cursor. If the selected
   occurrence is not present in that earlier prefix, Reducer Lab clears the
   occurrence selection explicitly. It never silently transfers selection to
   an array index or a similarly tagged later occurrence. A task selection is
   retained only while the selected cursor's graph still contains that exact
   tracker task id.
4. Alice enables “Fold repeated occurrences.” Reducer Lab replaces each
   consecutive non-action presentation group with one summary row that states
   its count and first/last journal positions. Expanding the group reveals every exact
   original row and payload. Disabling folding restores the same identities in
   the same order. Initiated actions always remain exact because an
   unprojected outside-authority observation may separate their boundary
   calls. Actor attribution remains the occurrence's truthful classification.
5. Alice follows causal predecessors and inspects all four relationship
   families. Each link resolves by exact operation or trace identity. Missing
   endpoints remain explicit rather than being invented from capture order.

There is no crash recovery or retry in this scenario because the Lab holds no
workflow authority and performs no external mutation. Reloading simply reads
the committed history again. Passive current status remains separate from the
selected historical cursor as accepted in #84.

### Visible result and forbidden result

Alice can move around the large graph without losing the selected cursor,
focus a task or occurrence, fold noisy repeated observations reversibly, and read
distinct visual/textual meanings for all relationship families. Interaction
remains bounded and responsive for the accepted 105-task/120-occurrence
fixture.

Reducer Lab must not unfold hypothetical policy, infer future work, mutate a
provider, renumber a journal position, merge distinct identities, fold an
initiated action, preserve a selection that is
absent from the chosen cursor, turn task selection into workflow authority, or
represent all relationship families with one ambiguous edge meaning.

### Acceptance-test mapping

- `renders and navigates a bounded 105-task 120-occurrence production trace`
  proves the exact large envelope, all four relationship families, bounded DOM
  output, cursor movement, and explicit stale-selection clearing.
- `focuses and fits the selected task without moving the journal cursor`
  proves pan, zoom, fit, task focus, synchronized graph/history/inspector state,
  and stable cursor identity through interaction.
- `folds repeated observed reports without losing occurrence identity` proves
  reversible folding, first/last position summaries, exact expansion order,
  and the rule that initiated actions remain exact.
- `renders truthful actors, opaque internals, and distinct repeated promotion
  identities` proves from a maintained production promotion trace that each
  promotion boundary call stays exact while the protocol rereads Git between
  calls.
- `pnpm check:lab:browser` exercises the same controls in Chromium. If the host
  cannot install Chromium's shared libraries, the handoff records the exact
  command and missing library after attempting the setup in
  `docs/DEVELOPMENT.md`.
