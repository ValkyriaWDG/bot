import { mkdir, writeFile, rename } from 'node:fs/promises';
import { runLab } from '../tests/lab/run.js';

const directory = '.local/lab';
const target = `${directory}/report.json`;
async function save(value: unknown) {
  await writeFile(`${directory}/report.pending.json`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${directory}/report.pending.json`, target);
}
await mkdir(directory, { recursive: true });
const incomplete = {
  schemaVersion: 1,
  evidenceKind: 'simulated-discord',
  generatedAt: new Date().toISOString(),
  executionStatus: 'running',
  scenarios: [],
  summary: { total: 0, passed: 0, failed: 0 },
};
await save(incomplete);
try {
  if (process.argv.length > 2 || !process.env.LAB_DATABASE_URL)
    throw new Error('missing_lab_configuration');
  const report = await runLab(process.env.LAB_DATABASE_URL);
  await save({ ...report, executionStatus: 'completed' });
  console.log(
    JSON.stringify({
      evidence: report.evidenceKind,
      ...report.summary,
      report: target,
      sourceRevision: report.sourceRevision,
      sourceDirty: report.sourceDirty,
    }),
  );
  if (report.summary.failed || report.summary.total === 0) process.exitCode = 1;
} catch {
  await save({ ...incomplete, executionStatus: 'failed' });
  console.error(
    'lab_execution_failed: supply LAB_DATABASE_URL for a disposable loopback test database; inspect prerequisites and scenario tests. No live credentials are required.',
  );
  process.exitCode = 1;
}
