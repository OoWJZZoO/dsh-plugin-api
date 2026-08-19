# Stage 1 Requirements: plugin-api-client-remote-contribution-m3

- WHEN a contribution is valid THEN C2 SHALL mount it exactly once through official `$mount` and return an idempotent, contribution-scoped disposer.
- WHEN official `$mount` resolves THEN C2 SHALL resolve each declared namespace through the official dynamic-service accessor (`remote[namespace]` or its documented equivalent), accepting Cordis dynamic properties and never relying on `namespace in remote` or own-property enumeration.
- WHEN descriptor or published face validation fails THEN C2 SHALL fail closed and roll back only its own mount.
- WHEN disposal or replacement occurs before `$mount` settles THEN C2 SHALL defer official disposal until settlement, invoke it at most once if the mount committed, and preserve a newer owner when late cleanup or rejection arrives.
