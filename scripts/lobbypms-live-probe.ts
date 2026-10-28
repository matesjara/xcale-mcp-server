/**
 * LobbyPMS live probe — the first session with a real property, READ-ONLY.
 *
 * Runs every money-free and guest-free read of the `lobbypms` provider THROUGH THE PROVIDER'S OWN CODE
 * (so the evidence is about what we ship, not about curl), plus two raw checks the provider cannot
 * make: whether `Authorization: Bearer` works (Q1) and what an unknown booking id returns (Q7). It
 * creates, cancels, blocks and charges nothing — no write tool is reachable from here.
 *
 * It closes `docs/design/lobbypms-provider/design-notes.md` › Q1, Q2 (run it once from an IP the property
 * has NOT authorized), Q3 (currency/tax hints), Q7, and records the real shapes as fixtures.
 *
 * The token is read from the environment and never printed, written or put in a file name. Responses
 * are written to `--out` (default: the OS temp dir) — they hold the property's room names and prices,
 * no guest data. Review them before committing any as a fixture.
 *
 *   LOBBYPMS_API_TOKEN=… npx tsx scripts/lobbypms-live-probe.ts --property 339654 \
 *     [--from 2026-11-10 --to 2026-11-12] [--out ./probe-out]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SecretString } from '../src/core/secret-string';
import type { ProviderCallContext, ToolResult } from '../src/core/types';
import { createLobbypmsProvider } from '../src/providers/lobbypms';

const BASE = 'https://api.lobbypms.com/api';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A date `days` from today, YYYY-MM-DD. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Never let the token reach the console, even inside a provider's echoed text. */
function scrub(text: string, token: string): string {
  return token ? text.split(token).join('<redacted>') : text;
}

async function main(): Promise<void> {
  const token = process.env.LOBBYPMS_API_TOKEN ?? '';
  const propertyId = arg('property');
  if (!token)
    throw new Error('set LOBBYPMS_API_TOKEN in the environment (never on the command line)');
  if (!propertyId) throw new Error('--property <LobbyPMS property id> is required');
  const from = arg('from') ?? inDays(30);
  const to = arg('to') ?? inDays(32);
  const out = path.resolve(arg('out') ?? path.join(os.tmpdir(), `lobbypms-probe-${Date.now()}`));
  fs.mkdirSync(out, { recursive: true });

  const ip = await fetch('https://api.ipify.org')
    .then((r) => r.text())
    .catch(() => '?');
  console.log(`caller public IP : ${ip}   (must be authorized in the property for 200s)`);
  console.log(`property         : ${propertyId}   window ${from} → ${to}`);
  console.log(`output           : ${out}\n`);

  const provider = createLobbypmsProvider();
  const ctx: ProviderCallContext = {
    credential: { secret: new SecretString(token) },
    metadata: { propertyId },
  };

  const save = (name: string, body: unknown) =>
    fs.writeFileSync(path.join(out, `${name}.json`), scrub(JSON.stringify(body, null, 2), token));

  const reads: Array<[string, Record<string, unknown>]> = [
    ['mcp_lobbypms_list_room_types', {}],
    ['mcp_lobbypms_check_availability', { start_date: from, end_date: to }],
    ['mcp_lobbypms_get_availability_rates', { start_date: from, end_date: to }],
    ['mcp_lobbypms_list_rate_plans', {}],
    ['mcp_lobbypms_list_channels', {}],
    ['mcp_lobbypms_list_document_types', {}],
    // An id no property has: shows RECORD_NOT_FOUND's real status and body (Q7).
    ['mcp_lobbypms_get_booking', { booking_id: 999999999999 }],
  ];
  for (const [tool, args] of reads) {
    const started = Date.now();
    const result: ToolResult = await provider.callTool(tool, args, ctx);
    const ms = Date.now() - started;
    save(tool.replace('mcp_lobbypms_', ''), result);
    if (result.kind === 'success') {
      const data = result.data as { data?: unknown[]; meta?: unknown } | unknown[];
      const rows = Array.isArray(data)
        ? data.length
        : Array.isArray(data?.data)
          ? data.data.length
          : '-';
      console.log(`✔ ${tool.padEnd(40)} ${String(ms).padStart(5)} ms  rows ${rows}`);
    } else {
      console.log(
        `✘ ${tool.padEnd(40)} ${String(ms).padStart(5)} ms  ${result.code}  ${scrub(result.message, token)}`,
      );
    }
    // Stay far below ~60 requests a minute.
    await new Promise((r) => setTimeout(r, 1_200));
  }

  // Q1 — is a Bearer header accepted? Raw, because the provider sends the query placement.
  const bearer = await fetch(`${BASE}/v1/rooms`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  const bearerBody = await bearer.text();
  save('raw-bearer-rooms', { status: bearer.status, body: safeJson(scrub(bearerBody, token)) });
  console.log(`\nBearer on v1/rooms            → HTTP ${bearer.status}`);

  // Rate-limit headers, if LobbyPMS sends any.
  const headers = [...bearer.headers.entries()].filter(([k]) => /rate|retry|limit/i.test(k));
  console.log(
    `rate-limit headers            → ${headers.length ? JSON.stringify(headers) : 'none'}`,
  );

  console.log(
    '\nNext: read the saved availability for prices vs. IVA (Q3), compare with the property, and record' +
      ' the answers in docs/design/lobbypms-provider/design-notes.md.',
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
