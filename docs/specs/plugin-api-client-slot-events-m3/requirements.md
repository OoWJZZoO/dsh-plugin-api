# Stage 1 Requirements: plugin-api-client-slot-events-m3

- WHEN a C4 mutation commits THEN C5 SHALL notify `slots/changed` listeners in deterministic snapshot order with the canonical key.
- WHEN a listener fails THEN C5 SHALL contain it and keep other listeners active.
- WHEN a listener returns a thenable that rejects THEN C5 SHALL observe and report the rejection, keep other listeners active, and SHALL not produce an unhandled rejection.
