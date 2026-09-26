import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args[0] && !/^[A-Za-z0-9_./^-]+$/.test(args[0])) ||
  args[0]?.startsWith('-')
)
  throw new Error('Expected a Git revision or range.');
const range = args[0] ?? 'origin/main..HEAD';
const log = execFileSync('git', ['log', '--format=%H%n%B%x00', range, '--'], { encoding: 'utf8' });
const aiTrailer = /^co-authored-by:.*(?:claude|anthropic|openai|chatgpt|codex|copilot|\bbot\b)/im;
const generatedFooter =
  /(?:generated (?:by|with).*(?:claude|codex|chatgpt|copilot)|claude\.ai\/code\/session|chatgpt\.com\/codex\/tasks)/i;
const rejected = log
  .split('\0')
  .filter((entry) => aiTrailer.test(entry) || generatedFooter.test(entry));
if (rejected.length) {
  console.error(
    'Commit contains AI attribution or an agent session link. Preserve the configured human identity.',
  );
  process.exitCode = 1;
} else console.log(`Commit attribution check passed (${range}).`);
