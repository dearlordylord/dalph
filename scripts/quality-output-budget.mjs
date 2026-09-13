/** Successful quality output is bounded so a passing gate cannot silently produce an unreviewable transcript. */
export const successfulOutputLineLimit = 550

export const addSuccessfulOutputLines = ({ currentOutputLines, maximumOutputLines, stageName, stageOutputLines }) => {
  const nextOutputLines = currentOutputLines + stageOutputLines
  if (nextOutputLines > maximumOutputLines) {
    throw new Error(
      `Quality gate successful output exceeded ${maximumOutputLines} lines after '${stageName}' ` +
        `(${nextOutputLines} lines observed)`
    )
  }
  return nextOutputLines
}
