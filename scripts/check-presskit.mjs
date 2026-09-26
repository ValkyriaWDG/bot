import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const BASE = 'assets/presskit/wardogs-january-2026';
const MAX_BYTES = 5 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const identifier = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function https(value) {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function schema(catalog) {
  requireValue(object(catalog), 'catalog schema must be an object');
  requireValue(catalog.schemaVersion === 1, 'catalog schemaVersion must be 1');
  requireValue(catalog.id === 'wardogs-january-2026', 'catalog id is invalid');
  requireValue(
    typeof catalog.recordedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(catalog.recordedAt) &&
      new Date(catalog.recordedAt).toISOString().slice(0, 10) === catalog.recordedAt,
    'catalog recordedAt must be a valid date',
  );
  requireValue(object(catalog.source), 'catalog source is required');
  for (const field of ['name', 'notes'])
    requireValue(text(catalog.source[field]), `source.${field} is required`);
  requireValue(catalog.source.kind === 'owner-supplied-presskit', 'source.kind is invalid');
  for (const field of ['officialPage', 'publisherPressHub', 'officialDownload'])
    requireValue(https(catalog.source[field]), `source.${field} must be an HTTPS URL`);
  for (const field of ['archiveIdentityVerified', 'includedLicenseFile'])
    requireValue(typeof catalog.source[field] === 'boolean', `source.${field} must be boolean`);
  requireValue(object(catalog.scope), 'catalog scope is required');
  requireValue(catalog.scope.status === 'curated-input-not-integrated', 'scope.status is invalid');
  requireValue(
    typeof catalog.scope.liveDiscordTested === 'boolean',
    'scope.liveDiscordTested must be boolean',
  );
  requireValue(catalog.scope.maxFileBytes === MAX_BYTES, 'scope.maxFileBytes must be 5242880');
  requireValue(
    Array.isArray(catalog.scope.rules) &&
      catalog.scope.rules.length > 0 &&
      catalog.scope.rules.every(text),
    'scope.rules must contain text',
  );
  requireValue(
    Array.isArray(catalog.assets) && catalog.assets.length > 0 && catalog.assets.length <= 100,
    'catalog assets must contain 1 to 100 entries',
  );
}

function assetSchema(asset) {
  requireValue(object(asset), 'asset must be an object');
  requireValue(identifier(asset.id), 'asset id is invalid');
  // This curated catalog is deliberately flat; never normalize an unsafe path into a safe one.
  requireValue(
    typeof asset.path === 'string' &&
      new RegExp(`^${BASE}/[a-z0-9]+(?:-[a-z0-9]+)*\\.(png|jpg|jpeg|svg)$`).test(asset.path),
    'asset path must be a safe file directly inside the presskit directory',
  );
  for (const field of ['originalPath', 'source', 'usage', 'recommendedUse', 'rights'])
    requireValue(text(asset[field]), `asset ${field} is required`);
  requireValue(
    !/^(?:\/|[a-z]:)|\\|(?:^|\/)\.\.(?:\/|$)/i.test(asset.originalPath),
    'asset originalPath must be relative',
  );
  requireValue(
    Array.isArray(asset.transformations) && asset.transformations.every(text),
    'asset transformations must be a text array',
  );
  requireValue(
    object(asset.alt) && text(asset.alt.cs) && text(asset.alt.en),
    'asset alt.cs and alt.en are required',
  );
  requireValue(
    positive(asset.bytes) && asset.bytes <= MAX_BYTES,
    'asset bytes must be positive and at most 5 MiB',
  );
  requireValue(
    typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256),
    'asset sha256 must be lowercase hex',
  );
  requireValue(
    positive(asset.width) && positive(asset.height),
    'asset width and height must be positive integer dimensions',
  );
  requireValue(
    ['PNG', 'JPEG', 'SVG'].includes(asset.format),
    'asset format must be PNG, JPEG or SVG',
  );
  const extension = path.posix.extname(asset.path);
  requireValue(
    { PNG: ['.png'], JPEG: ['.jpg', '.jpeg'], SVG: ['.svg'] }[asset.format].includes(extension),
    'asset format does not match path extension',
  );
}

function safeFile(root, relative, limit) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    requireValue(!stat.isSymbolicLink(), `${relative}: symlink is forbidden`);
  }
  const resolved = realpathSync(current);
  const inside = path.relative(root, resolved);
  requireValue(
    inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside),
    `${relative}: path escapes root`,
  );
  const stat = lstatSync(current);
  requireValue(stat.isFile(), `${relative}: expected a regular readable file`);
  requireValue(
    stat.size > 0 && stat.size <= limit,
    `${relative}: file size exceeds limit or is empty`,
  );
  const bytes = readFileSync(current);
  requireValue(bytes.length === stat.size, `${relative}: file changed while reading`);
  return bytes;
}

