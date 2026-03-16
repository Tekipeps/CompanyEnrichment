# Company Enrichment MCP
An MCP tool that returns structured company intelligence from live web data — firmographics, funding history, key personnel, and growth signals.

Given any company name or domain, it returns:
- **Firmographics** — industry, headcount, headquarters, founded year, description
- **Funding history** — round type, amount, date, lead investors
- **Key personnel** — C-suite and founders with LinkedIn URLs
- **Growth signals** — hiring velocity, recent launches, leadership changes
- **Executive synthesis** — 2–3 sentence summary with confidence score

## Setup
```bash
# 1. Copy env file and fill in your API keys
cp .env.example .env

# 2. Install dependencies
bun install

# 3. Set up the database
bun run db:generate
bun run db:push
```

Required keys:
- `XAI_API_KEY` — get one at https://console.x.ai
- `EXA_API_KEY` — get one at https://exa.ai
- `DATABASE_URL` — PostgreSQL connection string

## Usage

### MCP Server
```bash
bun run dev      # development
bun run start    # production

# Health check
curl http://localhost:3000/health
```

### REST API
```bash
curl "http://localhost:3000/api/enrich?query=stripe.com"
curl "http://localhost:3000/api/enrich?query=Paystack&location=Nigeria"
```

## Tool: `enrich_company`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Company domain (`stripe.com`) or name (`Stripe`) |
| `location` | string | no | Country or city to disambiguate same-name companies |

Response time: ~10–25 seconds on cache miss. Repeat lookups are instant (30-day cache).

## How It Works

1. Domain resolution — company names are resolved to canonical domains via xAI
2. Cache check — PostgreSQL cache keyed by domain (30-day TTL)
3. On miss: parallel Exa web searches → Grok synthesis → structured output
4. Result cached and returned

## Data Sources
- **Exa** — live web search for company profiles, funding news, personnel
- **xAI Grok** — domain resolution and intelligence synthesis
- **PostgreSQL** — enrichment cache (Prisma)
