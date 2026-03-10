/**
 * CTX Pre-Submission Validation — ContextClient edition
 * Tests the live endpoint via @ctxprotocol/sdk (marketplace) or
 * @modelcontextprotocol/sdk (direct MCP) for pre-listing validation.
 * Usage: bun tmp_validate.ts
 */
import "dotenv/config";
import { ContextClient } from "@ctxprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ENDPOINT = "https://company-enrichment.tekipeps.com/mcp";
const API_KEY = process.env.CTX_PROTOCOL_SECRET_KEY ?? "";
const TOOL_NAME = "enrich_company";

// ── helpers ──────────────────────────────────────────────────────────────────

const pass = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string) => console.log(`  ❌ ${msg}`);
const warn = (msg: string) => console.log(`  ⚠️  ${msg}`);
const section = (title: string) =>
  console.log(`\n${"═".repeat(60)}\n${title}\n${"═".repeat(60)}`);

if (!API_KEY) {
  fail("CTX_PROTOCOL_SECRET_KEY is not set in .env — aborting");
  process.exit(1);
}

const client = new ContextClient({ apiKey: API_KEY });

// ── STEP 4.1: Discover the tool ───────────────────────────────────────────────

section("STEP 4.1 — Tool Discovery");
console.log(`Searching marketplace for: "${TOOL_NAME}"`);

let toolId: string | null = null;

try {
  const tools = await client.discovery.search({
    query: TOOL_NAME,
    mode: "query",
    surface: "answer",
    queryEligible: true,
  } as any);

  if (!tools || tools.length === 0) {
    warn("Tool not found in marketplace — not yet listed or not yet staked");
    warn("Falling back to direct MCP endpoint tests");
  } else {
    toolId = tools[0].id;
    pass(`Found tool: "${tools[0].name}" (id: ${toolId})`);
    pass(`Category: ${tools[0].category ?? "—"}`);
    pass(`Price: ${tools[0].price ?? "—"}`);
  }
} catch (e: any) {
  warn(`Discovery failed: ${e?.message ?? e}`);
  warn("Proceeding with direct MCP endpoint tests");
}

// ── STEP 4.2-4.3: Query mode tests (only if listed on marketplace) ────────────

const TRY_ASKING = [
  "What industry is ClickUp in and how many employees do they have?",
  "Who are the key executives at Notion?",
  "What is Vercel's latest funding round and valuation?",
  "Give me a full company profile for linear.app",
  "What growth signals exist for Zapier — hiring, funding, recent launches?",
  "Who founded Retool and what is their total funding?",
  "Is monday.com publicly listed? What is their ARR?",
  "Find the CEO and CTO of a Nigerian fintech called Paystack",
];

const queryResults: {
  prompt: string;
  pass: boolean;
  ms: number;
  note: string;
}[] = [];

