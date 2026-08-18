# Stage 1 Requirements: plugin-api-client-codec-m3

- WHEN a descriptor codec is constructed THEN the leaf SHALL use zod v4 schema objects and strict codec records.
- WHEN a descriptor identity or codec is malformed THEN the leaf SHALL reject it before publication.
