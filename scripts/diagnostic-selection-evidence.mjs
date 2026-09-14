/** Resolve whether changed-file diagnostics use a task-pinned base or the convenient moving development fallback. */
export const diagnosticBaseInput = (environment = process.env) =>
  environment.DALPH_DIAGNOSTICS_BASE === undefined
    ? { baseReference: "origin/master", source: "moving-default" }
    : { baseReference: environment.DALPH_DIAGNOSTICS_BASE, source: "explicit" }

/** Emit one machine-readable line so a diagnostic report cannot obscure its comparison base or selected paths. */
export const reportDiagnosticSelection = ({ command, selectedPaths, selection, source }) => {
  console.error(
    `Dalph changed-file selection: ${JSON.stringify({
      command,
      base: {
        reference: selection.baseReference,
        resolvedSha: selection.resolvedBaseSha ?? null,
        comparisonSha: selection.comparisonBaseSha ?? null,
        source
      },
      headSha: selection.headSha ?? null,
      changedPaths: selection.files,
      selectedPaths
    })}`
  )
}
