import type { Page } from "@playwright/test";

interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  position: string;
  function_codes: string[];
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

interface AdminRequest {
  method: string;
  path: string;
  body: unknown;
}

interface InstallAdminUsersFixtureOptions {
  userKind?: "chief" | "employee";
  mustChangePassword?: boolean;
  deferPasswordChanges?: boolean;
}

const functionOptions = [
  { code: "chief", label: "Начальник" },
  { code: "chief_editor", label: "Шеф-редактор" },
  { code: "author", label: "Автор" },
  { code: "proofreader", label: "Корректор" },
  { code: "video_editor", label: "Монтажёр" },
  { code: "designer", label: "Дизайнер" },
  { code: "operator", label: "Оператор" },
];

const rubric = { id: 7, name: "Новости" };

export interface AdminUsersFixture {
  requests: AdminRequest[];
  assertRequestBody: (method: string, path: string, expectedBody: unknown) => void;
  setUserMustChangePassword: (userId: number, mustChangePassword: boolean) => void;
  waitForPasswordChangeRequest: () => Promise<{
    rejectCurrentPassword: () => void;
    succeed: () => void;
  }>;
}

export async function installAdminUsersFixture(
  page: Page,
  {
    userKind = "chief",
    mustChangePassword = false,
    deferPasswordChanges = false,
  }: InstallAdminUsersFixtureOptions = {},
): Promise<AdminUsersFixture> {
  const requests: AdminRequest[] = [];
  const capturedRequests: AdminRequest[] = [];
  type PasswordChangeControl = Awaited<
    ReturnType<AdminUsersFixture["waitForPasswordChangeRequest"]>
  >;
  const pendingPasswordChangeControls: PasswordChangeControl[] = [];
  const passwordChangeWaiters: Array<(control: PasswordChangeControl) => void> = [];
  const publishPasswordChange = (control: PasswordChangeControl) => {
    const waiter = passwordChangeWaiters.shift();
    if (waiter) waiter(control);
    else pendingPasswordChangeControls.push(control);
  };
  const now = "2026-07-30T09:00:00Z";
  let nextUserId = 3;
  let currentUser: AdminUser = userKind === "chief"
    ? {
      id: 1,
      username: "astra",
      display_name: "Астра",
      position: "Начальник",
      function_codes: ["chief", "author"],
      is_active: true,
      must_change_password: mustChangePassword,
      created_at: "2026-07-24T08:00:00Z",
      updated_at: now,
    }
    : {
      id: 2,
      username: "runa",
      display_name: "Руна",
      position: "Корреспондент",
      function_codes: ["author"],
      is_active: true,
      must_change_password: mustChangePassword,
      created_at: "2026-07-24T08:30:00Z",
      updated_at: now,
    };
  const users: AdminUser[] = [
    {
      id: 1,
      username: "astra",
      display_name: "Астра",
      position: "Начальник",
      function_codes: ["chief", "author"],
      is_active: true,
      must_change_password: false,
      created_at: "2026-07-24T08:00:00Z",
      updated_at: now,
    },
    {
      id: 2,
      username: "runa",
      display_name: "Руна",
      position: "Корреспондент",
      function_codes: ["author"],
      is_active: true,
      must_change_password: true,
      created_at: "2026-07-24T08:30:00Z",
      updated_at: now,
    },
  ];

  await page.context().addCookies([
    {
      name: "newscast_session",
      value: "synthetic-admin-session",
      url: "http://127.0.0.1:5173",
    },
  ]);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postDataJSON() ?? null;
    capturedRequests.push({ method, path, body });
    const safeBody = body && typeof body === "object"
      ? Object.fromEntries(
        Object.entries(body as Record<string, unknown>).map(([key, value]) => (
          key.includes("password") ? [key, "[redacted]"] : [key, value]
        )),
      )
      : body;
    requests.push({ method, path, body: safeBody });

    if (path === "/api/v1/auth/me" && method === "GET") {
      return route.fulfill({ json: currentUser });
    }
    if (path === "/api/v1/auth/change-password" && method === "POST") {
      if (deferPasswordChanges) {
        return new Promise<void>((resolve) => {
          let settled = false;
          const settle = async (outcome: "reject" | "success") => {
            if (settled) return;
            settled = true;
            if (outcome === "reject") {
              await route.fulfill({
                status: 400,
                json: {
                  error: {
                    code: "CURRENT_PASSWORD_INVALID",
                    message: "Текущий пароль указан неверно",
                    details: {},
                  },
                },
              });
            } else {
              currentUser = { ...currentUser, must_change_password: false, updated_at: now };
              await route.fulfill({
                json: { ok: true, event_id: null, changed_at: now, resource: null },
              });
            }
            resolve();
          };
          publishPasswordChange({
            rejectCurrentPassword: () => void settle("reject"),
            succeed: () => void settle("success"),
          });
        });
      }
      currentUser = { ...currentUser, must_change_password: false, updated_at: now };
      return route.fulfill({
        json: { ok: true, event_id: null, changed_at: now, resource: null },
      });
    }
    if (path === "/api/v1/me/actions" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/create-options" && method === "GET") {
      return route.fulfill({
        json: {
          rubrics: [rubric],
          authors: [currentUser],
          priority_options: [{ code: "standard", label: "Стандарт" }],
          create_action: {
            code: "story_create",
            label: "Создать сюжет",
            method: "POST",
            href: "/api/v1/stories",
            emphasis: "primary",
            confirmation: null,
            form: "story_create",
          },
        },
      });
    }
    if (path === "/api/v1/stories" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/admin/users" && method === "GET") {
      return route.fulfill({
        json: {
          items: users.map((user) => ({ ...user, function_codes: [...user.function_codes] })),
          function_options: functionOptions,
        },
      });
    }
    if (path === "/api/v1/admin/users" && method === "POST") {
      const payload = body as {
        username: string;
        display_name: string;
        position: string;
        function_codes: string[];
      };
      const created: AdminUser = {
        id: nextUserId,
        username: payload.username,
        display_name: payload.display_name,
        position: payload.position,
        function_codes: [...payload.function_codes],
        is_active: true,
        must_change_password: true,
        created_at: now,
        updated_at: now,
      };
      nextUserId += 1;
      users.push(created);
      return route.fulfill({
        json: {
          ok: true,
          event_id: null,
          changed_at: now,
          resource: { type: "user", id: created.id },
        },
      });
    }

    const resetMatch = path.match(/^\/api\/v1\/admin\/users\/(\d+)\/reset-password$/);
    if (resetMatch && method === "POST") {
      const user = users.find((item) => item.id === Number(resetMatch[1]));
      if (user) {
        user.must_change_password = true;
        user.updated_at = now;
      }
      return route.fulfill({
        json: { ok: true, event_id: null, changed_at: now, resource: null },
      });
    }

    const updateMatch = path.match(/^\/api\/v1\/admin\/users\/(\d+)$/);
    if (updateMatch && method === "PATCH") {
      const payload = body as Partial<Pick<
        AdminUser,
        "username" | "display_name" | "position" | "function_codes" | "is_active"
      >>;
      const user = users.find((item) => item.id === Number(updateMatch[1]));
      if (user) Object.assign(user, payload, { updated_at: now });
      return route.fulfill({
        json: { ok: true, event_id: null, changed_at: now, resource: null },
      });
    }

    const deleteMatch = path.match(/^\/api\/v1\/admin\/users\/(\d+)$/);
    if (deleteMatch && method === "DELETE") {
      const userId = Number(deleteMatch[1]);
      if (userId === 2) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "USER_DELETE_BLOCKED",
              message: "Сотрудник уже участвовал в работе. Отключите учётную запись",
              details: {},
            },
          },
        });
      }
      if (userId !== 3) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "USER_DELETE_BLOCKED",
              message: "Сотрудник уже участвовал в работе. Отключите учётную запись",
              details: {},
            },
          },
        });
      }
      const userIndex = users.findIndex((item) => item.id === userId);
      if (userIndex >= 0) users.splice(userIndex, 1);
      return route.fulfill({
        json: {
          ok: true,
          event_id: null,
          changed_at: now,
          resource: { type: "user", id: userId },
        },
      });
    }

    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "UNEXPECTED_TEST_REQUEST",
          message: `${method} ${path}`,
        },
      },
    });
  });

  return {
    requests,
    assertRequestBody: (method, path, expectedBody) => {
      const request = capturedRequests.find((item) => (
        item.method === method && item.path === path
      ));
      if (!request) throw new Error(`Synthetic request ${method} ${path} not found`);
      if (JSON.stringify(request.body) !== JSON.stringify(expectedBody)) {
        throw new Error(`Synthetic request ${method} ${path} has an unexpected body`);
      }
    },
    setUserMustChangePassword: (userId, nextMustChangePassword) => {
      const user = users.find((item) => item.id === userId);
      if (!user) throw new Error(`Synthetic admin user ${userId} not found`);
      user.must_change_password = nextMustChangePassword;
      user.updated_at = now;
    },
    waitForPasswordChangeRequest: () => {
      const existing = pendingPasswordChangeControls.shift();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => passwordChangeWaiters.push(resolve));
    },
  };
}
