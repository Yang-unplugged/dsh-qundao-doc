# Official DSH host verification

Result: **21 checks passed** using the actual published `@deepseek-ai/dsh@0.2.2-rc.1` host, release commit `c59d10a`, and the final unmodified `dsh-local-documents-next@0.2.0` plugin. This did not use `integration/test-host.mjs` or mocked React/slot/connection providers.

## Official source

- npm: https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2-rc.1.tgz
- Repository: https://github.com/deepseek-ai/deepseek-harness
- CLI: `node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port 43381`
- Harness: `node /workspace/shared/dsh-official-host-qa/verify-official-host.mjs`
- Node: 24.22.1. Host required Node >=24.9.0.
- Install: official npm package pinned to 0.2.2-rc.1, `--ignore-scripts --no-audit --no-fund`; integrity is retained in package-lock.json and the report.

## Passed

- Official CLI version and web-profile composition.
- Final plugin copied byte-for-byte into a separate profile; source hashes unchanged afterward.
- Real host startup and its stock token-to-cookie authentication exchange.
- Anonymous plugin API request refused with HTTP 401.
- Official frontend boot graph lists the final plugin, dependencies and immediate loading.
- Host serves the actual 2,546,937-byte plugin client factory via its revisioned module URL.
- Real authenticated Connection routes: empty store, create, update, 409 stale-revision conflict, folder/favorite/pin/icon/cover metadata, named version, history, historical restore, soft delete and undelete.
- Synthetic PNG upload and exact-byte readback, backup with document and image.
- Graceful host shutdown releases the plugin store lock.
- A second actual host process reopens the persisted document with exact content/metadata/named versions and image bytes; second graceful shutdown succeeds.

## Isolation and cleanup

Only synthetic data under this QA directory was used. HOME, DSH_HOME, DSH_AGENTS_HOME and working directory were isolated. The child environment did not inherit user credentials or account API keys. Telemetry was disabled, listening stayed on 127.0.0.1, and `--no-open` prevented browser launch. Temporary stock browser authentication was used only against this local process; the signing record was removed after shutdown. No credential values appear in reports. No Mac foreground, real documents, account login, messages, security settings or product files were changed.

## Remaining limit

This is genuine official-host backend and module-delivery verification. It is **not native browser/client execution or UI acceptance**: actual sidebar rendering, click/drag behavior, browser layout, native Chinese IME, system clipboard, and browser reload persistence remain unverified. The previously reported browser platform blocker was neither bypassed nor retried.

## Evidence

- `official-host-report.json`: all 21 assertions, release identity, source hashes and official package integrity.
- `logs/official-boot-1.log`, `logs/official-boot-2.log`: redacted actual readiness logs.
- `logs/official-index.html`: actual generated host HTML/boot graph; no auth token.
- `logs/default-config.yml`: official web-profile composition.
- `verify-official-host.mjs`: executable assertions. Its empty-store assertion expects a fresh profile; retain this completed test's synthetic data as evidence, and use a new isolated QA copy for a clean rerun.

During harness development, two assumptions were corrected: stock auth redirects with HTTP 303 (README text mentioned 302), and anonymous 401 returns plain text rather than JSON. These were harness corrections only; no plugin changes were made.
