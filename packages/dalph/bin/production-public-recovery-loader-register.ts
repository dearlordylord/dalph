#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Qualification registers one process-local ESM boundary substitution. */
import { register } from "node:module"

register(new URL("./production-public-recovery-loader-hooks.js", import.meta.url), import.meta.url)
