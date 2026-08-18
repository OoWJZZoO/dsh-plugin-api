# Stage 0 Goal: plugin-api-client-manifest-m3

> feature_name: `plugin-api-client-manifest-m3`
> milestone: M3 / C1
> upstream: `plugin-api-m3-contract`
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Goal

Provide a small client-manifest helper that validates and normalizes the official
`dsh.client` declaration while preserving the official `exports["./client"]`
loading contract. The helper gives package authors one stable entry point without
patching or reimplementing the official client module loader.

## Why

Client packages currently repeat loader-facing declaration checks and can drift
from the host's accepted manifest shape. C1 should make the package boundary
explicit so later client features can be composed in `lib/client.js` without
inventing a second manifest or boot protocol.

## Outcome

`defineManifest({ platform: 'web', inject?, immediately? })` returns a frozen,
official-shaped declaration or throws a local validation error before boot. The
package exports a client bundle entry at `./client`; the helper remains a pure
leaf and does not own client composition, boot registration, or any M4 dynamic
discovery behavior.
