FROM oven/bun:1 AS builder
WORKDIR /app

# Enable corepack (optional for bun, but good practice if any mixed package managers exist)
# Copy package files
COPY package.json bun.lock ./

# Install dependencies using bun
RUN bun install --frozen-lockfile

# Copy the rest of the application files
COPY . .

# Generate Prisma client and build
RUN bun run db:generate && bun run build

# Final lightweight stage
FROM oven/bun:1-alpine
WORKDIR /app

# Copy built assets and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Create a data directory and expose it as a volume
# This is where the SQLite database will reside to persist across container restarts
RUN mkdir -p /app/data
ENV DATABASE_URL="file:/app/data/dev.db"
VOLUME ["/app/data"]

# Expose the port the app runs on
EXPOSE 3000

# Run the compiled server using bun
CMD ["bun", "dist/index.js"]
