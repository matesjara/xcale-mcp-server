import { describe, expect, it } from 'vitest';

import { SecretString } from '../../secret-string';
import {
  forwardedCredentialResolver,
  resolveCredential,
} from '../credential-resolver';

describe('forwardedCredentialResolver', () => {
  it('without a bundle, the inbound value IS the single resolved secret (unchanged)', async () => {
    const resolved = await forwardedCredentialResolver.resolve(
      new SecretString('TOK'),
    );
    expect(resolved.secret.reveal()).toBe('TOK');
    expect(resolved.secrets).toBeUndefined();
  });

  it('with a named-secret bundle, it carries the bundle as resolved.secrets', async () => {
    const secrets = {
      directorio: new SecretString('DIR'),
      autoagendamiento: new SecretString('SCHED'),
    };
    const resolved = await forwardedCredentialResolver.resolve(
      new SecretString('RAW'),
      secrets,
    );
    expect(resolved.secrets?.directorio?.reveal()).toBe('DIR');
    expect(resolved.secrets?.autoagendamiento?.reveal()).toBe('SCHED');
  });
});

describe('resolveCredential', () => {
  it('forwarded passes a named-secret bundle through to the resolved credential', async () => {
    const resolved = await resolveCredential(
      'forwarded',
      new SecretString('RAW'),
      {},
      { directorio: new SecretString('DIR') },
    );
    expect(resolved.secrets?.directorio?.reveal()).toBe('DIR');
  });
});
