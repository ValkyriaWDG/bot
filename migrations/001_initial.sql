CREATE TABLE action_intents (
  id uuid PRIMARY KEY,
  interaction_id text NOT NULL UNIQUE,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  server_id text NOT NULL,
  action jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','executing','succeeded','failed','unknown','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_executing_action_per_server ON action_intents(server_id) WHERE state = 'executing';
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  server_id text,
  action text NOT NULL,
  code text NOT NULL,
  intent_id uuid REFERENCES action_intents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  role_ids jsonb NOT NULL,
  membership_state text NOT NULL CHECK (membership_state IN ('present','left')),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(guild_id,user_id)
);
CREATE SEQUENCE role_sync_sequence AS bigint;
CREATE TABLE role_outbox (
  event_id uuid PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE,
  event jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  last_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_outbox_due ON role_outbox(next_attempt_at,sequence) WHERE status IN ('pending','leased');
