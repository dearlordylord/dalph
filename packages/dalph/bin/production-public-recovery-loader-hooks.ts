/* eslint-disable import/no-nodejs-modules -- Node's qualification loader redirects one built module URL. */

const orchestratorSuffix = "/packages/orchestrator/dist/src/index.js"
const productionHostSuffix = "/dist/src/application/production-host.js"
const facade = new URL("./production-public-recovery-external-facade.js", import.meta.url).href

export const resolve = async (
  specifier: string,
  context: { readonly parentURL?: string },
  nextResolve: (specifier: string, context: { readonly parentURL?: string }) => Promise<{ readonly url: string }>
) => {
  const resolved = await nextResolve(specifier, context)
  return resolved.url.endsWith(orchestratorSuffix) && context.parentURL?.endsWith(productionHostSuffix) === true
    ? { shortCircuit: true, url: facade }
    : resolved
}
