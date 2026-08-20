/**
 * ADR numbering — mints the `NNNN-` prefix for ADRs that are still unnumbered.
 *
 * ADRs are authored unnumbered (`<slug>.md`, `# ADR: …`) for the whole life of a branch, so two
 * branches can never collide on a number they both guessed. The number is minted here, against
 * `origin/dev`, right before the branch merges.
 *
 *   npm run adr:number             # dry run — print the plan, touch nothing
 *   npm run adr:number -- --apply  # git mv + rewrite the heading and every link
 *
 * Ordering is by the commit that first added each ADR (uncommitted ones sort last), so numbers
 * follow the real history rather than the alphabet.
 *
 * See docs/adr/README.md and .claude/skills/adr/SKILL.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export const ADR_DIR = 'docs/adr';

const NUMBERED = /^(\d{4})-/;
const UNCOMMITTED = Number.MAX_SAFE_INTEGER;
/** Bytes sniffed when deciding whether a tracked file is text. */
const SNIFF_BYTES = 8000;

export interface AdrEntry {
  slug: string;
  /** Unix timestamp of the commit that first added the file; UNCOMMITTED if it is not in git yet. */
  addedAt: number;
}

export interface Assignment {
  slug: string;
  number: number;
  from: string;
  to: string;
}

/** Highest `NNNN-` prefix among the given ADR file names; 0 when none is numbered. */
export function highestNumber(fileNames: string[]): number {
  let max = 0;
  for (const name of fileNames) {
    const match = NUMBERED.exec(basename(name));
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** Assigns sequential numbers from `startAt`, oldest ADR first. */
export function assign(entries: AdrEntry[], startAt: number): Assignment[] {
  return [...entries]
    .sort((a, b) => a.addedAt - b.addedAt || a.slug.localeCompare(b.slug))
    .map((entry, index) => {
      const number = startAt + index;
      return {
        slug: entry.slug,
        number,
        from: `${ADR_DIR}/${entry.slug}.md`,
        to: `${ADR_DIR}/${pad(number)}-${entry.slug}.md`,
      };
    });
}

/** `# ADR: Title` → `# ADR 0007: Title`. Leaves an already-numbered heading alone. */
export function numberHeading(content: string, number: number): string {
  return content.replace(/^# ADR:[ \t]*/, `# ADR ${pad(number)}: `);
}

/**
 * Repoints every link to a renamed ADR. `renames` maps slug → numbered base name.
 *
 * Only links that name a known ADR are touched: path forms (`docs/adr/<slug>.md`,
 * `adr/<slug>.md`) anywhere, plus bare relative links (`](<slug>.md)`) inside `docs/adr/`, where
 * ADRs cross-reference each other. Sibling docs that link to a non-ADR `<name>.md` are untouched.
 */
export function rewriteLinks(
  content: string,
  renames: ReadonlyMap<string, string>,
  insideAdrDir: boolean,
): string {
  let out = content;
  for (const [slug, numbered] of renames) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`((?:docs/)?adr/)${escaped}\\.md`, 'g'), `$1${numbered}.md`);
    if (insideAdrDir) {
      out = out.replace(new RegExp(`\\]\\(${escaped}\\.md`, 'g'), `](${numbered}.md`);
    }
  }
  return out;
}

/**
 * Whether a file is binary, by the usual heuristic: a NUL byte near the start.
 *
 * ADRs get cited from anywhere — `Dockerfile`, `tsconfig.json`, CI yaml, source comments — so the
 * rewrite scans every tracked text file rather than an extension allow-list that would silently
 * miss one and leave a dangling path behind.
 */
export function looksBinary(head: Buffer): boolean {
  return head.subarray(0, SNIFF_BYTES).includes(0);
}

function pad(number: number): string {
  return String(number).padStart(4, '0');
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** ADR file names on `origin/dev`; empty when the ref is unavailable (fresh clone, offline). */
function fileNamesOnDev(): string[] {
  try {
    return git('ls-tree', '-r', '--name-only', 'origin/dev', '--', ADR_DIR)
      .split('\n')
      .filter(Boolean);
  } catch {
    console.warn('! origin/dev unavailable — numbering against local ADRs only.');
    return [];
  }
}

function unnumberedSlugs(): string[] {
  return readdirSync(ADR_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md' && !NUMBERED.test(name))
    .map((name) => name.slice(0, -'.md'.length));
}

function addedAt(slug: string): number {
  const log = git('log', '--diff-filter=A', '--format=%at', '--', `${ADR_DIR}/${slug}.md`).trim();
  const first = log.split('\n').filter(Boolean).pop();
  return first ? Number(first) : UNCOMMITTED;
}

function rewritableFiles(): string[] {
  return git('ls-files')
    .split('\n')
    .filter(Boolean)
    .filter((file) => existsSync(file) && !looksBinary(readFileSync(file)));
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const slugs = unnumberedSlugs();

  if (slugs.length === 0) {
    console.log('Every ADR is already numbered — nothing to do.');
    return;
  }

  const localNames = readdirSync(ADR_DIR);
  const startAt = Math.max(highestNumber(fileNamesOnDev()), highestNumber(localNames)) + 1;
  const plan = assign(
    slugs.map((slug) => ({ slug, addedAt: addedAt(slug) })),
    startAt,
  );

  const renames = new Map(plan.map((item) => [item.slug, `${pad(item.number)}-${item.slug}`]));
  const touched = rewritableFiles().filter((file) => {
    const content = readFileSync(file, 'utf8');
    return rewriteLinks(content, renames, file.startsWith(`${ADR_DIR}/`)) !== content;
  });

  console.log(`${plan.length} ADR(s) to number, starting at ${pad(startAt)}:\n`);
  for (const item of plan) console.log(`  ${pad(item.number)}  ${item.slug}`);
  console.log(`\n${touched.length} file(s) reference them and would be repointed.`);

  if (!apply) {
    console.log('\nDry run. Re-run with `--apply` to perform the rename.');
    return;
  }

  for (const item of plan) {
    git('mv', item.from, item.to);
    const content = readFileSync(item.to, 'utf8');
    const numbered = numberHeading(content, item.number);
    if (numbered === content) {
      console.warn(`! ${item.to}: no \`# ADR: …\` heading found — heading left untouched.`);
    }
    writeFileSync(item.to, numbered);
  }

  for (const file of rewritableFiles()) {
    const content = readFileSync(file, 'utf8');
    const rewritten = rewriteLinks(content, renames, file.startsWith(`${ADR_DIR}/`));
    if (rewritten !== content) writeFileSync(file, rewritten);
  }

  console.log('\nApplied. Review with `git diff` (renames are staged by `git mv`) and commit.');
}

if (process.argv[1]?.endsWith('number-adrs.ts')) main();
