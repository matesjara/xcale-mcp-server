import { describe, expect, it } from 'vitest';

import { assign, highestNumber, looksBinary, numberHeading, rewriteLinks } from '../number-adrs';

describe('highestNumber', () => {
  it('returns 0 when no ADR carries a number', () => {
    expect(highestNumber(['consumer-agnostic-contract.md', 'README.md'])).toBe(0);
  });

  it('reads the highest prefix, not the last one listed', () => {
    expect(highestNumber(['0009-b.md', '0012-c.md', '0003-a.md'])).toBe(12);
  });

  it('ignores path prefixes and unnumbered siblings', () => {
    expect(highestNumber(['docs/adr/0004-a.md', 'docs/adr/b.md'])).toBe(4);
  });

  it('does not mistake a 4-digit fragment inside the slug for a number', () => {
    expect(highestNumber(['oauth-2026-scopes.md'])).toBe(0);
  });
});

describe('assign', () => {
  it('numbers oldest first, sequentially from the given start', () => {
    const plan = assign(
      [
        { slug: 'newer', addedAt: 200 },
        { slug: 'older', addedAt: 100 },
      ],
      7,
    );

    expect(plan.map((item) => [item.number, item.slug])).toEqual([
      [7, 'older'],
      [8, 'newer'],
    ]);
  });

  it('pads to four digits in the target path', () => {
    const [item] = assign([{ slug: 'fiscal-write-path', addedAt: 1 }], 3);

    expect(item?.from).toBe('docs/adr/fiscal-write-path.md');
    expect(item?.to).toBe('docs/adr/0003-fiscal-write-path.md');
  });

  it('sorts uncommitted ADRs last — they are the newest by definition', () => {
    const plan = assign(
      [
        { slug: 'draft', addedAt: Number.MAX_SAFE_INTEGER },
        { slug: 'committed', addedAt: 500 },
      ],
      1,
    );

    expect(plan.map((item) => item.slug)).toEqual(['committed', 'draft']);
  });

  it('breaks timestamp ties by slug so the plan is deterministic', () => {
    const plan = assign(
      [
        { slug: 'zulu', addedAt: 42 },
        { slug: 'alpha', addedAt: 42 },
      ],
      1,
    );

    expect(plan.map((item) => item.slug)).toEqual(['alpha', 'zulu']);
  });

  it('does not mutate the caller’s array', () => {
    const entries = [
      { slug: 'b', addedAt: 2 },
      { slug: 'a', addedAt: 1 },
    ];
    assign(entries, 1);

    expect(entries.map((entry) => entry.slug)).toEqual(['b', 'a']);
  });
});

describe('numberHeading', () => {
  it('injects the number into the ADR heading', () => {
    expect(numberHeading('# ADR: Tool-derived OAuth scopes\n\n- **Status:**', 12)).toBe(
      '# ADR 0012: Tool-derived OAuth scopes\n\n- **Status:**',
    );
  });

  it('leaves an already-numbered heading untouched', () => {
    const content = '# ADR 0004: Already minted\n';

    expect(numberHeading(content, 9)).toBe(content);
  });

  it('leaves the body alone when the heading is missing', () => {
    const content = 'No heading here\n\n# ADR: not on the first line\n';

    expect(numberHeading(content, 5)).toBe(content);
  });
});

describe('rewriteLinks', () => {
  const renames = new Map([['fiscal-write-path', '0015-fiscal-write-path']]);

  it('repoints repo-root paths', () => {
    expect(rewriteLinks('See `docs/adr/fiscal-write-path.md`.', renames, false)).toBe(
      'See `docs/adr/0015-fiscal-write-path.md`.',
    );
  });

  it('repoints the shorter `adr/<slug>.md` form', () => {
    expect(rewriteLinks('(adr/fiscal-write-path.md)', renames, false)).toBe(
      '(adr/0015-fiscal-write-path.md)',
    );
  });

  it('repoints bare sibling links inside docs/adr', () => {
    expect(rewriteLinks('[fiscal](fiscal-write-path.md)', renames, true)).toBe(
      '[fiscal](0015-fiscal-write-path.md)',
    );
  });

  it('leaves bare links alone outside docs/adr, where they mean a different file', () => {
    const content = '[checklist](fiscal-write-path.md)';

    expect(rewriteLinks(content, renames, false)).toBe(content);
  });

  it('never touches a sibling doc that is not an ADR', () => {
    const content = '[checklist](checklist.md) and [design](feature-design.md)';

    expect(rewriteLinks(content, renames, true)).toBe(content);
  });

  it('leaves another repo’s already-numbered ADR alone', () => {
    const content = '`xcale-backend/docs/adr/0005-native-connection-reauth-lifecycle.md`';

    expect(
      rewriteLinks(content, new Map([['native-connection-reauth-lifecycle', '0002-x']]), false),
    ).toBe(content);
  });

  it('rewrites every occurrence, not just the first', () => {
    expect(
      rewriteLinks(
        'docs/adr/fiscal-write-path.md and docs/adr/fiscal-write-path.md',
        renames,
        false,
      ),
    ).toBe('docs/adr/0015-fiscal-write-path.md and docs/adr/0015-fiscal-write-path.md');
  });

  it('applies every rename in the map', () => {
    const many = new Map([
      ['alpha', '0001-alpha'],
      ['beta', '0002-beta'],
    ]);

    expect(rewriteLinks('docs/adr/alpha.md docs/adr/beta.md', many, false)).toBe(
      'docs/adr/0001-alpha.md docs/adr/0002-beta.md',
    );
  });
});

describe('looksBinary', () => {
  it('accepts text so extensionless citers like Dockerfile get rewritten', () => {
    expect(looksBinary(Buffer.from('# docs/adr/deployment-runtime-and-hosting.md\n'))).toBe(false);
  });

  it('rejects a buffer carrying a NUL byte', () => {
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x4e]))).toBe(true);
  });

  it('ignores a NUL that sits past the sniff window', () => {
    const late = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0x00])]);

    expect(looksBinary(late)).toBe(false);
  });
});