function pngDimensions(bytes) {
  requireValue(
    bytes.length >= 45 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'PNG header is invalid',
  );
  let offset = 8;
  let dimensions;
  let imageData = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    requireValue(offset + size + 12 <= bytes.length, 'PNG chunk is truncated');
    if (offset === 8) {
      requireValue(type === 'IHDR' && size === 13, 'PNG IHDR header is invalid');
      dimensions = [bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)];
    } else requireValue(type !== 'IHDR', 'PNG has duplicate IHDR');
    if (type === 'IDAT') imageData = true;
    offset += size + 12;
    if (type === 'IEND') {
      requireValue(size === 0 && offset === bytes.length, 'PNG IEND is invalid');
      ended = true;
      break;
    }
  }
  requireValue(
    ended && imageData && dimensions?.every(positive),
    'PNG image header or chunks are incomplete',
  );
  return dimensions;
}

function jpegDimensions(bytes) {
  requireValue(
    bytes.length >= 4 &&
      bytes.readUInt16BE(0) === 0xffd8 &&
      bytes.readUInt16BE(bytes.length - 2) === 0xffd9,
    'JPEG header or end marker is invalid',
  );
  let offset = 2;
  while (offset < bytes.length - 2) {
    requireValue(bytes[offset++] === 0xff, 'JPEG marker is invalid');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    requireValue(
      marker !== 0xda && marker !== 0xd9 && offset + 2 <= bytes.length,
      'JPEG frame header is missing',
    );
    const size = bytes.readUInt16BE(offset);
    requireValue(size >= 2 && offset + size <= bytes.length, 'JPEG segment is truncated');
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      requireValue(size >= 8, 'JPEG frame header is truncated');
      const dimensions = [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      requireValue(dimensions.every(positive), 'JPEG dimensions are invalid');
      return dimensions;
    }
    offset += size;
  }
  throw new Error('JPEG frame header is missing');
}

function staticCss(css) {
  let remaining = css.trim();
  while (remaining) {
    const rule = /^(\.[A-Za-z_][\w-]*(?:\s*,\s*\.[A-Za-z_][\w-]*)*)\s*\{([^{}]*)\}/.exec(remaining);
    requireValue(rule, 'SVG style has unsupported CSS');
    const declarations = rule[2]
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean);
    requireValue(
      declarations.length > 0 &&
        declarations.every(
          (value) =>
            /^(?:fill|stroke)\s*:\s*(?:#[a-f\d]{3,8}|none)$/i.test(value) ||
            /^stroke-width\s*:\s*\d+(?:\.\d+)?(?:px)?$/.test(value),
        ),
      'SVG style has unsafe or unsupported declarations',
    );
    remaining = remaining.slice(rule[0].length).trim();
  }
}

