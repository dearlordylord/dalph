# Documentation reference checking

## Selected tool and boundary

The repository checks maintained Markdown with Lychee 0.24.2, offline, including
heading anchors. The checker validates current navigation after documentation
and source changes; it does not validate external HTTP availability, literal test
names, or scenario coverage. Current setup and scan scope live in
[command guidance](../development/commands.md#documentation-links).

This is verification tooling only: it cannot change Dalph workflow actions,
provider calls, task attempts, Journal history, runtime retries, or cleanup.

## Primary-source comparison

| Solution | Relevant contract | Decision |
| --- | --- | --- |
| [Lychee](https://github.com/lycheeverse/lychee/tree/lychee-v0.24.2) | Local Markdown targets, offline scanning, optional anchor checking, native release binaries | Selected by the maintainer; provision one pinned binary with checked archive digest. |
| [remark-validate-links](https://github.com/remarkjs/remark-validate-links) | Git-repository local files and headings; CLI supports cross-document headings | Viable Node alternative, unnecessary alongside Lychee. |
| [markdownlint MD051](https://github.com/DavidAnson/markdownlint/blob/main/doc/md051.md) | Same-document fragment validation | Insufficient alone for missing source files and cross-document headings. |
| [markdown-link-check](https://github.com/tcort/markdown-link-check) | File/HTTP liveness and retry/exclusion policy | Documented contract does not establish the cross-Markdown heading boundary needed here. |

The pinned Lychee [configuration example](https://github.com/lycheeverse/lychee/blob/lychee-v0.24.2/lychee.example.toml)
uses a fragment mode string; our configuration selects `anchor-only`. The
[release assets](https://github.com/lycheeverse/lychee/releases/tag/lychee-v0.24.2)
provide Linux/macOS distributions. The installer records the selected archive's
SHA-256 in source; no custom Markdown parser or heading-slug implementation is used.

## Acceptance checks

`pnpm test:docs` exercises the actual pinned verifier against isolated Git trees:
valid files, source targets, duplicate headings, encoded spaces, deleted source
files, removed headings, and empty selection. The offline fixture includes an
unreachable external URL, so remote liveness cannot block the navigation check.
The full census checks the current working tree, not an earlier candidate's proof.
Scoped review still owns the judgment that a mapped test exercises the promised
boundary. Git preserves the earlier tool-selection research and superseded proposals.
