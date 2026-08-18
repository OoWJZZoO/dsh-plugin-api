# Stage 1 Requirements: plugin-api-client-slots-m3

- WHEN a slot is registered THEN C4 SHALL validate the official SlotEntryDef fields and canonical key before forwarding to the official slots service.
- WHEN entries are read or registrations disposed THEN C4 SHALL expose immutable snapshots and preserve official ownership.
