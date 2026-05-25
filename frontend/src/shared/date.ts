export function formatDateTime(isoValue?: string | null): string {
  if (!isoValue) {
    return "-";
  }
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }
  return parsed.toLocaleString("ru-RU");
}

export function formatDate(isoValue?: string | null): string {
  if (!isoValue) {
    return "-";
  }
  const parsed = new Date(`${isoValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }
  return parsed.toLocaleDateString("ru-RU");
}

export function sortableDate(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatTextSeq(value?: number | null): string {
  if (!value || value < 1) {
    return "-";
  }
  return `#${value}`;
}
