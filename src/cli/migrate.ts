import { Pool } from 'pg';
import { requiredSecret } from '../config.js';
import { BotError } from '../errors.js';
import { migrate } from '../persistence/migrations.js';

async function main() {
  if (process.argv.length > 2) throw new BotError('invalid_migration_arguments');
  const pool = new Pool({
    connectionString: requiredSecret(process.env, 'DATABASE_URL'),
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  try {
    await migrate(pool);
    console.log(JSON.stringify({ event: 'migrations_applied' }));
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'migration_failed',
      code: error instanceof BotError ? error.code : 'check_database_and_migration_history',
    }),
  );
  process.exitCode = 1;
});
