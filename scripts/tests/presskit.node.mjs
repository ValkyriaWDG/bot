import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePresskit } from '../check-presskit.mjs';

const base = 'assets/presskit/wardogs-january-2026';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1cAAAAASUVORK5CYII=',
  'base64',
);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><defs><style>.cls-1 { fill: #fff; stroke-width: 0px; }</style></defs><g><path class="cls-1" d="M0 0 L10 20"/><rect x="0" y="0" width="1" height="2"/></g></svg>';

function entry(id, content, format, width, height) {
  return {
    id,
    path: `${base}/${id}.${format === 'SVG' ? 'svg' : 'png'}`,
    originalPath: `Originals/${id}`,
    source: 'Synthetic test fixture.',
    usage: 'test-fixture',
    recommendedUse: 'Validator test only.',
    rights: 'Synthetic fixture.',
    transformations: [],
    alt: { cs: 'Testovací obrázek.', en: 'Test image.' },
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    width,
    height,
    format,
  };
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'valkyria-presskit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, base);
  mkdirSync(directory, { recursive: true });
  const catalog = {
    schemaVersion: 1,
    id: 'wardogs-january-2026',
    recordedAt: '2026-09-26',
    source: {
      name: 'Synthetic fixture',
      kind: 'owner-supplied-presskit',
      officialPage: 'https://www.wardogs.com/press-kit',
      publisherPressHub: 'https://www.team17.com/press-and-creator-hub',
      officialDownload: 'https://www.wardogs.com/test.zip',
      archiveIdentityVerified: false,
      includedLicenseFile: false,
      notes: 'Fixture only.',
    },
    scope: {
      status: 'curated-input-not-integrated',
      liveDiscordTested: false,
      maxFileBytes: 5242880,
      rules: ['Synthetic fixture only.'],
    },
    assets: [entry('pixel', png, 'PNG', 1, 1), entry('mark', svg, 'SVG', 10, 20)],
  };
  writeFileSync(path.join(root, catalog.assets[0].path), png);
  writeFileSync(path.join(root, catalog.assets[1].path), svg);
  const save = () => writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(catalog));
  save();
  return { root, directory, catalog, save };
}

function rejected(root, pattern) {
  const result = validatePresskit(root);
  assert.ok(
    result.errors.some((message) => pattern.test(message)),
    result.errors.join('\n'),
  );
  assert.deepEqual(result.paths, [], 'invalid catalogs never grant a size exception');
}

test('accepts real tiny PNG and static SVG files and returns only their relative paths', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.directory, 'README.md'), '# Synthetic test fixture\n');
  assert.deepEqual(validatePresskit(f.root), {
    errors: [],
    paths: [`${base}/pixel.png`, `${base}/mark.svg`],
  });
});

test('rejects same-size corruption without relying on declared byte count', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.directory, 'mark.svg'), svg.replace('#fff', '#ffe'));
  rejected(f.root, /sha256/i);
});

test('rejects traversal and absolute paths before reading outside the catalog', (t) => {
  const f = fixture(t);
  for (const unsafe of [
    `${base}/../../../outside.png`,
    '/tmp/outside.png',
    'C:\\outside.png',
    `${base}/%2e%2e/outside.png`,
  ]) {
    f.catalog.assets[0].path = unsafe;
    f.save();
    rejected(f.root, /path/i);
  }
});

test('rejects duplicate IDs or paths instead of accepting an ambiguous allowlist', (t) => {
  const f = fixture(t);
  f.catalog.assets.push({ ...f.catalog.assets[0] });
  f.save();
  rejected(f.root, /duplicate/i);
});

