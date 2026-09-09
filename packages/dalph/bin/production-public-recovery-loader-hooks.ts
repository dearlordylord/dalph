/* eslint-disable import/no-nodejs-modules -- Node's qualification loader redirects one built module URL. */

const productionHostSuffix = "/dist/src/application/production-host.js"
const liveCliSuffix = "/dist/src/application/live-cli.js"
const facade = new URL("./production-public-recovery-host-facade.js", import.meta.url).href

export const resolve = (
  specifier: string,
  context: { readonly parentURL?: string },
  nextResolve: (specifier: string, context: { readonly parentURL?: string }) => Promise<{ readonly url: string }>
) => {
  const resolved = new URL(specifier, context.parentURL).href
  return resolved.endsWith(productionHostSuffix) && context.parentURL?.endsWith(liveCliSuffix) === true
    ? Promise.resolve({ shortCircuit: true, url: facade })
    : nextResolve(specifier, context)
}
