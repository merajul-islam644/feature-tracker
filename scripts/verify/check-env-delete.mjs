// One-off: verify the env-delete cascade cleaned the cloud for project
// 3d10edd8-dd42-451f-9005-b6100848330e / slug "dev". Read-only.
import { walkerClient } from "../walker/auth.mjs";

const PID = "3d10edd8-dd42-451f-9005-b6100848330e";
const client = await walkerClient();

async function count(name, filter) {
  const r = await client.data
    .collection(name, { fields: ["ItemId"] })
    .list({ filter, pageNo: 1, pageSize: 100 });
  const d = r?.data ?? {};
  for (const v of Object.values(d)) if (v?.items) return v.items.length;
  return 0;
}

console.log("Environment rows for project:", await count("Environment", { projectId: PID }));
console.log("Features under (project, dev):", await count("Feature", { projectId: PID, envSlug: "dev" }));
console.log("Targets under (project, dev):", await count("VerificationTarget", { projectId: PID, envSlug: "dev" }));
console.log("Secrets under (project, dev):", await count("Secret", { projectId: PID, envSlug: "dev" }));
console.log("Issues under (project, dev):", await count("Issue", { projectId: PID, envSlug: "dev" }));
