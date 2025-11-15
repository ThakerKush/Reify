// Minimal cookie getter compatible with Fetch Request, Headers, or Hono Context
export function getCookie(
  source: Request | Headers | { req?: any } | string | null | undefined,
  name: string
): string | undefined {
  if (!source) return undefined;

  let cookieHeader: string | null | undefined;

  if (typeof source === "string") {
    cookieHeader = source;
  } else if (typeof (source as any).get === "function") {
    // Headers
    cookieHeader = (source as Headers).get("cookie");
  } else if ((source as any).headers?.get) {
    // Request-like
    cookieHeader = (source as any).headers.get("cookie");
  } else if ((source as any).req?.raw?.headers?.get) {
    // Hono Context → c.req.raw.headers
    cookieHeader = (source as any).req.raw.headers.get("cookie");
  } else if ((source as any).req?.header) {
    // Hono Context → c.req.header("cookie")
    cookieHeader = (source as any).req.header("cookie");
  }

  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;

    let val = trimmed.slice(eq + 1);
    // strip wrapping quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  }

  return undefined;
}
