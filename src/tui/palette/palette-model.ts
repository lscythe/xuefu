import type { AppError } from "../../application/errors";
import { rankFuzzy } from "../../application/search/fuzzy";
import { type ValidationError, validationError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

/** One value an entry asks for before it runs, e.g. the issue key for "Start work". */
export interface PaletteField {
  readonly label: string;
  /** Shown greyed out while the field is empty, e.g. "MOB-2841". */
  readonly example: string;
  /** An optional field may be left empty; its value is then null. */
  readonly optional: boolean;
  /** Checked on Enter, so a mistake is caught before the next field. */
  readonly check: (raw: string) => Result<unknown, ValidationError>;
}

/** Something the palette can do. */
export interface PaletteEntry {
  readonly title: string;
  /** The direct key for it, shown beside the title, e.g. "t". */
  readonly keys: string | null;
  readonly fields: readonly PaletteField[];
  /** Gets each field's trimmed text, or null for an optional field left empty. */
  readonly run: (values: readonly (string | null)[]) => Promise<Result<unknown, AppError>>;
}

export interface PaletteRow {
  readonly entry: PaletteEntry;
  /** Matched code-point positions in the title, for highlighting. */
  readonly hits: readonly number[];
}

/** Entries matching the query, best first; every entry in its given order for a blank query. */
export function paletteRows(entries: readonly PaletteEntry[], query: string): PaletteRow[] {
  const trimmed = query.trim();
  if (trimmed === "") return entries.map((entry) => ({ entry, hits: [] }));
  return rankFuzzy(entries, trimmed, (entry) => [entry.title]).map(({ item, match }) => ({
    entry: item,
    hits: match.positions,
  }));
}

/** A field's value from what was typed: null for an empty optional field, else checked text. */
export function fieldValue(
  field: PaletteField,
  raw: string,
): Result<string | null, ValidationError> {
  const value = raw.trim();
  if (value === "") {
    return field.optional
      ? ok(null)
      : err(
          validationError(`${field.label} is required`, [
            { path: field.label, message: `type one, e.g. ${field.example}` },
          ]),
        );
  }
  const checked = field.check(value);
  return checked.ok ? ok(value) : checked;
}
