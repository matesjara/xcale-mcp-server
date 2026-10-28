/**
 * Fastify/pino logger options. The `redact` paths are a hard security control (ADR:
 * credential-forwarding-and-token-model): the Hop-A token and Hop-B secret must NEVER reach logs.
 */
export function loggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [
        'req.headers["x-provider-token"]',
        // A multi-credential provider's whole bundle (HiMed: three tokens in clear).
        'req.headers["x-provider-credentials"]',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  };
}
