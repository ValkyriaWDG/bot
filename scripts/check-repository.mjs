import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const root = process.cwd();
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  ),
];
const failures = [];
for (const required of [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'STATUS.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.env.example',
  'pnpm-lock.yaml',
  'Dockerfile',
  '.github/workflows/ci.yml',
  'docs/commands.md',
  'docs/wardogs-api.md',
  'docs/web-integration.md',
  'docs/live-acceptance.md',
  'docs/index.md',
  'docs/user-guide.md',
  'docs/testing-lab.md',
  'docs/lab-database.md',
  'docs/troubleshooting.md',
  'compose.lab.yaml',
]) {
  if (!files.includes(required) || !existsSync(required))
    failures.push(`Missing required file: ${required}`);
}
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
];
for (const file of files) {
  if (
    /^(?:\.local|node_modules|dist|coverage)\//.test(file) ||
    (/(?:^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example') ||
    (/^config\/.*\.json$/.test(file) && !file.endsWith('.example.json'))
  )
    failures.push(`Private/generated path: ${file}`);
  if (!existsSync(file)) continue;
  if (statSync(file).size > 1_000_000)
    failures.push(`Unexpected large public source file: ${file}`);
  if (!/\.(?:md|ts|mjs|json|yml|yaml|sql|example)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(text)))
    failures.push(`Credential pattern: ${file}`);
  if (file.endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch {
      failures.push(`Invalid JSON: ${file}`);
    }
  }
  if (file.endsWith('.md')) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const path = resolve(dirname(file), decodeURIComponent(target));
      if (!path.startsWith(root + sep) || !existsSync(path))
        failures.push(`Broken/outside local link: ${file} -> ${target}`);
    }
  }
}
const skills = files.filter((file) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file));
if (skills.length !== 8) failures.push('Expected eight repository skills.');
for (const skill of skills) {
  const text = readFileSync(skill, 'utf8');
  if (!/^---\r?\nname: valkyria-[a-z-]+\r?\ndescription: [\s\S]+?\r?\n---/.test(text))
    failures.push(`Invalid skill frontmatter: ${skill}`);
}
const attribution = JSON.parse(readFileSync('.claude/settings.json', 'utf8')).attribution;
if (attribution?.commit !== '' || attribution?.pr !== '' || attribution?.sessionUrl !== false)
  failures.push('AI attribution suppression must remain configured.');
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else
  console.log(
    `Repository checks passed: ${files.length} public files, ${skills.length} skills. This is not a comprehensive secret scan.`,
  );
