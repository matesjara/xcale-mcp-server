/**
 * Audit gate — the full-tree `npm audit` step of CI, with dated, single-advisory exceptions.
 *
 *   npx tsx scripts/audit-gate.ts
 *
 * Runs `npm audit --json` and fails on any high or critical advisory that is not listed in
 * `audit-exceptions.json`. An exception names one GHSA and one package, expires within 30 days,
 * and fails CI when it expires or when its advisory is no longer reported. The production audit
 * (`npm audit --omit=dev --audit-level=high`) is a separate, plain CI step and never goes
 * through this file.
 *
 * Policy: docs/adr/0014-supply-chain-audit-gate.md and
 * docs/adr/audit-gate-dated-advisory-exceptions.md. No dependency beyond node and tsx.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface AuditException {
  id: string;
  package: string;
  scope: string;
  reason: string;
  added: string;
  expires: string;
  tracking: string;
  decision: string;
}

export interface Verdict {
  ok: boolean;
  failures: string[];
  notices: string[];
}

interface Advisory {
  id: string;
  name: string;
  severity: string;
  title: string;
}

const REQUIRED: (keyof AuditException)[] = [
  'id',
  'package',
  'scope',
  'reason',
  'added',
  'expires',
  'tracking',
  'decision',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditOutput(
  stdout: string,
): { ok: true; audit: unknown } | { ok: false; failure: string } {
  let audit: unknown;
  try {
    audit = JSON.parse(stdout);
  } catch {
    return { ok: false, failure: 'npm audit did not return JSON — failing closed.' };
  }
  const a = audit as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') {
    return { ok: false, failure: 'npm audit returned an unexpected JSON value — failing closed.' };
  }
  if ('error' in a) {
    return {
      ok: false,
      failure: `npm audit reported an error — failing closed: ${JSON.stringify(a.error)}`,
    };
  }
  if (!a.vulnerabilities || typeof a.vulnerabilities !== 'object') {
    return {
      ok: false,
      failure: 'npm audit JSON has no `vulnerabilities` object — failing closed.',
    };
  }
  return { ok: true, audit };
}

/** Leaf advisories: object `via` entries of high/critical severity. String `via` is derived. */
function collectAdvisories(audit: unknown): Advisory[] {
  const vulns = (audit as { vulnerabilities: Record<string, { via?: unknown[] }> }).vulnerabilities;
  const found = new Map<string, Advisory>();
  for (const v of Object.values(vulns)) {
    for (const via of v.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const e = via as { url?: string; name?: string; severity?: string; title?: string };
      if (e.severity !== 'high' && e.severity !== 'critical') continue;
      const id =
        e.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? e.url ?? '(no id)';
      found.set(`${id}|${e.name}`, {
        id,
        name: e.name ?? '(unknown)',
        severity: e.severity,
        title: e.title ?? '',
      });
    }
  }
  return [...found.values()];
}

export function evaluateAudit(audit: unknown, exceptions: unknown, today: string): Verdict {
  const failures: string[] = [];
  const notices: string[] = [];

  if (!Array.isArray(exceptions)) {
    return {
      ok: false,
      failures: ['audit-exceptions.json must be a JSON array of exception entries.'],
      notices,
    };
  }

  const valid: AuditException[] = [];
  exceptions.forEach((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const missing = REQUIRED.filter((k) => typeof e[k] !== 'string' || !(e[k] as string).trim());
    if (missing.length) {
      failures.push(`audit-exceptions.json entry ${i} is missing: ${missing.join(', ')}.`);
      return;
    }
    const entry = e as unknown as AuditException;
    if (!DATE.test(entry.added) || !DATE.test(entry.expires)) {
      failures.push(`Exception ${entry.id}: \`added\` and \`expires\` must be YYYY-MM-DD.`);
      return;
    }
    valid.push(entry);
  });

  const advisories = collectAdvisories(audit);

  for (const adv of advisories) {
    const byId = valid.find((e) => e.id === adv.id);
    if (!byId) {
      failures.push(
        `${adv.severity} advisory ${adv.id} in ${adv.name} is not excepted: ${adv.title}`,
      );
    } else if (byId.package !== adv.name) {
      failures.push(
        `Exception ${byId.id} names package "${byId.package}" but the advisory is reported on "${adv.name}" — package mismatch.`,
      );
    }
  }

  for (const e of valid) {
    const reported = advisories.some((a) => a.id === e.id);
    if (!reported) {
      failures.push(`Exception ${e.id} (${e.package}) is stale — remove the entry.`);
      continue;
    }
    if (e.expires < today) {
      failures.push(
        `Exception ${e.id} (${e.package}) expired — reassess the chain per ADR 0014 and the amending ADR (expired ${e.expires}).`,
      );
      continue;
    }
    if (advisories.some((a) => a.id === e.id && a.name === e.package)) {
      notices.push(
        `Audit exception applied: ${e.id} (${e.package}, ${e.scope}) expires ${e.expires} — ${e.tracking}`,
      );
    }
  }

  return { ok: failures.length === 0, failures, notices };
}

function main(): number {
  const run = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = parseAuditOutput(run.stdout ?? '');
  if (!parsed.ok) {
    console.error(`::error::${parsed.failure}`);
    return 1;
  }

  let exceptions: unknown;
  try {
    const path = fileURLToPath(new URL('../audit-exceptions.json', import.meta.url));
    exceptions = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`::error::Cannot read audit-exceptions.json: ${(err as Error).message}`);
    return 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  const verdict = evaluateAudit(parsed.audit, exceptions, today);
  for (const n of verdict.notices) console.log(`::notice::${n}`);
  for (const f of verdict.failures) console.error(`::error::${f}`);
  if (verdict.ok) console.log('Audit gate passed (full tree, high+).');
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
