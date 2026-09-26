# Disposable laboratory database

Run these commands from the repository root. The [simulation plan](simulation-plan.md)
uses real PostgreSQL and local Discord, Wardogs and website fixtures. No bot, game or
production database credentials are needed. The fixed password below belongs only to
this disposable fixture and is intentionally public.

## Prerequisites and isolation

- Use the Node version in `.node-version` and pnpm version in `package.json`.
- Docker must run Linux containers with Docker Compose v2 supporting `up --wait`.
  Docker Desktop's Linux engine is suitable on Windows.
- Run `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`.
  The initial dependency, PostgreSQL image and Chromium downloads require network access.
- Keep `LAB_DATABASE_URL` scoped to this shell and pointed at the fixture below.
  Do not substitute `DATABASE_URL` or an existing application database.

[`compose.lab.yaml`](../compose.lab.yaml) creates the `valkyria-bot-lab` project with
PostgreSQL 17 pinned to the same image digest as CI. Only `127.0.0.1:55440` is published;
no production Docker network, environment file or persistent volume is used. Database
data lives in a 256 MiB tmpfs and is discarded when the container stops. Each lab run
also uses its own temporary schema, so a failed run can be discarded without touching
another application's tables.

## PowerShell

```powershell
docker compose -f compose.lab.yaml up -d --wait --wait-timeout 60
if ($LASTEXITCODE -ne 0) { throw 'Laboratory PostgreSQL did not become healthy.' }
$env:LAB_DATABASE_URL = 'postgresql://bot_test:synthetic-lab-only@127.0.0.1:55440/valkyria_bot_test'

pnpm lab:run
if ($LASTEXITCODE -ne 0) { throw 'Laboratory scenarios failed.' }
pnpm test:e2e
if ($LASTEXITCODE -ne 0) { throw 'End-to-end checks failed.' }
pnpm test:visual
if ($LASTEXITCODE -ne 0) { throw 'Browser checks failed.' }
```

After those checks, open a second PowerShell terminal in the repository root:

```powershell
pnpm lab:serve
```

Open [the local viewer](http://127.0.0.1:4178). Stop the viewer with `Ctrl+C` when done,
then clean up the fixture in the first terminal:

```powershell
docker compose -f compose.lab.yaml down
Remove-Item Env:LAB_DATABASE_URL -ErrorAction SilentlyContinue
```

## Bash

```bash
docker compose -f compose.lab.yaml up -d --wait --wait-timeout 60 || exit 1
export LAB_DATABASE_URL='postgresql://bot_test:synthetic-lab-only@127.0.0.1:55440/valkyria_bot_test'

pnpm lab:run || exit 1
pnpm test:e2e || exit 1
pnpm test:visual || exit 1
```

After those checks, run the viewer in a second terminal at the repository root:

```bash
pnpm lab:serve
```

Open [the local viewer](http://127.0.0.1:4178). Stop the viewer with `Ctrl+C` when done,
then clean up the fixture in the first terminal:

```bash
docker compose -f compose.lab.yaml down
unset LAB_DATABASE_URL
```

## Reports and reruns

`pnpm lab:run` writes `.local/lab/report.json`. `pnpm test:e2e` independently exercises
the scenario engine. `pnpm test:visual` requires the generated report and starts its
own viewer at `127.0.0.1:4178`; stop any manually started viewer first. It must fail if
the database, report or browser prerequisite is missing. Screenshots are under
`.local/lab/screenshots`. They show the implemented simulation viewer, not the official
Discord client or a live integration.

`LAB_PORT` optionally changes the manually started viewer's port. Playwright uses
4178, so unset a custom `LAB_PORT` before browser tests. `LAB_REPORT_FILE` is a viewer
override for deliberately inspecting a different report; leave it unset for current
run verification. Preserve source revision and dirty-worktree metadata when sharing
evidence. Follow the [evidence policy](engineering/evidence.md) before public delivery.

If port 55440 is occupied, stop this fixture, set `LAB_POSTGRES_PORT` to a free loopback
port in the current shell, and change the port in `LAB_DATABASE_URL` to match before
starting again. Do not stop an unrelated service or expose the database on `0.0.0.0`.

If Docker is unavailable, Compose syntax can still be checked without contacting its
daemon:

```text
docker compose -f compose.lab.yaml config --no-interpolate --no-env-resolution --quiet
```

That check does not prove database startup or any scenario. Report database/browser
execution as blocked or not run; do not replace PostgreSQL with an in-memory store or
claim green end-to-end acceptance. After success or failure, the cleanup command is
always `docker compose -f compose.lab.yaml down` for this laboratory project only.
This removes its container and project network; generated reports and screenshots
remain local for inspection. No production Compose file is involved.
