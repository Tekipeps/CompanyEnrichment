Architecture
Protocol Architecture

How the marketplace, settlement layer, and safety model work together
​
Overview
Context is built on a code-execution paradigm. Instead of rigid “tool calling” schemas, the runtime can plan and execute tool interactions using typed MCP metadata, then settle economics according to the active mode (Query or Execute). The architecture consists of five layers:

    The Marketplace — Supply of tools from developers
    The Agent — Demand from users and developers via Query + Execute modes
    The Handshake Layer — Secure user-approval flow for signatures, transactions, and OAuth (guide)
    The Protocol — Settlement layer on Base
    Context Injection — User data for personalized tools

​
The Marketplace (Supply)
Developers register Tools (the marketplace listing) powered by standard Model Context Protocol servers. Paste your endpoint URL and Context auto-discovers methods via tools/list.
​
Terminology
Term Definition
Tool The marketplace listing (what users see in discovery/search)
Method A concrete MCP method (tools/call) exposed under a listing
Mode Where a method is eligible: answer, execute, or both (set via \_meta.surface)
​
How It Works

    You build an MCP server exposing your data/APIs
    You register it as an MCP listing with a listing response price and optional method-level execute pricing metadata
    Query runtime selects query-eligible methods; Execute runtime selects methods with explicit per-call pricing
    You get paid in USDC on Base through deferred settlement flows (query turns and execute-session batches)

​
The Data Broker Standard
Context is not a text-based chat platform — it is a Structured Data Marketplace. We treat your tool like a financial API, not a conversational bot.
​
Why outputSchema and structuredContent Matter
The MCP specification defines outputSchema and structuredContent as optional features for tools. Context requires them for all paid tools because structured data enables powerful marketplace features:
Feature Without Schema With Schema
AI Code Generation Agent guesses response format Agent writes precise parsing code
Type Safety Runtime errors, broken parsing Guaranteed structure
Dispute Resolution Manual review required Auto-adjudicated on-chain
Trust Signal Unknown reliability ”Data Broker” verified
​
Why Context Requires These Fields
While optional in vanilla MCP, Context requires structured outputs because:

    AI Agent Benefit: The agent uses your outputSchema to write accurate TypeScript code that parses your response correctly.
    Payment Verification: Our smart contracts can verify that your returned JSON matches your promised schema.
    Dispute Resolution: Schema mismatches can be auto-adjudicated on-chain without manual review.

Result: You are not just a “Prompt Engineer” — you are a Data Broker selling verifiable information on-chain.
​
The Agent (Demand)
When a user asks a complex question (e.g., “Is it profitable to arb Uniswap vs Aave?”), the Agent:
1

Discover
Finds relevant tools from the marketplace (or uses pre-selected ones)
2

Plan
Creates a solution using composability
3

Write Code
Generates code to invoke the necessary paid Tools via callMcpSkill()
4

Execute
Runs the code securely in our sandbox
5

Synthesize
Combines results into a coherent answer and streams it to the user
6

Settle
After the response is delivered, payment is settled in the background via ContextRouter (deferred settlement — tool fees are waived if execution fails)
Composability is the superpower of Context. Any frontier model can stitch together disparate tools into a coherent workflow, creating infinite new use cases from your single MCP server.
​
The Librarian Model (Canonical)
Context runs one marketplace with two modes:

    User A (Query): Context is the librarian. You ask a question and pay once for a curated response.
    User B (Execute): Your app/agent is the librarian. You select methods directly and pay per execute call within a session budget.
    Both in one app: SDK clients can invoke both models side-by-side.

Compatibility: some API/SDK fields still use legacy names like pricePerQuery. In this rollout, Query billing semantics are listing-level per response turn. A future major release can add response-named aliases (for example, pricePerResponse) before deprecating legacy names.
​
The Protocol (Settlement)
All value flows through ContextRouter.sol on Base, with mode-specific settlement semantics:

    Query mode (/api/v1/query) keeps deferred settlement after the response is delivered.
    Execute mode (/api/v1/tools/execute) uses execute sessions (maxSpendUsd) with automatic payment in deferred batches.

