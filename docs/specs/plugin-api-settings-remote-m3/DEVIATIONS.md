# ST4 Deviations

The contract wording names a direct `TypertRemoteService` instance, while the
implementation uses a feature-local plain service object plus the official
`bindTypertRemote` binder and `ctx.reflect.provide`. This is the official
binder-equivalent service registration path: it preserves the same
`typertRemote` metadata, wire descriptors, registration/disposer lifetime and
failure behavior without double-registering a service. No official DSH package
is modified. The Stage 4 audit additionally made `get()` use the redacted
settings descriptor and isolated Remote metadata on a feature-local prototype.