if (toolId) {
  section("STEP 4.3 — Query Mode Tests");

  for (const prompt of TRY_ASKING) {
    console.log(`\nPrompt: "${prompt.slice(0, 70)}..."`);
    const t0 = Date.now();

    try {
      const answer = await client.query.run({
        query: prompt,
        tools: [toolId],
        queryDepth: "deep",
        includeDeveloperTrace: true,
      });

      const ms = Date.now() - t0;
      const trace = answer?.developerTrace;
      const text = answer.response;

      const isApology =
        /sorry|unable|cannot|don't have|no data/i.test(text) &&
        text.length < 200;

      if (isApology) {
        fail(`Generic apology response in ${ms}ms`);
        queryResults.push({
          prompt,
          pass: false,
          ms,
          note: "generic apology",
        });
      } else {
        pass(`✓ ${ms}ms | ${text.slice(0, 80)}`);
        queryResults.push({ prompt, pass: true, ms, note: "ok" });
      }

      if (trace) {
        console.log(
          `    trace: toolCalls=${answer.toolsUsed.map((tool) => tool.name).join(", ") ?? "?"}, selfHeal=${trace.selfHealCount ?? 0}, loops=${trace.loopCount ?? 0}`,
        );
      }
    } catch (e: any) {
      const ms = Date.now() - t0;
      fail(`Threw in ${ms}ms: ${e?.message ?? e}`);
      queryResults.push({
        prompt,
        pass: false,
        ms,
        note: String(e?.message ?? e).slice(0, 80),
      });
    }
  }
} else {
  // ── STEP 5: Direct MCP endpoint tests (pre-listing) ───────────────────────

  section("STEP 5 — Direct MCP Endpoint Tests (pre-listing)");

  const sampleArgs = [
    { query: "stripe.com" },
    { query: "notion" },
    { query: "jira" },
    { query: "paystack", location: "Nigeria" },
  ];

  // Connect raw MCP client to the live endpoint
  let mcpClient: Client | null = null;
  try {
    mcpClient = new Client({ name: "ctx-validator", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));
    await mcpClient.connect(transport);

    // Verify tool is listed
    const { tools } = await mcpClient.listTools();
    const toolDef = tools.find((t) => t.name === TOOL_NAME);

    if (!toolDef) {
      fail(`Tool "${TOOL_NAME}" not found in server tool list`);
    } else {
      pass(`Tool registered: "${toolDef.name}"`);

      // Validate description quality
      const desc = toolDef.description ?? "";
      if (desc.length < 200) {
        fail(
          `Description too short (${desc.length} chars) — needs "Try asking" + agent tips`,
        );
      } else if (!desc.includes("Try asking") && !desc.includes("try asking")) {
        warn(
          `Description (${desc.length} chars) — missing "Try asking" examples`,
        );
      } else {
        pass(`Description quality: ${desc.length} chars ✓`);
      }

      // Validate _meta fields
      const meta = (toolDef as any)._meta ?? (toolDef as any).annotations ?? {};
      if (meta.rateLimit) {
        pass(
          `_meta.rateLimit present: maxReq=${meta.rateLimit.maxRequestsPerMinute}, maxConc=${meta.rateLimit.maxConcurrency}`,
        );
      } else {
        warn("_meta.rateLimit not found — recommended for Execute mode");
      }

      if (meta.surface) {
        pass(`_meta.surface: "${meta.surface}"`);
      } else {
        warn(`_meta.surface not set`);
      }

      if ((meta as any).pricing?.executeUsd) {
        fail(
          `_meta.pricing.executeUsd is still set to "${(meta as any).pricing.executeUsd}" — remove it`,
        );
      } else {
        pass("_meta.pricing.executeUsd: not set ✓");
      }
    }
  } catch (e: any) {
    fail(`MCP connection failed: ${e?.message ?? e}`);
  }

  // Run tool calls
  const execResults: {
    query: string;
    pass: boolean;
    ms: number;
    confidence: number | null;
    note: string;
  }[] = [];

  if (mcpClient) {
    console.log("");
    for (const args of sampleArgs) {
      console.log(`\nCalling: ${TOOL_NAME}(${JSON.stringify(args)})`);
      const t0 = Date.now();

      try {
        const result = await mcpClient.callTool({
          name: TOOL_NAME,
          arguments: args,
        });
        const ms = Date.now() - t0;

        // Parse structured content
        const sc = (result as any).structuredContent as any;
        const text = (result.content as any)?.text ?? "";

        let parsed: any = sc;

        if (!parsed && text) {
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            /* raw text */
          }
        }

        const name = parsed?.firmographics?.name ?? null;
        const confidence = parsed?.dataQuality?.confidenceScore ?? null;
        const synthesis = parsed?.synthesis ?? null;
        const isError = (result as any).isError === true;

        if (isError) {
          fail(`${ms}ms → isError=true: ${text.slice(0, 120)}`);
          execResults.push({
            query: args.query,
            pass: false,
            ms,
            confidence,
            note: "isError",
          });
        } else if (!name) {
          fail(`${ms}ms → no firmographics.name`);
          execResults.push({
            query: args.query,
            pass: false,
            ms,
            confidence,
            note: "no firmographics",
          });
        } else if (!synthesis) {
          warn(`${ms}ms → ${name} (conf: ${confidence}) — missing synthesis`);
          execResults.push({
            query: args.query,
            pass: true,
            ms,
            confidence,
            note: "no synthesis",
          });
        } else {
          pass(
            `${ms}ms → ${name} | conf: ${confidence} | synthesis: ${synthesis.slice(0, 60)}...`,
          );
          execResults.push({
            query: args.query,
            pass: true,
            ms,
            confidence,
            note: "ok",
          });
        }
      } catch (e: any) {
        const ms = Date.now() - t0;
        fail(`${ms}ms → ${e?.message ?? e}`);
        execResults.push({
          query: args.query,
          pass: false,
          ms,
          confidence: null,
          note: String(e?.message ?? e).slice(0, 80),
        });
      }
    }

    try {
      await mcpClient.close();
    } catch (_) {
      /* ignore */
    }

    // Execute-mode summary table
    console.log("\n| Query | Pass | ms | Confidence | Note |");
    console.log("|-------|------|-----|------------|------|");
    for (const r of execResults) {
      const status = r.pass ? "✅" : "❌";
      console.log(
        `| ${r.query.padEnd(15)} | ${status} | ${r.ms} | ${r.confidence ?? "—"} | ${r.note} |`,
      );
    }

    const passed = execResults.filter((r) => r.pass).length;
    const avgMs = Math.round(
      execResults.reduce((s, r) => s + r.ms, 0) / execResults.length,
    );
    const avgConf =
      execResults
        .filter((r) => r.confidence !== null)
        .reduce((s, r) => s + (r.confidence ?? 0), 0) /
      execResults.filter((r) => r.confidence !== null).length;

    console.log(
      `\nExecute mode: ${passed}/${execResults.length} passed | avg ${avgMs}ms | avg confidence ${avgConf.toFixed(2)}`,
    );
    console.log(
      "Execute mode: " +
        (passed === execResults.length
          ? "✅ PASS"
          : passed > 0
            ? "⚠️  PARTIAL"
            : "❌ FAIL"),
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

section("FINAL SIGN-OFF");

if (queryResults.length > 0) {
  console.log("\n| Prompt | Pass | ms | Note |");
  console.log("|--------|------|-----|------|");
  for (const r of queryResults) {
    const status = r.pass ? "✅" : "❌";
    console.log(
      `| ${r.prompt.slice(0, 45)}... | ${status} | ${r.ms} | ${r.note} |`,
    );
  }

  const passed = queryResults.filter((r) => r.pass).length;
  const avgMs = Math.round(
    queryResults.reduce((s, r) => s + r.ms, 0) / queryResults.length,
  );

  console.log(
    `\nQuery mode: ${passed}/${queryResults.length} passed | avg ${avgMs}ms`,
  );
  console.log(
    "Query mode: " + (passed === queryResults.length ? "✅ PASS" : "❌ FAIL"),
  );
} else {
  console.log(
    "\nQuery mode: N/A (tool not listed on marketplace yet — submit to CTX to enable)",
  );
}

console.log("\nMarketplace listing:   ⏳ PENDING submission");
