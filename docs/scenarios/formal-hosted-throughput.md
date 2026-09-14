# Hosted formal verification finishes without changing its evidence

This is repository tooling only. It changes how GitHub Actions schedules the
formal commands used to qualify Dalph source; it cannot change a Dalph Run,
call GitHub as Dalph's task tracker, call Git, start a Dalph executor, or append
the workflow journal.

## A successful family starts its expensive independent checks first

- **Starting facts:** a hosted formal job has checked out one commit, installed
  the pinned tools, constructed the complete effective profile, and has not
  started the next command family. The family contains independent checker
  processes and may retain a serialized command that prepares a shared tool.
- **Trigger:** the hosted runner admits that family under its fixed concurrency
  of two.
- **Boundary calls:** the runner finishes the serialized prefix first. It then
  starts sampled and exhaustive checks before the shorter deterministic and
  negative tests, while retaining each command's canonical position, exact
  arguments, seed, sample count, witnesses, expected verdict, captured output,
  and result position. Two children at most run together.
- **Visible result:** a successful family reports the same ordered evidence as
  the canonical 105-command profile, while avoiding an idle worker behind two
  short commands.
- **Forbidden result:** scheduling must not change command identity or output
  validation, exceed concurrency two, bypass the serialized preparation prefix,
  or admit another command after a failure.
- **Crash/retry:** the first failed child aborts its running sibling and prevents
  later admission exactly as before. A GitHub retry starts a new job; partial
  family results are not success evidence.
- **Acceptance tests:** `quint-gate-concurrency.test.ts` proves cost-priority
  admission, canonical result order, the serialized prefix, concurrency two,
  and fail-fast behavior. `quint-effective-profile.test.mjs` proves that all
  105 canonical commands and their exact tokens remain unchanged.

## GitHub qualifies every command in two model-family shards

- **Starting facts:** a non-documentation candidate commit needs formal
  qualification for one supported Node version. GitHub supplies one workflow
  run id, attempt number, commit SHA, and Node version. No complete shard
  reports exist for that identity.
- **Trigger:** the formal matrix starts shard zero and shard one for that Node
  version.
- **Boundary calls:** each job independently installs the pinned tools, enters
  through the repository's pnpm and gate-custody admission path, and constructs
  the same complete canonical profile. A fixed partition assigns whole model
  families to exactly one shard. Each shard runs only its assigned
  canonical commands under the unchanged 720-second execution deadline and
  16-minute job deadline, validates every command result and its distinct
  custody ID, writes one report bound to the workflow run, attempt, commit,
  Node version, shard number, shard count, and complete-profile digest, and
  uploads that report. A later
  aggregation job downloads both reports and reconstructs the canonical
  profile. It rejects a missing or duplicate shard, mixed workflow/commit/Node
  identities, a profile mismatch, an absent or duplicate command position, a
  command-token mismatch, a missing, malformed, or duplicate custody ID, an
  unsupported exit, or output that does not prove its declared witnesses or
  temporal verdict. The runner records only IDs returned by the admitted
  command boundary; neither the runner nor aggregator synthesizes one.
- **Visible result:** the aggregate job succeeds only when positions 0 through
  104 occur exactly once and prove the same complete formal profile. The two
  shard jobs may finish in either order.
- **Forbidden result:** a shard must not publish local reusable formal success;
  aggregation must not accept one shard, mix reports from another retry or Node
  version, reduce the inventory, split a model family, change a seed/sample/
  witness/negative-control obligation, fabricate command custody, or widen
  either deadline.
- **Crash/retry:** if a shard times out, crashes, or fails validation, its matrix
  job fails and aggregation fails closed because complete matching evidence is
  unavailable. A workflow retry has a different attempt identity and cannot
  combine its artifact with the earlier attempt.
- **Acceptance tests:** focused profile-partition tests prove whole-family,
  disjoint, exhaustive assignment and unchanged command tokens; shard-report
  tests prove exact successful aggregation and every missing/mixed/duplicate/
  altered rejection above, including missing, malformed, and duplicate custody
  IDs; the CI contract test proves two shards, report upload/download, the
  pnpm/custody runner path, the aggregate dependency, and the literal
  720-second and 16-minute bounds.
