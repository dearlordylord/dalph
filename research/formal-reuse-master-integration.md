# Formal reuse integration into master

The maintainer requested integration of #359–#362 and prevention of Apalache
writing generated output into the observed checkout. The merged implementation
candidate is `b9c4cb26972f46fd94f3202eb17a547396eabee2`, based on master
`73035b965d97723c2cae91efeede43e3375412b9`.

The merge preserves master's explicit coordinator-return declarations,
artifact-first preflight, ARM hosted formal runner, and subsequent qualification
artifact changes. The earlier `49dc0dad` timing measurements in
[the original qualification report](formal-reuse-qualification-362.md) remain
historical measurements of that source, not measurements of this merge.

Apalache now receives the exact original run/helper output directory before its
`server` command. Evidence validation reconstructs and checks that destination.
The [output scenario and acceptance mapping](../docs/scenarios/formal-reuse-owned-server-output.md)
cover fresh output under native observation, refusal when the output argument
is removed, rejection of missing or foreign destinations, and exact lost-watch
diagnostics. These controls are mandatory preflight tests. The original failing
run `306cc2fc-3871-4a7d-9647-d4691927a847` remains retained; its successful formal
commands did not qualify its failed candidate observation.

Focused verification passed 44 merged chronology/contract tests, 12 formal
wrapper integration cases, 148 gate-resume controls, and finally 97 formal
controls. The output fixtures reproduce and clear the enclosing gate's
candidate-history and formatter contracts before observing their own disposable
repositories. Independent spec and standards reviews found no remaining issue
in output routing. The diagnostic addition preserves the same fail-closed
observer behavior and tests the exact path of a deleted watched input.

Shared Git configuration was replaced by concurrent work during subsequent
qualification. The observer correctly refused; an interrupted run also lacked
final observation and could not be resumed. Qualification therefore moved to
an independent clone at
`.scratch/formal-reuse-merge-isolated`, retaining the exact candidate commit.
No observer exclusion or success requirement was weakened.

`pnpm check:all --candidate=73035b965d97723c2cae91efeede43e3375412b9`
passed in **1,646.818 seconds**, run
`fb93b650-02e0-488f-ace0-72928d0c33f4`. It executed the complete 105-command formal
profile freshly inside candidate observation, then passed all twenty chronology
repetitions, Lab, catalog, and coverage. Coverage passed 4,039 tests in 375 files;
42 tests/four files retained their configured skips. Statements were 97.04%,
branches 95.59%, functions 96.44%, and lines 97.63%. The changed-line classifier
had no changed production or maintained-evaluation lines against this master
base. Successful output was 464/550 lines.

The production evidence reader confirms all 19 required stages, stopped custody,
complete formal proof, and ready/drained/unchanged candidate and formal
observations. The owned server stopped with its process group absent; its command
records the exact helper-owned output path, and the checkout has no
`_apalache-out`. The subsequent ordinary `pnpm check:quint` passed in 6.222 seconds,
reusing formal attempt `2f433147-56e7-4640-9140-f94ac37cc58a` with zero new checkers
or servers. This is a final integration check, not a new ten-sample benchmark.

Logs, command results, and the production-reader audit are retained under
`.scratch/formal-reuse-merge-master/` in the integration worktree, including
`check-all-isolated.log`, `check-all-isolated-result.json`,
`isolated-handoff-audit.json`, and `quint-isolated-final.log`. Original formal
receipts remain under the isolated clone's `.git/dalph-gates/runs/`.

This report changes no runtime or verification implementation. It records the
completed checks after the frozen candidate, without claiming the report commit
was itself the measured implementation.
