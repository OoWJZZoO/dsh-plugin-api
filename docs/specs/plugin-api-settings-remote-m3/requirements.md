# Stage 1 Requirements: plugin-api-settings-remote-m3

> feature_name: `plugin-api-settings-remote-m3`
> upstream: `plugin-api-m3-contract` Requirements 2, 5, 10, 12

## Requirements

1. WHEN `settings.remote(namespace, serviceKey?)` is called with a registered settings namespace, THEN the ST4 adapter SHALL create one host service object, bind it with the official `bindTypertRemote`, mark its public methods through the official Remote metadata mechanism, and return one effect-scoped disposer.
2. WHEN `serviceKey` is omitted, THEN the adapter SHALL use the validated settings namespace as both service key and wire namespace; WHEN it is supplied, THEN both the namespace and service key SHALL satisfy the official Typert remote-segment grammar.
3. WHEN the published `get` method is invoked, THEN it SHALL read the selected settings namespace through the official settings service and return a JSON-safe snapshot; WHEN `set` is invoked with the approved request shape, THEN it SHALL validate the request before building official settings mutation operations and return a JSON-safe result.
4. WHEN a namespace is not registered, a key collides with an active owner, a method descriptor is malformed, or a value is not JSON-safe, THEN the adapter SHALL reject before publication or persistence and SHALL leave existing owners unchanged.
5. WHEN the settings service, Typert binding primitive, or required host registration primitive is missing or malformed, THEN ST4 SHALL fail closed as P2, SHALL not patch official files, and SHALL leave the M1 settings facade available.
6. WHEN the returned disposer runs, THEN it SHALL be idempotent, SHALL unregister only the exact service contribution created by that call, and SHALL not remove a later replacement with the same key.
7. WHEN publication or a later publication step fails, THEN ST4 SHALL roll back its own completed registrations in reverse order and SHALL contain the diagnostic at the host feature boundary.
8. WHEN the host plugin applies ST4 more than once for one owner, THEN it SHALL not duplicate the Typert service or remote metadata registration.

## Scope exclusions

ST4 does not implement ST5 client mounting, ST6 codec generation, C2 generic remote contribution, C3 settings scope, C6 event bridge, C7 native dynamic discovery, ST7 dynamic settings namespaces, shared `lib/index.js` or `lib/plugin-api-service.js` composition, or any official DSH package change.
