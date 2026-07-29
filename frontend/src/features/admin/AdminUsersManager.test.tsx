import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminUsersManager from "./AdminUsersManager";
import type { AdminUsersResponse } from "./types";

const apiMocks = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  resetAdminUserPassword: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const response: AdminUsersResponse = {
  function_options: [
    { code: "chief", label: "Начальник" },
    { code: "author", label: "Автор" },
    { code: "proofreader", label: "Корректор" },
    { code: "designer", label: "Дизайнер" },
  ],
  items: [
    {
      id: 1,
      username: "astra",
      display_name: "Астра",
      position: "Начальник",
      function_codes: ["chief", "author"],
      is_active: true,
      must_change_password: false,
      created_at: "2026-07-24T08:00:00Z",
      updated_at: "2026-07-24T09:00:00Z",
    },
    {
      id: 2,
      username: "runa",
      display_name: "Руна",
      position: "Дизайнер",
      function_codes: ["designer"],
      is_active: false,
      must_change_password: true,
      created_at: "2026-07-24T08:30:00Z",
      updated_at: "2026-07-24T09:30:00Z",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.fetchAdminUsers.mockResolvedValue(response);
  apiMocks.createAdminUser.mockResolvedValue({ ok: true });
  apiMocks.updateAdminUser.mockResolvedValue({ ok: true });
  apiMocks.resetAdminUserPassword.mockResolvedValue({ ok: true });
});

describe("AdminUsersManager", () => {
  it("loads the canonical read model and renders active and inactive employees", async () => {
    render(<AdminUsersManager currentUserId={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("Загрузка сотрудников");
    expect(await screen.findByRole("cell", { name: "Астра" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Руна" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Активна" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Отключена" })).toBeInTheDocument();
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledOnce();
  });

  it("creates an employee with normalized identity fields, checked functions and a temporary password", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить сотрудника" });
    await user.type(within(dialog).getByLabelText("Имя"), "  Север  ");
    await user.type(within(dialog).getByLabelText("Логин"), "  sever  ");
    await user.type(within(dialog).getByLabelText("Должность"), "  Корреспондент  ");
    await user.click(within(dialog).getByRole("checkbox", { name: "Автор" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Корректор" }));
    await user.type(within(dialog).getByLabelText("Временный пароль"), "Temporary-Synthetic-2026!");
    await user.type(within(dialog).getByLabelText("Повторите пароль"), "Temporary-Synthetic-2026!");
    await user.click(within(dialog).getByRole("button", { name: "Создать сотрудника" }));

    await waitFor(() => expect(apiMocks.createAdminUser).toHaveBeenCalledWith({
      username: "sever",
      display_name: "Север",
      position: "Корреспондент",
      function_codes: ["author", "proofreader"],
      temporary_password: "Temporary-Synthetic-2026!",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Добавить сотрудника" })).not.toBeInTheDocument());
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent("Temporary-Synthetic-2026!");

    await user.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    expect(screen.getByLabelText("Временный пароль")).toHaveValue("");
    expect(screen.getByLabelText("Повторите пароль")).toHaveValue("");
  });

  it("keeps a rejected create form open and renders the command message", async () => {
    apiMocks.createAdminUser.mockRejectedValueOnce(new Error("Логин уже используется"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    await user.type(screen.getByLabelText("Имя"), "Север");
    await user.type(screen.getByLabelText("Логин"), "sever");
    await user.type(screen.getByLabelText("Должность"), "Корреспондент");
    await user.click(screen.getByRole("checkbox", { name: "Автор" }));
    await user.type(screen.getByLabelText("Временный пароль"), "Temporary-Synthetic-2026!");
    await user.type(screen.getByLabelText("Повторите пароль"), "Temporary-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Создать сотрудника" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Логин уже используется");
    expect(screen.getByRole("dialog", { name: "Добавить сотрудника" })).toBeInTheDocument();
    expect(screen.getByLabelText("Временный пароль")).toHaveValue("Temporary-Synthetic-2026!");
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledOnce();
  });

  it("clears and closes a successful create even when the following refetch fails", async () => {
    apiMocks.fetchAdminUsers
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("Список временно недоступен"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    await user.type(screen.getByLabelText("Имя"), "Север");
    await user.type(screen.getByLabelText("Логин"), "sever");
    await user.type(screen.getByLabelText("Должность"), "Корреспондент");
    await user.click(screen.getByRole("checkbox", { name: "Автор" }));
    await user.type(screen.getByLabelText("Временный пароль"), "Temporary-Synthetic-2026!");
    await user.type(screen.getByLabelText("Повторите пароль"), "Temporary-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Создать сотрудника" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Добавить сотрудника" })).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Список временно недоступен");
    expect(document.body).not.toHaveTextContent("Temporary-Synthetic-2026!");
  });

  it("edits only the employee name, position and functions", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Изменить Руна" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить сотрудника" });
    await user.clear(within(dialog).getByLabelText("Имя"));
    await user.type(within(dialog).getByLabelText("Имя"), "  Искра  ");
    await user.clear(within(dialog).getByLabelText("Должность"));
    await user.type(within(dialog).getByLabelText("Должность"), "  Шеф-редактор  ");
    await user.click(within(dialog).getByRole("checkbox", { name: "Автор" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Дизайнер" }));
    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() => expect(apiMocks.updateAdminUser).toHaveBeenCalledWith(2, {
      display_name: "Искра",
      position: "Шеф-редактор",
      function_codes: ["author"],
    }));
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
  });

  it("confirms deactivation and activates an employee without confirmation", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Отключить Астра" }));
    expect(confirmMock).toHaveBeenCalledWith("Отключить учётную запись сотрудника «Астра»?");
    expect(apiMocks.updateAdminUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Отключить Астра" }));
    await waitFor(() => expect(apiMocks.updateAdminUser).toHaveBeenCalledWith(1, { is_active: false }));

    await user.click(screen.getByRole("button", { name: "Активировать Руна" }));
    await waitFor(() => expect(apiMocks.updateAdminUser).toHaveBeenCalledWith(2, { is_active: true }));
    expect(confirmMock).toHaveBeenCalledTimes(2);
  });

  it("requires matching reset passwords, then clears both values and refetches", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Сбросить пароль Руна" }));
    await user.type(screen.getByLabelText("Новый временный пароль"), "Reset-Synthetic-2026!");
    await user.type(screen.getByLabelText("Повторите пароль"), "Different-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Пароли не совпадают");
    expect(apiMocks.resetAdminUserPassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Повторите пароль"));
    await user.type(screen.getByLabelText("Повторите пароль"), "Reset-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));

    await waitFor(() => expect(apiMocks.resetAdminUserPassword).toHaveBeenCalledWith(2, {
      temporary_password: "Reset-Synthetic-2026!",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Сбросить пароль" })).not.toBeInTheDocument());
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent("Reset-Synthetic-2026!");

    await user.click(screen.getByRole("button", { name: "Сбросить пароль Руна" }));
    expect(screen.getByLabelText("Новый временный пароль")).toHaveValue("");
    expect(screen.getByLabelText("Повторите пароль")).toHaveValue("");
  });
});
