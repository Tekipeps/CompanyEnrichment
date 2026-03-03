import "dotenv/config";
import { enrichCompany } from "./src/orchestrator/enrichment.js";

async function main() {
  const query = "Mugdevs"; // Can be a company name OR domain (e.g. "stripe.com")
  const location = "Nigeria"; // e.g. "United States" to disambiguate
  console.log(`Starting local test for: ${query}`);

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing required environment variable: GEMINI_API_KEY");
    process.exit(1);
  }

  try {
    console.time("EnrichmentDuration");
    const result = await enrichCompany(query, location);
    console.timeEnd("EnrichmentDuration");

    console.log("\n=================================");
    console.log("FINAL ENRICHMENT RESULT:");
    console.log("=================================\n");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

main();
