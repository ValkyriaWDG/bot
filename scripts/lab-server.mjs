import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const reportPath = process.env.LAB_REPORT_FILE || '.local/lab/report.json';
const port = Number(process.env.LAB_PORT || 4178);
const assets = new Map([
  ['/', ['tools/lab/index.html', 'text/html; charset=utf-8']],
  ['/lab.css', ['tools/lab/lab.css', 'text/css; charset=utf-8']],
  ['/lab.js', ['tools/lab/lab.js', 'text/javascript; charset=utf-8']],
  ['/report.json', [reportPath, 'application/json; charset=utf-8']],
  ['/extensions', ['tools/extensions/index.html', 'text/html; charset=utf-8']],
  ['/extensions.css', ['tools/extensions/extensions.css', 'text/css; charset=utf-8']],
  ['/extensions.js', ['tools/extensions/extensions.js', 'text/javascript; charset=utf-8']],
  [
    '/extensions-report.json',
    ['.local/lab/extensions-report.json', 'application/json; charset=utf-8'],
  ],
]);

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || process.argv.length > 2)
    throw new Error('invalid_lab_options');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (
    report.schemaVersion !== 1 ||
    report.evidenceKind !== 'simulated-discord' ||
    !Array.isArray(report.scenarios)
  )
    throw new Error('invalid_report');
} catch {
  console.error(
    'lab_report_unavailable: run pnpm lab:run first, or set LAB_REPORT_FILE to a generated simulation report.',
  );
  process.exit(1);
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405).end();
    return;
  }
  const entry = assets.get((request.url || '').split('?')[0]);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(entry[0]);
    response.setHeader('Content-Type', entry[1]);
    response.writeHead(200).end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404).end('Lab artifact unavailable. Regenerate the report.');
  }
});
server.on('error', () => {
  console.error('lab_viewer_unavailable: check LAB_PORT and local prerequisites.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Simulation viewer: http://127.0.0.1:${port} (read-only, synthetic data)`),
);
const close = () => {
  server.close();
  server.closeAllConnections();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