​
How Settlement Works
For Query mode:

    User sets a spending cap (ERC-20 allowance on ContextRouter) — one-time setup
    Before execution, the server performs a read-only pre-flight check (balance + allowance) — no gas cost
    Tools execute and the AI response is streamed to the user
    After the response is fully delivered, the server settles payment in the background via the operator wallet
    If settlement fails, it is retried automatically (up to 5 attempts with exponential backoff)

For Execute mode:

    User spending cap (allowance) is checked as the long-lived global ceiling
    Client starts an execute session with maxSpendUsd (short-lived run budget)
    Each execute call accrues method-level price (_meta.pricing.executeUsd) into session spend
    Session spend is flushed to pending settlement in deferred batches (threshold/TTL/close)
    Session responses expose methodPrice, spent, remaining, and maxSpend

Key benefit: Both modes avoid blocking users on on-chain settlement. Query responses and execute results return first, then settlement is handled asynchronously. Failed executions do not silently overcharge successful-call economics.
​
Payment Distribution
Recipient Share
Tool Developer 90%
Protocol Treasury 10%
When multiple tools are used, settlements can be batched (query turn batches and execute-session batches).
​
Staking System
All tools (including free) require a minimum stake, enforced on-chain.
Tool Type Minimum Stake
Free Tools $10 USDC
Paid Tools $10 USDC or 100× listing response price (whichever is higher)
​
Stake Properties

    Fully refundable with a 7-day withdrawal delay
    Creates accountability and enables slashing for fraud
    On-chain enforcement via smart contracts

​
Security: Financial Protocol Architecture
We use Asymmetric Request Signing (RS256) to secure the marketplace. This is not just “auth” it’s the foundation of a financial protocol.
​
Free vs Paid Requirements
Tool Type Security Middleware Rationale
Free Tools ($0.00) Optional Great for distribution and adoption
Paid Tools ($0.01+) Mandatory We cannot route payments to insecure endpoints
If you’re building a free tool, you can skip security middleware entirely. But for paid tools, the middleware ensures that only legitimate, paid requests from the Context platform can execute your code.
​
Why This Matters (for Paid Tools)
Approach Result
Without Auth A toy — anyone can curl your endpoint
With Shared Secrets A security liability secrets can leak
With Asymmetric Signing Professional infrastructure (like Stripe/Visa)
​
How It Works

    Platform signs requests with a private key (stored securely in environment)
    Tool servers verify requests using the public key (distributed via SDK)
    Short-lived tokens (2-minute expiration) prevent replay attacks

​
JWT Claims
Claim Description
iss https://ctxprotocol.com (issuer)
aud Tool endpoint URL (audience)
toolId Database ID of the tool being called
iat Issue timestamp
exp Expiration (2 minutes from issue)
​
For MCP Tool Developers
Secure your endpoint with a single line:

import { createContextMiddleware } from "@ctxprotocol/sdk";

// 1 line to secure your endpoint
app.use("/mcp", createContextMiddleware());

