import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../test/deferred";
import AdminUsersManager from "./AdminUsersManager";
import type { AdminUsersResponse } from "./types";

const apiMocks = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
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
    {
      id: 3,
      username: "sever",
      display_name: "Север",
      position: "Корреспондент",
      function_codes: ["author"],
      is_active: true,
      must_change_password: false,
      created_at: "2026-07-24T10:00:00Z",
      updated_at: "2026-07-24T10:00:00Z",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.fetchAdminUsers.mockResolvedValue(response);
  apiMocks.createAdminUser.mockResolvedValue({ ok: true });
  apiMocks.updateAdminUser.mockResolvedValue({ ok: true });
  apiMocks.deleteAdminUser.mockResolvedValue({ ok: true });
  apiMocks.resetAdminUserPassword.mockResolvedValue({ ok: true });
});

const originalShowModal = HTMLDialogElement.prototype.showModal;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: originalShowModal,
    });
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }
});

describe("AdminUsersManager", () => {
  it("loads the canonical read model and renders active and inactive employees", async () => {
    render(<AdminUsersManager currentUserId={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("Загрузка сотрудников");
    expect(await screen.findByRole("cell", { name: "Астра" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Руна" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Активна" })).toHaveLength(2);
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

  it("clears and unmounts accepted create/reset passwords before never-resolving refetches complete", async () => {
    const neverResolvingRefetch = new Promise<AdminUsersResponse>(() => undefined);
    apiMocks.fetchAdminUsers
      .mockResolvedValueOnce(response)
      .mockReturnValue(neverResolvingRefetch);
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

    await waitFor(() => expect(apiMocks.createAdminUser).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Добавить сотрудника" })).not.toBeInTheDocument());
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent("Temporary-Synthetic-2026!");

    await user.click(screen.getByRole("button", { name: "Сбросить пароль Руна" }));
    await user.type(screen.getByLabelText("Новый временный пароль"), "Reset-Synthetic-2026!");
    await user.type(screen.getByLabelText("Повторите пароль"), "Reset-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));

    await waitFor(() => expect(apiMocks.resetAdminUserPassword).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Сбросить пароль" })).not.toBeInTheDocument());
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(3);
    expect(document.body).not.toHaveTextContent("Reset-Synthetic-2026!");
  });

  it("opens a real native modal, handles Escape cancellation and restores trigger focus", async () => {
    const showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });
    const trigger = screen.getByRole("button", { name: "Добавить сотрудника" });
    trigger.focus();

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Добавить сотрудника" });
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("open");
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);

    expect(cancel.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Добавить сотрудника" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("uses an atomic guard against fast duplicate form submissions", async () => {
    const command = createDeferred<unknown>();
    apiMocks.createAdminUser.mockReturnValue(command.promise);
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
    const form = screen.getByRole("dialog", { name: "Добавить сотрудника" }).querySelector("form");
    expect(form).not.toBeNull();

    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(apiMocks.createAdminUser).toHaveBeenCalledOnce();
    command.resolve({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Добавить сотрудника" })).not.toBeInTheDocument());
  });

  it("disables every command launch point while an activation command is pending", async () => {
    const command = createDeferred<unknown>();
    apiMocks.updateAdminUser.mockReturnValue(command.promise);
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Активировать Руна" }));

    expect(screen.getByRole("button", { name: "Добавить сотрудника" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Изменить Астра" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сбросить пароль Руна" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отключить Астра" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    command.resolve({ ok: true });
    await waitFor(() => expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2));
  });

  it("rejects empty create and reset passwords locally with required minimum-length controls", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
    await user.type(screen.getByLabelText("Имя"), "Север");
    await user.type(screen.getByLabelText("Логин"), "sever");
    await user.type(screen.getByLabelText("Должность"), "Корреспондент");
    await user.click(screen.getByRole("checkbox", { name: "Автор" }));
    expect(screen.getByLabelText("Временный пароль")).toBeRequired();
    expect(screen.getByLabelText("Временный пароль")).toHaveAttribute("minlength", "12");
    expect(screen.getByRole("button", { name: "Создать сотрудника" })).toBeDisabled();
    expect(apiMocks.createAdminUser).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Закрыть" }));

    await user.click(screen.getByRole("button", { name: "Сбросить пароль Руна" }));
    expect(screen.getByLabelText("Новый временный пароль")).toBeRequired();
    expect(screen.getByLabelText("Новый временный пароль")).toHaveAttribute("minlength", "12");
    expect(screen.getByRole("button", { name: "Сбросить пароль" })).toBeDisabled();
    expect(apiMocks.resetAdminUserPassword).not.toHaveBeenCalled();
  });

  it("clears a stale row-command alert when a later dialog command succeeds", async () => {
    apiMocks.updateAdminUser.mockRejectedValueOnce(new Error("Активация не выполнена"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Активировать Руна" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Активация не выполнена");

    await user.click(screen.getByRole("button", { name: "Сбросить пароль Руна" }));
    await user.type(screen.getByLabelText("Новый временный пароль"), "Reset-Synthetic-2026!");
    await user.type(screen.getByLabelText("Повторите пароль"), "Reset-Synthetic-2026!");
    await user.click(screen.getByRole("button", { name: "Сбросить пароль" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Сбросить пароль" })).not.toBeInTheDocument());
    expect(screen.queryByText("Активация не выполнена")).not.toBeInTheDocument();
  });

  it("submits a normalized login from the existing edit dialog", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Изменить Астра" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить сотрудника" });
    await user.clear(within(dialog).getByLabelText("Логин"));
    await user.type(within(dialog).getByLabelText("Логин"), "  astra-new  ");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() => expect(apiMocks.updateAdminUser).toHaveBeenCalledWith(1, {
      username: "astra-new",
      display_name: "Астра",
      position: "Начальник",
      function_codes: ["chief", "author"],
    }));
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
  });

  it("keeps the edit dialog and all values open after a conflict", async () => {
    apiMocks.updateAdminUser.mockRejectedValueOnce(new Error("Логин уже используется"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Астра" });

    await user.click(screen.getByRole("button", { name: "Изменить Астра" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить сотрудника" });
    await user.clear(within(dialog).getByLabelText("Логин"));
    await user.type(within(dialog).getByLabelText("Логин"), "astra-new");
    await user.clear(within(dialog).getByLabelText("Имя"));
    await user.type(within(dialog).getByLabelText("Имя"), "Астра новая");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Логин уже используется");
    expect(within(dialog).getByLabelText("Логин")).toHaveValue("astra-new");
    expect(within(dialog).getByLabelText("Имя")).toHaveValue("Астра новая");
    expect(within(dialog).getByLabelText("Должность")).toHaveValue("Начальник");
    expect(within(dialog).getByRole("checkbox", { name: "Начальник" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Автор" })).toBeChecked();
  });

  it("confirms deletion by name and login, then refetches", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Север" });

    await user.click(screen.getByRole("button", { name: "Удалить Север" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить сотрудника" });
    expect(dialog).toHaveTextContent("Север");
    expect(dialog).toHaveTextContent("sever");
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(apiMocks.deleteAdminUser).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Удалить сотрудника" })).not.toBeInTheDocument());
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
  });

  it("does not call DELETE when deletion is cancelled", async () => {
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Север" });

    await user.click(screen.getByRole("button", { name: "Удалить Север" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить сотрудника" });
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));

    expect(apiMocks.deleteAdminUser).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Удалить сотрудника" })).not.toBeInTheDocument();
  });

  it("keeps a blocked deletion dialog open and shows the server refusal beside the list", async () => {
    apiMocks.deleteAdminUser.mockRejectedValueOnce(new Error("Сотрудник уже участвовал в работе. Отключите учётную запись"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Север" });

    await user.click(screen.getByRole("button", { name: "Удалить Север" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить сотрудника" });
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Сотрудник уже участвовал в работе. Отключите учётную запись");
    expect(screen.getByRole("dialog", { name: "Удалить сотрудника" })).toBeInTheDocument();
    expect(apiMocks.fetchAdminUsers).toHaveBeenCalledOnce();
  });

  it("disables deletion launch points and duplicate DELETE submits while pending", async () => {
    const command = createDeferred<unknown>();
    apiMocks.deleteAdminUser.mockReturnValue(command.promise);
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Север" });

    await user.click(screen.getByRole("button", { name: "Удалить Север" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить сотрудника" });
    const form = within(dialog).getByRole("button", { name: "Удалить" }).closest("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(apiMocks.deleteAdminUser).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Добавить сотрудника" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Изменить Астра" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Удалить Руна" })).toBeDisabled();
    command.resolve({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Удалить сотрудника" })).not.toBeInTheDocument());
  });

  it("closes an accepted deletion before a failed refetch", async () => {
    apiMocks.fetchAdminUsers
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("Список временно недоступен"));
    const user = userEvent.setup();
    render(<AdminUsersManager currentUserId={1} />);
    await screen.findByRole("cell", { name: "Север" });

    await user.click(screen.getByRole("button", { name: "Удалить Север" }));
    await user.click(within(screen.getByRole("dialog", { name: "Удалить сотрудника" })).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(apiMocks.deleteAdminUser).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Удалить сотрудника" })).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent("Список временно недоступен");
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
