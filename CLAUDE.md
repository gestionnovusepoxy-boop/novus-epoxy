# Novus Epoxy — Project Rules

## Project Overview

**novus-epoxy** is managed by the `gestionnovusepoxy-boop` GitHub organization.

## Code Style

- Keep changes minimal and focused — avoid over-engineering.
- Prefer editing existing files over creating new ones.
- No trailing whitespace. Consistent indentation (2 spaces for JS/TS/JSON, 4 for Python).
- No commented-out code in commits.

## Git Workflow

- Branch from `main`. PR names: `feat/`, `fix/`, `chore/`, `docs/`.
- Squash merge PRs to keep history clean.
- Never force-push to `main`.
- Commits: short imperative subject line, body if needed.

## Security

- Never commit secrets, API keys, or credentials.
- All dependencies must pass `npm audit` (no high/critical vulnerabilities).
- Validate inputs at system boundaries.

## CI / GitHub Actions

- `claude.yml` — responds to `@claude` mentions on issues and PRs; auto-reviews every PR.
- `claude-maintenance.yml` — weekly Monday 3am UTC: dependency check, npm audit, stale issues, TODO scan.
- `claude-triage.yml` — auto-labels and prioritizes (P0–P3) every new issue.

## Issue Labels

| Label | Description |
|-------|-------------|
| `P0`  | Critical — fix immediately |
| `P1`  | High — fix this sprint |
| `P2`  | Medium — backlog |
| `P3`  | Low — nice-to-have |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `question` | Needs clarification |
| `documentation` | Docs only |

## Claude Behavior

- When reviewing PRs: be concise, focus on correctness and security.
- When triaging issues: always assign a priority label and explain why.
- When responding to `@claude`: stay on-topic, ask clarifying questions if needed.
- Do not create files unless necessary. Do not add unnecessary comments or docstrings.