test('rejects active SVG content even with its correct recomputed hash', (t) => {
  const f = fixture(t);
  const fragments = [
    '<script>alert(1)</script>',
    '<image href="https://example.com/image.png"/>',
    '<path onload="alert(1)" d="M0 0"/>',
    '<style>.cls-1 { fill: url(https://example.com/image); }</style>',
    '<style>@import "https://example.com/style";</style>',
    '<style>.cls-1 { f\\69ll: red; }</style>',
    '<use href="#shape"/>',
    '<foreignObject/>',
    '<g><path/></svg>',
  ];
  for (const fragment of fragments) {
    const unsafe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20">${fragment}</svg>`;
    f.catalog.assets[1] = entry('mark', unsafe, 'SVG', 10, 20);
    writeFileSync(path.join(f.directory, 'mark.svg'), unsafe);
    f.save();
    rejected(f.root, /svg/i);
  }
});

test('rejects SVG entity and doctype declarations with otherwise matching metadata', (t) => {
  const f = fixture(t);
  const unsafe = '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]>' + svg;
  f.catalog.assets[1] = entry('mark', unsafe, 'SVG', 10, 20);
  writeFileSync(path.join(f.directory, 'mark.svg'), unsafe);
  f.save();
  rejected(f.root, /svg/i);
});

test('rejects missing files and unregistered local binaries', (t) => {
  const f = fixture(t);
  unlinkSync(path.join(f.directory, 'pixel.png'));
  rejected(f.root, /missing|read|ENOENT/i);
  writeFileSync(path.join(f.directory, 'pixel.png'), png);
  writeFileSync(path.join(f.directory, 'unlisted.bin'), Buffer.from([0, 1, 2]));
  rejected(f.root, /unlisted|unregistered/i);
});

test('compares native PNG and SVG dimensions against catalog dimensions', (t) => {
  const f = fixture(t);
  for (const asset of f.catalog.assets) {
    const width = asset.width;
    asset.width = width + 1;
    f.save();
    rejected(f.root, /dimension/i);
    asset.width = width;
  }
});

test('rejects files above 5 MiB even when the catalog increases its own limit', (t) => {
  const f = fixture(t);
  const large = Buffer.alloc(5242881);
  f.catalog.assets[0] = entry('pixel', large, 'PNG', 1, 1);
  writeFileSync(path.join(f.directory, 'pixel.png'), large);
  f.save();
  rejected(f.root, /size|bytes|MiB/i);
  f.catalog.scope.maxFileBytes = 10000000;
  f.save();
  rejected(f.root, /maxFileBytes|size|bytes|MiB/i);
});

test('rejects truncated or disguised native image headers with a matching checksum', (t) => {
  const f = fixture(t);
  const invalid = Buffer.from('not actually a PNG');
  f.catalog.assets[0] = entry('pixel', invalid, 'PNG', 1, 1);
  writeFileSync(path.join(f.directory, 'pixel.png'), invalid);
  f.save();
  rejected(f.root, /PNG|header/i);
});

test('rejects malformed catalogs, missing provenance and invalid numeric metadata without throwing', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.directory, 'catalog.json'), '{broken');
  rejected(f.root, /JSON|catalog/i);
  for (const value of [null, [], { assets: null }, { ...f.catalog, source: null }]) {
    writeFileSync(path.join(f.directory, 'catalog.json'), JSON.stringify(value));
    rejected(f.root, /schema|source|catalog/i);
  }
  delete f.catalog.assets[0].rights;
  f.catalog.assets[1].width = 0;
  f.save();
  rejected(f.root, /rights|width|dimension/i);
});

test('rejects symlinked catalog directories that escape the repository', (t) => {
  const outside = fixture(t);
  const f = fixture(t);
  rmSync(f.directory, { recursive: true });
  try {
    symlinkSync(outside.directory, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Host disallows symlinks');
    throw error;
  }
  rejected(f.root, /symlink/i);
  assert.ok(readFileSync(path.join(outside.directory, 'pixel.png')).equals(png));
});

test('CLI returns a failing exit code for invalid asset integrity', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.directory, 'mark.svg'), svg.replace('#fff', '#ffe'));
  const script = fileURLToPath(new URL('../check-presskit.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, f.root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sha256/i);
});
