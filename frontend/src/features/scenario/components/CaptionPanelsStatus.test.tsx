import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CaptionPanelsStatus from "./CaptionPanelsStatus";


describe("CaptionPanelsStatus", () => {
  it("не занимает место постоянным информационным блоком", () => {
    const { container } = render(
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

    expect(container).toBeEmptyDOMElement();
  });

  it("оставляет только компактное предупреждение и адресную ссылку на diff", () => {
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

    expect(screen.queryByRole("heading", { name: "CaptionPanels" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("CaptionPanels: сценарий изменился");
    expect(screen.getByRole("link", { name: "Посмотреть изменения" })).toHaveAttribute(
      "href",
      "/stories/41/history?session=93",
    );
  });
});
