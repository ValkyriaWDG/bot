import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Interaction } from 'discord.js';
import type { BotConfig, Capability } from '../../src/contracts.js';
import { portFor } from '../../src/discord/port.js';
import { handleInteraction } from '../../src/discord/handler.js';
import { DiscordMembershipProvider } from '../../src/discord/membership.js';
import { OperationsService } from '../../src/operations.js';
import { PostgresStore } from '../../src/persistence/store.js';
import { migrate } from '../../src/persistence/migrations.js';
import { RoleSyncService } from '../../src/rolesync/service.js';
import { signEvent } from '../../src/rolesync/signing.js';
import { WardogsClient } from '../../src/wardogs/client.js';
import type { LabReport, LabScenario } from './report.js';
import { apiMessage, createFixtures, IDS, GAME_TOKEN, SIGNING_SECRET } from './fixtures.js';

/** Reject production targets before allocating either a DB pool or a fixture listener. */
export function validateLabDatabase(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('LAB_DATABASE_TARGET_REFUSED');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  const explicitCi = process.env.CI === 'true' && process.env.LAB_ALLOW_NON_LOOPBACK === 'true';
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !/^\/valkyria_bot_(?:test|lab)$/.test(url.pathname) ||
    (!loopback && !explicitCi)
  )
    throw new Error('LAB_DATABASE_TARGET_REFUSED');
}

