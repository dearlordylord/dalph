# Issue 167: complete controlled-provider delivery through maintained cassettes

> **Architecture correction, 2026-08-14:** This file truthfully records the
> currently implemented controlled-provider journey, but its separate
> candidate-agent and target-verification stages are no longer intended product
> behavior. It is regression evidence, not authority for the replacement
> Integrator design.

## A five-task dependency diamond completes only from tracker-confirmed success

No person triggers individual steps. A maintainer has started one Dalph Run
against controlled provider-neutral tracker, Git, executor, verification, and
journal boundaries. The complete tracker graph contains A; B, C, and E blocked
by A; and D blocked by B, C, and E. No task has a claim, planned attempt, or
worktree. Capacity is two and the in-memory workflow journal is empty. Git
repository `/dalph/cassettes/five-task-diamond.git` has target ref
`refs/heads/master` at Base SHA `2222222222222222222222222222222222222222`;
there is no candidate, verification evidence, or promotion intent yet.

Dalph reads the complete graph, claims A, records A's immutable attempt, creates
its exact worktree, and asks the controlled executor to work. The executor
returns `Terminal(Accepted(commit))`. Dalph records the accepted-result
responsibility, constructs the exact two-parent candidate, runs the configured
verification, promotes by exact expected-head comparison, replaces A's active
claim with its promotion-correlated completion claim, and asks the controlled
tracker to complete A. Neither the executor response, promotion, nor tracker
mutation response proves success. A later focused tracker read reports A
successfully complete with the exact completion claim; Dalph deletes only that
claim and records settlement. Only a later complete graph read releases B, C,
and E. Dalph repeats the same production protocol for them within capacity.
D starts only after a complete graph read reports B, C, and E successfully
complete. A final complete graph read reports all five tasks complete and the
Run terminates only after every exact responsibility settles.

The controlled boundaries return definite results, so a lost response, crash,
or retry is not invented in this happy chronology. Those outcomes remain in
the maintained unhappy and recovery cassettes owned by their accepted tickets.
The maintainer sees one chronological successful Run. Dalph must not use an
executor, integration, verification, promotion, or mutation response as task
success; start D early; exceed capacity two; inject reducer state or a second
scheduler; or terminate with a retained responsibility.

Acceptance seam: `runs the five-task controlled-provider diamond through exact
accepted-result finality` through `runAuthoredScenarioCassette`.

## The maintained ten-task story preserves its restart and gains full finality

No person triggers the restart. The maintained
`authored:deliveryInvariantStory` Run has observed A through I, with X added by
a later tracker revision. Capacity is two. A has settled through the complete
accepted-result protocol. B and C hold exact task-work positions when the
coordinator process dies. The workflow journal, controlled tracker claims, and
controlled Git worktrees survive; process-local coordinator and executor state
does not.

The integration target is repository `/dalph/cassettes/double-diamond.git`,
ref `refs/heads/master`, initially at Base SHA
`2222222222222222222222222222222222222222`. Before A's accepted result there
is no candidate or verification evidence. The journal begins empty; by the
declared process death it contains the exact B and C plans, responsibilities,
and Running reports used for reconstruction.

The next activation reconstructs the same Run, B and C attempts, claims, and
worktrees from the journal and current controlled authorities before allowing
X to use capacity. B and C return accepted commits. Their exact integration
responsibilities run in journal order through candidate construction,
verification, promotion, tracker completion, focused success confirmation,
completion-claim deletion, and settlement. Later complete graph observations
release D and X, then E and F, then H and I, then G. Every executor returns an
accepted commit and every task crosses the same finality boundary before the
next dependency wave. The final complete graph read reports all ten tasks
successfully complete and the Run terminates with no held or retained work.

The process death itself is not a workflow occurrence and is not journaled.
Recovery allocates no replacement attempt. The maintainer sees the same Run
and attempts continue. Dalph must not trust volatile state, start X before the
reconstructed positions release it, use coarse `Completed` executor results,
release a dependant from focused success alone, or terminate early.

Acceptance seams:

- `consumes a staggered graph while reconstructed positions delay restart-added X`
- `preserves the double-diamond middle positions across coordinator restart`

## The maintained A-to-B story releases B only after A settles

No person triggers the individual steps. A maintainer starts one Run with
capacity one. The controlled tracker reports A open and B open but blocked by
A; neither task has a claim, attempt, or worktree, and the workflow journal is
empty. Git repository `/dalph/cassettes/pipeline.git` has `refs/heads/master`
at Base SHA `2222222222222222222222222222222222222222`, with no candidate or
verification evidence. Dalph claims, plans, and
starts A. A's executor returns an accepted commit. Dalph constructs and
validates the exact candidate, verifies it, promotes it, replaces A's active
claim with a completion claim, asks the tracker to complete A, confirms A's
success with a focused read, deletes the exact completion claim, and records
A's settlement.

