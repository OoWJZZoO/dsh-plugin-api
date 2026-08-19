# Stage 1 Requirements: plugin-api-client-settings-remote-m3

- WHEN settings descriptors and the host face match THEN ST5 SHALL reuse C2 to mount once and provide the resulting face to rendering.
- WHEN mount or face validation fails THEN ST5 SHALL release its own effect and return a visible degraded outcome without native dynamic discovery.
- WHEN ST5 runs against the official gateway THEN its active path SHALL pass C2's dynamic-namespace resolution and pending-mount lifecycle contract; ST5 SHALL not treat a Cordis dynamic service as absent because it is not an own property.
