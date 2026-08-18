# Stage 2 Design: plugin-api-client-connection-m3

`createClientConnection` resolves the official connection once and publishes frozen `rpc` and `api.settings` forwarding shells. It owns no transport or cleanup; W5 owns client composition.
