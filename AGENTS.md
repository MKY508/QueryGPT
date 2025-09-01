# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: Flask API, OpenInterpreter integration, database access, routing, prompts.
- `frontend/`: Static UI (HTML/CSS/JS). No build step required.
- `config/`: Runtime configuration (e.g., `config.json`, `models.json`, onboarding config).
- `tests/`: Unit and integration tests.
- `output/` and `backend/output/`: Generated artifacts (charts, reports). Treated as runtime output.

## Build, Test, and Development Commands
- First‑time setup
  - `./setup.sh` – create venv and install Python dependencies.
- Run locally
  - `./start.sh` – start the Flask server and UI (auto‑detects ports).
  - Alternative: `pip install -r requirements.txt && python backend/app.py`.
- Tests
  - `pytest -q` – run unit/integration tests under `tests/`.

## Coding Style & Naming Conventions
- Python: 4‑space indentation, `snake_case` for functions/variables, `CapWords` for classes.
- JS/HTML/CSS: keep files modular; prefer small pure functions; avoid inline styles.
- Keep modules focused; avoid cross‑layer imports (e.g., frontend ↔ backend).
- Prefer explicit returns and error handling over implicit fallthroughs.

## Testing Guidelines
- Framework: `pytest` (unit under `tests/unit/`, integration under `tests/integration/`).
- Naming: `test_<module>.py`, functions `test_<behavior>()`.
- Cover: happy paths, edge cases (empty inputs, timeouts), and security checks (read‑only SQL).
- Run: `pytest -q`; add fixtures for DB/config as needed.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
  - Example: `feat(progress): add SSE stream for friendly status`
- PRs should include:
  - What/why summary, screenshots (UI), and reproduction/validation steps.
  - Linked issues, migration/rollback notes, and risk assessment.

## Security & Configuration Tips
- Never commit secrets. Use `.env` for `API_KEY`, DB creds; `config/config.json` must omit passwords.
- DB access is read‑only; reject non‑SELECT queries in APIs.
- Outputs go to `output/` (served via `/output/<file>` with extension allow‑list).
- Prefer SSE `/api/chat/stream` for user‑friendly, code‑free progress.
