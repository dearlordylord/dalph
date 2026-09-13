# Disposable latest-state buffer check

Checks the installed Effect sliding buffer over Dalph's actual CurrentSignal
attachment. A held consumer skips intermediate controlled values, retains the
latest/final value, and observes stream completion.

```sh
pnpm exec vitest run --config research/prototypes/invokee-slow-watch/vitest.config.ts --reporter verbose
```

This bounds only one adapter stage, not upstream memory or network behavior.
See [results and limits](../../invokee-slow-watch-results.md).
