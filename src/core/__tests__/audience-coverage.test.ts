import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '../../providers';

/**
 * A provider either classifies its tools' audience or it does not — never half
 * (ADR `tool-audience-gate-on-guest-channels`, xcale#1243).
 *
 * The consumer treats an unmarked tool of a classifying provider as `unclassified` and refuses it on
 * a guest channel. That is the safe fallback, but it is also a silent one: a new tool added without a
 * mark would ship disabled for guests and nobody would know why. Failing here makes the author
 * decide. Only PUBLISHED tools count — a control-plane tool never reaches an agent.
 */
describe('audience coverage', () => {
  for (const provider of PROVIDERS) {
    it(`${provider.manifest.slug}: no published tool declares an audience, or all of them do`, () => {
      const tools = provider.listTools();
      const marked = tools.filter((t) => t.audience !== undefined);
      if (marked.length === 0) return;

      const unmarked = tools.filter((t) => t.audience === undefined).map((t) => t.name);
      expect(unmarked).toEqual([]);
    });
  }
});
