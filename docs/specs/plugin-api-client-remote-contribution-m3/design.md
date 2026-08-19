# Stage 2 Design: plugin-api-client-remote-contribution-m3

C2 owns a package-keyed mount map. It validates descriptor identities before mount, verifies published namespaces after mount through the official dynamic-service accessor (not `in`/own-property checks), and never owns settings-specific UI or codec construction. Each record has pending, active, and stale/disposed states. A disposer called while pending marks the record stale; when `$mount` settles, a committed mount is disposed exactly once, while a rejection removes the map entry only if it still owns that record.
