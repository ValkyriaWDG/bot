import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrate } from '../../src/persistence/migrations.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 1,
});
let directory: string;
beforeAll(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  directory = await mkdtemp(join(tmpdir(), 'valkyria-migrations-'));
});
afterAll(async () => {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  if (directory) {
    if (!resolve(directory).startsWith(join(resolve(tmpdir()), 'valkyria-migrations-')))
      throw new Error('unsafe_fixture_path');
    await rm(directory, { recursive: true, force: true });
  }
});
it('rejects edited and missing applied migrations without applying later files', async () => {
  const original = 'CREATE TABLE sample (id integer PRIMARY KEY);';
  const path = join(directory, '001_sample.sql');
  await writeFile(path, original);
  await migrate(pool, directory);
  await migrate(pool, directory);
  await writeFile(path, `${original}\n-- changed`);
  await expect(migrate(pool, directory)).rejects.toThrow('migration_checksum_mismatch');
  await writeFile(path, original);
  await unlink(path);
  await writeFile(join(directory, '002_later.sql'), 'CREATE TABLE later (id integer);');
  await expect(migrate(pool, directory)).rejects.toThrow('migration_history_missing');
  expect((await pool.query('SELECT name FROM schema_migrations')).rows).toEqual([
    { name: '001_sample.sql' },
  ]);
});
