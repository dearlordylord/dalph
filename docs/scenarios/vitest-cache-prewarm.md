# Bootstrap prewarms the ordinary Vitest transform cache

This scenario changes repository bootstrap and qualification tooling only. It
does not add a Dalph command, workflow decision, provider request, journal fact,
retry rule, cleanup action, or delivery-visible result. The actor is the
maintainer running the repository bootstrap; no Dalph coordinator, executor,
tracker, Git delivery boundary, or workflow journal participates.

## A fresh worktree is bootstrapped and its test modules are prewarmed

### Starting situation

The maintainer has one Dalph worktree at a reviewed source revision. Submodules
are either absent or at their declared revisions. The dependency graph is not
yet installed, production artifacts are not prepared, and the ordinary Vitest
filesystem module cache at `node_modules/.experimental-vitest-cache` is absent
or disposable. No test process, provider, executor, GitHub task, Git ref, or
journal record is part of this operation.

### Bootstrap action and outside event

The maintainer runs `pnpm bootstrap:worktree`. Bootstrap initializes declared
submodules, performs the existing frozen install, prepares production
artifacts, performs the existing script-disabled frozen relink, and validates
workspace-bin launchers. Only after those boundaries succeed, bootstrap starts
the bounded Vitest prewarm. The prewarm creates the test-mode Vitest config,
discovers the ordinary test files, and transforms/parses them with fixed local
concurrency. It must not execute tests, global setup, coverage, providers, or
the target application. Vitest writes only its disposable filesystem module
cache under the worktree.

### Visible and forbidden result

The maintainer sees a successful bootstrap and a cache that a later fresh
Vitest process may reuse. A prewarm failure or timeout fails bootstrap with its
bounded command result; it is not reported as a successful warm worktree. The
prewarm must not change authored source, package manifests, lockfiles,
production `dist` output, coverage output, or any path outside the worktree.

### Crash and retry

If bootstrap exits during prewarm, atomic cache entries may remain but are
disposable and are never qualification evidence. A later bootstrap rerun
reuses only entries that Vitest's source/configuration/lock identity accepts;
otherwise it transforms the module again. No external mutation or ambiguous
provider result exists to reconcile.

### Acceptance test mapping

- `prewarms ordinary test modules without executing a test or provider` proves
  the prewarm boundary and no-execution result.
- `runs the prewarm only after the final frozen relink and launcher validation`
  proves bootstrap ordering and the bounded command contract.
- `prewarm failure or timeout fails bootstrap` proves the visible failure and
  retry boundary.

## A changed input cannot reuse stale prewarm output

### Starting situation and trigger

The worktree has a prewarmed ordinary cache. The maintainer changes an ordinary
test or source module, the Vitest configuration, or the frozen dependency
lockfile, then starts a fresh Vitest process.

### Boundary calls and visible result

Vitest's cache identity rejects the transformed bytes whose source,
configuration, or lock identity changed and transforms the changed module
again. Unchanged modules may still be reused. The maintainer sees the current
test behavior; no stale transformed source is accepted.

### Forbidden result and crash applicability

The cache must not serve a changed module as if it were unchanged, and a
partial cache file must not become success evidence. There is no Dalph runtime
crash or provider retry boundary; this is a local read/transform operation.

### Acceptance test mapping

- `changed source and configuration invalidate the persistent Vitest cache`
  proves changed-input invalidation.
- `a malformed or symlinked persistent cache fails closed without deleting
  outside the worktree` proves the disposable-path boundary.

## Full qualification discards prewarm output

### Starting situation and trigger

The maintainer starts a fresh or same-candidate resumed `pnpm check:all` run.
The worktree may contain a cache produced by bootstrap or an earlier ordinary
Vitest command.

### Boundary calls and visible result

Before the guarded candidate input observation, the full-gate setup removes the
exact persistent Vitest module cache along with the existing disposable Vite
caches. The guard treats the cache as generated output. Qualification then
starts from its existing fresh-transform boundary; resume does not receive
stage credit from prewarm output.

### Forbidden result and crash applicability

The gate must not credit a prewarm cache as a stage result, retain a cache that
can hide a candidate input change, or delete a similarly named path outside the
worktree. A process crash remains governed by the existing gate custody and
reconciliation protocol; this scenario adds no new Dalph crash or retry rule.

### Acceptance test mapping

- `fresh and resumed setup discards the persistent Vitest cache with exact Vite
  caches` proves reset and generated-output treatment.
- `persistent Vitest cache aliases fail closed before deleting outside the
  worktree` proves the path-safety boundary.

## Scope boundary

Vitest pool selection, worker counts, coverage scheduling, hosted CI suffix
scheduling, and the persistent warm delivery-repeatability runner remain
unchanged. A controlled cold-versus-warm measurement records whether the
bootstrap cost is repaid by the documented workload; it must not be presented
as a universal wall-clock promise. If a clean candidate cannot demonstrate a
material gain, item 5 remains a tooling-boundary completion and the measured
performance claim stays open without changing those policies.
