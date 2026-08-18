# Stage 2 Design: plugin-api-client-codec-m3

`createClientCodec(zod)` receives the one browser-bundled zod copy from W5 and exposes JSON, strict codec, and direct invocation descriptor builders. It creates no remote mount or host artifacts.
