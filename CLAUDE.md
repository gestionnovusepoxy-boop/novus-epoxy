# Novus Epoxy — Project Rules

## Project Overview

Novus Epoxy — planchers époxy haut de gamme (Québec).
Repo: `gestionnovusepoxy-boop/novus-epoxy`.
Site vitrine: novusepoxy.ca (PHP 8.2 custom sur Hostinger — accès CMS seulement, pas d'accès hPanel).

## Architecture

```
dashboard/       → Next.js 15 sur Vercel (app principale)
  app/api/       → API routes (submissions, stats, emails, track)
  app/dashboard/ → Pages admin (soumissions, emails, stats)
  lib/db.ts      → Connexion Neon PostgreSQL serverless
  middleware.ts   → Rate limiting + CORS endpoints publics
hostinger/       → PHP legacy (pas déployé — conservé comme référence)
database/        → Schémas SQL (PostgreSQL = production, MySQL = legacy)
```

- **DB** : Neon PostgreSQL (DATABASE_URL sur Vercel)
- **Auth** : NextAuth v5, magic link via Resend, 1 admin autorisé (ADMIN_EMAIL)
- **Tracker** : tracker.js injecté sur novusepoxy.ca → POST /api/track sur Vercel
- **Polling** : 30s refresh, pause auto si onglet caché

## Code Style

- Noms de variables/fonctions en anglais, UI en français.
- 2 espaces pour JS/TS/JSON. Pas de code commenté en commit.
- Pas de over-engineering. Solution minimale qui fonctionne.

## Git Workflow

- Branch from `main`. PR names: `feat/`, `fix/`, `chore/`, `docs/`.
- Squash merge PRs. Never force-push to `main`.
- Commits: short imperative subject line.

## Security

- Never commit secrets (.env, API keys, credentials).
- SQL: toujours paramétrisé ($1, $2...) — JAMAIS d'interpolation de string dans les requêtes.
- Endpoints publics (/api/track, /api/submissions POST) protégés par rate limiting dans middleware.ts.
- Validate inputs at system boundaries.

## CI / GitHub Actions

- `claude.yml` — @claude mentions sur issues/PRs + auto-review PRs.
- `claude-maintenance.yml` — cron lundi 3h UTC.
- `claude-triage.yml` — auto-label P0-P3 nouvelles issues.
- `deploy-vercel.yml` — auto-deploy dashboard sur push `dashboard/**`.
- `deploy-hostinger.yml` — legacy, FTP (non configuré).

## Issue Labels

| Label | Description |
|-------|-------------|
| `P0` | Critical — fix immédiatement |
| `P1` | High — fix ce sprint |
| `P2` | Medium — backlog |
| `P3` | Low — nice-to-have |
