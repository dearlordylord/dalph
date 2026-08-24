# Issue #83 — control, disposition, and cleanup at an exact cursor

This scenario file is the implementation record for [GitHub issue #83](https://github.com/openai/dalph/issues/83). The person affected is Alice, who is inspecting a committed Run. The production systems in scope are the read-only `TraceReader`, the committed workflow journal, the occurrence projector, and the immutable console/Reducer Lab result. Git, the tracker, executor, Integrator, control, and cleanup boundaries are not called by this read path.

## Scenario 1: Alice reads applied controls at one committed cursor

Starting facts: one Run has a valid journal beginning and an applied Run or task `Pause`/`Unpause`, or an applied `ContinueExistingAttempt`, `RestartTaskImplementation`, or `StopTaskImplementation`. Each event carries the durable operator class, and choices carry their request identity and exact planned-attempt subject. Later records may exist after Alice's selected `JournalPosition`.

Trigger and boundary calls: Alice supplies the exact `(RunId, JournalPosition)` to `TraceReader.readAt`. The reader reads the committed journal source, validates the prefix and causal identities, projects the closed occurrence union, and folds one versioned facet. No provider or mutation boundary is called.

Visible result: `TraceControlDispositionFacet.controls` contains one tagged `Direction` or `AttemptChoice` fact per applied occurrence. Its `source`, subject, typed actor class, ordinal, choice, and durable request identity are preserved. A Run direction and task direction remain distinct subjects, and each choice remains distinct. The result is immutable and has no control capability.

Forbidden result: the reader must not show a requested-but-unapplied command, invent a person or reason, collapse controls into one status, reinterpret Run pause as application Exit/drain, or include a source after Alice's cursor.

Acceptance tests:

- `projects Run and task control directions at the exact committed cursor`;
- `projects Continue Restart and Stop without inventing operator metadata`;
- `reopens the same control view through memory and SQLite`; and
- `does not leak later control history into an earlier cursor`.

## Scenario 2: Alice distinguishes dispositions and cleanup progress

Starting facts: the selected valid prefix may contain an implementation abandonment after Stop, a preserved stopped-attempt claim, Run cancellation, integration quarantine, non-convergent promotion, a Full-rerun predecessor preservation, or a cleanup authorization. Cleanup is one of the distinct worktree, branch, or Integrator predecessor-candidate families. A family can have an observation-intent, present/absent/foreign/unreadable observation, contradiction, mutation intent/result, or settled event.

Trigger and boundary calls: Alice selects the cursor and `TraceReader` derives facts only from the validated prefix's projected occurrences. The reader does not ask Git or a provider for current state and does not append a cleanup or disposition event. A process restart or a read retry replays the same committed prefix.

Visible result: `TraceControlDispositionFacet.dispositions` keeps abandonment, cancellation, claim preservation, quarantine, non-convergence, candidate preservation, and worktree-loss preservation tagged separately. `cleanup` keeps all three cleanup families separate, retains the immutable authorization and every exact source cursor, and exposes the last typed progress status (`ObservationPending`, `Contradicted`, `Absent`, `MutationPending`, recorded mutation result, or `Settled`).

Forbidden result: the facet must not merge outcomes into `failed`, `draining`, or `cleaned`; treat quarantine as deletion authority; infer a current provider state; hide a preserved resource; or expose cleanup/provider capability.

Acceptance tests:

- `keeps abandonment cancellation quarantine preservation and cleanup distinct`;
- `shows each cleanup family's exact progress and source identity`;
- `shows a gap rather than guessing an outcome after a committed intent`; and
- `reopens disposition and cleanup views through memory and SQLite`.

## Scenario 3: malformed history fails closed and remains Run-scoped

Starting facts: one requested prefix contains a foreign nested Run, missing or non-earlier cleanup/disposition provenance, mismatched cleanup subject, or malformed causal source. A separate Run has an independent valid prefix.

Trigger and boundary calls: Alice asks for the damaged exact cursor. `TraceReader` validates nested Run bindings and cleanup provenance/history before projecting the prefix. The independent Run is read through its own journal source. Neither path obtains mutation or provider capabilities.

Visible result: the damaged Run returns the typed `TraceProjectionInvalid` (or the typed prefix/cursor error at the relevant boundary) with no partial facet. The independent Run remains readable. Repeating the failed read does not append, repair, contact a provider, or broaden the failure to the other Run. Console and Reducer Lab receive the same versioned `TraceAtCursor`/`TraceHistoricalFacets` value and only render it.

Forbidden result: malformed history must not be silently dropped, repaired, guessed, or converted into a partial cleanup/disposition state. Presentation must not expose journal append/lifecycle, operator-control, tracker, Git, executor, Integrator, or cleanup services.

Acceptance tests:

- `fails the exact malformed control or disposition prefix without a partial facet`;
- `keeps an independent Run readable after scoped trace corruption`;
- `the production trace composition exposes no control or cleanup capability`; and
- `console and Reducer Lab consume the same versioned control-disposition schema`.

## Scenario-to-test mapping

| Scenario | Focused evidence |
| --- | --- |
| 1 — exact applied controls | `trace-reader.control-disposition.test.ts` control directions/choices test; earlier-cursor isolation test; memory/SQLite reopen test |
| 2 — distinct dispositions and cleanup | `trace-reader.control-disposition.test.ts` `keeps abandonment and authorized worktree cleanup distinct with exact source identities`, `keeps branch cleanup separate and requires its settled worktree predecessor`, `projects Integrator candidate cleanup progress at each committed intent/result cursor` (including the mutation-intent gap and exact step/status sources), `preserves a contradictory worktree cleanup with its exact source identity`, and `reopens the exact candidate disposition and cleanup facet through memory and SQLite` |
| 3 — fail closed and passive consumers | `trace-reader.control-disposition.test.ts` malformed scoped-prefix and independent-Run test; `workflow-trace.production.test.ts` schema/capability assertion; `cassette-lab.smoke.ts` shared-schema visibility assertion |
