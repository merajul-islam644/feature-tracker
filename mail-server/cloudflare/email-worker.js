// mail-server/cloudflare/email-worker.js
//
// Cloudflare Email Worker for the Lattice mailbox.
//
// Cloudflare Email Routing delivers the RAW message to this worker
// (catch-all route or a specific address rule). We parse it with
// postal-mime and POST the parsed fields to the Lattice mail-server,
// which stores one MailMessage row the /mail inbox reads.
//
// Secrets (set via `wrangler secret put` or the dashboard):
//   INBOUND_URL     https://<your-mail-server>/mail/inbound
//   INBOUND_SECRET  the same value as MAIL_INBOUND_SECRET on the server
//
// Deploy:
//   npm i postal-mime        (bundled by wrangler at deploy time)
//   npx wrangler deploy
// …or paste this file into the dashboard (Settings → Email → Email
// Workers) — dashboard deploy needs postal-mime inlined, so prefer the
// wrangler path; the README walks both.

import { PostalMime } from "postal-mime";

export default {
  async email(message, env, ctx) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const parsed = await new PostalMime().parse(raw);

    const payload = {
      from:
        parsed.from?.address
          ? parsed.from.name
            ? `${parsed.from.name} <${parsed.from.address}>`
            : parsed.from.address
          : message.from,
      to: message.to,
      subject: parsed.subject ?? "(no subject)",
      text: parsed.text ?? "",
      receivedAt: new Date().toISOString(),
    };

    const resp = await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbound-secret": env.INBOUND_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      // Throwing makes Cloudflare retry/send a bounce; a stored-failure
      // is better than silence, since the sender at least learns it
      // didn't land.
      console.error("inbound POST failed", resp.status, await resp.text());
      throw new Error(`inbound POST failed: ${resp.status}`);
    }
  },
};
