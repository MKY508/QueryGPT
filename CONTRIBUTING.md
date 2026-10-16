# Contributing to ReceiptBI

Thank you for helping improve ReceiptBI. 中文贡献同样欢迎；Issue 和 Pull Request 可以使用中文或英文。

## 中文速览

- 提交前先搜索已有 Issue，并选择 Bug、功能建议或使用帮助模板。
- 涉及较大行为或界面变化时，请先开 Issue 对齐方向。
- 开发环境需要 Python 3.11+、uv 和 Node.js 24 LTS（见 `.nvmrc`），前端统一使用 npm；修改 SQLite 执行器时才需要 Rust。
- Pull Request 需要写清问题、结果和验证方式；界面改动请附截图。
- 不要上传凭据、个人信息或私有业务数据。

## Before you start

- Search existing issues before opening a new one.
- Use the issue form that best matches your request.
- Keep each pull request focused on one problem.
- Do not include credentials, personal data, or private business datasets.
- For a larger behavior or UI change, open an issue first so the direction can be agreed before implementation.

## Development setup

ReceiptBI development uses Python 3.11+, uv, Node.js 24 LTS (see `.nvmrc`), and npm. Rust is required only when changing the SQLite executor. See [development prerequisites](docs/DEVELOPMENT.md#prerequisites) for installation guidance.

```bash
git clone https://github.com/MoonMao42/ReceiptBI.git
cd ReceiptBI
./start.sh install dev
./start.sh doctor
./start.sh
```

The frontend runs at `http://127.0.0.1:3000` and the API at `http://127.0.0.1:8000`.

## Making a change

1. Fork the repository and create a short-lived branch.
2. Follow the existing code and product patterns.
3. Add or update tests for behavior that changes.
4. Update user-facing documentation when the workflow changes.
5. Use a descriptive commit message, such as `fix: ...`, `feat: ...`, or `docs: ...`.

## Checks

Run the checks related to your change:

```bash
./start.sh test backend
./start.sh test frontend
```

Focused checks are also available:

```bash
# Backend
cd apps/api
ruff check .
ruff format --check .
mypy --config-file mypy.ini
pytest tests/

# Frontend
cd apps/web
npm run lint
npm run type-check
npm run test

# SQLite executor
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

You do not need to run unrelated platform packaging locally. State what you tested in the pull request.

## Pull requests

A useful pull request includes:

- the problem and the intended result;
- the important implementation choices;
- screenshots for visible UI changes;
- the checks you ran;
- any remaining limitations or follow-up work.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE) and follows the [Code of Conduct](CODE_OF_CONDUCT.md).
