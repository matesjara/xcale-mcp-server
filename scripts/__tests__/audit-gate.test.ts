import { describe, expect, it } from 'vitest';
import { evaluateAudit, parseAuditOutput, type AuditException } from '../audit-gate';

const GHSA = 'GHSA-fc5q-39xc-vjpf';
const TODAY = '2026-11-17';

const exception = (over: Partial<AuditException> = {}): AuditException => ({
  id: GHSA,
  package: 'picomatch',
  scope: 'dev',
  reason: 'ReDoS via extglobs; dev-only; no patched version',
  added: '2026-11-17',
  expires: '2026-12-17',
  tracking: 'https://github.com/matesjara/xcale-mcp-server/issues/218',
  decision: 'https://github.com/matesjara/xcale-mcp-server/issues/217#issuecomment-6960934871',
  ...over,
});

const leaf = (name: string, ghsa: string, severity = 'high') => ({
  source: 1,
  name,
  dependency: name,
  title: 't',
  url: `https://github.com/advisories/${ghsa}`,
  severity,
  range: '<=4.0.7',
});

/** The real picomatch shape: one leaf on picomatch, string `via` on everything above it. */
const picomatchAudit = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    picomatch: { name: 'picomatch', severity: 'high', via: [leaf('picomatch', GHSA)] },
    fdir: { name: 'fdir', severity: 'high', via: ['picomatch'] },
    tinyglobby: { name: 'tinyglobby', severity: 'high', via: ['fdir', 'picomatch'] },
    vite: { name: 'vite', severity: 'high', via: ['tinyglobby'] },
    vitest: { name: 'vitest', severity: 'high', via: ['vite'] },
    hono: {
      name: 'hono',
      severity: 'moderate',
      via: [leaf('hono', 'GHSA-aaaa-bbbb-cccc', 'moderate')],
    },
  },
});

describe('evaluateAudit', () => {
  it('passes the real picomatch shape with a live exception, and notices it', () => {
    const v = evaluateAudit(picomatchAudit(), [exception()], TODAY);
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
    expect(v.notices.join('\n')).toContain(GHSA);
    expect(v.notices.join('\n')).toContain('2026-12-17');
  });

  it('(a) fails a high advisory that is not excepted', () => {
    const v = evaluateAudit(picomatchAudit(), [], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toContain(GHSA);
  });

  it('(a) fails a critical advisory beside an excepted one', () => {
    const audit = picomatchAudit();
    (audit.vulnerabilities as Record<string, unknown>).evil = {
      name: 'evil',
      severity: 'critical',
      via: [leaf('evil', 'GHSA-zzzz-yyyy-xxxx', 'critical')],
    };
    const v = evaluateAudit(audit, [exception()], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toContain('GHSA-zzzz-yyyy-xxxx');
  });

  it('(b) fails when the exception names another package than the advisory', () => {
    const v = evaluateAudit(picomatchAudit(), [exception({ package: 'fdir' })], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toMatch(/package/);
  });

  it('(c) fails an expired exception', () => {
    const v = evaluateAudit(picomatchAudit(), [exception({ expires: '2026-11-16' })], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toContain('expired — reassess the chain per ADR 0014');
  });

  it('(d) fails a stale exception whose advisory is no longer reported', () => {
    const clean = { auditReportVersion: 2, vulnerabilities: {} };
    const v = evaluateAudit(clean, [exception()], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toContain('stale — remove the entry');
  });

  it('(e) fails an entry that lacks a required field', () => {
    const { reason: _reason, ...partial } = exception();
    const v = evaluateAudit(picomatchAudit(), [partial as AuditException], TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toContain('reason');
  });

  it('(e) fails a malformed exceptions file', () => {
    const v = evaluateAudit(picomatchAudit(), { not: 'an array' }, TODAY);
    expect(v.ok).toBe(false);
    expect(v.failures.join('\n')).toMatch(/array/);
  });

  it('(e) fails a malformed date', () => {
    const v = evaluateAudit(picomatchAudit(), [exception({ expires: 'soon' })], TODAY);
    expect(v.ok).toBe(false);
  });
});

describe('parseAuditOutput', () => {
  it('fails closed on non-JSON output', () => {
    expect(parseAuditOutput('npm ERR! something').ok).toBe(false);
  });

  it('fails closed on an `error` key', () => {
    expect(parseAuditOutput(JSON.stringify({ error: { code: 'E400' } })).ok).toBe(false);
  });

  it('fails closed without a vulnerabilities object', () => {
    expect(parseAuditOutput(JSON.stringify({ auditReportVersion: 2 })).ok).toBe(false);
  });

  it('accepts a well-formed report', () => {
    expect(parseAuditOutput(JSON.stringify(picomatchAudit())).ok).toBe(true);
  });
});
