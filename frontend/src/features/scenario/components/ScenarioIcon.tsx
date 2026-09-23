const paths = {
  undo: "M9 6 4 11l5 5M4 11h10a6 6 0 0 1 6 6",
  redo: "m15 6 5 5-5 5M20 11H10a6 6 0 0 0-6 6",
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6",
  export: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
  edit: "m4 15 11-11 5 5L9 20l-6 1 1-6ZM13 6l5 5",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  up: "M12 20V4m-6 6 6-6 6 6",
  down: "M12 4v16m-6-6 6 6 6-6",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
};

export default function ScenarioIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="scenario-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={name === "grip" ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}
