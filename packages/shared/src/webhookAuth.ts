/**
 * Normalize what Puck stores for a bot webhook and sends as the HTTP `Authorization` header value.
 * The CLI env or prompt may hold a full header line (`Authorization: Bearer …`) instead of the value
 * alone; Convex stores the encrypted string and `delivery` must not forward the header name twice.
 */
export function normalizeWebhookAuthorization(raw: string): string {
  let value = raw.trim();
  if (!value) return value;
  value = value.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  const line = /^authorization\s*:\s*(.+)$/iu.exec(value);
  if (line) value = line[1]!.trim();
  return value;
}
