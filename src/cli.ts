// Local test CLI — bypasses MCP transport, calls orchestrators directly.
//
// enrich_company:
//   bun src/cli.ts "Stripe"
//   bun src/cli.ts "stripe.com"
//   bun src/cli.ts "Acme Corp" "San Francisco"
//
// compare_companies:
//   bun src/cli.ts --compare "stripe.com" "adyen.com"
//   bun src/cli.ts --compare "Notion" "Linear"
import "dotenv/config";
import { enrichCompany } from "./orchestrator/enrichment.js";
import { compareCompanies } from "./orchestrator/comparison.js";

const args = process.argv.slice(2);

// ---- compare mode ----------------------------------------------------------
if (args[0] === "--compare") {
  const query1 = args[1];
  const query2 = args[2];

  if (!query1 || !query2) {
    console.error("Usage: bun src/cli.ts --compare <query1> <query2>");
    process.exit(1);
  }

  console.log(`\nComparing: "${query1}" vs "${query2}"\n`);

  const t0 = Date.now();
  try {
    const result = await compareCompanies([
      { query: query1 },
      { query: query2 },
    ]);
    const elapsed = Date.now() - t0;
    console.log(`\n✓ Done in ${elapsed}ms\n`);
    // Print narrative first for quick read, then full JSON
    console.log("── Narrative ──────────────────────────────────────────");
    console.log(result.narrative);
    console.log("\n── Meta ───────────────────────────────────────────────");
    console.log(JSON.stringify(result.meta, null, 2));
    console.log("\n── Full output ────────────────────────────────────────");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`\n✗ Failed in ${elapsed}ms:`, err);
    process.exit(1);
  }
  process.exit(0);
}

// ---- enrich mode (default) -------------------------------------------------
const query = args[0];
if (!query) {
  console.error(
    "Usage:\n" +
      "  bun src/cli.ts <query|domain> [location]\n" +
      "  bun src/cli.ts --compare <query1> <query2>",
  );
  process.exit(1);
}

const location = args[1];

console.log(`\nEnriching: "${query}"${location ? ` (${location})` : ""}\n`);

const t0 = Date.now();

try {
  const result = await enrichCompany(query, location);
  const elapsed = Date.now() - t0;
  console.log(`\n✓ Done in ${elapsed}ms\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const elapsed = Date.now() - t0;
  console.error(`\n✗ Failed in ${elapsed}ms:`, err);
  process.exit(1);
}
