# Stage 1 Requirements: plugin-api-client-remote-contribution-m3

- WHEN a contribution is valid THEN C2 SHALL mount it exactly once through official `$mount` and return an idempotent, contribution-scoped disposer.
- WHEN descriptor or published face validation fails THEN C2 SHALL fail closed and roll back only its own mount.
