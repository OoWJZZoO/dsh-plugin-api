# Stage 1 Requirements: plugin-api-client-settings-scope-m3

- WHEN `bind(spec)` is called THEN C3 SHALL forward the exact official spec and return the official four-member scope unchanged.
- WHEN the service is absent or malformed THEN C3 SHALL expose a typed disabled surface and create no second settings transport.
