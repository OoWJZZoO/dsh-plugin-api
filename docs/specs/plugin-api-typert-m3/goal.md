# Stage 0 Goal: plugin-api-typert-m3

> feature_name: `plugin-api-typert-m3`
> milestone: M3 / C8
> upstream: `plugin-api-m3-contract`
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Goal

Expose the official Typert registry and loader artifact boundary through a
typed, fail-closed host leaf under `pluginApi.services.typert`, while preserving
the official registry's invocation, lookup, context, ordering, disposer, and
error semantics.

## Why

Generated Typert artifacts already have an official registry contract, but a
community plugin otherwise has to reach into runtime-specific services and
loader details. C8 provides a stable facade for registration and inspection so
settings remote work can consume the same official metadata without cloning or
monkey-patching the registry.

## Outcome

The C8 leaf provides a frozen forwarding facade for the official Typert
registry, plus an artifact-facing `./typert` export boundary. Missing or
malformed Typert services disable only C8. Shared `pluginApi.services`
composition and host mounter wiring remain owned by W5 integration.
