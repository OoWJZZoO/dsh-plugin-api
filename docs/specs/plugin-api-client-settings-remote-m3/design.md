# Stage 2 Design: plugin-api-client-settings-remote-m3

ST5 receives the C2 owner, C9/ST6-ready descriptor contribution, and client remote map from W5. It never calls `$mount` itself or owns codec construction. Its active and cleanup behavior is therefore gated by C2's official dynamic-service resolution and pending-mount stale-safety rules; ST5 must be tested with the real gateway rather than a plain-object remote mock.
