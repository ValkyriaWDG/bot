# Contributing

Read [AGENTS.md](AGENTS.md) and the [engineering workflow](docs/engineering/workflow.md).
Keep changes scoped to an issue with observable acceptance criteria. Work in a task
branch; preserve unrelated edits and submit a PR with the concrete before/after behavior.
Do not merge or publish as an incidental part of implementation.

Use the Node and pnpm versions declared in the repository and install with
`pnpm install --frozen-lockfile`. Review dependency and lockfile changes together.
Write meaningful tests for behavior and failure boundaries. The
[verification matrix](docs/engineering/verification.md) maps the actual commands to
their claims; PostgreSQL integration tests require an explicitly disposable database.

All code, technical docs, issue/PR descriptions and AI prompts are English. Discord
command names remain English; Czech is the default user-facing language. Keep both
supported response languages consistent for changed commands.

Provide [reviewable evidence](docs/engineering/evidence.md), including captioned real
screenshots for visible behavior when tested live and an honest account of pending
live checks. Add acceptance proof to related issues before using a closing keyword.
Use synthetic data in public artifacts. Never include credentials, actual player
identifiers, private membership snapshots or infrastructure configuration.

AI-assisted contributions are permitted. The configured contributor remains responsible
for the patch and evidence. Do not add AI co-author trailers, generated-by branding or
agent session links to commits/PRs. Preserve legitimate human attribution.

Report sensitive vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.
