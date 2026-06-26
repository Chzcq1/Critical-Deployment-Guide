# Digital Product Store

A full-stack automated digital product store with Telegram Bot integration. Customers browse products on the storefront, submit payment proof, and get Telegram group access automatically after admin approval.

## Run & Operate

- `artifacts/api-server: API Server` workflow — runs the Python FastAPI backend (port 8080)
- `artifacts/store: web` workflow — runs the React Vite storefront (port 24964)

## Stack

- **Frontend**: React + Vite, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion, Wouter
- **Backend**: Python FastAPI, SQLAlchemy (PostgreSQL), python-telegram-bot (webhook mode)
- **Database**: PostgreSQL (Supabase or any external provider via `DATABASE_URL`)
- **Bot**: Telegram webhook at `/webhook`, integrated into FastAPI

## Where things live

- `backend/main.py` — FastAPI app entry point (lifespan, CORS, routers)
- `backend/models.py` — SQLAlchemy models: Product, Order, OTPSession
- `backend/bot.py` — Telegram bot helper functions (approve, reject, OTP, webhook setup)
- `backend/routes/` — API route handlers (products, orders, admin, auth)
- `backend/webhook.py` — Telegram webhook handler (callback_query for approve/reject)
- `artifacts/store/src/pages/StoreFront.tsx` — Customer storefront
- `artifacts/store/src/pages/AdminPanel.tsx` — Admin CRUD panel

## Required Environment Variables

Set these in the Replit Secrets panel (or `.env` for local/Render):

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `DATABASE_URL` | PostgreSQL connection string (e.g. Supabase) |
| `ADMIN_GROUP_ID` | Telegram group ID where bot sends order notifications |
| `BOT_USERNAME` | Bot username without `@` (for Telegram Login Widget) |
| `WEBHOOK_URL` | Full public URL for Telegram webhook (e.g. `https://your-app.onrender.com/webhook`) |
| `SECRET_KEY` | Random secret for admin session signing |
| `VITE_BOT_USERNAME` | Same as BOT_USERNAME, for the React frontend |

## Render Deployment

Start command:
```
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

Build command (build React frontend first):
```
pnpm --filter @workspace/store run build
```

The FastAPI app automatically serves the built React app as static files at the root, and handles `/api/*` and `/webhook` on the same process. One Render web service handles everything.

## Architecture decisions

- Python FastAPI backend handles all routes (API, webhook, and static frontend serving)
- No SQLite — PostgreSQL only, Supabase-compatible via `DATABASE_URL`
- Telegram bot uses webhook mode (not polling) for Render compatibility
- All bot credentials are optional at startup — the server starts even without them
- Admin OTP is sent to the admin group chat (not the user's DM) for security
- Single-use invite links (`member_limit=1`) per Telegram group per approved order

## Product

- **Customer storefront**: Browse products, login via Telegram Login Widget, submit payment slip or TrueMoney link
- **FOMO timer**: Per-product 15-minute countdown in localStorage shows urgency on discounted items
- **Admin panel**: OTP-protected CRUD dashboard for products and orders
- **Bot flow**: Order → Admin group notification → Approve/Reject buttons → Customer DM with access links

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The api-server artifact is configured to run Python FastAPI, not Node.js. Do not revert to the Node.js server.
- Run `pnpm --filter @workspace/store run build` before deploying so FastAPI can serve static files.
- `WEBHOOK_URL` must be the full public URL (e.g. Render URL) — set it after first deploy, then the bot will receive updates.
- The bot needs admin rights in the target Telegram groups to create invite links.
