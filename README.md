# PuchiPix

Multi-site gallery, video, and forum-post downloader with a DAG-based orchestration engine.

## Project Structure

```
PuchiPix/
├── frontend/          # Next.js 16 (App Router) + React 19
├── backend/           # Go (chi router, PostgreSQL, DAG orchestration)
├── data/              # Runtime data (SQLite DB, gallery cache)
├── docker-compose.yml
└── README.md
```

## Architecture

- **Frontend**: Next.js 16 (App Router) + React 19 — proxy-only, no backend logic
- **Backend**: Go (chi router, PostgreSQL) — handles all API, DAG orchestration, scraping, downloading
- **Proxy**: Custom Next.js server (`frontend/src/server.ts`) forwards `/api/*` → Go backend (`:10541`)

## Tech Stack

- **Next.js 16** (App Router, standalone output) + **React 19**
- **TypeScript 5** (strict mode)
- **Go** (backend at `backend/`)
- **Socket.IO Client** (real-time progress via WebSocket to Go backend)
- **Tailwind CSS 4**
- **Zustand** (client state)

## Getting Started

```bash
# 1. Start Go backend (see backend/)
cd backend && make run

# 2. Start frontend dev server
cd frontend
pnpm install
pnpm dev
```

Frontend starts at `http://localhost:10540`, proxies API to Go backend at `localhost:10541`.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm test:typecheck` | TypeScript type check |

## Docker

```bash
cd frontend
pnpm docker:build
pnpm docker:run
```

## License

Private project.
