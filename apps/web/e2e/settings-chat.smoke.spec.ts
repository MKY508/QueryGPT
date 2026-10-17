import { expect, test } from "@playwright/test";

test("settings workflow and chat smoke test", async ({ page }) => {
  const suffix = Date.now().toString();
  const connectionName = `CI PostgreSQL ${suffix}`;
  const modelName = `CI Mock Model ${suffix}`;

  await page.goto("/settings");
  await expect(page.getByTestId("settings-tab-models")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByTestId("settings-tab-connections").click();
  await page.getByTestId("connection-add-button").click();
  await expect(page.getByTestId("connection-form")).toBeVisible();

  await page.getByTestId("connection-name-input").fill(connectionName);
  await page.getByTestId("connection-driver-select").selectOption("postgresql");
  await page.getByTestId("connection-host-input").fill("db");
  await page.getByTestId("connection-port-input").fill("5432");
  await page.getByTestId("connection-database-input").fill("receiptbi");
  await page.getByTestId("connection-username-input").fill("postgres");
  await page.getByTestId("connection-password-input").fill("postgres");
  await page.getByTestId("connection-submit-button").click();

  const connectionCard = page.locator('[data-testid^="connection-card-"]', {
    hasText: connectionName,
  });
  await expect(connectionCard).toBeVisible();
  await connectionCard.locator('[data-testid^="connection-test-"]').click();
  await expect(
    connectionCard.locator('[data-testid^="connection-test-result-"]'),
  ).toHaveAttribute("data-status", "success", { timeout: 15_000 });

  await page.getByTestId("settings-tab-models").click();
  await page.getByTestId("model-add-button").click();
  await expect(page.getByTestId("model-form")).toBeVisible();

  await page.getByTestId("model-preset-custom").click();
  await page.getByTestId("model-name-input").fill(modelName);
  await page.getByTestId("model-id-input").fill("receiptbi-ci");
  await page.getByTestId("model-base-url-input").fill("http://mock-llm:4010/v1");
  await page.getByTestId("model-api-key-input").fill("ci-test-key");
  await page.getByTestId("model-default-checkbox").check();
  await page.getByTestId("model-submit-button").click();

  const modelCard = page.locator('[data-testid^="model-card-"]', {
    hasText: modelName,
  });
  await expect(modelCard).toBeVisible();
  await expect(
    modelCard.locator('[data-testid^="model-health-"]'),
  ).toHaveText(/^(可用|Available)$/, { timeout: 15_000 });
  await modelCard.locator('[data-testid^="model-test-"]').click();
  await expect(
    modelCard.locator('[data-testid^="model-health-"]'),
  ).toHaveText(/^(可用|Available)$/, { timeout: 15_000 });

  await page.goto("/");
  await expect(page.getByTestId("project-work-surface")).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await expect(page.getByTestId("chat-data-source-button")).toBeAttached();
  await expect(page.getByTestId("chat-connection-select")).toHaveCount(0);
  const analysisServiceSelector = page.getByTestId("analysis-service-selector");
  await expect(analysisServiceSelector).toBeVisible();
  await expect(analysisServiceSelector).toContainText(modelName);

  await page
    .getByTestId("chat-input")
    .fill("List top 3 product names and categories.");
  const streamResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/chat/stream") &&
      response.request().method() === "POST" &&
      response.ok()
  );
  await page.getByTestId("chat-submit").click();
  await streamResponse;

  const assistantCard = page.locator('[data-testid^="assistant-message-card-"]').last();
  const assistantLoading = page.getByTestId("assistant-loading-message");
  const investigationActivity = page.getByTestId("investigation-activity");

  await Promise.any([
    assistantCard.waitFor({ state: "visible", timeout: 30_000 }),
    assistantLoading.waitFor({ state: "visible", timeout: 30_000 }),
    investigationActivity.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
});