​
Context Injection (User Data)
For tools that need access to user-specific data (e.g., “Analyze my positions” or “Check my balances”), Context uses a Context Injection pattern. The platform fetches user data client-side and injects it directly into your tool’s arguments — your server never sees private keys or credentials.
Context Type Description
"hyperliquid" Hyperliquid perpetuals & spot positions
"polymarket" Polymarket prediction markets
"wallet" Generic EVM wallet balances
Context Injection Guide
Full guide: declaring requirements, handling data, supported context types
​
Tool Safety Limits
Each tool invocation runs inside a sandboxed code-execution environment.
​
MCP Tools Limits
Limit Value Purpose
Max calls per response turn 100 Prevent runaway loops in Query runtime
VM timeout 5000ms Code execution limit
MCP execution timeout ~60 seconds Encourages pre-computed products
Every response-turn MCP call increments an internal counter. Once executionCount >= 100, the platform throws an error for that turn.
The ~60 second timeout is intentional. This limit is enforced at the platform/client level (not by MCP itself) and serves as a quality forcing function. It encourages data brokers to build pre-computed insight products rather than raw data access tools.See Build & List Your Tool for detailed guidance on product architecture.
​
Runtime Cancellation and Retry Semantics

    Query execution timeouts now propagate cancellation to in-flight MCP calls, so requests do not continue burning API quota after the turn has timed out.
    Infrastructure-style failures (for example: 429, auth failures, upstream timeout/unavailable responses) are treated as non-healable for that turn and skip code-rewrite self-healing loops.
    Self-healing retries are still used for likely code/data-shape issues (property mismatch, parsing errors), where retries can improve outcomes.
    If completeness checks indicate a capability/tier constraint (for example: required metric is unavailable on the current plan), the platform avoids repeated same-tool rewrite loops and returns best-effort output with limitations.
    Reflection retries are conservative for isolated nulls: a single non-critical null field (especially when outputs include capability-limit signals) does not trigger repeated code rewrites.
    Tool contributors can publish pacing hints in _meta.rateLimit / _meta.rateLimitHints (maxRequestsPerMinute, cooldownMs, maxConcurrency, supportsBulk, recommendedBatchTools, notes), which are surfaced to planning prompts.
    Runtime pacing now combines declared hints with adaptive feedback: on rate-limit/timeout/abort signals it increases cooldowns, and after stable successes it gradually relaxes back toward declared baselines.
    Example implementation: Coinglass contributor server.
    Implementation guide: Tool Metadata.

​
Economic Model
Scenario Behavior
Free tools ($0.00) Can be used immediately without payment
Query mode Pay-per-response (~$0.10), query-eligible method selection, up to 100 MCP calls per turn, automatic payment after delivery
Execute mode Per-call method pricing (~$0.001) inside execute sessions, automatic payment in deferred batches
Unpriced execute methods Query-only — invisible in Execute mode until \_meta.pricing.executeUsd is set
Settlement fails Retried automatically (up to 5 attempts), then platform absorbs
Why execute pricing is ~1/100 of response pricing: A single Query response can invoke up to 100 method calls per turn, all covered by one flat response fee. When SDK consumers pay per-execute-call, the per-call price must be proportionally lower. A common starting point is execute price = listing response price / 100.
Execute mode gating: Methods without explicit \_meta.pricing.executeUsd do not appear in SDK-level Execute discovery. They remain usable in Query mode only. Contributors must set execute pricing (either via the contribute form or in MCP server \_meta) to unlock Execute visibility. See Tool Metadata for configuration details.
​
SDK Payment Modes
The SDKs expose two modes, reflecting Context’s role as both a response marketplace and an execution marketplace:
Mode Endpoint Payment Model Settlement Timing What You Get
Execute (client.tools.execute()) /api/v1/tools/execute Per execute call Session accrual + automatic batch payment Raw data + explicit spending limit
Query (client.query.run()) /api/v1/query Pay-per-response Deferred (post-response) AI-synthesized answer from the full agentic pipeline
Execute is for precision — you call specific methods with explicit execute pricing and get raw data + session spend visibility. Good for custom pipelines and deterministic orchestration. Query is for intelligence — you ask a natural-language question, and the server handles tool discovery, multi-tool orchestration (up to 100 MCP calls per response turn), targeted self-healing retries, completeness checks, and AI synthesis. One flat fee, curated answer. This is the same agentic pipeline that powers the client app.
Why offer both? Different consumers have different needs. An agent building a custom trading strategy wants raw data and full control (Execute). An agent answering user questions wants curated intelligence without managing orchestration (Query). Context serves both.

https://docs.ctxprotocol.com/architecture/protocol
