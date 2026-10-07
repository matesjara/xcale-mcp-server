import { describe, expect, it } from 'vitest';

import { loggerOptions } from '../logger';

/**
 * The redact list is a hard security control: every header that carries a credential must be on it.
 * `X-Provider-Credentials` carries a multi-credential provider's whole bundle (HiMed: three tokens in
 * clear) and was missing (code review 2026-10-06).
 */
describe('logger redaction', () => {
  it('redacts every credential-bearing header', () => {
    const paths = loggerOptions('info').redact.paths;
    for (const header of ['x-provider-token', 'x-provider-credentials']) {
      expect(paths).toContain(`req.headers["${header}"]`);
    }
    expect(paths).toContain('req.headers.authorization');
  });
});
