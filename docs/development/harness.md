# Harness policy

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

## Safety and supply chain

CI installs with `--frozen-lockfile`; pnpm enforces strict peers, allowlisted
lifecycle scripts (`onlyBuiltDependencies`), and a 24-hour release delay unless
explicitly excepted. Install gitleaks before committing. The pre-commit hook
formats and lints staged code and scans staged secrets. `pnpm check:fast`
includes the workspace typecheck; repository verification runs the cycle check
for the frozen candidate. Unused-export analysis is an optional diagnostic.

Only exact diffs containing allowlisted documentation paths use the single
Ubuntu docs gate: whitespace, classifier controls, changed-commit secrets.
Everything else—including unreadable/empty diffs and manual/initial events—uses
the selected Node quality matrix, conservatively retaining all versions when change
evidence is unavailable. Independently, hosted formal shards run
only when the exact base-to-head paths intersect the generated hosted-formal
input projection. Unavailable base, head, diff, or projection evidence runs the
shards; a proved unaffected change skips them while the required aggregate job
reports a lightweight successful not-applicable result. The classifiers and
controls live in
[scripts/classify-docs-only-change.mjs](../../scripts/classify-docs-only-change.mjs)
and its test; the generated projection is checked by
`formal-input-policy.test.mjs`.

## Changing the harness

Root manifests, compiler/lint/format/test/coverage configs, and CI/hooks define
quality policy. Explain threshold reductions and exclusions; generated-code
exclusions must not hide authored logic.

- TypeScript-Go (`@typescript/native`) is patched by `@effect/tsgo` during
  install. Oxlint owns source lint rules. Knip owns the repository value-export
  graph check.
- `scripts/unused-export-exceptions.json` names exact file and symbol pairs;
  `scripts/unused-file-exceptions.json` names exact files. New graph findings
  and stale exceptions fail. Public package entry points use Knip's entry-point
  semantics and do not need blanket exceptions. Review the policy and run its
  focused tests before changing either exception set.
- `oxlint-complexity-suppressions.json` counts violations per file, not per
  function/value. A new or increased entry records a concrete `justification`
  for keeping the function cohesive after independent decisions have been
  extracted. The optional complexity diagnostic can use the same base as changed-line
  coverage through `--candidate=<base sha>`;
  the base must be an ancestor strictly earlier than candidate `HEAD`. A
  self-resolving fallback tries the verified parent instead; the gate fails if
  no such commit is available. A direct check without
  `--candidate=<base sha>` treats existing entries as legacy while still
  rejecting count mismatches and malformed entries. Run
  `pnpm check:complexity:prune` after reductions; pruning preserves reviewed
  justifications for every retained entry.
  The resolved canonical SHA is also exported to changed-line coverage as
  `DALPH_COVERAGE_BASE_SHA`; an explicit all-zero candidate is invalid rather
  than a request to use fallback discovery.
- Production `floatingEffect` is an error. Test `multipleEffectProvide` and
  `unnecessaryEffectGen` stay off for deliberate Layer/generator composition;
  `lazyEffect` stays off for intentional lazy interfaces. New severity overrides
  require a concrete fixture/source shape and regression test, never broad
  warning suppression.
- `dalph/effect-class-inheritance-only` permits inheritance only for
  `Context.Service` tags and `Schema.TaggedError`; no per-class escapes.
- Duplication excludes tests and disposable prototypes; tooling/configuration
  remain scanned.


### Affected formal checks

Local candidate checks select complete Quint model families for model-source changes,
following imports through the existing parser. Each family retains its deep proof,
negative controls, witness checks and evaluator provenance. Unknown or unregistered
inputs and runtime changes without a model ownership mapping retain the full
portfolio. Hosted shard producers and their aggregate derive that same selection independently
from the exact bound Base/candidate range. Empty shards retain explicit reports;
missing commands, wrong families and missing negative verdicts cannot receive credit.
Both jobs install the pinned dependencies needed for import discovery. Explicit
`check:ci:formal` and `test:delivery-repeatability` retain the full diagnostics.