export async function runLab(databaseUrl: string): Promise<LabReport> {
  validateLabDatabase(databaseUrl);
  const schema = `lab_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
    max: 8,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  let fixtures: Awaited<ReturnType<typeof createFixtures>> | undefined;
  let created = false;
  const report: LabReport = {
    schemaVersion: 1,
    evidenceKind: 'simulated-discord',
    generatedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    environment: {
      database: 'Real dedicated PostgreSQL; isolated random schema, removed after run',
      discord:
        'Real discord.js interactions and REST serialization; loopback Discord API fixture, no Gateway/login',
      wardogs: 'Production WardogsClient with actual loopback HTTP requests; synthetic game server',
      website:
        'Loopback HMAC receiver fixture with process-local replay state; not the production website receiver',
    },
    scenarios: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await migrate(pool);
    const f = (fixtures = await createFixtures());
    const capabilities: Capability[] = [
      'server.status',
      'server.players',
      'server.broadcast',
      'server.moderate',
      'server.control',
    ];
    const config: BotConfig = {
      guildId: IDS.guild,
      applicationId: IDS.application,
      defaultLocale: 'cs',
      websiteUrl: 'https://valkyriawdg.cz',
      servers: [
        {
          id: 'primary',
          label: 'SYNTHETIC Valkyria Wardogs',
          baseUrl: f.gameUrl,
          tokenEnv: 'LAB_GAME_TOKEN',
          grants: Object.fromEntries(capabilities.map((key) => [key, [IDS.role]])),
        },
      ],
      roleSync: {
        enabled: false,
        url: f.websiteUrl,
        keyId: 'lab',
        secretEnv: 'LAB_SIGNING_SECRET',
        reconcileSeconds: 60,
      },
    };
    const store = new PostgresStore(pool, IDS.guild);
    const members = new DiscordMembershipProvider(f.client.rest, IDS.guild);
    const game = new WardogsClient({
      baseUrl: f.gameUrl,
      token: GAME_TOKEN,
      allowInsecureLoopback: true,
      timeoutMs: 1000,
    });
    const operations = new OperationsService(
      config,
      members,
      store,
      new Map([['primary', game]]),
      true,
    );
    const sync = new RoleSyncService(
      {
        guildId: IDS.guild,
        url: f.websiteUrl,
        keyId: 'lab',
        secret: SIGNING_SECRET,
        enabled: true,
      },
      store,
      members,
      { allowLoopbackHttp: true },
    );
    let current: LabScenario;
    const check = (label: string, passed: boolean, details: string) => {
      current.checks.push({ label, passed, details });
    };
    const writes = () => f.game.filter((request) => request.method !== 'GET');
    const state = async (id: string) => (await store.getIntent(id))?.state;
    const scalar = async (sql: string, values: unknown[] = []) =>
      Number((await pool.query<{ value: string }>(sql, values)).rows[0]?.value ?? 0);
    async function deliver(expected: number) {
      // PostgreSQL has sub-millisecond timestamps; poll the real scheduler.
      for (let attempt = 0; attempt < 20; attempt++) {
        await sync.tick();
        if (
          (await scalar(
            "SELECT count(*)::text AS value FROM role_outbox WHERE status='delivered'",
          )) === expected
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('LAB_DELIVERY_TIMEOUT');
    }
    async function scenario(
      id: string,
      title: string,
      description: string,
      work: () => Promise<void>,
    ) {
      current = {
        id,
        title,
        description,
        status: 'passed',
        checks: [],
        messages: [],
        observations: {},
      };
      report.scenarios.push(current);
      try {
        await work();
      } catch (error) {
        check(
          'Scenario completed without an unexpected error',
          false,
          error instanceof Error && /^LAB_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'Unexpected lab boundary error; no raw dependency error is published.',
        );
      } finally {
        f.roles.set(IDS.member, [IDS.role]);
        f.setMembershipStatus(200);
        f.setGameMode('normal');
        f.setRejectAcknowledgement(false);
        f.setRejectCleanup(false);
        f.setRejectReply(false);
        config.roleSync.enabled = false;
        current.status =
          current.checks.length > 0 && current.checks.every((item) => item.passed)
            ? 'passed'
            : 'failed';
      }
    }
    async function call(
      interaction: Interaction,
      command?: string,
      expectedDelivery: 'delivered' | 'failed' = 'delivered',
    ) {
      const port = portFor(interaction);
      if (!port) throw new Error('LAB_PORT_UNAVAILABLE');
      const locale =
        port.input.kind === 'command'
          ? port.input.options.language === 'en'
            ? 'en'
            : 'cs'
          : port.input.customId.endsWith(':en')
            ? 'en'
            : 'cs';
      current.messages.push({
        speaker: 'member',
        displayName: 'Synthetic member',
        content:
          command ??
          (interaction.isChatInputCommand()
            ? interaction.toString()
            : 'Select confirmation control'),
        command:
          command ??
          (interaction.isChatInputCommand()
            ? interaction.toString()
            : 'Select confirmation control'),
        locale,
      });
      const begin = f.discord.length;
      let failed = false;
      try {
        await handleInteraction(port, {
          config,
          operations,
          onAccountRefresh: async (userId) => {
            if (!(await sync.refresh(userId))) throw new Error('LAB_OBSERVATION_SUPERSEDED');
          },
        });
      } catch {
        failed = true;
      }
      check(
        'Discord delivery matches the scenario expectation',
        failed === (expectedDelivery === 'failed'),
        expectedDelivery === 'delivered'
          ? 'The actual interaction handler must finish its final Discord REST reply successfully.'
          : 'This named failure scenario deliberately rejects Discord delivery; no successful reply is claimed.',
      );
      const wire = f.discord.slice(begin).filter((item) => item.path.includes(interaction.token));
      const acknowledgement = wire.find((item) => item.path.includes('/interactions/'));
      check(
        'Discord acknowledgement requests ephemeral delivery',
        (acknowledgement?.body.data as { flags?: number } | undefined)?.flags === 64 &&
          acknowledgement?.body.type === 5,
        'Observed serialized Discord callback type 5 with flags 64.',
      );
      const reply = wire.findLast((item) => item.path.endsWith('/messages/@original'))?.body;
      if (reply && !failed) {
        check(
          'Discord response disables mentions',
          JSON.stringify((reply.allowed_mentions as { parse?: unknown } | undefined)?.parse) ===
            '[]',
          'Actual Discord REST message payload has allowed_mentions.parse=[].',
        );
        const rows = Array.isArray(reply.components)
          ? (reply.components as { components: { label?: string; custom_id?: string }[] }[])
          : [];
        current.messages.push({
          speaker: 'bot',
          displayName: 'Valkyria LAB',
          content: String(reply.content ?? ''),
          locale,
          buttons: rows.flatMap((row) => row.components.map((button) => button.label ?? '')),
        });
      } else
        current.messages.push({
          speaker: 'system',
          displayName: 'Laboratory',
          content:
            'The simulated Discord delivery failed. Inspect the recorded database/HTTP observations; no successful user reply is claimed.',
          locale,
        });
      return {
        reply,
        failed,
        source: apiMessage(
          String(reply?.content ?? ''),
          Array.isArray(reply?.components) ? reply.components : [],
        ),
      };
    }
    async function prepare(
      action = 'restart',
      options: Record<string, string> = {},
      locale: 'cs' | 'en' = 'cs',
    ) {
      const before = writes().length;
      const result = await call(
        f.command('admin', action, { server: 'primary', language: locale, ...options }),
      );
      const components = result.reply?.components as
        { components: { custom_id?: string }[] }[] | undefined;
      const confirm = components?.[0]?.components[0]?.custom_id,
        cancel = components?.[0]?.components[1]?.custom_id;
      if (!confirm || !cancel) throw new Error('LAB_CONFIRMATION_NOT_CREATED');
      const id = confirm.split(':')[1]!;
      check(
        'Preview is durable and sends no game write',
        (await state(id)) === 'pending' && writes().length === before,
        'PostgreSQL contains a pending confirmation; only confirmation may dispatch.',
      );
      return { ...result, id, confirm, cancel };
    }
    for (const locale of ['cs', 'en'] as const)
      await scenario(
        `help-${locale}`,
        locale === 'cs' ? 'Česká nápověda' : 'English help',
        'A real discord.js command is serialized into an ephemeral localized response.',
        async () => {
          const result = await call(f.command('help', undefined, { language: locale }));
          check(
            'Selected language appears in actual reply',
            String(result.reply?.content).includes(
              locale === 'cs' ? 'Nápověda Valkyria' : 'Valkyria help',
            ),
            `Explicit ${locale} command option controls the response.`,
          );
        },
      );
    await scenario(
      'status',
      'Private server status',
      'Fresh Discord REST membership authorizes a real HTTP status read.',
      async () => {
        const result = await call(
          f.command('server', 'status', { server: 'primary', language: 'en' }),
        );
        check(
          'Game status traverses the real HTTP adapter',
          f.game.some((item) => item.path === '/v1/status') &&
            String(result.reply?.content).includes('2/100'),
          'Loopback game returned two synthetic players on Europe.',
        );
        check(
          'Upstream mentions are neutralized',
          !String(result.reply?.content).includes('@everyone'),
          'Hostile synthetic server name does not emit a usable mention.',
        );
      },
    );
    await scenario(
      'players',
      'Private player list',
      'Only display names are rendered; platform IDs stay out of the member list.',
      async () => {
        const result = await call(f.command('server', 'players', { server: 'primary' }));
        check(
          'Real player response is rendered safely',
          String(result.reply?.content).includes('Synthetic Alpha') &&
            !String(result.reply?.content).includes(IDS.steam) &&
            !String(result.reply?.content).includes('@everyone'),
          'Two synthetic names are shown without Steam identifiers or active mentions.',
        );
      },
    );
    const actions = [
      {
        action: 'broadcast',
        options: { message: 'Synthetic exercise starts now' },
        method: 'POST',
        path: '/v1/broadcast',
        body: { message: 'Synthetic exercise starts now' },
      },
      {
        action: 'kick',
        options: { steam_id: IDS.steam, reason: 'Synthetic test only' },
        method: 'POST',
        path: `/v1/players/${IDS.steam}/kick`,
        body: { reason: 'Synthetic test only' },
      },
      {
        action: 'ban',
        options: { steam_id: IDS.steam, reason: 'Synthetic test only' },
        method: 'POST',
        path: '/v1/bans',
        body: { steamId: IDS.steam, reason: 'Synthetic test only' },
      },
      {
        action: 'unban',
        options: { steam_id: IDS.steam },
        method: 'DELETE',
        path: `/v1/bans/${IDS.steam}`,
        body: {},
      },
      {
        action: 'map',
        options: { map: 'Europe' },
        method: 'POST',
        path: '/v1/match/map',
        body: { map: 'Europe' },
      },
      { action: 'restart', options: {}, method: 'POST', path: '/v1/match/restart', body: {} },
    ];
    for (const action of actions)
      await scenario(
        `${action.action}-confirm`,
        `Confirmed ${action.action}`,
        'Saved confirmation, fresh authorization, atomic PostgreSQL claim and observed provider request.',
        async () => {
          const before = writes().length;
          const pending = await prepare(action.action, action.options as Record<string, string>);
          const result = await call(f.button(pending.confirm, pending.source), 'Potvrdit zásah');
          const sent = writes().slice(before);
          check(
            'Exactly one expected request reaches the game fixture',
            sent.length === 1 &&
              sent[0]?.method === action.method &&
              sent[0]?.path === action.path &&
              JSON.stringify(sent[0]?.body) === JSON.stringify(action.body),
            `${action.method} ${action.path}; request JSON matches the saved action.`,
          );
          check(
            'Accepted result and audit are durable',
            (await state(pending.id)) === 'succeeded' &&
              (await scalar(
                "SELECT count(*)::text AS value FROM audit_events WHERE intent_id=$1 AND code='dispatching'",
                [pending.id],
              )) === 1,
            'One dispatching audit row and a succeeded intent; this means provider acceptance, not independently verified game effect.',
          );
          check(
            'Reply asks the operator to verify the effect',
            String(result.reply?.content).includes('Ověřte jeho výsledek'),
            'Actual Czech response reports acceptance and follow-up verification.',
          );
          current.observations = {
            method: action.method,
            path: action.path,
            requests: sent.length,
            state: await state(pending.id),
          };
        },
      );
    await scenario(
      'cancel-expiry',
      'Cancellation and database expiry',
      'Cancelled and expired confirmations cannot dispatch.',
      async () => {
        const before = writes().length;
        const cancelled = await prepare();
        await call(f.button(cancelled.cancel, cancelled.source), 'Zrušit');
        const expired = await prepare();
        await pool.query(
          "UPDATE action_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [expired.id],
        );
        await call(f.button(expired.confirm, expired.source), 'Confirm expired request');
        check(
          'Cancel is persisted and expired request stays undispatched',
          (await state(cancelled.id)) === 'cancelled' && writes().length === before,
          'Expiry uses the real PostgreSQL expires_at value, not a fabricated application-only clock.',
        );
      },
    );
    await scenario(
      'authorization-denied',
      'Actor, guild, role and REST denial',
      'A copied confirmation and unverified membership cannot grant control.',
      async () => {
        const pending = await prepare(),
          before = writes().length;
        const outsider = await call(
          f.button(pending.confirm, pending.source, IDS.outsider),
          'Another member tries this confirmation',
        );
        const wrongGuild = await call(
          f.button(pending.confirm, pending.source, IDS.member, IDS.outsider),
          'Confirmation from another guild',
        );
        f.roles.set(IDS.member, []);
        const denied = await call(f.command('admin', 'restart', { server: 'primary' }));
        f.setMembershipStatus(403);
        const unavailable = await call(f.command('server', 'status', { server: 'primary' }));
        check(
          'Every authorization failure denies game dispatch',
          writes().length === before &&
            !outsider.failed &&
            !wrongGuild.failed &&
            String(denied.reply?.content).includes('nemáte oprávnění') &&
            String(unavailable.reply?.content).includes('nelze ověřit'),
          'Four denials traverse real Discord REST/handler boundaries; no cached grant is substituted.',
        );
        check(
          'A REST access failure is not a fabricated departure',
          (await scalar('SELECT count(*)::text AS value FROM memberships')) === 0,
          'Unknown REST membership does not create a left snapshot.',
        );
      },
    );
    await scenario(
      'role-revoked',
      'Role revoked before confirmation',
      'The member loses the granted role after preview and before confirming.',
      async () => {
        const pending = await prepare(),
          before = writes().length;
        f.roles.set(IDS.member, []);
        members.invalidate(IDS.member);
        const result = await call(f.button(pending.confirm, pending.source), 'Potvrdit zásah');
        check(
          'Fresh member REST prevents the write',
          writes().length === before && String(result.reply?.content).includes('nemáte oprávnění'),
          'The production provider fetched current empty roles; the earlier preview did not retain authorization.',
        );
        current.observations = {
          gameWrites: writes().length - before,
          state: await state(pending.id),
          membership: 'fresh REST without granted role',
        };
      },
    );
    await scenario(
      'double-confirm',
      'Concurrent confirmation clicks',
      'Two real Discord button interactions race through PostgreSQL to the game HTTP fixture.',
      async () => {
        const pending = await prepare(),
          before = writes().length;
        await Promise.all([
          call(f.button(pending.confirm, pending.source), 'Confirm click 1'),
          call(f.button(pending.confirm, pending.source), 'Confirm click 2'),
        ]);
        check(
          'The race produces one actual game write and one claim audit',
          writes().length === before + 1 &&
            (await scalar(
              "SELECT count(*)::text AS value FROM audit_events WHERE intent_id=$1 AND code='dispatching'",
              [pending.id],
            )) === 1 &&
            (await state(pending.id)) === 'succeeded',
          'Counted actual loopback HTTP writes and real committed PostgreSQL audit rows.',
        );
        current.observations = {
          concurrentClicks: 2,
          gameWrites: writes().length - before,
          dispatchAuditRows: await scalar(
            "SELECT count(*)::text AS value FROM audit_events WHERE intent_id=$1 AND code='dispatching'",
            [pending.id],
          ),
        };
      },
    );
    await scenario(
      'unknown-outcome',
      'Lost response and HTTP 202',
      'An accepted request with no conclusive result stays unknown and is never retried automatically.',
      async () => {
        const outcomes: { mode: string; state: string | undefined; observedWrites: number }[] = [];
        for (const mode of ['timeout', 'accepted'] as const) {
          const pending = await prepare('restart', {}, 'en'),
            before = writes().length;
          f.setGameMode(mode);
          const result = await call(f.button(pending.confirm, pending.source), `Confirm (${mode})`);
          await call(
            f.button(pending.confirm, pending.source),
            'Try the consumed confirmation again',
          );
          check(
            `${mode}: unknown is persisted without retry`,
            (await state(pending.id)) === 'unknown' &&
              writes().length === before + 1 &&
              String(result.reply?.content).includes('outcome is unknown'),
            'Observed exactly one POST; the replay cannot dispatch an unknown operation.',
          );
          outcomes.push({
            mode,
            state: await state(pending.id),
            observedWrites: writes().length - before,
          });
          f.setGameMode('normal');
        }
        current.observations = {
          outcomes,
          additionalWrites: outcomes.reduce(
            (sum, outcome) => sum + Math.max(0, outcome.observedWrites - 1),
            0,
          ),
        };
      },
    );
    await scenario(
      'read-error',
      'Provider read error',
      'A failed status request gives a safe private reply without leaking the upstream body.',
      async () => {
        f.setGameMode('read-error');
        const before = writes().length;
        const result = await call(
          f.command('server', 'status', { server: 'primary', language: 'en' }),
        );
        check(
          'Read failure is safe and cannot mutate',
          !String(result.reply?.content).includes(GAME_TOKEN) &&
            String(result.reply?.content).includes('could not be completed') &&
            writes().length === before,
          'HTTP 503 body is not exposed to Discord.',
        );
      },
    );
    await scenario(
      'audit-failure',
      'Audit insert fails before dispatch',
      'A real PostgreSQL trigger rejects the dispatch audit; the transaction rolls back.',
      async () => {
        const pending = await prepare(),
          before = writes().length;
        await pool.query(
          "CREATE FUNCTION lab_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER lab_reject_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION lab_reject_audit()",
        );
        try {
          await call(
            f.button(pending.confirm, pending.source),
            'Confirm while audit storage rejects writes',
          );
        } finally {
          await pool.query(
            'DROP TRIGGER lab_reject_audit ON audit_events; DROP FUNCTION lab_reject_audit()',
          );
        }
        check(
          'Failed audit rolls back claim and prevents provider write',
          (await state(pending.id)) === 'pending' && writes().length === before,
          'No mocked store exception: PostgreSQL rejected the actual audit INSERT inside the claim transaction.',
        );
      },
    );
    await scenario(
      'role-sync',
      'Account, signed delivery and departure',
      'The account response queues an actual outbox event; a loopback consumer authenticates delivery and rejects replay.',
      async () => {
        config.roleSync.enabled = true;
        const result = await call(f.command('account', undefined, { language: 'en' }));
        check(
          'Account reports durable pending synchronization',
          String(result.reply?.content).includes('synchronization is pending') &&
            (await scalar('SELECT count(*)::text AS value FROM role_outbox')) === 1,
          'A fresh REST observation and its outbox row committed before the pending response.',
        );
        await deliver(1);
        const present = f.receiver.state,
          envelope = f.receiver.lastEnvelope;
        check(
          'HMAC authenticated present event is delivered',
          present?.membershipState === 'present' &&
            (await scalar(
              "SELECT count(*)::text AS value FROM role_outbox WHERE status='delivered'",
            )) === 1,
          'Actual signed HTTP request acknowledged only after fixture consumer accepted it.',
        );
        await sync.depart(IDS.member);
        await deliver(2);
        if (!present || !envelope) throw new Error('LAB_SIGNED_DELIVERY_MISSING');
        const replay = await fetch(f.websiteUrl, {
          method: 'POST',
          headers: envelope.headers,
          body: envelope.body,
          signal: AbortSignal.timeout(1500),
        });
        await replay.arrayBuffer();
        const stale = signEvent(
          { ...present, eventId: randomUUID() },
          { url: f.websiteUrl, keyId: 'lab', secret: SIGNING_SECRET },
        );
        const old = await fetch(f.websiteUrl, {
          method: 'POST',
          ...stale,
          signal: AbortSignal.timeout(1500),
        });
        await old.arrayBuffer();
        check(
          'Replay and stale present cannot resurrect departure',
          replay.status === 409 &&
            old.status === 409 &&
            f.receiver.state?.membershipState === 'left' &&
            f.receiver.state.roleIds.length === 0 &&
            (await scalar(
              "SELECT count(*)::text AS value FROM role_outbox WHERE status='delivered'",
            )) === 2,
          'Fixture replay/order state is process-local; this does not certify the independent production website receiver.',
        );
        current.observations = {
          deliveredEvents: await scalar(
            "SELECT count(*)::text AS value FROM role_outbox WHERE status='delivered'",
          ),
          replayHttpStatus: replay.status,
          staleHttpStatus: old.status,
          finalMembership: f.receiver.state?.membershipState,
          duplicateRejected: f.receiver.duplicates,
          staleRejected: f.receiver.stale,
          websitePermissionsGranted: false,
        };
      },
    );
    await scenario(
      'restart-recovery',
      'Interrupted execution recovery',
      'An executing intent from a previous runtime is recovered as unknown, never replayed.',
      async () => {
        const pending = await prepare(),
          before = writes().length;
        check(
          'Real store claims the interrupted intent',
          await store.claimIntent(
            pending.id,
            { guildId: IDS.guild, userId: IDS.member },
            new Date(),
          ),
          'Simulated crash point is after the durable claim and before any game request.',
        );
        const recovered = await new PostgresStore(pool, IDS.guild).recoverInterrupted();
        await call(f.button(pending.confirm, pending.source), 'Confirm after recovery');
        check(
          'Recovery remains unknown with no replay',
          recovered === 1 && (await state(pending.id)) === 'unknown' && writes().length === before,
          'New store instance reads persisted state and records process_interrupted audit. No process/Gateway restart is claimed.',
        );
      },
    );
    await scenario(
      'defer-failure',
      'Discord acknowledgement rejected',
      'Rejected private acknowledgement prevents all downstream authorization and control work.',
      async () => {
        const before = {
          discord: f.discord.length,
          game: f.game.length,
          intents: await scalar('SELECT count(*)::text AS value FROM action_intents'),
        };
        f.setRejectAcknowledgement(true);
        const result = await call(
          f.command('admin', 'restart', { server: 'primary' }),
          undefined,
          'failed',
        );
        check(
          'No downstream IO follows rejected defer',
          result.failed &&
            f.discord.slice(before.discord).every((item) => item.path.includes('/interactions/')) &&
            f.game.length === before.game &&
            (await scalar('SELECT count(*)::text AS value FROM action_intents')) === before.intents,
          'Only the rejected Discord callback was sent; there was no membership REST call, intent insertion or game request.',
        );
      },
    );
    await scenario(
      'reply-cleanup-failure',
      'Discord reply and cleanup failures',
      'Loss of a user-facing acknowledgement after dispatch must not erase durable execution state.',
      async () => {
        for (const mode of ['cleanup', 'reply'] as const) {
          const pending = await prepare(),
            before = writes().length;
          if (mode === 'cleanup') f.setRejectCleanup(true);
          else f.setRejectReply(true);
          const result = await call(
            f.button(pending.confirm, pending.source),
            `Confirm with simulated ${mode} failure`,
            mode === 'reply' ? 'failed' : 'delivered',
          );
          f.setRejectCleanup(false);
          f.setRejectReply(false);
          await call(f.button(pending.confirm, pending.source), 'Click the original control again');
          check(
            `${mode}: durable result survives and replay is denied`,
            (await state(pending.id)) === 'succeeded' &&
              writes().length === before + 1 &&
              (mode === 'cleanup' ? !result.failed : result.failed),
            'PostgreSQL and observed HTTP prove one accepted request even when Discord cannot update the message.',
          );
        }
      },
    );
    report.summary.total = report.scenarios.length;
    report.summary.passed = report.scenarios.filter((item) => item.status === 'passed').length;
    report.summary.failed = report.summary.total - report.summary.passed;
    return report;
  } finally {
    try {
      await fixtures?.close();
    } finally {
      await pool.end();
      try {
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }
}
