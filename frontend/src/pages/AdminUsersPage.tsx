import type { CurrentUser } from "../shared/contracts";

interface AdminUsersPageProps {
  user: CurrentUser;
}

export default function AdminUsersPage({ user }: AdminUsersPageProps) {
  if (!user.function_codes.includes("chief")) {
    return (
      <section className="main-workspace">
        <section className="main-hero">
          <div>
          <p className="muted small">сотрудники</p>
          <h2>Недоступно</h2>
          <p className="muted">Управление сотрудниками доступно только начальнику.</p>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="main-workspace">
      <section className="stories-page-header">
        <div>
          <p className="muted small">сотрудники</p>
          <h2>Управление сотрудниками</h2>
          <p className="muted">
            Учетные записи используют должность и набор рабочих функций, а не единственную роль.
          </p>
        </div>
      </section>
      <p className="muted">Операции создания и изменения сотрудников будут подключены вместе с read-model сотрудника, чтобы интерфейс не работал с устаревшими role API.</p>
    </section>
  );
}
