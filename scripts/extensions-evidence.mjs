import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile } from 'node:fs/promises';

const mode = process.argv[2];
if (!['check', 'curate'].includes(mode) || process.argv.length !== 3)
  throw new Error('Use check or curate');
const base = 'docs/evidence/extensions';
const source = mode === 'curate' ? '.local/lab' : base;
const manifestPath = `${source}/${mode === 'curate' ? 'extensions-captures' : 'manifest'}.json`;
const reportPath = `${source}/${mode === 'curate' ? 'extensions-report' : 'report'}.json`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(reportPath);
  const report = JSON.parse(bytes.toString('utf8'));
  assert.equal(manifest.evidenceKind, 'simulated-discord-extensions');
  assert.equal(report.evidenceKind, manifest.evidenceKind);
  assert.equal(report.executionStatus, 'completed');
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.viewerDirty, false);
  assert.equal(report.revision.dirty, false);
  assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(manifest.sourceRevision, manifest.viewerRevision);
  assert.equal(report.revision.sha, manifest.sourceRevision);
  assert.equal(hash(bytes), manifest.reportSha256);
  assert.equal(report.summary.total, report.scenarios.length);
  assert.equal(report.summary.passed, report.scenarios.length);
  assert.equal(report.summary.failed, 0);
  assert.ok(
    report.scenarios.every(
      (s) => s.status === 'passed' && s.checks.length > 0 && s.checks.every((c) => c.passed),
    ),
  );
  assert.ok(manifest.captures.length >= 5);
  assert.equal(new Set(manifest.captures.map((c) => c.file)).size, manifest.captures.length);
  for (const capture of manifest.captures) {
    assert.match(capture.file, /^[a-z0-9-]+\.png$/);
    assert.match(capture.caption, /Synthetic Discord lab.*not Discord/);
    assert.ok(report.scenarios.some((s) => s.id === capture.scenarioId));
    const file = `${source}/${mode === 'curate' ? 'extensions-screenshots/' : ''}${capture.file}`;
    const png = await readFile(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(hash(png), capture.sha256);
    assert.equal(png.readUInt32BE(16), capture.viewport.width);
    assert.ok(png.readUInt32BE(20) >= capture.viewport.height);
  }
  assert.doesNotMatch(
    JSON.stringify({ manifest, report }),
    /test-(?:signup|publication)-secret|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY/,
  );
  if (mode === 'curate') {
    await mkdir(base, { recursive: true });
    await copyFile(reportPath, `${base}/report.json`);
    await copyFile(manifestPath, `${base}/manifest.json`);
    for (const capture of manifest.captures)
      await copyFile(`${source}/extensions-screenshots/${capture.file}`, `${base}/${capture.file}`);
  }
  console.log(
    `Extension evidence ${mode}: ${report.summary.total} passing scenarios, ${manifest.captures.length} captures, dated source ${manifest.sourceRevision}.`,
  );
} catch {
  console.error(
    'Extension evidence is missing, dirty, failed or inconsistent. Regenerate from clean source and inspect before curating.',
  );
  process.exitCode = 1;
}
