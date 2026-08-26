# TradeSafe Africa

An African cross-border trade intelligence and transaction-coordination
platform: discover import demand, find nearby African supply, calculate
complete landed costs, post buying/selling/freight requirements, get
matched with verified counterparties, and run the resulting deal through a
private deal room — evidence checks, documents, milestones, disputes.

Runs on [vinext](https://github.com/cloudflare/vinext) (Next.js
reimplemented on Vite) deployed to Cloudflare Workers, with D1 for
relational data and R2 for private documents.

See:
- **`docs/AUDIT.md`** — architecture, what works, what's broken, and the
  phased build-out plan this codebase is following.
- **`docs/DEPLOYMENT.md`** — local dev, migrations, and how to deploy.

## Quick start

```bash
npm ci
cp .dev.vars.example .dev.vars   # then set SESSION_SECRET — see docs/DEPLOYMENT.md
npm run cf-typegen
npm run db:migrate:local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server (`vinext dev`) |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` (regenerates Cloudflare binding types first) |
| `npm test` | Build + run the test suite |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from `db/schema.ts` changes |
| `npm run db:migrate:local` / `:remote` | Apply migrations to local Miniflare / the real D1 database |
| `npm run preview` / `npm run deploy` | Deploy to the Cloudflare preview / production environment |

Full deployment walkthrough — including one-time Cloudflare account setup
and rollback — is in `docs/DEPLOYMENT.md`.
