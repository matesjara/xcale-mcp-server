export const meta = {
  name: 'agentic-gates',
  description:
    'Run the three independent review gates (code-review, pr-review, contract-qa) on an open PR against dev and return structured verdicts',
  phases: [{ title: 'Gates' }],
};

// args (passed by the /agentic-ship skill):
//   prNumber — the open PR against dev; every gate reads the diff from it (`gh pr diff`)
//   slug     — the design slug, so pr-review can locate docs/design/<slug>/ (optional)
//   reach    — 'docs' | 'provider' | 'shared', derived from the BUILT diff, not from the intent:
//                docs      → nothing under src/; contract-qa is skipped
//                provider  → src/providers/** only; contract-qa is mandatory
//                shared    → src/core|protocol|auth/**, or a non-additive contract move;
//                            contract-qa is mandatory AND the skill must not auto-merge
//   issue    — optional issue #N, so pr-review can check the diff against what was asked
//
// Returns: array of { gate, result: 'pass'|'blocked', findings: [{severity, description, location?}] }
// The gates run as FRESH subagents (agentType) — independence is enforced here, not by convention.

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['gate', 'result', 'findings'],
  properties: {
    gate: { type: 'string', enum: ['code-review', 'pr-review', 'contract-qa'] },
    result: { type: 'string', enum: ['pass', 'blocked'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'description'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'note'] },
          description: { type: 'string' },
          location: { type: 'string' },
        },
      },
    },
  },
};

const pr = args?.prNumber;
const slug = args?.slug;
const issue = args?.issue;
const reach = args?.reach ?? 'shared'; // fail closed: an unknown reach gets the strictest treatment

phase('Gates');

// Which gates this run OWES a verdict. Kept beside the runners so the two can never drift.
const expectedGates = ['code-review', 'pr-review'];

const gateRuns = [
  () =>
    agent(
      `You are the CODE-REVIEW (inward) gate on PR #${pr}. Read the diff with \`gh pr diff ${pr}\` and the changed files in full. Judge intrinsic quality: the CREDENTIAL BOUNDARY FIRST (SecretString, \`.reveal()\` only at provider egress, nothing logged or persisted), then correctness, error mapping, and the architecture invariants in CLAUDE.md. Report a verdict with gate "code-review".`,
      { label: 'gate:code-review', agentType: 'code-reviewer', schema: VERDICT }
    ),
  () =>
    agent(
      `You are the PR-REVIEW (outward) gate on PR #${pr}. Judge it as a pull request against \`dev\`: scope containment, fidelity to what was asked, honesty of the PR body against the diff, integration with \`dev\`, and hygiene.${
        slug ? ` The design contract is \`docs/design/${slug}/\` — read it and check the diff against it.` : ''
      }${
        issue ? ` The work was requested in issue #${issue} — read it with \`gh issue view ${issue} --comments\` and check the diff delivers what it asked, no more and no less.` : ''
      } Report a verdict with gate "pr-review".`,
      { label: 'gate:pr-review', agentType: 'pr-reviewer', schema: VERDICT }
    ),
];

// The third gate reviews the published MCP contract, not a running process — see SKILL.md § 1.
// It runs for anything that touches src/. Docs- and skill-only changes cannot move the contract.
if (reach !== 'docs') {
  expectedGates.push('contract-qa');
  gateRuns.push(() =>
    agent(
      `You are the CONTRACT-QA gate on PR #${pr}. It touches \`src/\` (reach: ${reach}), so the published MCP surface may have moved. Produce EXECUTED evidence — run the suites and boot the app in-process, never assert from reading alone — and judge the round trip, the agent-fitness of the tools, additive-only evolution, and the credential boundary at egress.${
        reach === 'provider'
          ? ' This is a PROVIDER change: the golden-rule file footprint (only src/providers/{slug}/ + tests + one line in src/providers/index.ts + generic config) is a BLOCKER when broken without an exceptional ADR in the same diff.'
          : ' This change reaches SHARED infrastructure or the public contract. A live consumer (xcale-backend) depends on it and this repo cannot test that side — hold every contract move to additive-only evolution (ADR additive-contract-versioning) and say plainly what a consumer would have to change.'
      } Report a verdict with gate "contract-qa".`,
      { label: 'gate:contract-qa', agentType: 'mcp-contract-qa', schema: VERDICT }
    )
  );
}

const verdicts = await parallel(gateRuns);

// Do NOT drop empty slots. A gate that crashed, timed out, or returned schema-invalid output would
// otherwise vanish, and step 7 auto-merges on "every verdict says pass" — which a shorter array
// satisfies trivially. A missing verdict is a BLOCKED gate, not an absent one; the caller escalates.
const returned = verdicts.filter(Boolean);
if (returned.length !== expectedGates.length) {
  const heard = new Set(returned.map((v) => v.gate));
  const missing = expectedGates.filter((g) => !heard.has(g));
  return [
    ...returned,
    ...missing.map((gate) => ({
      gate,
      result: 'blocked',
      findings: [
        {
          severity: 'blocker',
          description: `Gate "${gate}" returned no verdict (crashed, timed out, or produced output that did not match the schema). Treated as blocked: a gate that did not run cannot have passed. Re-run it, or escalate.`,
        },
      ],
    })),
  ];
}
return returned;
