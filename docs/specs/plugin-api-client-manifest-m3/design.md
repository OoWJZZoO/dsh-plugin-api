# Stage 2 Design: plugin-api-client-manifest-m3

> feature_name: `plugin-api-client-manifest-m3`
> upstream: `plugin-api-m3-contract` Design
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Overview

C1 is a pure package-boundary leaf. It mirrors the official
`@deepseek-ai/dsh-client-modules` parser contract and returns an immutable
manifest declaration. Package metadata points `./client` at the integration-owned
`lib/client.js` entry; C1 does not implement that entry.

## Architecture

```text
caller -> defineManifest -> frozen dsh.client declaration
package.json -------------------------------> official client-modules scanner
exports["./client"] ------------------------> integration-owned lib/client.js
```

Validation is local and synchronous. The official loader remains the only boot
registration mechanism and reads the package declaration later.

## Components and Interfaces

### `lib/client-manifest.js`

Export `defineManifest(input)` and `isManifest(value)`. `platform` must be a
non-empty string and the C1 public helper documents the M3 platform as `web`.
`inject`, when present, must be a string array. `immediately`, when present,
must be boolean. The returned object is a shallow-frozen copy and the `inject`
array is copied and frozen. No default `inject` or `immediately` key is added;
this preserves the official parser's omission semantics.

### `package.json`

Add `exports["./client"]` pointing to `./lib/client.js` and add the official
`dsh.client` declaration for this package with `platform: "web"` and only the
fields required by the package's boot contract. The integration owner owns the
contents of `lib/client.js`.

## Data Models

```js
{
  platform: 'web',
  inject?: string[],
  immediately?: boolean,
}
```

The runtime return is `Readonly<{ platform: string, inject?: readonly string[], immediately?: boolean }>`.

## Error Handling

Validation throws `TypeError` with field-specific messages before side effects.
No global state is changed. If package scanning rejects malformed metadata, the
official loader owns its failure presentation; C1 does not catch or rewrite it.

## Testing Strategy

- valid `web` declaration, optional-field preservation, copy/freeze behavior;
- invalid platform/inject/immediately and unknown-field policy;
- package export and `dsh.client` metadata shape;
- proof the helper does not access `window` or register a loader.

## Key Decisions

- No `inject: []` or `immediately: false` default is synthesized because the
  official parser preserves absent fields.
- `exports["./client"]` is owned by C1, while `lib/client.js` remains W5-owned.
- No M4 `remote.<namespace>` discovery or loader patch is included.
