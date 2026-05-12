import type { ReactNode } from "react";

interface StoryMaterialsPanelProps {
  materialLinksCount: number;
  sourceLinksCount: number;
  handoffLinksCount: number;
  workspacePathsCount: number;
  localFilesCount: number;
  children: ReactNode;
}

export default function StoryMaterialsPanel({
  materialLinksCount,
  sourceLinksCount,
  handoffLinksCount,
  workspacePathsCount,
  localFilesCount,
  children,
}: StoryMaterialsPanelProps) {
  return (
    <section id="story-materials" className="story-materials-panel story-workspace-section">
      <div className="story-materials-head">
        <div>
          <p className="story-overview-eyebrow">материалы и рабочие пути</p>
          <h3>Материалы</h3>
          <p>
            Ссылки на сетевые папки, мастер-файлы, референсы и локальные вложения карточки
            хранятся отдельно от текста и production-треков.
          </p>
        </div>
        <div className="story-materials-summary" aria-label="Сводка материалов">
          <div>
            <span>привязки</span>
            <strong>{materialLinksCount}</strong>
          </div>
          <div>
            <span>пути</span>
            <strong>{workspacePathsCount}</strong>
          </div>
          <div>
            <span>файлы</span>
            <strong>{localFilesCount}</strong>
          </div>
        </div>
      </div>

      <div className="story-materials-counts" aria-label="Материалы по назначению">
        <span>Исходники {sourceLinksCount}</span>
        <span>Передача {handoffLinksCount}</span>
        <span>Файлы {localFilesCount}</span>
      </div>

      <div className="story-materials-note">
        Это ссылки на рабочие материалы и небольшие вложения, а не медиа-архив внутри системы.
      </div>

      <div className="story-materials-body">{children}</div>
    </section>
  );
}
