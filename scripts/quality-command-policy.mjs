/** The package entry point declares local handoff or the separate hosted quality job. */
export const parseQualityCommandArguments = (args) => {
  const purposes = args.filter((argument) => argument === "--local-handoff" || argument === "--hosted-quality")
  if (purposes.length !== 1) throw new Error("Name exactly one quality purpose: --local-handoff or --hosted-quality")
  const candidateArguments = args.filter((argument) => argument.startsWith("--candidate="))
  const resumeArguments = args.filter((argument) => argument.startsWith("--resume="))
  if (candidateArguments.length > 1) throw new Error("Name at most one candidate base")
  if (resumeArguments.length > 1) throw new Error("Name at most one prior run for resume")
  for (const argument of args) {
    if (!purposes.includes(argument) && !candidateArguments.includes(argument) && !resumeArguments.includes(argument))
      throw new Error(`Unsupported quality argument: ${argument}`)
  }
  const purpose = purposes[0].slice(2)
  if (purpose === "hosted-quality" && resumeArguments.length > 0)
    throw new Error("Resume is supported only through pnpm check:all")
  if (resumeArguments[0] === "--resume=") throw new Error("Name a prior run for resume")
  return {
    purpose,
    candidateArgument: candidateArguments[0],
    resumeRunId: resumeArguments[0]?.slice("--resume=".length)
  }
}
