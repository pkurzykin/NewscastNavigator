import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CaptionPanelsStatus from "./CaptionPanelsStatus";


describe("CaptionPanelsStatus", () => {
  it("объясняет серверный контракт без фонового обновления After Effects", () => {
    render(
      <CaptionPanelsStatus
        storyId={41}
        state={{
          eligible: true,
          last_opened_revision: null,
          changed_since_last_open: false,
          diff_session_id: null,
        }}
      />,
    );

    expect(screen.getByText(/при каждом открытии получает актуальный сценарий с сервера/i)).toBeInTheDocument();
    expect(screen.getByText(/After Effects не обновляется автоматически/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("показывает серверное предупреждение и адресную ссылку на diff", () => {
    render(
      <CaptionPanelsStatus
        storyId={41}
        state={{
          eligible: true,
          last_opened_revision: 7,
          changed_since_last_open: true,
          diff_session_id: 93,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Сценарий изменился после последнего открытия CaptionPanels",
    );
    expect(screen.getByRole("link", { name: "Посмотреть изменения" })).toHaveAttribute(
      "href",
      "/stories/41/history?session=93",
    );
  });
});
