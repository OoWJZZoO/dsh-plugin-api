# C8 Deviations

The initial implementation omitted the required Typert peer dependencies and
did not export the official loader artifact. The batch review found both issues;
the implementation now exports an empty, valid host `TYPERT` manifest and lists
the official registry/protocol packages as peer dependencies. The facade still
uses only the service supplied by `ctx` and does not import private DSH modules.
