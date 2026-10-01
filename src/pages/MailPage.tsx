import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, isValid } from "date-fns";
import {
  ArrowLeft,
  AtSign,
  Check,
  Copy,
  Inbox,
  Mail,
  Pencil,
  Search,
  Send,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { useAllJoinedUsers, type JoinedMember } from "@/lib/blocks/users";
import {
  useDeleteMail,
  useMailInbox,
  useMarkMailRead,
  useRegisterMailAddress,
  useSendMail,
  useSentMail,
} from "@/lib/blocks/hooks";
import { type MailMessage } from "@/lib/blocks/data";
import { useT } from "@/lib/blocks/i18n";

type Folder = "inbox" | "sent";

function relativeTime(iso: string) {
  const d = new Date(iso);
  return isValid(d) ? formatDistanceToNow(d, { addSuffix: false }) : "";
}

function fullDate(iso: string) {
  const d = new Date(iso);
  return isValid(d) ? d.toLocaleString() : "";
}

// The person the row/reader is "about": the sender in the inbox, the
// recipient in Sent. Drives both the avatar and the name label.
//
// Inbound bridge mail often lands with `fromName` set to the raw RFC-5322
// from-line — e.g. `"SELISE Blocks" <apps@selise.co>` — which breaks the
// avatar's initials fallback (`getInitials` then picks "S<"). Strip the
// angle-bracketed address here so the avatar and the row label agree on
// a clean display name.
function cleanDisplayName(raw: string): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function counterpart(mail: MailMessage, folder: Folder) {
  const raw =
    folder === "inbox"
      ? mail.fromName || mail.fromEmail || "Unknown sender"
      : mail.toName || "Unknown recipient";
  return {
    id: folder === "inbox" ? mail.fromId : mail.userId,
    name: cleanDisplayName(raw) || raw,
  };
}

// External mail (the inbound bridge) frequently arrives as a full HTML
// document. Those render in a sandboxed iframe so the layout, styling and
// buttons survive; everything else is plain text with URL autolinking.
const HTML_BODY_RE = /<!doctype|<html[\s>]|<body[\s>]/i;
const URL_SPLIT_RE = /(https?:\/\/[^\s<>"')\]]+|mailto:[^\s<>"')\]]+)/g;

/** Tag-stripped text for the list-row preview line. Strips the same
 * lead-meta prefix the reader pane groups into a muted strip ("Email\n
 * 96\n" header lines from inbound bridge mail), so the list preview
 * jumps straight to the actual message body instead of starting with
 * the routing/identifying header. URLs get pulled out before truncation
 * so a 200-character activation link doesn't dominate the preview and
 * make one row 3x taller than its neighbour — keeping list rows at a
 * uniform two-line height. */
function mailPreview(body: string): string {
  let text = body;
  if (HTML_BODY_RE.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  // Drop URLs from the preview — they're surfaced as their own pill row
  // in the reader pane, so showing them in the list preview only eats
  // vertical space without adding any new information.
  text = text.replace(URL_SPLIT_RE, " ");
  // Drop the "Email\n<n>\n" lead-meta block the reader groups as muted
  // meta — same heuristic as PlainTextPaper: short leading lines without
  // sentence-ending punctuation, capped at 3 lines.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length && start < 3) {
    const line = lines[start].trim();
    if (!line) { start++; continue; }
    if (line.length <= 24 && !/[.!?]$/.test(line)) {
      start++;
      continue;
    }
    break;
  }
  return lines.slice(start).join(" ").replace(/\s{2,}/g, " ").trim();
}

/** Plain text → text and link chunks, so React renders anchors safely
 * (no dangerouslySetInnerHTML anywhere on user-supplied content). */
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** HTML mail body. The iframe sandbox allows popups only so `<a>` links
 * can open new tabs — scripts stay off, so hostile mail can't touch the
 * app. `<base target>` retrofits plain anchors into new-tab links, and
 * the wrapper forces a light colour scheme so dark-mode app chrome
 * doesn't wash the message out. The wrapper is `flex-1 min-h-0` so the
 * iframe grows to fill the remaining reader pane; long HTML scrolls
 * inside the frame, the page never does. */
function HtmlMailFrame({ html }: { html: string }) {
  const injected = `<meta name="color-scheme" content="light"><style>html,body{background:#ffffff!important;color:#0f172a;margin:0;padding:16px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.55;}a{color:#4f46e5;text-decoration:underline;}img{max-width:100%;height:auto;}</style><base target="_blank">`;
  const withBase = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${injected}`)
    : `${injected}${html}`;
  return (
    <div className="-ml-4 flex min-h-0 flex-1 overflow-hidden rounded-br-2xl border border-border-subtle bg-surface shadow-soft md:-ml-8">
      <iframe
        title="Message body"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={withBase}
        className="block h-full min-h-[320px] w-full flex-1 bg-white"
      />
    </div>
  );
}

/** Plain-text mail body styled like a Gmail/Outlook reading pane. Splits
 * the body into prose paragraphs and surfaces lone URLs in their own
 * pill row so a long activation link doesn't dominate the layout. The
 * rendering is purely visual — no server call, no data mutation. */
function PlainTextPaper({ text }: { text: string }) {
  // A "standalone URL" is a line that's nothing but a single http(s) link
  // (possibly wrapped across multiple lines because the sender broke it
  // for plain-text clients). We collapse wrap-broken URLs back into one.
  const urlOnlyLine = /^\s*(https?:\/\/\S+)\s*$/;
  const urlStart = /^\s*https?:\/\/\S{1,80}$/; // first line of a wrapped URL
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const blocks: Array<
    | { kind: "greeting"; text: string }
    | { kind: "p"; text: string }
    | { kind: "link"; href: string }
    | { kind: "meta"; text: string }
  > = [];

  let i = 0;
  let greetingEmitted = false;
  // Lead-meta junk: 1-3 short non-punctuated lines at the very top
  // before a greeting/heading — e.g. the "Email\n96\n" header prefix
  // SELISE put on this mail. Group them into one muted strip so they
  // don't drown the actual message body in noisy one-word paragraphs.
  const metaBuf: string[] = [];
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }
    if (urlOnlyLine.test(line)) {
      if (metaBuf.length) {
        blocks.push({ kind: "meta", text: metaBuf.join(" · ") });
        metaBuf.length = 0;
      }
      blocks.push({ kind: "link", href: line.match(/(https?:\/\/\S+)/)![1] });
      i++;
      continue;
    }
    if (urlStart.test(line)) {
      if (metaBuf.length) {
        blocks.push({ kind: "meta", text: metaBuf.join(" · ") });
        metaBuf.length = 0;
      }
      // Glom continuation lines that are also URL fragments.
      let combined = line.trim();
      let j = i + 1;
      while (j < lines.length) {
        const nxt = lines[j].trim();
        if (!nxt) break;
        if (/^(https?:\/\/|\S+\.\S+|[\w/=?%&:+-]+)$/.test(nxt)) {
          combined += nxt;
          j++;
        } else {
          break;
        }
      }
      const m = /(https?:\/\/\S+)/.exec(combined);
      if (m) {
        blocks.push({ kind: "link", href: m[1] });
        i = j;
        continue;
      }
    }
    // Greeting heuristic: short line that ends with comma/colon and
    // starts with a salutation ("Hi", "Hello", "Dear", or just a name).
    // Only the first one becomes a greeting — everything else falls
    // through to paragraph rendering.
    const isGreeting =
      !greetingEmitted &&
      line.length <= 60 &&
      /[,.:]$/.test(line) &&
      /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening)|hola|greetings)\b/i.test(line);
    if (isGreeting) {
      if (metaBuf.length) {
        blocks.push({ kind: "meta", text: metaBuf.join(" · ") });
        metaBuf.length = 0;
      }
      greetingEmitted = true;
      blocks.push({ kind: "greeting", text: line });
      i++;
      continue;
    }
    // Junk-prefix meta: short lines at the top that don't match greeting
    // or URL — buffer them until we hit a real block, then emit as one
    // muted strip. Cap at 3 to avoid eating a multi-line signature.
    if (!greetingEmitted && blocks.length === 0 && metaBuf.length < 3 && line.length <= 24 && !/[.!?]$/.test(line)) {
      metaBuf.push(line);
      i++;
      continue;
    }
    if (metaBuf.length) {
      blocks.push({ kind: "meta", text: metaBuf.join(" · ") });
      metaBuf.length = 0;
    }
    // Collect contiguous non-empty lines into one paragraph.
    let para = line;
    let k = i + 1;
    while (k < lines.length && lines[k].trim() !== "" && !urlOnlyLine.test(lines[k]) && !urlStart.test(lines[k])) {
      para += " " + lines[k].trim();
      k++;
    }
    blocks.push({ kind: "p", text: para });
    i = k;
  }
  if (metaBuf.length) {
    blocks.push({ kind: "meta", text: metaBuf.join(" · ") });
  }

  return (
    <div className="rounded-br-2xl border border-border-subtle bg-surface px-6 py-7 text-foreground sm:px-10 sm:py-10">
      <div className="mx-auto flex max-w-[640px] flex-col gap-4">
        {blocks.length === 0 ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          blocks.map((b, idx) => {
            if (b.kind === "greeting") {
              return (
                <p key={idx} className="text-sm font-medium text-muted-foreground">
                  {b.text}
                </p>
              );
            }
            if (b.kind === "meta") {
              return (
                <p
                  key={idx}
                  className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70"
                >
                  {b.text}
                </p>
              );
            }
            if (b.kind === "link") {
              return (
                <a
                  key={idx}
                  href={b.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block break-all rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-2.5 text-[13px] font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/15"
                >
                  {b.href}
                </a>
              );
            }
            // Lead paragraph after greeting reads as a heading.
            const prev = blocks[idx - 1];
            const isLeadHeading =
              prev?.kind === "greeting" && b.text.length <= 80;
            if (isLeadHeading) {
              return (
                <h3
                  key={idx}
                  className="text-balance text-[22px] font-semibold leading-snug tracking-tight text-foreground"
                >
                  {b.text}
                </h3>
              );
            }
            return (
              <p
                key={idx}
                className="text-[15px] leading-7 text-foreground/85"
              >
                <LinkifiedText text={b.text} />
              </p>
            );
          })
        )}
      </div>
    </div>
  );
}

// Mail — the workspace mailbox. Two folders over one MailMessage
// collection: Inbox (rows addressed to me) and Sent (rows I created).
// Data flows through the defensive hooks in `lib/blocks/hooks.ts`, so
// the page renders mirror rows transparently until `blx_MailMessages`
// is deployed to the gateway.
export function MailPage() {
  const t = useT();
  // `user` is the context's field; aliased so the rest of the file keeps
  // the conventional `currentUser` name used by the data hooks.
  const { user: currentUser } = useAuthContext();
  const inbox = useMailInbox();
  const sent = useSentMail();
  const markRead = useMarkMailRead();
  const deleteMail = useDeleteMail();
  const send = useSendMail();
  const joinedQuery = useAllJoinedUsers();
  const joined = joinedQuery.data ?? [];

  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [toIds, setToIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [registerState, setRegisterState] = useState<
    "idle" | "pending" | "ok" | "error"
  >("idle");
  const [query, setQuery] = useState("");

  // This user's inbound address — handed back by the bridge on
  // registration (the public mail domain is the bridge's knowledge,
  // not derivable client-side). Null until registered, so the dialog
  // never shows a half-built address.
  const [bridgeAddress, setBridgeAddress] = useState<string | null>(null);
  const registerAddress = useRegisterMailAddress();

  // Register the mailbox the first time the dialog opens — the bridge
  // creates (or reuses) a real routable account and mirrors it into
  // blx_MailAddresses. The "idle" guard means an error waits for the
  // Retry button instead of loop-firing.
  useEffect(() => {
    if (!emailOpen || registerState !== "idle" || !currentUser) {
      return;
    }
    setRegisterState("pending");
    registerAddress.mutate(
      { userId: currentUser.id, userName: currentUser.name },
      {
        onSuccess: (r) => {
          setBridgeAddress(r.address);
          setRegisterState("ok");
        },
        onError: () => setRegisterState("error"),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailOpen, registerState, currentUser]);

  const allRows = folder === "inbox" ? inbox.data ?? [] : sent.data ?? [];
  const loading = folder === "inbox" ? inbox.isLoading : sent.isLoading;

  // Local search filter over subject + peer name + preview. Same shape as
  // the rows, so the existing list rendering doesn't need to branch.
  const rows = useMemo(() => {
    if (!query.trim()) return allRows;
    const q = query.toLowerCase();
    return allRows.filter((m) => {
      const peer = counterpart(m, folder);
      return (
        m.subject.toLowerCase().includes(q) ||
        peer.name.toLowerCase().includes(q) ||
        mailPreview(m.body ?? "").toLowerCase().includes(q)
      );
    });
  }, [allRows, query, folder]);

  const unreadCount = (inbox.data ?? []).filter((m) => !m.readAt).length;
  const totalInbox = (inbox.data ?? []).length;
  const totalSent = (sent.data ?? []).length;
  const selected = rows.find((m) => m.id === selectedId) ?? null;

  const recipientOptions = useMemo(
    () =>
      joined
        .filter((u) => u.id !== currentUser?.id)
        .map((u) => ({ value: u.id, label: u.displayName || u.name })),
    [joined, currentUser?.id],
  );
  const recipientMap = useMemo(
    () => new Map<string, JoinedMember>(joined.map((u) => [u.id, u])),
    [joined],
  );

  function openMail(mail: MailMessage) {
    setSelectedId(mail.id);
    // Only the recipient's copy carries an unread state — the sender's
    // Sent row is theirs and never flips.
    if (folder === "inbox" && !mail.readAt) {
      markRead.mutate(mail);
    }
  }

  function removeMail(mail: MailMessage) {
    if (selectedId === mail.id) setSelectedId(null);
    deleteMail.mutate(mail);
  }

  async function handleSend() {
    const recipients = toIds
      .map((id) => recipientMap.get(id))
      .filter((u): u is JoinedMember => Boolean(u))
      .map((u) => ({
        id: u.id,
        name: u.displayName || u.name,
        email: u.email,
      }));
    try {
      const results = await send.mutateAsync({
        to: recipients,
        subject,
        body,
      });
      toast.success(
        `${t("mail.compose.sentToast", "Message sent")} (${results.length})`,
      );
      setToIds([]);
      setSubject("");
      setBody("");
      setComposeOpen(false);
      // Land the user on the folder that now holds their message.
      setFolder("sent");
      setSelectedId(null);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("mail.compose.failed", "Couldn't send the message."),
      );
    }
  }

  async function copyAddress() {
    if (!bridgeAddress) return;
    try {
      await navigator.clipboard.writeText(bridgeAddress);
      setCopied(true);
      toast.success(t("mail.getEmail.copiedToast", "Address copied"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(
        t(
          "mail.getEmail.copyFailed",
          "Couldn't copy — select the address manually.",
        ),
      );
    }
  }

  const folders: { id: Folder; label: string; icon: typeof Inbox; count: number }[] = [
    {
      id: "inbox",
      label: t("mail.folder.inbox", "Inbox"),
      icon: Inbox,
      count: totalInbox,
    },
    {
      id: "sent",
      label: t("mail.folder.sent", "Sent"),
      icon: Send,
      count: totalSent,
    },
  ];

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[34rem] flex-col bg-background">
      {/* Page header — title, search, primary actions. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-background/80 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-soft">
            <Mail className="h-[18px] w-[18px]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-bold tracking-tight text-foreground">
              {t("mail.title", "Mail")}
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              {t("mail.subtitle", "Messages between you and your teammates.")}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <label className="relative hidden flex-1 max-w-xs sm:block">
            <span className="sr-only">Search mail</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("mail.search", "Search subject, sender or text…")}
              className="h-9 w-full rounded-lg border border-border-subtle bg-surface-subtle pl-8 pr-3 text-[13px] placeholder:text-muted-foreground/80 focus:border-indigo-400 focus:bg-background focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
            <AtSign className="mr-2 h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("mail.getEmail", "Get Your Email")}
            </span>
            <span className="sm:hidden">{t("mail.getEmailShort", "Address")}</span>
          </Button>
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("mail.compose", "Compose")}
          </Button>
        </div>
      </div>

      {/* Three-pane body: folders | list | reader. On phones only one of
          list/reader is shown — the back button toggles between them. */}
      <div className="grid min-h-0 flex-1 md:grid-cols-[200px_minmax(320px,400px)_1fr]">
        {/* Sidebar — folders. */}
        <aside className="hidden min-h-0 border-r border-border-subtle bg-surface-subtle/40 p-3 md:block">
          <Button
            className="mb-3 w-full justify-start gap-2"
            size="sm"
            onClick={() => setComposeOpen(true)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("mail.compose", "Compose")}
          </Button>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("mail.foldersLabel", "Folders")}
          </p>
          <nav className="space-y-0.5">
            {folders.map((f) => {
              const Icon = f.icon;
              const active = folder === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFolder(f.id);
                    setSelectedId(null);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-background font-medium text-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">{f.label}</span>
                  {f.count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                        active
                          ? "bg-indigo-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {f.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <p className="mt-6 flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="inline-block h-1 w-1 rounded-full bg-indigo-400" aria-hidden="true" />
            {t("mail.labels", "Tips")}
          </p>
          <div className="mx-2 mt-1 rounded-lg border border-dashed border-border-subtle bg-background/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <p className="line-clamp-2">
              {t(
                "mail.tips",
                "Get Your Email is your real address. Outsiders can mail you there — it lands here.",
              )}
            </p>
          </div>
        </aside>

        {/* List pane — also hosts the folder pill row on mobile. */}
        <aside
          className={`min-h-0 flex-col overflow-hidden border-r border-border-subtle ${
            selected ? "hidden md:flex" : "flex"
          }`}
          aria-label={t("mail.listLabel", "Message list")}
        >
          {/* Mobile folder pill row (sidebar handles this on md+). */}
          <div
            role="tablist"
            aria-label={t("mail.folders", "Mail folders")}
            className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-3 py-2 md:hidden"
          >
            {folders.map((f) => {
              const active = folder === f.id;
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setFolder(f.id);
                    setSelectedId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-background text-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {f.label}
                  {f.id === "inbox" && unreadCount > 0 && (
                    <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {loading && rows.length === 0 ? (
            <div className="flex-1 space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-surface-subtle">
                <Mail className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {query
                    ? t("mail.empty.search", "No matches for that search.")
                    : folder === "inbox"
                      ? t("mail.empty.inbox", "Your inbox is empty.")
                      : t("mail.empty.sent", "Nothing sent yet.")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {folder === "inbox" && !query
                    ? t(
                        "mail.empty.inboxHint",
                        "Open Get Your Email to share your address — anything sent to it lands here.",
                      )
                    : folder === "sent" && !query
                      ? t(
                          "mail.empty.sentHint",
                          "Hit Compose to start a conversation with a teammate.",
                        )
                      : null}
                </p>
              </div>
              {folder === "sent" && !query && (
                <Button size="sm" onClick={() => setComposeOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("mail.compose", "Compose")}
                </Button>
              )}
            </div>
          ) : (
            <ul className="mail-scroll min-h-0 flex-1 overflow-y-auto p-2">
              {rows.map((m) => {
                const peer = counterpart(m, folder);
                const isUnread = folder === "inbox" && !m.readAt;
                const isSelected = m.id === selectedId;
                return (
                  <li key={m.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openMail(m)}
                      className={`flex h-[5.5rem] w-full items-start gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? "bg-indigo-50/70 ring-1 ring-indigo-200/60 dark:bg-indigo-500/10 dark:ring-indigo-400/30"
                          : "hover:bg-surface-subtle"
                      }`}
                    >
                      <UserAvatar
                        userId={peer.id || undefined}
                        name={peer.name}
                        size="sm"
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-sm ${
                              isUnread
                                ? "font-semibold text-foreground"
                                : "text-foreground/90"
                            }`}
                          >
                            {peer.name}
                          </span>
                          <span
                            className={`shrink-0 text-[11px] transition-opacity ${
                              isUnread
                                ? "font-medium text-indigo-600 dark:text-indigo-400"
                                : "text-muted-foreground"
                            } group-hover:opacity-0`}
                          >
                            {relativeTime(m.createdAt)}
                          </span>
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-[13px] ${
                            isUnread
                              ? "font-medium text-foreground"
                              : "text-foreground/80"
                          }`}
                        >
                          {m.subject || t("mail.noSubject", "(no subject)")}
                        </span>
                        <span className="mt-0.5 block max-h-[2.25rem] overflow-hidden text-[11px] leading-snug text-muted-foreground">
                          {mailPreview(m.body ?? "") ||
                            t("mail.noBody", "No content")}
                        </span>
                      </span>
                      <span className="mt-1 flex shrink-0 flex-col items-center gap-1">
                        {isUnread && (
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-indigo-500"
                          />
                        )}
                        <button
                          type="button"
                          aria-label={t("mail.delete", "Delete message")}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMail(m);
                          }}
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Reader pane. */}
        <section
          className={`min-h-0 flex-col bg-background ${
            selected ? "flex" : "hidden md:flex"
          }`}
          aria-label={t("mail.readerLabel", "Message reader")}
        >
          {selected ? (
            <>
              {/* Top bar — back, subject line, peer row. Fills only what it
                  needs; the body region below uses min-h-0 + flex-1 to
                  absorb the remaining viewport. No outer scroll. */}
              <div className="shrink-0 border-b border-border-subtle bg-background/95 backdrop-blur">
                <div className="flex items-center gap-2 px-3 py-2 md:px-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedId(null)}
                    aria-label={t("mail.back", "Back to list")}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 dark:bg-indigo-500/15">
                      {folder === "inbox"
                        ? t("mail.folder.inbox", "Inbox")
                        : t("mail.folder.sent", "Sent")}
                    </span>
                    <span className="truncate font-medium">
                      {relativeTime(selected.createdAt)}
                    </span>
                    <span aria-hidden="true" className="opacity-50">·</span>
                    <span className="truncate" title={fullDate(selected.createdAt)}>
                      {fullDate(selected.createdAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMail(selected)}
                    aria-label={t("mail.delete", "Delete message")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex items-start gap-3 px-4 pb-3 pt-1.5 md:px-8">
                  <h2 className="min-w-0 flex-1 text-balance break-words text-[22px] font-bold leading-snug tracking-tight text-foreground">
                    {selected.subject ||
                      t("mail.noSubject", "(no subject)")}
                  </h2>
                </div>
              </div>

              {/* Scroll region — owns the only vertical scroll in the
                  pane (body cards on long or HTML mail). For plain-text
                  bodies this is where the scroll happens; for HTML mail
                  the iframe inside takes the scroll instead. Peer card
                  is sticky to the top so the sender/recipient row stays
                  in view as the body scrolls — same pattern as Gmail's
                  collapsed "from" header. */}
              <div className="mail-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-3 px-4 pb-4 pt-3 md:px-8">
                  {/* Peer card — sender (inbox) or recipient (sent).
                     Stays inside the parent's horizontal padding so its
                     left/right edges align with the body content below
                     — no flat edge pokes out, no extra rounding. */}
                  <div className="sticky top-0 z-10 flex items-center gap-3 border border-border-subtle bg-surface/95 px-7 py-3 backdrop-blur md:px-11">
                    <UserAvatar
                      userId={counterpart(selected, folder).id || undefined}
                      name={counterpart(selected, folder).name}
                      size="md"
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {counterpart(selected, folder).name}
                        </span>
                        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {folder === "inbox"
                            ? t("mail.from", "From")
                            : t("mail.to", "To")}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {(() => {
                          if (folder === "inbox" && selected.fromEmail) {
                            return selected.fromEmail;
                          }
                          if (selected.toName && selected.toName.includes("@")) {
                            const m = /<([^>]+)>/.exec(selected.toName);
                            if (m) return m[1];
                            return selected.toName;
                          }
                          return t("mail.peerSubtitle", "Workspace member");
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Body card — HTML or plain text. HTML mail sits inside
                      a flex-1 iframe that fills the remaining height so
                      long messages scroll inside the frame, not the page.
                      Plain text mail renders in a paper card that mimics
                      the way Gmail/Outlook surface the body: warm-white
                      surface, comfortable padding, generous line height,
                      clickable URLs broken out into their own rows so a
                      long link doesn't dominate the visual rhythm. */}
                  {selected.body && HTML_BODY_RE.test(selected.body) ? (
                    <HtmlMailFrame html={selected.body} />
                  ) : (
                    <PlainTextPaper
                      text={
                        selected.body ||
                        t("mail.noBody", "This message has no content.")
                      }
                    />
                  )}
                </div>
              </div>

              {/* Sticky bottom action bar — gives reply affordance a
                  stable home; hooks can wire to the compose dialog later. */}
              <div className="shrink-0 flex items-center gap-2 border-t border-border-subtle bg-background/95 px-3 py-2 backdrop-blur md:px-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setComposeOpen(true)}
                  disabled={folder !== "inbox"}
                  title={
                    folder === "inbox"
                      ? t("mail.reply", "Reply")
                      : t("mail.replyHint", "Open a new message to reply")
                  }
                >
                  <SendHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("mail.reply", "Reply")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(selected.body ?? "")
                      .then(() =>
                        toast.success(
                          t("mail.forward.copied", "Message copied"),
                        ),
                      )
                      .catch(() => {});
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("mail.copyText", "Copy text")}
                </Button>
                <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                  {selected.body
                    ? `${Math.max(1, Math.round((selected.body.length || 0) / 5) / 100)} min read`
                    : ""}
                </span>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10">
                <Mail
                  className="h-7 w-7 text-indigo-500/70"
                  aria-hidden="true"
                />
              </div>
              <div className="max-w-xs">
                <p className="text-sm font-medium text-foreground">
                  {t("mail.readerEmpty", "Select a message to read it here.")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "mail.readerHint",
                    "Pick one from the list on the left to open it in this pane.",
                  )}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Compose — MultiSelect over the workspace roster (self excluded). */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("mail.compose.title", "New message")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "mail.compose.description",
                "Send a message to teammates in this workspace.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MultiSelect
              label={t("mail.compose.to", "To")}
              value={toIds}
              onChange={setToIds}
              options={recipientOptions}
              placeholder={t("mail.compose.toPlaceholder", "Pick recipients…")}
            />
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("mail.compose.subjectPlaceholder", "Subject")}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder={t("mail.compose.bodyPlaceholder", "Write your message…")}
              className="flex w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setComposeOpen(false)}
              disabled={send.isPending}
            >
              {t("mail.compose.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => void handleSend()}
              disabled={send.isPending || toIds.length === 0 || !subject.trim()}
            >
              <SendHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
              {send.isPending
                ? t("mail.compose.sending", "Sending…")
                : t("mail.compose.send", "Send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Get Your Email — surfaces the inbound address with shortcuts to
          use it: copy for sharing, or jump into the visitor's own mail
          client with the address pre-filled. */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("mail.getEmail.title", "Your email address")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "mail.getEmail.description",
                "Share it with anyone — whatever they send here from Gmail, Outlook, anywhere, lands in your inbox.",
              )}
            </DialogDescription>
          </DialogHeader>
          {bridgeAddress ? (
            <>
              <div className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-3.5 py-3">
                <AtSign
                  className="h-4 w-4 shrink-0 text-indigo-500"
                  aria-hidden="true"
                />
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                  {bridgeAddress}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyAddress()}
                >
                  {copied ? (
                    <Check
                      className="mr-1.5 h-3.5 w-3.5 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copied
                    ? t("mail.getEmail.copied", "Copied")
                    : t("mail.getEmail.copy", "Copy")}
                </Button>
              </div>
              {/* Registration status — the address only routes once the
                  cloud registry row exists, so say so honestly. */}
              <p
                className="flex flex-wrap items-center gap-1.5 text-xs"
                role="status"
              >
                {registerState === "ok" && (
                  <>
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-success"
                      aria-hidden="true"
                    />
                    <span className="text-success">
                      {t(
                        "mail.getEmail.active",
                        "Active — anything sent here lands in your inbox.",
                      )}
                    </span>
                  </>
                )}
                {registerState === "pending" && (
                  <span className="text-muted-foreground">
                    {t("mail.getEmail.activating", "Activating your address…")}
                  </span>
                )}
                {registerState === "error" && (
                  <>
                    <span className="text-destructive">
                      {t(
                        "mail.getEmail.activateFailed",
                        "Couldn't activate the address — mail won't route yet.",
                      )}
                    </span>
                    <button
                      type="button"
                      className="font-medium text-indigo-600 hover:underline"
                      onClick={() => setRegisterState("idle")}
                    >
                      {t("mail.getEmail.retry", "Retry")}
                    </button>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("mail.getEmail.signedOut", "Sign in to get your address.")}
            </p>
          )}
          <DialogFooter>
            <Button asChild variant="outline" disabled={!bridgeAddress}>
              <a href={bridgeAddress ? `mailto:${bridgeAddress}` : "#"}>
                <SendHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("mail.getEmail.openApp", "Open mail app")}
              </a>
            </Button>
            <Button
              onClick={() => void copyAddress()}
              disabled={!bridgeAddress}
            >
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("mail.getEmail.copyAddress", "Copy address")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
