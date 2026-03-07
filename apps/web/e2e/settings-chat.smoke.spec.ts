import { expect, test } from "@playwright/test";

test("settings workflow and chat smoke test", async ({ page }) => {
  const suffix = Date.now().toString();
  const connectionName = `CI PostgreSQL ${suffix}`;
  const modelName = `CI Mock Model ${suffix}`;

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

  await page.getByTestId("settings-tab-connections").click();
  await page.getByTestId("connection-add-button").click();
  await expect(page.getByTestId("connection-form")).toBeVisible();

  await page.getByTestId("connection-name-input").fill(connectionName);
  await page.getByTestId("connection-driver-select").selectOption("postgresql");
  await page.getByTestId("connection-host-input").fill("db");
  await page.getByTestId("connection-port-input").fill("5432");
  await page.getByTestId("connection-database-input").fill("querygpt");
  await page.getByTestId("connection-username-input").fill("postgres");
  await page.getByTestId("connection-password-input").fill("postgres");
  await page.getByTestId("connection-submit-button").click();

  const connectionCard = page.locator('[data-testid^="connection-card-"]', {
    hasText: connectionName,
  });
  await expect(connectionCard).toBeVisible();
  await connectionCard.locator('[data-testid^="connection-test-"]').click();
  await expect(connectionCard.getByText("连接成功")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("settings-tab-models").click();
  await page.getByTestId("model-add-button").click();
  await expect(page.getByTestId("model-form")).toBeVisible();

  await page.getByTestId("model-preset-custom").click();
  await page.getByTestId("model-name-input").fill(modelName);
  await page.getByTestId("model-id-input").fill("querygpt-ci");
  await page.getByTestId("model-base-url-input").fill("http://mock-llm:4010/v1");
  await page.getByTestId("model-api-key-input").fill("ci-test-key");
  await page.getByTestId("model-default-checkbox").check();
  await page.getByTestId("model-submit-button").click();

  const modelCard = page.locator('[data-testid^="model-card-"]', {
    hasText: modelName,
  });
  await expect(modelCard).toBeVisible();
  await modelCard.locator('[data-testid^="model-test-"]').click();
  await expect(page.getByTestId("model-test-summary")).toContainText("连接成功", {
    timeout: 15_000,
  });

  await page.goto("/");
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await expect(page.getByText("示例数据库")).toBeVisible();
  await expect(page.getByText(modelName)).toBeVisible();

  await page
    .getByTestId("chat-input")
    .fill("列出前 3 个产品名称和分类，并给出简短说明。");
  await page.getByTestId("chat-submit").click();

  await expect(page.getByText("分析已完成。")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("assistant-tab-sql").last().click();
  await expect(page.getByText("SELECT name, category FROM products ORDER BY id LIMIT 3;")).toBeVisible();
});
