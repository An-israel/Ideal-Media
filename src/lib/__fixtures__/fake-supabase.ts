/**
 * An in-memory stand-in for the slice of PostgREST the academy importer uses.
 *
 * The importer is the one piece that cannot be checked by running the real
 * thing here — there is no Supabase in this environment — and it is the piece
 * somebody presses a button on. So the behaviour it depends on is modelled:
 * upsert resolving against a unique key, select with `in` and `range`, delete
 * with `in`, and a count of how many requests were made (the reason it was
 * rewritten in the first place).
 *
 * It is deliberately strict: an upsert whose `onConflict` names a key the
 * table was not given throws, rather than quietly inserting duplicates the way
 * a loose mock would and letting a real bug pass.
 */

type Row = Record<string, unknown>;

interface TableSpec {
  /** Columns that together identify a row, as PostgREST's onConflict spells it. */
  unique?: string[];
  /** Rows deleted from a parent table take these children with them. */
  cascadeFrom?: { table: string; column: string };
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();
  private specs: Record<string, TableSpec>;
  private nextId = 1;
  /** Every request made, so a test can assert the round-trip count. */
  readonly calls: { table: string; op: string; columns?: string }[] = [];

  constructor(specs: Record<string, TableSpec>) {
    this.specs = specs;
    for (const name of Object.keys(specs)) this.tables.set(name, []);
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  private keyOf(table: string, row: Row): string | null {
    const unique = this.specs[table]?.unique;
    if (!unique) return null;
    return unique.map((c) => String(row[c])).join("\u0000");
  }

  private cascadeDelete(table: string, ids: unknown[]) {
    for (const [child, spec] of Object.entries(this.specs)) {
      if (spec.cascadeFrom?.table !== table) continue;
      const column = spec.cascadeFrom.column;
      const kept: Row[] = [];
      const removed: Row[] = [];
      for (const r of this.rows(child)) {
        (ids.includes(r[column]) ? removed : kept).push(r);
      }
      this.tables.set(child, kept);
      if (removed.length > 0) this.cascadeDelete(child, removed.map((r) => r.id));
    }
  }

  from = (table: string) => {
    if (!this.tables.has(table)) throw new Error(`no such table: ${table}`);
    const self = this as FakeSupabase;

    return {
      select(columns?: string) {
        let rows = [...self.rows(table)];
        let counted = false;
        const builder = {
          in(column: string, values: unknown[]) {
            rows = rows.filter((r) => values.includes(r[column]));
            return builder;
          },
          eq(column: string, value: unknown) {
            rows = rows.filter((r) => r[column] === value);
            return builder;
          },
          order() {
            return builder;
          },
          range(from: number, to: number) {
            if (!counted) {
              self.calls.push({ table, op: "select", columns });
              counted = true;
            }
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
          },
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            if (!counted) {
              self.calls.push({ table, op: "select", columns });
              counted = true;
            }
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
        return builder;
      },

      upsert(input: Row | Row[], opts?: { onConflict?: string }) {
        self.calls.push({ table, op: "upsert" });
        const incoming = Array.isArray(input) ? input : [input];
        const unique = self.specs[table]?.unique;
        if (opts?.onConflict) {
          const named = opts.onConflict.split(",").map((s) => s.trim());
          if (!unique || named.join(",") !== unique.join(",")) {
            throw new Error(
              `upsert on ${table} says onConflict "${opts.onConflict}" but the unique key is "${unique?.join(",") ?? "none"}"`
            );
          }
        }

        const existing = self.rows(table);
        const byKey = new Map(
          existing.map((r) => [self.keyOf(table, r), r]).filter(([k]) => k !== null) as [
            string,
            Row,
          ][]
        );
        const written: Row[] = [];
        for (const row of incoming) {
          const key = self.keyOf(table, row);
          const found = key !== null ? byKey.get(key) : undefined;
          if (found) {
            Object.assign(found, row);
            written.push(found);
          } else {
            const created = { id: `id-${self.nextId++}`, ...row };
            existing.push(created);
            if (key !== null) byKey.set(key, created);
            written.push(created);
          }
        }
        self.tables.set(table, existing);
        return {
          select(columns?: string) {
            self.calls[self.calls.length - 1].columns = columns;
            return Promise.resolve({ data: written, error: null });
          },
          then(resolve: (v: { data: null; error: null }) => unknown) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
      },

      delete() {
        return {
          in(column: string, values: unknown[]) {
            self.calls.push({ table, op: "delete" });
            const kept: Row[] = [];
            const removed: Row[] = [];
            for (const r of self.rows(table)) {
              (values.includes(r[column]) ? removed : kept).push(r);
            }
            self.tables.set(table, kept);
            self.cascadeDelete(table, removed.map((r) => r.id));
            return {
              select(columns?: string) {
                self.calls[self.calls.length - 1].columns = columns;
                return Promise.resolve({ data: removed, error: null });
              },
              then(resolve: (v: { data: Row[]; error: null }) => unknown) {
                return Promise.resolve({ data: removed, error: null }).then(resolve);
              },
            };
          },
        };
      },
    };
  }
}

/** The academy tables, with the keys and cascades migration 0017 gives them. */
export function academyTables() {
  return new FakeSupabase({
    academy_courses: { unique: ["slug"] },
    academy_modules: {
      unique: ["course_id", "position"],
      cascadeFrom: { table: "academy_courses", column: "course_id" },
    },
    academy_lessons: {
      unique: ["module_id", "position"],
      cascadeFrom: { table: "academy_modules", column: "module_id" },
    },
    academy_assignments: {
      unique: ["module_id"],
      cascadeFrom: { table: "academy_modules", column: "module_id" },
    },
  });
}
