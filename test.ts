import "dotenv/config";
import { enrichCompany } from "./src/orchestrator/enrichment.js";

async function main() {
  const domain = "https://braudit.app";
  console.log(`Starting local test for domain: ${domain}`);

  if (!process.env.SCRAPING_BEE_API_KEY || !process.env.GEMINI_API_KEY) {
    console.error(
      "Missing required environment variables! Please set SCRAPING_BEE_API_KEY and GEMINI_API_KEY.",
    );
    process.exit(1);
  }

  try {
    console.time("EnrichmentDuration");
    const result = await enrichCompany(domain);
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
