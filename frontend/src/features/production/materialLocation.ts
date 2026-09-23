export interface MaterialLocationDescription {
  display: string;
  href: string | null;
  copies: Array<{ label: string; value: string }>;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SERVER_NAME = /^[\p{L}\p{N}._-]+$/u;

function displayLocation(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodePathSegment(segment: string): string {
  return segment.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

function safeServer(server: string): boolean {
  return SERVER_NAME.test(server) && server !== "." && server !== ".."
    && server.toLowerCase() !== "localhost";
}

function safePathSegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== ".."
    && !CONTROL_CHARACTERS.test(segment)
    && !/[\\/<>:"|?*]/.test(segment);
}

function safeNetworkSegments(segments: string[]): boolean {
  return segments.length > 0 && segments.every((segment, index) => (
    safePathSegment(segment) || (index === segments.length - 1 && index > 0 && segment === "")
  ));
}

function networkCopies(server: string, segments: string[], windowsValue?: string) {
  try {
    const windows = windowsValue ?? `\\\\${server}\\${segments.join("\\")}`;
    const linux = `smb://${encodeURIComponent(server)}/${segments.map(encodeURIComponent).join("/")}`;
    return [
      { label: "Для Windows", value: windows },
      { label: "Для Linux", value: linux },
    ];
  } catch {
    return null;
  }
}

function uncCopies(display: string): MaterialLocationDescription["copies"] | null {
  if (!display.startsWith("\\\\")) return null;
  const [server, ...segments] = display.slice(2).split("\\");
  if (!safeServer(server) || !safeNetworkSegments(segments)) return null;
  return networkCopies(server, segments, display);
}

function networkUriCopies(display: string): MaterialLocationDescription["copies"] | null {
  const match = /^(?:smb|file):\/\/([^/]+)\/(.+)$/i.exec(display);
  if (!match) return null;
  const [, server, path] = match;
  if (!safeServer(server)) return null;
  const segments = path.split("/").map(decodePathSegment);
  if (!safeNetworkSegments(segments)) return null;
  return networkCopies(server, segments);
}

function safeHttpHref(display: string): string | null {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(display)?.[1];
  if (!authority || /[@\\\s]/.test(authority) || /%(?![0-9a-f]{2})/i.test(display)) return null;
  try {
    const url = new URL(display);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function describeMaterialLocation(raw: string): MaterialLocationDescription {
  const display = displayLocation(raw);
  if (!display) return { display, href: null, copies: [] };
  const fallback: MaterialLocationDescription = {
    display,
    href: null,
    copies: [{ label: "Копировать путь", value: display }],
  };
  if (CONTROL_CHARACTERS.test(raw)) return fallback;

  if (/^https?:\/\//i.test(display)) {
    const href = safeHttpHref(display);
    return href
      ? { display, href, copies: [{ label: "Копировать ссылку", value: display }] }
      : fallback;
  }

  const copies = uncCopies(display) ?? networkUriCopies(display);
  return copies ? { display, href: null, copies } : fallback;
}
