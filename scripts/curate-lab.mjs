import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

try {
  assert.equal(process.argv.length, 2);
  const manifest = JSON.parse(await readFile('.local/lab/captures.json', 'utf8'));
  const report = await readFile('.local/lab/report.json');
  assert.equal(manifest.evidenceKind, 'simulated-discord');
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.viewerDirty, false);
  assert.equal(manifest.viewerRevision, manifest.sourceRevision);
  assert.equal(createHash('sha256').update(report).digest('hex'), manifest.reportSha256);
  const captures = [];
  for (const capture of manifest.captures) {
    assert.match(capture.file, /^[a-z0-9-]+\.png$/);
    const image = await readFile(`.local/lab/screenshots/${capture.file}`);
    assert.equal(createHash('sha256').update(image).digest('hex'), capture.sha256);
    captures.push({ file: capture.file, image });
  }
  await mkdir('docs/evidence', { recursive: true });
  for (const capture of captures) await writeFile(`docs/evidence/${capture.file}`, capture.image);
  await writeFile('docs/evidence/report.json', report);
  await writeFile('docs/evidence/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    'Copied original simulation captures and report. Review captions and run pnpm check:evidence before staging.',
  );
} catch {
  console.error(
    'Evidence curation failed. Generate the lab report and browser captures from the same clean commit; inspect the original screenshots before publishing.',
  );
  process.exitCode = 1;
}
