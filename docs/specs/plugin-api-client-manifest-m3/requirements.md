# Stage 1 Requirements: plugin-api-client-manifest-m3

> feature_name: `plugin-api-client-manifest-m3`
> upstream: `plugin-api-m3-contract` Goal and requirements 1.1-1.5, 2.2-2.5, 3.1-3.2, 10.1-10.5
> class: A (official `dsh.client` declaration and loader boundary stabilization)
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Introduction

C1 owns the package declaration helper and the package-level `./client`
conditional export. It does not compose browser features, invoke
`window.__ModuleLoader__`, or implement C7 native remote discovery.

## Requirements

### R1 Manifest identity

**User Story:** As a client package author, I want a validated manifest helper, so that my declaration matches the official loader.

1. WHEN `defineManifest` receives `{ platform: 'web' }` THEN it SHALL return an object whose `platform` is exactly `'web'` and whose omitted optional fields retain official omission/default semantics.
2. WHEN `defineManifest` receives `inject` THEN it SHALL accept only an array of strings and SHALL preserve array order and values.
3. WHEN `defineManifest` receives `immediately` THEN it SHALL accept only a boolean and SHALL preserve its value.
4. WHEN any required or optional manifest field is malformed THEN the helper SHALL throw a local validation error before any loader side effect.
5. WHEN a manifest is returned THEN it SHALL be immutable and SHALL not retain a mutable alias of caller-owned arrays.

### R2 Package export boundary

**User Story:** As the official module loader, I want a discoverable client export, so that it can load the package bundle through its documented path.

1. WHEN package metadata declares a web client contribution THEN `exports["./client"]` SHALL resolve to the client bundle entry.
2. WHEN `exports["./client"]` is read by the official loader THEN its value SHALL remain a string or a one-level conditional object with a string `default`; C1 SHALL not change loader field names.
3. WHEN client boot is executed THEN C1 SHALL only provide the declaration and export boundary; it SHALL not call or patch `window.__ModuleLoader__`.

### R3 Fail-safe and scope

**User Story:** As the host boot process, I want malformed package metadata contained, so that one package cannot take down unrelated features.

1. WHEN a caller catches a manifest validation failure during apply/boot THEN the failure SHALL be local, deterministic, and free of unrelated feature state changes.
2. WHEN C1 is mounted alongside other M3 features THEN it SHALL publish no top-level host namespace and SHALL not edit `lib/client.js`, host composition, remote registries, slots, or official DSH files.
3. WHEN a proposed behavior requires official loader changes or C7 dynamic discovery THEN C1 SHALL leave it unimplemented and report it as out of scope.
