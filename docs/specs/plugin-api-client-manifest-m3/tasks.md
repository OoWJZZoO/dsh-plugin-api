# Stage 3 Tasks: plugin-api-client-manifest-m3

> feature_name: `plugin-api-client-manifest-m3`
> upstream: approved Goal, Requirements, and Design
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

- [ ] 1.1 Add the pure `lib/client-manifest.js` helper with field validation, defensive copying, and freezing. (Requirements R1.1-R1.5, R3.1)
- [ ] 1.2 Update `package.json` with the official `dsh.client` declaration and `exports["./client"]` entry without editing the integration-owned `lib/client.js`. (Requirements R2.1-R2.3)
- [ ] 1.3 Add focused `test/client-manifest.test.mjs` coverage for valid/invalid declarations, immutability, metadata, and no-loader side effects. (Requirements R1-R3)
- [ ] 1.4 Run `node --test test/client-manifest.test.mjs` and `git diff --check`; record any deviation or confirm none. (Requirements R3.1-R3.3)
