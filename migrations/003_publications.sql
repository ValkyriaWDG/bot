CREATE TABLE publication_receipts (
  guild_id text NOT NULL,
  event_id uuid NOT NULL,
  digest text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,event_id)
);
CREATE TABLE publication_projections (
  guild_id text NOT NULL,
  entity_id text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('cs','en')),
  revision numeric(30,0) NOT NULL CHECK (revision > 0),
  digest text NOT NULL,
  projection jsonb NOT NULL,
  last_emitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,entity_id,locale)
);
CREATE TABLE publication_bindings (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  entity_id text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('cs','en')),
  purpose text NOT NULL CHECK (purpose IN ('fixture','result','status')),
  channel_id text NOT NULL,
  desired_revision numeric(30,0) NOT NULL CHECK (desired_revision > 0),
  delivered_revision numeric(30,0),
  message_id text,
  state text NOT NULL CHECK (state IN ('pending','leased','sending','delivered','suppressed','unknown','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_code text NOT NULL DEFAULT 'queued',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id,entity_id,locale,purpose,channel_id),
  FOREIGN KEY (guild_id,entity_id,locale) REFERENCES publication_projections(guild_id,entity_id,locale)
);
CREATE INDEX publication_queue ON publication_bindings(guild_id,state,next_attempt_at);
CREATE TABLE publication_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  binding_id uuid NOT NULL REFERENCES publication_bindings(id),
  code text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
