import "dotenv/config";
import express from "express";
import router from "./router";

const app = express();
app.use(express.json());
app.use(router);

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(
    `🚀 Company Enrichment MCP Server running on http://localhost:${PORT}`,
  );
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

// Keep the Bun process alive (Bun's event loop exits early unlike Node.js)
process.stdin.resume();
