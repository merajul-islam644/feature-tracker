// One-off: list every Environment row's (slug, label, kind) so the
// short-form-on-card / full-form-on-page change can be checked against
// live data — canonical rows seeded by the v2.1 migration carry SHORT
// labels ("Dev"/"Stg"/…), which would leak onto env page headers. Read-only.
import { walkerClient } from "../walker/auth.mjs";

const client = await walkerClient();
const r = await client.data
  .collection("Environment", {
    fields: ["ItemId", "projectId", "slug", "label", "kind"],
  })
  .list({ pageNo: 1, pageSize: 200 });
const d = r?.data ?? {};
for (const v of Object.values(d)) {
  if (v?.items) {
    console.log(`rows: ${v.items.length}`);
    for (const row of v.items) {
      console.log(
        `  ${row.projectId} | slug=${row.slug} | label=${JSON.stringify(row.label)} | kind=${row.kind}`,
      );
    }
  }
}
