# SCM Dashboard Global Next

Personal Vercel prototype for migrating the Python/Streamlit SCM Dashboard into a Next.js dashboard that can later move into SCM Portal.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict
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

## Required Env Vars

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_ALLOWED_DOMAIN=boosters.kr
NEXT_PUBLIC_API_PREFIX=/api
SCM_INVENTORY_SNAPSHOT_TABLE=
SCM_LOGISTICS_MOVES_TABLE=
```

Supabase Google OAuth must redirect back to:

```txt
http://localhost:3000/auth/callback
https://your-vercel-domain.vercel.app/auth/callback
```

Only Google users whose email ends with `@boosters.kr` are allowed to access the dashboard and API routes.

## Current Data Placeholders

Fill these after confirming the personal Supabase schema:

- `SCM_INVENTORY_SNAPSHOT_TABLE`
- `SCM_LOGISTICS_MOVES_TABLE`

Expected columns are typed in `src/lib/scm-dashboard/types.ts`. If the real schema differs, update `queries.ts` and `transform.ts` rather than burying mapping logic inside React components.

## Vercel Deploy

1. Import `ysjeon-bstrs/scm-dashboard-global-next` into Vercel.
2. Add the env vars above in Vercel Project Settings.
3. Configure Supabase Google OAuth redirect URLs.
4. Deploy and open `/global/scm-dashboard`.

## Future SCM Portal Integration

Prototype route:

```txt
src/app/global/scm-dashboard/
src/app/api/scm-dashboard/
```

Expected portal route:

```txt
src/app/automation/global/scm-dashboard/
src/app/api/automation/scm-dashboard/
```

Client fetch paths are centralized through `NEXT_PUBLIC_API_PREFIX`, so portal integration should set:

```env
NEXT_PUBLIC_API_PREFIX=/api/automation
```

Do not copy the prototype shell into SCM Portal. Move only the dashboard page, components, and `src/lib/scm-dashboard` logic, then let the official portal shell own navigation, auth frame, and menu registration.
