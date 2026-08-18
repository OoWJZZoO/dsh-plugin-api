# ST4 Deviations

No contract deviations were identified. ST4 uses the official `bindTypertRemote` path with a dedicated host-service instance registered through `ctx.reflect.provide`; this preserves the required public binding/disposer semantics without adding a Typert dependency or patching official files. The Stage 4 audit additionally made `get()` use the redacted settings descriptor and isolated its Remote metadata on a feature-local prototype.
