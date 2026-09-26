import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each(['--dry-run', '--help', '--apply'])(
  'rejects migration argument %s before opening a database',
  (argument) => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
    import pg from 'pg';
    import net from 'node:net';
    let connections = 0;
    net.Socket.prototype.connect = function() { throw new Error('NETWORK_DISABLED_IN_TEST'); };
    pg.Pool.prototype.connect = async function() { connections++; throw new Error('DATABASE_DISABLED_IN_TEST'); };
    process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/fixture';
    process.argv = ['node', 'migrate', ${JSON.stringify(argument)}];
    process.on('beforeExit', () => console.log(JSON.stringify({ connections })));
    await import('./src/cli/migrate.ts');
  `,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ connections: 0 });
    expect(result.stderr).toContain('invalid_migration_arguments');
  },
);