function svgDimensions(bytes) {
  let xml = decoder.decode(bytes).trim();
  xml = xml.replace(/^<\?xml\s+version=["']1\.0["']\s+encoding=["']UTF-8["']\s*\?>\s*/i, '');
  requireValue(
    !/[&\\@]|<!|<\?|\bhref\b|\bon[a-z]+\s*=|url\s*\(/i.test(xml),
    'SVG contains forbidden entities, declarations, references or active content',
  );
  const attributes = {
    svg: ['id', 'data-name', 'xmlns', 'viewBox', 'width', 'height'],
    defs: [],
    style: [],
    g: ['id', 'data-name', 'class'],
    path: ['id', 'data-name', 'class', 'd', 'fill', 'stroke', 'stroke-width'],
    rect: [
      'id',
      'data-name',
      'class',
      'x',
      'y',
      'width',
      'height',
      'fill',
      'stroke',
      'stroke-width',
    ],
  };
  const stack = [];
  let root;
  let offset = 0;
  for (const token of xml.matchAll(/<[^>]*>|[^<]+/g)) {
    requireValue(token.index === offset, 'SVG markup is malformed');
    offset += token[0].length;
    if (!token[0].startsWith('<')) {
      if (stack.at(-1) === 'style') staticCss(token[0]);
      else requireValue(token[0].trim() === '', 'SVG has unsupported text');
      continue;
    }
    const closing = /^<\/([A-Za-z][\w-]*)\s*>$/.exec(token[0]);
    if (closing) {
      requireValue(stack.pop() === closing[1], 'SVG closing element is malformed');
      continue;
    }
    const opening = /^<([A-Za-z][\w-]*)(\s[^<>]*?)?\s*(\/?)>$/.exec(token[0]);
    requireValue(opening && Object.hasOwn(attributes, opening[1]), 'SVG has unsupported elements');
    const [, name, raw = '', selfClosing] = opening;
    requireValue(stack.length > 0 || (!root && name === 'svg'), 'SVG must have exactly one root');
    requireValue(name !== 'svg' || !root, 'SVG nested roots are unsupported');
    requireValue(stack.at(-1) !== 'style', 'SVG style cannot contain elements');
    const values = {};
    let tail = raw;
    while (tail.trim()) {
      const attr = /^\s+([A-Za-z][\w-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(tail);
      requireValue(
        attr && attributes[name].includes(attr[1]) && !Object.hasOwn(values, attr[1]),
        'SVG has unsafe, duplicate or unsupported attributes',
      );
      values[attr[1]] = attr[2] ?? attr[3];
      tail = tail.slice(attr[0].length);
    }
    for (const [key, value] of Object.entries(values)) {
      if (['width', 'height', 'x', 'y', 'stroke-width'].includes(key))
        requireValue(/^-?\d+(?:\.\d+)?(?:px)?$/.test(value), 'SVG numeric attribute is invalid');
      if (['fill', 'stroke'].includes(key))
        requireValue(/^(?:#[a-f\d]{3,8}|none)$/i.test(value), 'SVG paint attribute is unsafe');
      if (key === 'd')
        requireValue(/^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]*$/.test(value), 'SVG path data is invalid');
    }
    if (name === 'svg') {
      requireValue(values.xmlns === 'http://www.w3.org/2000/svg', 'SVG namespace is invalid');
      const box = values.viewBox
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      requireValue(
        box?.length === 4 && box.every(Number.isFinite) && positive(box[2]) && positive(box[3]),
        'SVG viewBox dimensions are invalid',
      );
      root = [box[2], box[3]];
      for (const [index, key] of ['width', 'height'].entries())
        if (values[key] !== undefined)
          requireValue(
            Number.parseFloat(values[key]) === root[index],
            'SVG explicit dimensions disagree with viewBox',
          );
    }
    if (!selfClosing) stack.push(name);
  }
  requireValue(offset === xml.length && stack.length === 0 && root, 'SVG markup is incomplete');
  return root;
}

/**
 * Validate this repository's curated presskit, without dependencies or network access.
 * Synchronous result: { errors: string[], paths: string[] }. paths is an all-or-nothing
 * size-exception allowlist: it is empty if ANY catalog/file validation fails.
 * Image validation checks native structure/dimensions, not full raster decoding.
 */
export function validatePresskit(repositoryRoot) {
  const errors = [];
  const paths = [];
  const problem = (label, error) => {
    // Filesystem exceptions can contain machine paths; expose their safe code only.
    errors.push(`${label}: ${error?.code ?? error?.message ?? 'validation failed'}`);
  };
  let root;
  let catalog;
  try {
    requireValue(
      typeof repositoryRoot === 'string' && repositoryRoot.length > 0,
      'repository root is required',
    );
    root = realpathSync(repositoryRoot);
    const raw = safeFile(root, `${BASE}/catalog.json`, 256 * 1024);
    catalog = JSON.parse(decoder.decode(raw));
    schema(catalog);
  } catch (error) {
    problem('presskit catalog', error);
    return { errors, paths: [] };
  }
  const ids = new Set();
  const registered = new Set();
  for (const [index, asset] of catalog.assets.entries()) {
    try {
      assetSchema(asset);
      requireValue(!ids.has(asset.id) && !registered.has(asset.path), 'duplicate asset id or path');
      ids.add(asset.id);
      registered.add(asset.path);
      const bytes = safeFile(root, asset.path, MAX_BYTES);
      requireValue(bytes.length === asset.bytes, 'asset byte size does not match catalog');
      requireValue(
        createHash('sha256').update(bytes).digest('hex') === asset.sha256,
        'asset sha256 does not match catalog',
      );
      const dimensions = { PNG: pngDimensions, JPEG: jpegDimensions, SVG: svgDimensions }[
        asset.format
      ](bytes);
      requireValue(
        dimensions[0] === asset.width && dimensions[1] === asset.height,
        'asset dimensions do not match catalog',
      );
      paths.push(asset.path);
    } catch (error) {
      problem(`presskit asset ${index + 1}`, error);
    }
  }
  try {
    for (const name of readdirSync(path.join(root, BASE))) {
      const relative = `${BASE}/${name}`;
      const stat = lstatSync(path.join(root, relative));
      requireValue(!stat.isSymbolicLink(), 'presskit contains a symlink');
      requireValue(stat.isFile(), 'presskit must be flat and contain only regular files');
      if (name === 'catalog.json' || registered.has(relative)) continue;
      requireValue(name === 'README.md', 'presskit contains an unlisted file');
      const readme = decoder.decode(safeFile(root, relative, 64 * 1024));
      requireValue(!readme.includes('\0'), 'presskit README contains binary data');
    }
  } catch (error) {
    problem('presskit directory', error);
  }
  return { errors, paths: errors.length === 0 ? paths : [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validatePresskit(process.argv[2] ?? process.cwd());
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Presskit integrity passed: ${result.paths.length} assets.`);
}
