/* eslint-disable import/no-nodejs-modules -- The explicit manual cassette opt-in is read before test registration. */
import nodeProcess from "node:process"

export const runIntegrationCapstone = nodeProcess.env["DALPH_RUN_INTEGRATION_CAPSTONE"] === "1"
