# SCM Dashboard Global Next

Open-source Next.js migration of a supply chain management dashboard for inventory visibility, logistics movement tracking, Excel-based operations workflows, and AI-assisted analytics.

This repository is the public rewrite of an actively maintained Python/Streamlit SCM dashboard. The goal is to extract the reusable dashboard patterns, data transformation logic, and maintainer-friendly workflows into a modern TypeScript application that can be adapted to different SCM data sources.

## Current Scope

- Inventory snapshot dashboard with filterable grids and KPI cards
- Logistics movement and inbound/outbound tracking APIs
- Excel upload/export workflows for operations teams
- Supabase authentication and read-only data access patterns
- Server-side API routes for source-system integration
- Typed transformation layer for keeping business logic outside React components

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict mode
- Tailwind CSS v4
- Supabase Auth and read-only Supabase data access
- AG Grid Enterprise v35
- `xlsx` for in-memory Excel upload/export

## Local Run

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000/global/scm-dashboard`.

## Environment

Copy `.env.example` to `.env.local` and fill in values for your own Supabase project and optional source database.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_ALLOWED_DOMAIN=example.com
NEXT_PUBLIC_API_PREFIX=/api
SCM_INVENTORY_SNAPSHOT_TABLE=
SCM_LOGISTICS_MOVES_TABLE=
```

Supabase OAuth redirect URLs should include:

```txt
http://localhost:3000/auth/callback
https://your-deployment-domain.example/auth/callback
```

Server-only credentials must stay in `.env.local` or deployment secrets. Do not commit real API keys, OAuth client secrets, service-role keys, database passwords, or company data.

## Project Layout

```txt
src/app/global/scm-dashboard/       Dashboard route
src/app/api/scm-dashboard/          SCM API routes
src/components/scm-dashboard/       Dashboard UI components
src/lib/scm-dashboard/              Queries, transforms, types, and source clients
```

## Roadmap

- Replace private source assumptions with documented adapter interfaces
- Add sample datasets for local development and demos
- Add automated tests for transforms, API route behavior, and Excel workflows
- Document migration patterns from Streamlit/Python dashboards to Next.js
- Add maintainer automation for PR summaries, release notes, and security review

## Contributing

Issues and pull requests are welcome. The most useful contributions are focused improvements to typed SCM data models, test coverage, source adapters, dashboard accessibility, documentation, and security hardening.

Before opening a pull request:

1. Run `npm run lint`
2. Keep source-specific credentials and business data out of commits
3. Prefer small, reviewable changes with clear test or verification notes
