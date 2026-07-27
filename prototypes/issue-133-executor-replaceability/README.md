# Issue #133 executor replaceability prototype

This throwaway prototype asks whether Dalph can select a materially different
executor without teaching generic reconstruction and activation about that
executor's stages.

Run the compile probe:

```sh
pnpm exec tsc -p prototypes/issue-133-executor-replaceability/tsconfig.json --pretty false
```

Run the import-boundary fixtures:

```sh
pnpm exec eslint --no-config-lookup --config prototypes/issue-133-executor-replaceability/eslint.config.mjs prototypes/issue-133-executor-replaceability/lint-fixtures/generic-good.ts
pnpm exec eslint --no-config-lookup --config prototypes/issue-133-executor-replaceability/eslint.config.mjs prototypes/issue-133-executor-replaceability/lint-fixtures/generic-bad.ts
```

The first lint command must pass. The second must fail with
`no-restricted-imports`.
