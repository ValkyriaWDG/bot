-- Additive bot-owned event-feed cursor; no website tables are accessed.
CREATE TABLE publication_cursors (
  guild_id text NOT NULL,
  stream text NOT NULL,
  cursor_value numeric(30,0) NOT NULL DEFAULT 0 CHECK (cursor_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id,stream)
);
