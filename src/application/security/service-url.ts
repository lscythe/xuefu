import { z } from "zod";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The address of a service a token is sent to, such as Jira's: HTTPS, but for a server on this
 * machine, so the token is never sent in the clear. Read without a trailing slash.
 */
export function serviceUrlSchema(service: string, example: string) {
  return z
    .url({ error: `must be ${service}'s address, such as ${example}` })
    .refine((raw) => {
      // Not an address at all is said by the check above.
      if (!URL.canParse(raw)) return true;
      const url = new URL(raw);
      return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
    }, "must use https, so the token is never sent in the clear")
    .transform((raw) => raw.replace(/\/+$/, ""));
}
