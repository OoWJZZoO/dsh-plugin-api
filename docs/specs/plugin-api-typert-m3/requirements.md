# Stage 1 Requirements: plugin-api-typert-m3

> feature_name: `plugin-api-typert-m3`
> upstream: `plugin-api-m3-contract` Goal and requirements 1.1-1.5, 2.2-2.5, 3.3-3.5, 10.1-10.5
> class: A (official Typert registry/loader seam stabilization)
> review: adversarial reviewer unavailable in the unattended W1 slot; coordinator self-audit required

## Introduction

C8 owns a leaf wrapper around the official `ctx.typert` service and the package
artifact export used by the official Typert loader. The wrapper delegates to
public registry methods only. It does not create a second registry, alter
generated metadata, patch official DSH files, or own the shared services parent.

## Requirements

### R1 Public placement and identity

**User Story:** As a plugin author, I want one stable Typert service face, so that generated artifacts can be registered without private imports.

1. WHEN C8 is active THEN its public host placement SHALL be `pluginApi.services.typert` and its feature identity SHALL be `typert`.
2. WHEN C8 is composed THEN it SHALL publish no top-level `pluginApi.typert` namespace and SHALL not replace the shared `pluginApi.services` parent.
3. WHEN the package exports `./typert` THEN the export SHALL resolve to the C8 artifact-facing leaf without changing official loader field names.

### R2 Official registry forwarding

**User Story:** As a generated package loader, I want the official registry semantics preserved, so that registration remains compatible with generated artifacts.

1. WHEN `typert.register(contribution)` is called THEN the facade SHALL invoke the official registry with the same receiver and exact argument, returning the same disposer identity and preserving official duplicate/error outcomes.
2. WHEN schema/reflection methods `get`, `resolve`, `list`, `getPackage`, `listPackages`, or `toJSONSchema` are called THEN the facade SHALL forward arguments, return values, and thrown errors without copying or reinterpretation.
3. WHEN `typert.local`, `typert.remotes`, `typert.lookups`, or `typert.contexts` is read THEN the facade SHALL expose the corresponding official contract and preserve nested registration order, receiver, disposer, and error behavior.
4. WHEN a nested registration method is called THEN the facade SHALL not synthesize descriptors, schemas, lookup providers, context binders, or replacement cleanup semantics.

### R3 Guard and fail-safe behavior

**User Story:** As the host boot process, I want missing Typert infrastructure contained, so that unrelated plugin API features keep running.

1. WHEN the official Typert service or any mandatory registry member is missing or malformed THEN the `typert` guard SHALL fail closed and C8 SHALL publish no active leaf.
2. WHEN the C8 guard or artifact mount fails THEN the host entry SHALL log a redacted diagnostic and return normally without throwing through apply.
3. WHEN C8 is disabled or core is inactive THEN calls SHALL use the standard inactive/feature-disabled presentation and SHALL not invoke an official service.

### R4 Scope and exclusions

1. WHEN implementation work is performed THEN it SHALL touch only C8 leaf modules, its append-only guard branch, package metadata, and focused tests.
2. WHEN a behavior requires changing official DSH loader/registry files or implementing an M4 proposal THEN C8 SHALL leave it unimplemented and record it as out of scope.
