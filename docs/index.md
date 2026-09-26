# Documentation index

This repository contains the independent Valkyria Discord operations service. Technical
documentation is English; command names are English and replies are Czech first with
explicit English selection. Local simulation, real PostgreSQL tests and live integrations
have separate acceptance boundaries.

## Use and inspect

Open the [captioned screenshot gallery](evidence/README.md) for actual browser captures
of the synthetic Discord lab, its report and source provenance.

| Guide                                      | Purpose                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [User guide](user-guide.md)                | Help/account, server reads, all administrative workflows, languages and outcomes                 |
| [Testing lab](testing-lab.md)              | Synthetic Discord scenarios, local PostgreSQL/HTTP chain, browser viewer and screenshot evidence |
| [Disposable lab database](lab-database.md) | Exact local PostgreSQL setup, environment, execution and cleanup commands                        |
| [Troubleshooting](troubleshooting.md)      | User notices, permission errors, unknown outcomes and operator diagnosis                         |
| [Command contract](commands.md)            | Exact manifest, validation, dispatcher and confirmation behavior                                 |

## Operate and integrate

| Guide                                            | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [Operations and setup](operations.md)            | Private configuration, explicit registration/migrations, runtime and recovery |
| [Deferred live acceptance](live-acceptance.md)   | Separate actual Discord, Wardogs, receiver and deployment verification        |
| [Wardogs wire evidence](wardogs-api.md)          | Adapter source evidence and installed-game compatibility limits               |
| [Website integration](web-integration.md)        | Proposed signed role-sync transport and independent consumer requirements     |
| [Website handoff](handoffs/website-role-sync.md) | Work required in the sibling website before sender delivery is accepted       |
| [Security policy](../SECURITY.md)                | Private reporting and safe handling of sensitive findings                     |

## Build and deliver

| Guide                                                 | Purpose                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| [Design](design.md)                                   | Service ownership, architecture and safety boundaries            |
| [Implementation plan](implementation-plan.md)         | Planned implementation sequence and behavioral acceptance        |
| [Roadmap](roadmap.md)                                 | Concrete repository and later live task scopes                   |
| [Working agreement](../AGENTS.md)                     | Agent authority, implementation and proof rules                  |
| [Skill catalog](engineering/skills.md)                | Eight project skills and when to load them                       |
| [Execution workflow](engineering/workflow.md)         | Intake, implementation, integration and handover                 |
| [Service workflows](engineering/service-workflows.md) | Domain-specific code, authorization and persistence procedures   |
| [Verification matrix](engineering/verification.md)    | Applicable scripts and the boundaries their results prove        |
| [Evidence policy](engineering/evidence.md)            | Captions, simulation labels, delivery and issue/incident closure |
| [Release controls](engineering/release.md)            | Exact revision, private image gates and deployment separation    |
| [Repository settings](repository-settings.md)         | GitHub protections, metadata and operator-owned configuration    |
| [Contributing](../CONTRIBUTING.md)                    | Contributor setup and review conventions                         |

Use `pnpm lab:curate` and `pnpm check:evidence` for the inspected clean-source gallery;
follow the [lab workflow](testing-lab.md) for source and separate evidence commits.
Use the current root README/status and exact PR/CI records for completion claims. A guide,
roadmap checkbox or screenshot file does not establish that a command ran or that a live
service is available. Curated evidence under `docs/evidence/` must include its manifest,
captions and source context; local working reports remain under `.local/lab/`.
