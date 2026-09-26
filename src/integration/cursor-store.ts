import type { Pool } from 'pg';
import type { PublicationCursorStore } from './publication-ingress.js';

export class PostgresPublicationCursor implements PublicationCursorStore {
  constructor(
    private pool: Pool,
    private guildId: string,
    private stream = 'website-v1',
  ) {
    if (!/^[1-9][0-9]{16,19}$/.test(guildId) || !/^[a-z0-9-]{1,64}$/.test(stream))
      throw new Error('invalid_publication_cursor_scope');
  }
  async read(): Promise<string> {
    const result = await this.pool.query<{ cursor: string }>(
      'SELECT cursor_value::text AS cursor FROM publication_cursors WHERE guild_id=$1 AND stream=$2',
      [this.guildId, this.stream],
    );
    return result.rows[0]?.cursor ?? '0';
  }
  async advance(expected: string, next: string): Promise<boolean> {
    if (
      ![expected, next].every((value) => /^(0|[1-9][0-9]{0,29})$/.test(value)) ||
      BigInt(next) < BigInt(expected)
    )
      throw new Error('invalid_publication_cursor');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO publication_cursors(guild_id,stream) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [this.guildId, this.stream],
      );
      const result = await client.query(
        'UPDATE publication_cursors SET cursor_value=$4::numeric,updated_at=now() WHERE guild_id=$1 AND stream=$2 AND cursor_value=$3::numeric',
        [this.guildId, this.stream, expected, next],
      );
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
