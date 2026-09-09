# Frontend integration checks

Run `node_modules/.bin/tsc --noEmit --incremental false` from `apps/web` when validating the complete frontend, including tests. Scoped dependency checks are useful during changes but do not establish this gate. Do not remove tests from the TypeScript configuration to make the gate pass.

Testing Library role queries accept `name`, not Playwright's `exact` option. String names already use exact matching; preserve regular expressions and predicates. See the [official ByRole API](https://testing-library.com/docs/queries/byrole/). The refactor removes 99 unsupported options from 22 files without changing names or assertions. Observer mocks explicitly declare callable signatures; heterogeneous tabular fixtures use record types rather than inferred unions involving inherited `toString`.

Current whole-program diagnostics contain no product-source errors and eight test errors across six files: history/semantic query parameter types, invalid preflight facts, an optional report-page version, and incomplete preflight/standing-analysis fixtures. The full type gate therefore still fails. Targeted observer/sort/validation/filter checks passed (18 cases), followed by workbench/cleaning/sort checks (26 cases, partly overlapping). No full build or full test suite was run.
