// Local test CLI — bypasses MCP transport, calls enrichCompany() directly.
// Usage:
//   bun src/cli.ts "Stripe"
//   bun src/cli.ts "stripe.com"
//   bun src/cli.ts "Acme Corp" "San Francisco"
import "dotenv/config";
import { enrichCompany } from "./orchestrator/enrichment.js";

const args = process.argv.slice(2);

const query = args[0];
if (!query) {
  console.error("Usage: bun src/cli.ts <query|domain> [location]");
  process.exit(1);
}

// Location is the optional second positional arg
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
