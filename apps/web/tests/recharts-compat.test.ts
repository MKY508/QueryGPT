import { createRequire } from "node:module";
import { expect, it } from "vitest";

it("lets Recharts recognize fragments created by the installed React runtime", () => {
  const require = createRequire(import.meta.url);
  const react = require("react");
  const chartRequire = createRequire(require.resolve("recharts"));
  const reactIs = chartRequire("react-is");
  expect(reactIs.isFragment(react.createElement(react.Fragment, null, "axis"))).toBe(true);
  expect(chartRequire("react-is/package.json").version).toBe(react.version);
});
