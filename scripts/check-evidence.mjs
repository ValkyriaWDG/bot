import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

try {
  const base = 'docs/evidence/';
  const manifest = JSON.parse(readFileSync(`${base}manifest.json`, 'utf8'));
  const bytes = readFileSync(`${base}report.json`);
  const report = JSON.parse(bytes.toString('utf8'));
  assert.equal(manifest.evidenceKind, 'simulated-discord');
  assert.equal(report.evidenceKind, 'simulated-discord');
  assert.equal(report.executionStatus, 'completed');
  assert.equal(manifest.sourceDirty, false);
  assert.equal(report.sourceDirty, false);
  assert.equal(manifest.viewerDirty, false);
  assert.equal(manifest.viewerRevision, manifest.sourceRevision);
  assert.match(manifest.sourceRevision, /^[0-9a-f]{40}$/);
  assert.equal(manifest.sourceRevision, report.sourceRevision);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.reportSha256);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.total, report.scenarios.length);
  assert.equal(report.summary.passed, report.scenarios.length);
  assert.ok(
    report.scenarios.every(
      (scenario) =>
        scenario.status === 'passed' &&
        scenario.checks.length > 0 &&
        scenario.checks.every((check) => check.passed),
    ),
  );
  assert.ok(manifest.captures.length >= 6);
  assert.equal(
    new Set(manifest.captures.map((capture) => capture.file)).size,
    manifest.captures.length,
  );
  for (const capture of manifest.captures) {
    assert.match(capture.file, /^[a-z0-9-]+\.png$/);
    assert.match(capture.caption, /Synthetic Discord lab/);
    assert.match(capture.caption, /not Discord/);
    assert.ok(
      report.scenarios.some(
        (scenario) =>
          scenario.id === capture.scenarioId &&
          scenario.status === 'passed' &&
          scenario.checks.every((check) => check.passed),
      ),
    );
    const image = readFileSync(`${base}${capture.file}`);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(image).digest('hex'), capture.sha256);
    assert.equal(image.readUInt32BE(16), capture.viewport.width);
    assert.ok(image.readUInt32BE(20) >= capture.viewport.height);
  }
  const serialized = JSON.stringify({ manifest, report });
  assert.doesNotMatch(
    serialized,
    /fixture-(?:discord-token|rcon-token|signing-secret|interaction-)|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY/,
  );
  console.log(
    `Curated simulation evidence verified: ${manifest.captures.length} captures, ${report.summary.total} scenarios, source ${manifest.sourceRevision}. Dated evidence; current CI captures remain separate.`,
  );
} catch {
  console.error(
    'Curated simulation evidence is missing or inconsistent. Regenerate, inspect and caption the report/screenshots; do not fabricate clean-source proof.',
  );
  process.exitCode = 1;
}
