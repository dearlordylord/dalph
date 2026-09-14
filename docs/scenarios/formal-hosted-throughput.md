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

## GitHub avoids formal execution when the exact change cannot affect it

- **Affected person and starting facts:** a maintainer opens or updates a pull
  request, or pushes a commit to `master`, and waits for the required
  `Formal model gate (Node 24.20.0)` check. GitHub has checked out the exact
  event head with complete Git history. The event supplies either the pull
  request base commit or the push's previous commit. Dalph has not started a
  formal checker. GitHub, Git, the execution substrate, and the workflow
  journal are not called as Dalph runtime boundaries because this is repository
  qualification tooling only.
- **Trigger and boundary calls:** the change-plan job resolves the event's exact
  base and head commits, asks Git for every path changed from base to head, and
  compares those paths with one checked-in hosted-formal input projection. That
  projection is generated from the same recursively discovered JavaScript and
  selected-Quint closure used by the formal gate, plus the exact workflow,
  root and every declared workspace package manifest, lock, workspace, npm,
  and selected patch inputs that determine the hosted installation and
  command. The workspace manifests are derived from `pnpm-workspace.yaml`, and
  unsupported install lifecycle commands in any of them fail projection
  generation closed. The projection, its generator, and the
  classifier that imports it are themselves governed inputs. A new formal
  dependency therefore first changes an already-governed importer or selected
  root, and the quality test refuses a stale projection before that dependency
  can merge.
- **Affected result:** if any changed path is in the projection, both existing
  shard jobs run and the aggregate job validates their evidence exactly as in
  the preceding scenario. The classification does not change the shard count,
  commands, custody evidence, deadlines, or aggregation contract.
- **Not-applicable result:** if the exact nonempty path set contains no governed
  input, GitHub starts neither expensive shard. It still starts one lightweight
  aggregate job for every supported Node version under the unchanged required
  check name. That job reports success as not applicable and prints the exact
  base commit, head commit, classification, and changed-path evidence. Runtime
  source, runtime tests, formal-tool tests outside the discovered closure, and
  documentation alone do not require fresh hosted formal execution.
- **Fail-closed result:** a missing or all-zero event base, an empty or
  unsupported head, an unsupported event, an unreadable Git diff, or a missing,
  malformed, or internally inconsistent projection selects formal execution.
  The change plan reports the concrete classification failure; it does not
  present an unknown change as not applicable. If the change plan itself fails,
  the required aggregate check fails instead of reporting success.
- **Crash and retry:** GitHub may stop between classification, either shard, and
  aggregation. A workflow retry recomputes the exact base-to-head paths and
  classification. It does not reuse a partial shard or an earlier
  not-applicable result.
- **Forbidden result:** GitHub must not skip a shard because the change looks
  like ordinary runtime or test work when a governed formal input also changed;
  hide a base, diff, or projection error behind a successful not-applicable
  result; omit the required formal check; maintain a second broad path allowlist
  that can drift from the formal closure; or run either expensive shard for a
  proven unaffected change.
- **Acceptance tests:** `classify-docs-only-change.test.mjs` proves exact
  base-to-head path enumeration, all fail-closed inputs, unchanged runtime/test/
  documentation classification, and generated-manifest positive and negative
  controls. `formal-input-policy.test.mjs` proves the checked-in projection is
  exactly regenerated from the authoritative closure and changes for a selected
  model, imported helper, hosted command, workflow, toolchain, or workspace
  package input, including rejection of an unsupported workspace lifecycle.
  `quint-ci-contract.test.ts` proves affected changes retain two shards and
  unchanged aggregation, while unaffected changes skip both shards and keep the
  successful lightweight required check with exact classification evidence. It
  also proves that a failed change plan fails the always-running aggregate and
  that not-applicable success requires a successful plan with the exact
  `false` classification.
