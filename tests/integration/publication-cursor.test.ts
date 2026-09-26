import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PostgresPublicationCursor } from '../../src/integration/cursor-store.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
const schema = `cursor_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const guild = '111111111111111111';
beforeAll(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile('migrations/004_publication_cursor.sql', 'utf8'));
});
afterAll(async () => {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});

it('compares and persists exact cursor values across instances and isolates guilds', async () => {
  const first = new PostgresPublicationCursor(pool, guild);
  expect(await first.read()).toBe('0');
  const claimed = await Promise.all([
    first.advance('0', '9007199254740993'),
    first.advance('0', '9007199254740994'),
  ]);
  expect(claimed.filter(Boolean)).toHaveLength(1);
  const saved = await new PostgresPublicationCursor(pool, guild).read();
  expect(['9007199254740993', '9007199254740994']).toContain(saved);
  expect(await first.advance('0', '9007199254740995')).toBe(false);
  await expect(first.advance(saved, '1')).rejects.toThrow('invalid_publication_cursor');
  expect(await new PostgresPublicationCursor(pool, '222222222222222222').read()).toBe('0');
});
