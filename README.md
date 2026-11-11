# Pantry

A mobile-first pantry and market-list app. Users start an order, add, edit and remove items, attach a receipt photo and archive the order. Admins manage products, users, coupons, item requests and feedback.

Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, MongoDB (Mongoose) and Auth.js (credentials + optional Google).

## Features

- **Market list and orders**: start an order, add/edit/remove/undo items, archive it with a receipt photo (zoomable viewer).
- **Pricing**: bulk prices and one-time coupons, claimed with a QR code or the built-in scanner.
- **Requests and feedback**: users request items or send feedback; admins review them.
- **Admin**: products (create, edit, merge), users, orders, coupons, requests, feedback and audit logs under `/admin`.
- **Auth**: email/password with forced password change, optional Google sign-in, toggleable registration.
- Light and dark themes.

## Requirements

- Node.js 24
- MongoDB

## Setup

```bash
npm install
cp .env.sample .env   # then fill it in
npm run dev           # http://localhost:3001
```

### Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (required) |
| `MONGODB_DB` | Database name |
| `AUTH_SECRET` | Session secret, generate with `npx auth secret` (required) |
| `AUTH_URL` | Public URL of the app; used for OAuth callbacks behind a proxy |
| `AUTH_TRUST_HOST` | Set `true` when behind a reverse proxy |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app (inlined at build time) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Optional Google sign-in. Redirect URI: `<AUTH_URL>/api/auth/callback/google` |
| `ALLOW_REGISTRATION` | Allow new accounts to register |
| `ALLOW_FIRST_LOGIN_ADMIN` | Make the first account to log in an admin |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3001 |
| `npm run build` | Production build (standalone output in `.next/standalone`) |
| `npm run start` | Serve the build on port 3001 |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `node scripts/check-mongo.js` | Check the MongoDB connection |

## Project layout

```
src/app/          routes, server actions and API routes (api/order-list, api/receipts, ...)
src/app/admin/    admin pages
src/components/   app components; ui/ holds the shared primitives (Button, Card, Dialog, ...)
src/lib/          data access, types and helpers
src/models/       Mongoose models
storage/receipts/ uploaded receipt photos (not committed)
```

## Docker

The image uses Next.js [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), so it ships only the traced server files and runs `node server.js` on port 3001.

```bash
docker compose build     # -> local/pantry:latest
docker compose up -d     # http://127.0.0.1:3001
```

- `.env` is mounted read-only at runtime. `NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them.
- `storage/` is mounted so receipts persist across container rebuilds.
- The container runs as UID 1002 (see `compose.yaml`); change `user:` to match the owner of `storage/` on your host.
