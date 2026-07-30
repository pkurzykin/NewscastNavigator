import { expect, test, type Page } from "@playwright/test";

import { installAdminUsersFixture } from "./fixtures/admin-users";

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("chief manages a combined-function employee through refreshed read models", async ({ page }) => {
  const fixture = await installAdminUsersFixture(page);
  const createPassword = "Temporary-Synthetic-2026!";
  const resetPassword = "Reset-Synthetic-2026!";
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Управление сотрудниками" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Сотрудники" })).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.getByRole("button", { name: "Добавить сотрудника" }).click();
  const createDialog = page.getByRole("dialog", { name: "Добавить сотрудника" });
  await expect(createDialog).toBeVisible();
  await expectNoDocumentOverflow(page);
  await createDialog.getByLabel("Имя").fill("Север");
  await createDialog.getByLabel("Логин").fill("sever");
  await createDialog.getByLabel("Должность").fill("Корреспондент");
  await createDialog.getByRole("checkbox", { name: "Автор" }).check();
  await createDialog.getByRole("checkbox", { name: "Корректор" }).check();
  await createDialog.getByLabel("Временный пароль").fill(createPassword);
  await createDialog.getByLabel("Повторите пароль").fill(createPassword);
  await createDialog.getByRole("button", { name: "Создать сотрудника" }).click();

  const employeeRow = page.getByRole("row", { name: /Север sever/ });
  await expect(employeeRow).toContainText("Автор, Корректор");
  await expect(employeeRow).toContainText("Активна");
  await expect(employeeRow).toContainText("Требуется смена");
  await expect(employeeRow).not.toContainText(createPassword);

  fixture.setUserMustChangePassword(3, false);
  await employeeRow.getByRole("button", { name: "Изменить Север" }).click();
  const editDialog = page.getByRole("dialog", { name: "Изменить сотрудника" });
  await expectNoDocumentOverflow(page);
  await editDialog.getByLabel("Логин").fill("sever-new");
  await editDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  const renamedEmployeeRow = page.getByRole("row", { name: /Север sever-new/ });
  await expect(renamedEmployeeRow).toContainText("sever-new");
  await expect(employeeRow).toContainText("Установлен");

  await renamedEmployeeRow.getByRole("button", { name: "Удалить Север" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Удалить сотрудника" });
  await expect(deleteDialog).toContainText("Север");
  await expect(deleteDialog).toContainText("sever-new");
  await deleteDialog.getByRole("button", { name: "Удалить" }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Север sever-new/ })).toHaveCount(0);

  const runaRow = page.getByRole("row", { name: /Руна runa/ });
  await runaRow.getByRole("button", { name: "Удалить Руна" }).click();
  const blockedDeleteDialog = page.getByRole("dialog", { name: "Удалить сотрудника" });
  await blockedDeleteDialog.getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByRole("alert").first()).toHaveText("Сотрудник уже участвовал в работе. Отключите учётную запись");
  await expect(blockedDeleteDialog).toBeVisible();
  await expect(runaRow).toBeVisible();

  fixture.assertRequestBody("POST", "/api/v1/admin/users", {
    username: "sever",
    display_name: "Север",
    position: "Корреспондент",
    function_codes: ["author", "proofreader"],
    temporary_password: createPassword,
  });
  fixture.assertRequestBody("PATCH", "/api/v1/admin/users/3", {
    username: "sever-new",
    display_name: "Север",
    position: "Корреспондент",
    function_codes: ["author", "proofreader"],
  });
  expect(JSON.stringify(fixture.requests)).not.toContain(createPassword);
  expect(JSON.stringify(fixture.requests)).not.toContain(resetPassword);

  const adminRequests = fixture.requests
    .filter((request) => request.path.startsWith("/api/v1/admin/users"))
    .map(({ method, path }) => `${method} ${path}`);
  const firstCommandIndex = adminRequests.findIndex((request) => !request.startsWith("GET "));
  expect(adminRequests.slice(firstCommandIndex)).toEqual([
    "POST /api/v1/admin/users",
    "GET /api/v1/admin/users",
    "PATCH /api/v1/admin/users/3",
    "GET /api/v1/admin/users",
    "DELETE /api/v1/admin/users/3",
    "GET /api/v1/admin/users",
    "DELETE /api/v1/admin/users/2",
  ]);
});

test("temporary-password login renders only password change until the change succeeds", async ({ page }) => {
  const fixture = await installAdminUsersFixture(page, {
    userKind: "employee",
    mustChangePassword: true,
    deferPasswordChanges: true,
  });
  await page.goto("/stories");

  await expect(page.getByRole("heading", { name: "Нужно сменить временный пароль" })).toBeVisible();
  await expect(page.locator("footer.app-footer")).toHaveCount(1);
  await expect(page.locator("footer.app-footer")).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main footer.app-footer")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Сюжеты" })).toHaveCount(0);
  await expectNoDocumentOverflow(page);

  await page.getByLabel("Текущий пароль").fill("Temporary-Employee-2026!");
  await page.getByLabel("Новый пароль", { exact: true }).fill("Permanent-Employee-2026!");
  await page.getByLabel("Повтори новый пароль", { exact: true }).fill("Permanent-Employee-2026!");
  await page.getByRole("button", { name: "Установить пароль" }).click();

  const rejectedChange = await fixture.waitForPasswordChangeRequest();
  await expect(page.getByRole("button", { name: "Сохранение..." })).toBeDisabled();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toHaveCount(0);
  rejectedChange.rejectCurrentPassword();
  await expect(page.getByRole("alert")).toHaveText("Текущий пароль указан неверно");
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toHaveCount(0);

  await page.getByLabel("Текущий пароль").fill("Temporary-Employee-2026!");
  await page.getByLabel("Новый пароль", { exact: true }).fill("Permanent-Employee-2026!");
  await page.getByLabel("Повтори новый пароль", { exact: true }).fill("Permanent-Employee-2026!");
  await page.getByRole("button", { name: "Установить пароль" }).click();

  const successfulChange = await fixture.waitForPasswordChangeRequest();
  await expect(page.getByRole("button", { name: "Сохранение..." })).toBeDisabled();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toHaveCount(0);
  successfulChange.succeed();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-shell > footer.app-footer")).toHaveCount(1);
  await expect(page.locator("footer.app-footer")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main footer.app-footer")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Сюжеты" })).toBeVisible();
  fixture.assertRequestBody("POST", "/api/v1/auth/change-password", {
    current_password: "Temporary-Employee-2026!",
    new_password: "Permanent-Employee-2026!",
  });
  expect(JSON.stringify(fixture.requests)).not.toContain("Temporary-Employee-2026!");
  expect(JSON.stringify(fixture.requests)).not.toContain("Permanent-Employee-2026!");
});

test("non-chief navigation has no employees link", async ({ page }) => {
  await installAdminUsersFixture(page, { userKind: "employee" });
  await page.goto("/stories");

  const navigation = page.getByRole("navigation", { name: "Основные разделы" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Сотрудники" })).toHaveCount(0);
  await expectNoDocumentOverflow(page);
});
