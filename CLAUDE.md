# Claude Code entry point

@AGENTS.md

Start with `/valkyria-delivery`; select specialist skills using the
[catalog](docs/engineering/skills.md). If this client does not expose project skills,
open the corresponding `.claude/skills/<name>/SKILL.md` directly. No global installation
or permission-bypass hook is required.

Follow the [execution workflow](docs/engineering/workflow.md), actual scripts in
`package.json`, and the [evidence policy](docs/engineering/evidence.md). Repository
tests, synthetic demonstrations, real PostgreSQL tests and live Discord/game/website
acceptance prove different boundaries. Keep deferred acceptance explicit.

Technical prose stays English. Discord names stay English, with Czech-first descriptions
and replies and explicit English response selection. Use attribution settings from
`.claude/settings.json`; add no AI co-author, generated-by or session-link footer.
