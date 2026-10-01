// scripts/verify/schema-diff.mjs — READ-ONLY: diff the LIVE tenant schemas
// (via GraphQL introspection on /data/v4/gateway) against the authored
// blocks/data/schemas/*.json files. Reports missing/extra fields and type
// mismatches per schema. Writes nothing.
//
// Run: node scripts/verify/schema-diff.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function loadDotenv(path = ".env") {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotenv();

const REQUIRED_KEYS = ["VITE_BLOCKS_API_URL", "VITE_BLOCKS_KEY"];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing .env keys: ${missing.join(", ")}`);
  process.exit(1);
}

// Bearer: browser session first, walker IAM login fallback (same pattern
// as migrate-env-schema.mjs).
let bearer;
try {
  const grab = await import("./grab-token.mjs");
  bearer = await grab.getBearerToken();
  console.log("[token] browser session");
} catch {
  const walker = await import("../walker/auth.mjs");
  bearer = await walker.freshAccessToken();
  console.log("[token] walker IAM login");
}

const gqlEndpoint = `${process.env.VITE_BLOCKS_API_URL}/data/v4/gateway`;

const INTROSPECTION = `query Introspect {
  __schema { types {
    name kind
    fields {
      name
      type { kind name ofType { kind name ofType { kind name } } }
    }
  } }
}`;

const res = await fetch(gqlEndpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${bearer}`,
    "x-blocks-key": process.env.VITE_BLOCKS_KEY,
  },
  body: JSON.stringify({ query: INTROSPECTION, operationName: "Introspect" }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || body?.errors?.length) {
  console.error(
    `Introspection failed: HTTP ${res.status}`,
    JSON.stringify(body?.errors ?? body).slice(0, 600),
  );
  process.exit(2);
}

const liveTypes = body?.data?.__schema?.types ?? [];
// Only object types that carry fields (skip scalars/interfaces/introspection
// internals), and skip the SDK envelope wrappers (types starting with get/
// insert/update/delete + Response/Paged suffixes are handled by matching
// authored names directly below).
const liveObjects = new Map(
  liveTypes
    .filter((t) => t.kind === "OBJECT" && t.fields?.length && !t.name.startsWith("__"))
    .map((t) => [t.name, t]),
);

function typeName(t) {
  if (!t) return "?";
  if (t.name) return t.name;
  return `${t.kind === "NON_NULL" ? "!" : t.kind === "LIST" ? "[" : ""}${typeName(t.ofType)}${t.kind === "LIST" ? "]" : ""}`;
}

const SCHEMAS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "blocks",
  "data",
  "schemas",
);
const authored = readdirSync(SCHEMAS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(SCHEMAS_DIR, f), "utf8")));

let problemCount = 0;
console.log(`\nAuthored schemas: ${authored.length}\n`);

for (const schema of authored) {
  const name = schema.name ?? schema.schemaName;
  if (!name) {
    console.log(`⚠ ${join(SCHEMAS_DIR, "?")}: no name in JSON`);
    problemCount++;
    continue;
  }
  // Live type name: exact, blx_-prefixed, or blx_ + plural — try each.
  const candidates = [name, `blx_${name}`, `blx_${name}s`, `blx_${name}es`];
  const liveName = candidates.find((c) => liveObjects.has(c));
  if (!liveName) {
    console.log(`✗ ${name}: NO live type (tried ${candidates.join(", ")})`);
    problemCount++;
    continue;
  }
  const live = liveObjects.get(liveName);
  const liveFields = new Map(live.fields.map((f) => [f.name, typeName(f.type)]));
  const authoredFields = schema.fields ?? [];
  const problems = [];

  for (const f of authoredFields) {
    const liveType = liveFields.get(f.name);
    if (liveType === undefined) {
      problems.push(`  missing field: ${f.name}`);
      continue;
    }
    // Authored types are Strings like "String"/"Int"/"Boolean" (optionally
    // with our own naming); live GraphQL scalars are String/Int/Boolean/… —
    // compare only the base scalar name, case-insensitive.
    const authoredBase = String(f.type ?? f.dataType ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
    const liveBase = liveType.replace(/[!\[\]]/g, "").split(".").pop()?.toLowerCase() ?? "";
    const scalarish = ["string", "int", "boolean", "float", "id", "datetime", "guid"].includes(liveBase);
    if (scalarish && authoredBase && liveBase && authoredBase !== liveBase && !authoredBase.startsWith(liveBase) && !liveBase.startsWith(authoredBase)) {
      problems.push(`  type mismatch: ${f.name} authored=${f.type ?? f.dataType} live=${liveType}`);
    }
  }
  const authoredNames = new Set(authoredFields.map((f) => f.name));
  for (const [fname] of liveFields) {
    // System columns the gateway adds on its own are fine: the audit set,
    // plus Language/OrganizationId/Tags which the platform injects onto
    // EVERY custom schema (verified uniform across all 25 authored types).
    if (
      ["ItemId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate", "Language", "OrganizationId", "Tags"].includes(fname)
    ) continue;
    if (!authoredNames.has(fname)) {
      problems.push(`  extra live field: ${fname}`);
    }
  }

  if (problems.length) {
    console.log(`✗ ${name} (live: ${liveName})`);
    console.log(problems.join("\n"));
    problemCount += problems.length;
  } else {
    console.log(`✓ ${name} (live: ${liveName}) — ${authoredFields.length} fields match`);
  }
}

console.log(
  problemCount === 0
    ? "\nALL SCHEMAS MATCH ✓"
    : `\n${problemCount} problem(s) found ✗`,
);
process.exit(problemCount === 0 ? 0 : 1);
