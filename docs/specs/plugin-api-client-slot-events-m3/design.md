# Stage 2 Design: plugin-api-client-slot-events-m3

C5 owns a local typed listener table and is wired to C4 only by the integration callback; it creates no host event catalog slice. Listener invocation contains synchronous throws and observes returned thenables so asynchronous rejection cannot escape as an unhandled rejection.