B remains blocked throughout those boundary calls. Only a later complete graph
reports A successfully complete and makes B eligible. Dalph then repeats the
same accepted-result protocol for B. A later complete graph reports both tasks
successfully complete, and only then may the Run terminate. Dalph must not treat
either executor report, promotion response, or completion-mutation response as
task success, and must not start B before A's settlement and later complete
graph.

This chronology has definite controlled responses and no process death, so
crash recovery and ambiguous retry do not apply. Separate maintained cassettes
begin with those lost-response or process-death cuts.

Acceptance seam: `releases B only after A's accepted-result finality in one Run`.

## The maintained catalog is production acceptance evidence

A maintainer runs the package acceptance suite. Every entry in
`maintainedAuthoredCassetteCatalog` begins from its own declared controlled
tracker, claim, Git, executor, journal, and control facts. The package suite
passes each exact catalog value to `runAuthoredScenarioCassette`; that public
runner decodes the story and runs the ordinary production coordinator and
workflow interpreter with controlled boundary implementations. Entries run
independently and retain their exact key on failure.

This test makes no GitHub, filesystem Git, SQLite, operating-system, browser,
or real-process call because provider-specific qualification is outside this
milestone. A cassette's declared crash or ambiguous response drives its
ordinary accepted recovery protocol; a cassette without such an event does
not gain one. The maintainer sees a failure tied to the exact catalog key.
Dalph must not count rendering, schema decoding, Reducer Lab smoke, a copied
registry, or aggregate test totals as execution of an entry.

Acceptance seam: the generated per-key pattern `runs maintained authored
cassette <catalog-key> through the composed production coordinator`.

## Scenario-to-test mapping

| Scenario | Concrete result | Acceptance test |
|---|---|---|
| Five-task diamond | D starts only after B, C, and E have tracker-confirmed success; all five accepted results settle | `runs the five-task controlled-provider diamond through exact accepted-result finality` |
| Ten-task restart story | Same B/C attempts survive restart and all ten tasks use accepted-result finality | `consumes a staggered graph while reconstructed positions delay restart-added X`; `preserves the double-diamond middle positions across coordinator restart` |
| A-to-B maintained story | B starts only after A's accepted result reaches completion finality and a later complete graph releases it | `releases B only after A's accepted-result finality in one Run` |
| Maintained catalog | Every shared registry entry executes through the public production runner | generated `runs maintained authored cassette <catalog-key> through the composed production coordinator` tests, plus the three stronger capstone tests above |

## Included unhappy and recovery evidence

The package law generates one named production-runner test per exact catalog
key except the three capstone entries, whose stronger named tests above run the
same public coordinator and assert exact dependency/finality chronology. A
failure therefore retains either its catalog key or its capstone name. The
accepted scenario documents indexed by `docs/scenarios/README.md` remain
authoritative; #167 neither copies nor weakens them.

| Accepted behavior owners | Maintained keys | Supporting focused/model evidence |
|---|---|---|
| #53–#61 integration candidate, verification, promotion, and finality | `candidate*`, `targetPromotion*`, `deliveryFinalitySpine`, `ambiguousCompletionResponse`, `completionGraphRefreshRecovery`, `completionTaskConflict` | candidate, verification, promotion, and finality protocol tests; accepted-result integration MBT/model |
| #63, #134, #135 Pause and Unpause | `runPause*`, `runUnpause*`, `taskPause*`, `taskUnpause*`, `staleTaskPauseRejected`, `unreadableTaskUnpauseRejected` | public Pause-observation acceptance/property tests and planned-executor model/MBT |
| #65–#67 changed-attempt choices and replacement | `changedAttempt*`, `changedAgainAttemptRequiresNewChoice`, `postIntegrationAttemptChoiceRejected` | attempt-choice/restart protocol tests and task-fact reconciliation model/MBT |
| #131, #136–#141 authority change, capacity, restart, and cleanup | `compatibleTargetAdvanceContinues`, `incompatibleTargetRewriteSafelySuspends`, `contractedCapacityRetainsTwoAttempts`, `coordinatorProcessDeathContinues`, `lostPlannedWorktreeSafelySuspends` | recovery/history, delivery-runtime admission, and controlled-authority focused tests |
| #156, #158, #161, #164–#166 maintained journal and cassette laws | every catalog key plus `singletonTaskCompletes` | recorded projection/fold/renaming tests, journal-history tests, and the per-key production-runner law |
