import "dotenv/config";
import { startServer } from "./server.js";

const REQUIRED_ENV_VARS = ["GEMINI_API_KEY", "DATABASE_URL"] as const;

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env.`,
    );
  }
}

async function main(): Promise<void> {
  validateEnv();
  await startServer();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[CompanyEnrichmentMCP] Fatal startup error: ${message}\n`,
  );
  process.exit(1);
});
