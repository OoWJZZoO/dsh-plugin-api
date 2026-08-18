# C8 Deviations

No contract deviations are known. The adversarial reviewer was unavailable
because all collaboration slots were occupied; the coordinator performed the
required self-audit against the M3 contract and official Typert registry and
protocol declarations.

Implementation note: C8 does not add Typert packages to `peerDependencies`.
The leaf uses only the official service contract supplied by `ctx` and has no
runtime import that could create a second package instance. This preserves the
repository's existing exact peer-dependency audit; integration should revisit
the choice if the final generated artifact requires a direct shared import.
