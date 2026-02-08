# @app/indexer

A high-performance Polymarket indexer that provides real-time market data with sub-second price updates via WebSocket integration.

## Features

- **Full Data Sync**: ~186K events, ~429K markets, ~7K live events, ~26K live markets
- **Real-time Price Updates**: Sub-second price updates via WebSocket
- **Multiple Data Sources**: Integrates Gamma API, CLOB API, Data API, and WebSocket
- **PostgreSQL Storage**: Persistent storage with Drizzle ORM
- **RESTful API**: Hono-based API server with comprehensive endpoints
- **Background Sync**: Periodic batch sync of markets, events, and trades
- **Docker Ready**: Full containerized deployment

## Quick Start

### Option 1: Docker (Full Stack)

From the project root:
```bash
# Start all services (db, redis, indexer)
pnpm docker:up

# View logs
pnpm docker:logs

# Stop everything
pnpm docker:down
```

### Option 2: Local Development

#### 1. Start PostgreSQL

```bash
cd packages/indexer
docker compose up -d
```

#### 2. Run Migrations

```bash
pnpm db:migrate
```

#### 3. Start the Indexer

```bash
# Run both API server and sync worker
pnpm start

# Or run separately:
pnpm server  # API server only
pnpm worker  # Sync worker only
```

## API Endpoints

### Markets
- `GET /markets` - List markets with filters
- `GET /markets/:id` - Single market with event
- `GET /markets/:id/history` - Price history
- `GET /markets/:id/trades` - Recent trades
- `GET /markets/search?q=` - Full-text search
- `POST /markets/prices` - Batch price lookup

### Events
- `GET /events` - List events
- `GET /events/:id` - Event with markets

### Stats
- `GET /stats` - Platform overview
- `GET /stats/sync` - Sync status

### Health
- `GET /health` - Health check
- `GET /health/live` - Liveness probe
- `GET /health/ready` - Readiness probe

## Configuration

See `.env.example` for all configuration options:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polymarket

# Server
PORT=3001
HOST=0.0.0.0

# Sync intervals (milliseconds)
MARKETS_SYNC_INTERVAL=300000  # 5 minutes
PRICE_FLUSH_INTERVAL=1000     # 1 second

# Logging
LOG_LEVEL=info
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                              │
│  Gamma API │ CLOB API │ Data API │ WebSocket (Real-time)    │
└──────┬─────────┬──────────┬──────────────┬──────────────────┘
       │         │          │              │
       ▼         ▼          ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                  SYNC ORCHESTRATOR                           │
│  ┌─────────────────────┐  ┌───────────────────────────────┐ │
│  │    BATCH SYNC       │  │      REAL-TIME SYNC           │ │
│  │  (Every 1-5 min)    │  │      (WebSocket)              │ │
│  └─────────────────────┘  └───────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     PostgreSQL                               │
│  Markets │ Events │ Price History │ Trades │ Sync State     │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Server (Hono)                       │
│  /markets │ /events │ /stats │ /health                      │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

- **events**: Event metadata and aggregated stats
- **markets**: Market data with real-time prices
- **tags**: Categories for events and markets
- **price_history**: Time-series price data
- **trades**: Individual trade records
- **wallets**: User profiles and stats (future)
- **positions**: User positions (future)
- **sync_state**: Sync progress tracking

## Development

```bash
# Type checking
pnpm typecheck

# Generate new migrations after schema changes
pnpm db:generate

# Open Drizzle Studio
pnpm db:studio

# Run tests
pnpm test
```

## Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start with hot reload |
| `start` | Production start (API + Worker) |
| `server` | API server only |
| `worker` | Sync worker only |
| `db:generate` | Generate migrations |
| `db:migrate` | Run migrations |
| `db:push` | Push schema directly |
| `db:studio` | Open Drizzle Studio |

## Docker Deployment

The indexer includes a Dockerfile for containerized deployment:

```bash
# Build the image
docker build -f packages/indexer/Dockerfile -t polymarket-indexer .

# Run with environment variables
docker run -d \
  -e DATABASE_URL=postgres://user:pass@host:5432/polymarket \
  -e PORT=3005 \
  -p 3005:3005 \
  polymarket-indexer
```

The `start.sh` script automatically runs migrations before starting the server.

## Notes

- **Batch Size**: Sync uses `FETCH_BATCH_SIZE=500` to stay under Gamma API limits
 - **Initial Sync**: First sync takes several minutes to fetch all ~186K events
- **Memory**: Full dataset requires ~2GB RAM for comfortable operation
