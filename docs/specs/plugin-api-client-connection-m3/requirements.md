# Stage 1 Requirements: plugin-api-client-connection-m3

- WHEN `client.connection.rpc.call(endpoint, args, signal)` is used THEN the leaf SHALL call the official transport as `rpc.call('/api', endpoint, {args}, signal)` without changing receiver, result, rejection, or cancellation identity.
- WHEN `client.connection.api.settings.*` is used THEN the leaf SHALL forward the official member unchanged.
- WHEN the connection is unavailable THEN the leaf SHALL expose a typed disabled C9 surface without affecting other client features.
