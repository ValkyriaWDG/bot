# Project skill catalog

These eight native Claude project skills are committed under `.claude/skills/`.
Load a skill when its procedure applies; a task may need several. Start with delivery,
then select the relevant specialist. Other clients can read the linked files directly.
Skills do not install tools, grant permissions or require global plugins.

| Skill                                                                        | Use for                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [valkyria-delivery](../../.claude/skills/valkyria-delivery/SKILL.md)         | Intake, scoped implementation, integration and handover                      |
| [valkyria-discord](../../.claude/skills/valkyria-discord/SKILL.md)           | Command manifests, localized interaction UX and runtime adaptation           |
| [valkyria-wardogs](../../.claude/skills/valkyria-wardogs/SKILL.md)           | Provider wire contracts, read adapters and bounded control transport         |
| [valkyria-auth](../../.claude/skills/valkyria-auth/SKILL.md)                 | Membership freshness, role capabilities and signed website synchronization   |
| [valkyria-database](../../.claude/skills/valkyria-database/SKILL.md)         | PostgreSQL migrations, action/audit transactions and outbox persistence      |
| [valkyria-github](../../.claude/skills/valkyria-github/SKILL.md)             | Branches, issues, scoped PRs and exact-head CI evidence                      |
| [valkyria-verification](../../.claude/skills/valkyria-verification/SKILL.md) | Acceptance proof, test selection, screenshots and incident recovery evidence |
| [valkyria-release](../../.claude/skills/valkyria-release/SKILL.md)           | Accepted-revision release preparation, image gates and deployment handover   |

Canonical guides are [workflow](workflow.md), [service workflows](service-workflows.md),
[verification](verification.md), [evidence](evidence.md) and [release](release.md).
Use the source module and its tests for exact current APIs, not a skill as copied API documentation.
