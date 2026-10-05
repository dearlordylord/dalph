import { Schema } from "effect"

const maximumTcpPort = 65535
const maximumIpv4Octet = 255
/** Explicit trusted-network IPv4 origin. No hostname, credentials, wildcard, path or discovery is accepted. */
export const LocalHostAddress = Schema.String.check(
  Schema.makeFilter((value) => {
    const match = /^http:\/\/((?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}):([1-9][0-9]{0,4})$/.exec(value)
    return (
      (match !== null &&
        match[1] !== undefined &&
        match[1] !== "0.0.0.0" &&
        match[1] !== "255.255.255.255" &&
        match[1].split(".").every((octet) => Number(octet) <= maximumIpv4Octet) &&
        Number(match[2]) <= maximumTcpPort) ||
      "expected an explicit http://IPv4:PORT origin"
    )
  })
).pipe(Schema.brand("LocalHostAddress"))
export type LocalHostAddress = typeof LocalHostAddress.Type
