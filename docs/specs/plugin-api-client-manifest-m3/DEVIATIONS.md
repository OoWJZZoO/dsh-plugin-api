# C1 Deviations

The helper intentionally accepts the official generic manifest shape, including
any non-empty `platform` string. The package's own `dsh.client` metadata remains
`platform: "web"`, because the official browser loader only consumes web
declarations. This is a contract clarification, not an official-loader patch:
`defineManifest` mirrors the parser's generic shape while this package publishes
one web bundle.
