/**
 * Contract probe — the executed evidence the `mcp-contract-qa` gate reports on.
 *
 * Boots the real Fastify app in-process on an ephemeral port and drives it with a real MCP client
 * over Streamable HTTP, exactly as a consumer would. It prints the PUBLISHED surface — the catalog
 * (`server/discover`), the flat namespaced tool set with descriptions and input schemas, and one
 * real `tools/call` round trip — so the gate judges what an agent on the other end actually
 * receives, not what the source suggests it receives.
 *
 * No secrets and no Doppler: the Hop-B secret is a throwaway generated here and the default
 * provider token is obviously fake. **`server/discover` and `tools/list` are fully offline** — they
 * read the registry, so they are always safe to run.
 *
 * `tools/call` is NOT offline. A real provider tool egresses to that provider's **production** API
 * with whatever `--token` you pass; only the `echo` provider is a stub. So calling a real tool is
 * guarded twice, and both guards fail closed:
 *
 *   --live         required for any tool outside `mcp_echo_*`. Says out loud that this run leaves
 *                  the machine. A bad token then yields the typed PROVIDER_AUTH_EXPIRED result,
 *                  which is exactly the evidence the 401 path needs — and no customer data moves.
 *   --allow-write  additionally required when the tool name carries a mutating verb. A write tool
 *                  reaches a real hotel's PMS or a real client's accounting, and this server is
 *                  at-most-once by design (ADR fiscal-write-path) — there is no undo from here.
 *
 *   node --import tsx .claude/skills/agentic-ship/references/contract-probe.mjs
 *   … --provider cloudbeds                      # only that provider's tools, with full schemas
 *   … --tool mcp_echo_say --args '{"message":"hi"}'                          # offline
 *   … --tool mcp_cloudbeds_list_reservations --metadata '{"propertyID":"1"}' \
 *        --token bad-token --live                                            # hits Cloudbeds
 *
 * VITEST=1 is set below on purpose: `src/server.ts` auto-starts unless it is defined, and this
 * script imports the app rather than running it as the entrypoint.
 */
process.env.VITEST ??= '1';

/** Mutating verbs. Matched against the tool's verb segment, so a read tool never trips it. */
const WRITE_VERBS =
  /_(create|update|patch|delete|remove|cancel|void|refund|charge|pay|post|send|assign|close|check_in|check_out)(_|$)/;

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import(
  '@modelcontextprotocol/sdk/client/streamableHttp.js'
);
const { buildApp } = await import('../../../../src/server.ts');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`--${name} needs a value. See the usage block at the top of this file.`);
    process.exit(2);
  }
  return value;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

const providerFilter = flag('provider');
const toolName = flag('tool');
const toolArgs = JSON.parse(flag('args', '{}'));
const metadata = flag('metadata');
const providerToken = flag('token', 'probe-token-not-a-real-credential');

// Both guards run BEFORE the app boots, so a refusal costs nothing and cannot half-execute.
if (toolName && !toolName.startsWith('mcp_echo_') && !has('live')) {
  console.error(
    `Refusing to call ${toolName}: it egresses to the provider's PRODUCTION API. ` +
      `Re-run with --live if that is what you intend.`,
  );
  process.exit(2);
}
if (toolName && WRITE_VERBS.test(toolName) && !has('allow-write')) {
  console.error(
    `Refusing to call ${toolName}: its name carries a mutating verb, and a write reaches a real ` +
      `customer system with no undo from here (ADR fiscal-write-path: at-most-once). ` +
      `Re-run with --allow-write only if you have a written reason to.`,
  );
  process.exit(2);
}

const SECRET = `probe-${Math.random().toString(36).slice(2)}`;
const app = buildApp({
  port: 0,
  nodeEnv: 'test',
  logLevel: 'silent',
  serverSecret: SECRET,
  credentialResolveUrl: '',
  credentialResolveSecret: '',
  siigoPartnerId: '',
});
await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address();

// ── Pillar 1: server/discover ────────────────────────────────────────────────────────────────
const discover = await app.inject({
  method: 'GET',
  url: '/discover',
  headers: { authorization: `Bearer ${SECRET}` },
});
const catalog = JSON.parse(discover.body).providers;
console.log('## server/discover\n');
for (const p of catalog) {
  if (providerFilter && p.slug !== providerFilter) continue;
  console.log(
    `- ${p.slug} · ${p.displayName} · ${p.category} · schema ${p.schemaVersion} · provider ${p.providerVersion} · ` +
      `auth ${p.authDescriptor.type}${p.additionalAuthDescriptors?.length ? ` (+${p.additionalAuthDescriptors.length} alt)` : ''} · ` +
      `${p.toolCount} tools${p.contextSchema ? ' · context required' : ''}${p.deprecated ? ' · DEPRECATED' : ''}`,
  );
}

// ── Pillar 2: tools/list ─────────────────────────────────────────────────────────────────────
const headers = { authorization: `Bearer ${SECRET}`, 'x-provider-token': providerToken };
if (metadata) headers['x-provider-metadata'] = Buffer.from(metadata).toString('base64');
const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
  requestInit: { headers },
});
const client = new Client({ name: 'contract-probe', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const shown = providerFilter ? tools.filter((t) => t.name.startsWith(`mcp_${providerFilter}_`)) : tools;
console.log(`\n## tools/list — ${tools.length} tools published${providerFilter ? `, ${shown.length} for ${providerFilter}` : ''}\n`);
for (const t of shown) {
  console.log(`### ${t.name}\n${t.description ?? '(no description)'}\n`);
  if (providerFilter) console.log('```json\n' + JSON.stringify(t.inputSchema, null, 2) + '\n```\n');
}

// ── Pillar 3: tools/call ─────────────────────────────────────────────────────────────────────
if (toolName) {
  console.log(`\n## tools/call — ${toolName}\n`);
  const result = await client.callTool({ name: toolName, arguments: toolArgs });
  console.log('```json\n' + JSON.stringify(result.structuredContent ?? result, null, 2) + '\n```');
  console.log(`\nisError: ${Boolean(result.isError)}`);
}

await client.close();
await app.close();
