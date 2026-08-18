# Stage 0 Goal: plugin-api-settings-remote-m3

> feature_name: `plugin-api-settings-remote-m3`
> milestone: M3
> row: ST4 host settings remote
> status: Stage 0 approved under unattended owner authorization

## Goal

Expose a host-side `settingsRemote` leaf that lets the existing
`pluginApi.settings` surface publish one registered settings namespace through
the official Typert Remote boundary. The leaf shall provide deterministic
namespace/service-key validation, a small settings get/set face, strict JSON
wire checks, and an owner-scoped idempotent disposer without changing shared
facade composition or any official DSH package.

## Why

Plugin-owned settings namespaces are not available through the official web
settings allowlist. Existing consumers therefore duplicate a hand-written
`TypertRemoteService` bridge and decorator-marker workaround. A single
fail-safe adapter removes that duplication while preserving the official
settings provider, Typert protocol, gateway discovery, and lifecycle owners.

## Boundary

This feature owns only the host leaf module, its focused tests, and the
append-only `settingsRemote` branch in `lib/guards.js`. Integration owns
`pluginApi.settings.remote` composition, `FEATURE_MOUNTERS`, shared service
surfaces, package metadata, and client-side ST5/ST6/C2/C9 wiring. This feature
does not implement native `remote.<namespace>` discovery or modify official
DSH files.

## Outcome

After Stage 4, integration can mount `createSettingsRemoteApi()` after the
base settings and Typert features. Calling its `remote(namespace, serviceKey?)`
creates exactly one Typert bridge with `get()` and `set(request)` methods,
returns an idempotent owner disposer, and fails locally when the settings or
Typert substrate is unavailable or malformed.
