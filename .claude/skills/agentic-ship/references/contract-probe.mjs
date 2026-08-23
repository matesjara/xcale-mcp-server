/**
 * Contract probe — the executed evidence the `mcp-contract-qa` gate reports on.
 *
 * Boots the real Fastify app in-process on an ephemeral port and drives it with a real MCP client
 * over Streamable HTTP, exactly as a consumer would. It prints the PUBLISHED surface — the catalog
 * (`server/discover`), the flat namespaced tool set with descriptions and input schemas, and one
 * real `tools/call` round trip — so the gate judges what an agent on the other end actually
 * receives, not what the source suggests it receives.
 *
 * No secrets, no network, no Doppler: the Hop-B secret is a throwaway generated here, and no
 * provider token is real. Calling a tool that reaches a provider API will therefore fail at egress
 * — which is itself useful evidence: it must fail as a TYPED error result, never as a throw.
 *
 *   node --import tsx .claude/skills/agentic-ship/references/contract-probe.mjs
 *   … --provider cloudbeds                      # only that provider's tools, with full schemas
 *   … --tool mcp_echo_say --args '{"message":"hi"}'
 *   … --tool mcp_cloudbeds_list_reservations --metadata '{"propertyID":"1"}' --token bad-token
 *
 * VITEST=1 is set below on purpose: `src/server.ts` auto-starts unless it is defined, and this
 * script imports the app rather than running it as the entrypoint.
 */
process.env.VITEST ??= '1';

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import(
  '@modelcontextprotocol/sdk/client/streamableHttp.js'
);
const { buildApp } = await import('../../../../src/server.ts');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const providerFilter = flag('provider');
const toolName = flag('tool');
const toolArgs = JSON.parse(flag('args', '{}'));
const metadata = flag('metadata');
const providerToken = flag('token', 'probe-token-not-a-real-credential');

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
