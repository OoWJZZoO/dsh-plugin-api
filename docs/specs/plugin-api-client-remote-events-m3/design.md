# Stage 2 Design: plugin-api-client-remote-events-m3

The leaf owns only an allowlisted local subscription table. `$dispatch` is the inbound carrier and never transports or exposes consumer emission. Listener wrappers catch synchronous throws and attach a rejection handler to every returned thenable; `$dispatch` remains `void` while asynchronous failures are reported and contained.
