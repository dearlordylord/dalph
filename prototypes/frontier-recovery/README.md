# PROTOTYPE — bounded resumable frontier model

This throwaway prototype answers one question from
[Build and check the Quint model](https://github.com/dearlordylord/dalph/issues/122):

> Does the accepted Dalph control-plane design permit bounded, resumable, and
> pausable graph-frontier traversal from every legal durable prefix without
> duplicate authority effects or branch-global deadlock?

The model is deliberately not production code. It keeps the authority,
durable-knowledge, workflow-history, control-command, and process-local
coordination boundaries separate, while abstracting provider internals and
repository bytes.

## Approved finite instance

- Tasks: `A`, `B`, `C`, and `D`.
- Dependency: `A` is the sole prerequisite of `B`.
- Grouping: `D` is a grouping child of `A`; grouping creates no dependency.
- Independent branch: `C`.
- Task-work capacity: two positions.
- Coordinator crashes: at most one per trace, at any durable prefix.
- Authority rereads: at most two unreadable results before isolation.
- Authority revisions: bounded explicitly in the model.
- Run and task control changes: at most one pause/resume cycle per subject in
  the exhaustive finite instance.
- Communication: one coordinator reads and mutates shared external authority
  state. There is no message protocol, so the model uses plain Quint rather
  than Choreo.

## Operation grain

Every ambiguity-crossing boundary is decomposed into:

1. durable intent;
2. request, which may or may not change the authority;
3. fresh authority observation; and
4. durable outcome or an exact nonterminal disposition.

The modeled boundary sequence is claim acquisition, worktree creation, session
establishment, executor invocation, Git promotion, completion-claim creation,
tracker completion, and completion-claim deletion.

## Run

The final one-command runner is:

```sh
pnpm prototype:frontier
```

It typechecks the model, runs deterministic scenarios and sampled witnesses,
then executes the bounded verification profiles. Exact commands and results are
recorded in `VERIFICATION.md`.

`SPECIFICATION-PROBLEM-LOG.md` retains confirmed specification defects, if
any, separately from model mistakes and verifier limitations.
