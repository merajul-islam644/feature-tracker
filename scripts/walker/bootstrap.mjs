// One-shot bootstrap: load walker context, list targets, print one target.
// Run: node scripts/walker/bootstrap.mjs
import { loadWalkerContext } from "./data.mjs";

const { config, targets, secrets, secretBindings } = await loadWalkerContext();

console.log("=== walker config ===");
console.log({
  iam: config.iam,
  apiUrl: config.apiUrl,
  tenant: config.tenant,
  email: config.email,
});
console.log("\n=== targets (count: " + targets.length + ") ===");
for (const t of targets) {
  console.log({
    id: t.id,
    name: t.applicationName,
    url: t.url,
    env: t.environment,
    enabled: t.enabled,
    credentialId: t.credentialId,
    lastVerifiedAt: t.lastVerifiedAt,
    lastStatus: t.lastStatus,
  });
}
console.log("\n=== secrets (count: " + secrets.length + ") ===");
for (const s of secrets) {
  console.log({
    id: s.id,
    name: s.name,
    email: s.email,
    passwordMasked: s.passwordMasked,
  });
}
console.log("\n=== bindings ===");
console.log(secretBindings);
