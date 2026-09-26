-- Additive only: 001 runtimes can operate unchanged during rollback.
CREATE TABLE management_settings (
  guild_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  apply_error text CHECK (apply_error IS NULL OR apply_error = 'MANAGEMENT_APPLY_FAILED'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE management_replay (
  guild_id text NOT NULL,
  nonce text NOT NULL CHECK (nonce ~ '^[a-f0-9]{32}$'),
  key_id text NOT NULL,
  actor_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, nonce)
);
CREATE INDEX management_replay_expiry ON management_replay(expires_at);
CREATE TABLE management_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL,
  actor_id text NOT NULL,
  key_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('bot.read','bot.configure')),
  code text NOT NULL,
  correlation_id uuid,
  reason text,
  previous_revision bigint,
  desired_revision bigint,
  settings_before jsonb,
  settings_after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
