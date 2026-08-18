# Stage 1 Requirements: plugin-api-client-remote-events-m3

- WHEN a client subscribes THEN the bridge SHALL reject events outside the official allowlist before registration.
- WHEN the host carrier dispatches decoded arguments THEN the bridge SHALL notify a snapshot of local listeners in order, return void, and contain listener failures.
