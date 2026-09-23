// One-time admin grant script for the manager role.
//
// Why this exists: the `blocks iam roles assign-permissions` CLI command
// has a defect — backend validates `filter.search` and `filter.isBuiltIn`
// as required, but the CLI's convenience flags don't send those fields,
// so every call returns 400 Bad Request. This script uses the same
// `assignPermissions` SDK method the CLI itself wraps, so the wire shape
// matches what backend expects.
//
// Usage (manual one-time admin operation):
//   1. Sign in to the CLI with an admin account that has permission to
//      assign permissions to the manager role:
//        blocks login --account <adminAccountName>
//   2. Make sure the active project is the Feature Tracker tenant:
//        blocks use Dd333bf2f23274fb481e4f363ee44b28b
//   3. Run this script from the repo root:
//        node scripts/grant-files-perms.cjs
//
// It grants the manager role the four Blocks Data Storage permissions
// needed by the profile-picture upload flow:
//   - blocks-data::file::get-pre-signed-url-for-upload  (presign upload)
//   - blocks-data::file::get-file                       (download one file)
//   - blocks-data::file::get-files                      (batch download)
//   - blocks-data::file::get-files-info                 (metadata)
//
// Re-runnable; adding already-assigned permissions is a no-op.
//
// Tokens, client ids, and tenant ids are NEVER printed.

const fs = require("fs");
const path = require("path");

process.chdir(path.resolve(__dirname, ".."));

// Minimal .env parser — only the two vars we need. Avoids adding
// `dotenv` as a one-time dependency.
function loadEnv() {
  const text = fs.readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const apiMatch = line.match(/^VITE_BLOCKS_API_URL=(.+)$/);
    if (apiMatch) process.env.VITE_BLOCKS_API_URL = apiMatch[1].trim();
    const keyMatch = line.match(/^VITE_BLOCKS_KEY=(.+)$/);
    if (keyMatch) process.env.VITE_BLOCKS_KEY = keyMatch[1].trim();
  }
}
loadEnv();

const apiUrl = process.env.VITE_BLOCKS_API_URL;
const xBlocksKey = process.env.VITE_BLOCKS_KEY;
if (!apiUrl || !xBlocksKey) {
  console.error(
    "Missing VITE_BLOCKS_API_URL or VITE_BLOCKS_KEY in .env — cannot proceed.",
  );
  process.exit(1);
}

// The SDK requires an OIDC bearer access token alongside the tenant key
// for sensitive endpoints like assign-permissions. We don't store any
// token here; the operator is expected to paste the access token from
// the signed-in browser session (devtools → Application → Cookies →
// `blocks_access_token`) into the BLOCKS_ACCESS_TOKEN env var, then run.
const accessToken = process.env.BLOCKS_ACCESS_TOKEN;
if (!accessToken) {
  console.error(
    [
      "",
      "BLOCKS_ACCESS_TOKEN env var not set.",
      "",
      "How to get it (one-time, dev-only):",
      "  1. Open https://dbeegi.slsblx.com:5173 in your browser.",
      "  2. Sign in as the manager.",
      "  3. DevTools → Application → Cookies → https://dbeegi.slsblx.com:5173",
      "  4. Copy the value of the `blocks_access_token` cookie.",
      "  5. Re-run with:",
      "       $env:BLOCKS_ACCESS_TOKEN='<paste>'; node scripts/grant-files-perms.cjs",
      "",
      "The token is held in process memory only and is never printed.",
    ].join("\n"),
  );
  process.exit(1);
}

const sdk = require(
  path.join(process.cwd(), "node_modules", "@seliseblocks", "client", "dist", "client.js"),
);

const blocks = sdk.createBlocksClient({
  apiUrl,
  xBlocksKey,
  accessToken: () => accessToken,
});

const FILE_PERMS = [
  "blocks-data::file::get-pre-signed-url-for-upload",
  "blocks-data::file::get-file",
  "blocks-data::file::get-files",
  "blocks-data::file::get-files-info",
];

(async () => {
  console.log("Granting file permissions to manager role…");
  const res = await blocks.iam.roles.assignPermissions({
    slug: "manager",
    addPermissions: FILE_PERMS,
  });
  // Only print the operation success/result, never tokens or ids.
  console.log(
    JSON.stringify(
      {
        isSuccess: res?.isSuccess ?? null,
        message: res?.message ?? null,
        errors: res?.errors ?? null,
        httpStatusCode: res?.httpStatusCode ?? null,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  // Avoid printing the full error body — it may include the token.
  console.error("Grant failed:", e?.message ?? e);
  process.exit(1);
});
