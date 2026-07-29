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
}

export async function installAdminUsersFixture(
  page: Page,
  {
    userKind = "chief",
    mustChangePassword = false,
  }: InstallAdminUsersFixtureOptions = {},
): Promise<AdminUsersFixture> {
  const requests: AdminRequest[] = [];
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
    requests.push({ method, path, body });

    if (path === "/api/v1/auth/me" && method === "GET") {
      return route.fulfill({ json: currentUser });
    }
    if (path === "/api/v1/auth/change-password" && method === "POST") {
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
        "display_name" | "position" | "function_codes" | "is_active"
      >>;
      const user = users.find((item) => item.id === Number(updateMatch[1]));
      if (user) Object.assign(user, payload, { updated_at: now });
      return route.fulfill({
        json: { ok: true, event_id: null, changed_at: now, resource: null },
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

  return { requests };
}
