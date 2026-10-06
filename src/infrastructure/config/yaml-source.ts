import { isMap, isScalar, LineCounter, parseDocument } from "yaml";
import type { ConfigurationIssue } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

export interface YamlSource {
  /** Parsed document as plain JS, or null for an empty/comment-only document. */
  readonly data: unknown;
  /** Line/column of `path` (or of `key` within the map at `path`), if present in the document. */
  locate(path: readonly PropertyKey[], key?: string): { line: number; column: number } | null;
}

type YamlDocument = ReturnType<typeof parseDocument>;

function rangeStart(node: unknown): number | null {
  if (typeof node !== "object" || node === null || !("range" in node)) return null;
  const { range } = node as { range: unknown };
  return Array.isArray(range) && typeof range[0] === "number" ? range[0] : null;
}

function keyStart(doc: YamlDocument, path: readonly PropertyKey[], key: string): number | null {
  const parent = path.length === 0 ? doc.contents : doc.getIn(path, true);
  if (!isMap(parent)) return null;
  const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === key);
  return pair === undefined ? null : rangeStart(pair.key);
}

export function parseYamlSource(text: string): Result<YamlSource, ConfigurationIssue[]> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: true });

  if (doc.errors.length > 0) {
    return err(
      doc.errors.map((e) => {
        const position = e.linePos?.[0];
        const firstLine = e.message.split("\n")[0] ?? e.message;
        return {
          path: "",
          message: firstLine,
          ...(position === undefined ? {} : { line: position.line, column: position.col }),
        };
      }),
    );
  }

  const locate = (path: readonly PropertyKey[], key?: string) => {
    let offset = key === undefined ? null : keyStart(doc, path, key);
    // Walk up until some ancestor has a position (e.g. a missing key reports its parent map).
    for (let depth = path.length; offset === null && depth >= 0; depth -= 1) {
      const prefix = path.slice(0, depth);
      offset = depth === 0 ? rangeStart(doc.contents) : rangeStart(doc.getIn(prefix, true));
    }
    if (offset === null) return null;
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };

  return ok({ data: doc.toJS() as unknown, locate });
}
