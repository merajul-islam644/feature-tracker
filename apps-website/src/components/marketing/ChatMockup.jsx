// In-product Team Chat mockup — sidebar with member list + active
// conversation thread showing text + image bubbles, plus the composer
// with a paperclip attachment. Used inside the ProductVisual section so
// the marketing site shows another realistic app surface.
import { Search, Paperclip, Send, Smile, MoreHorizontal, Phone, Video } from "lucide-react";

const members = [
  { initials: "MA", name: "Maya Ahmadi", preview: "Pushed the staging build", active: false, tone: "from-indigo-500 to-cyan-500", unread: 0 },
  { initials: "RA", name: "Rafi Ahmed", preview: "Opened PR #482", active: false, tone: "from-pink-500 to-rose-500", unread: 2 },
  { initials: "AS", name: "Asha Singh", preview: "Shared release notes", active: true, tone: "from-emerald-500 to-teal-500", unread: 0 },
  { initials: "NK", name: "Noor Khan", preview: "Will check tomorrow", active: false, tone: "from-amber-500 to-orange-500", unread: 0 },
  { initials: "DI", name: "Devon Ito", preview: "Sent the spec draft", active: false, tone: "from-purple-500 to-fuchsia-500", unread: 0 },
];

const messages = [
  {
    fromMe: false,
    initials: "AS",
    tone: "from-emerald-500 to-teal-500",
    name: "Asha",
    time: "10:42",
    body: "Hey, just pushed the v2.4 release notes draft. Mind taking a look before Friday?",
  },
  {
    fromMe: true,
    initials: "ME",
    tone: "from-indigo-500 to-cyan-500",
    name: "You",
    time: "10:44",
    body: "On it. Anything specific you want me to check?",
  },
  {
    fromMe: false,
    initials: "AS",
    tone: "from-emerald-500 to-teal-500",
    name: "Asha",
    time: "10:45",
    body: "Mostly the rollout section — we want to land it on staging first.",
    attachment: {
      kind: "image",
      caption: "release-notes-draft.png",
    },
  },
  {
    fromMe: true,
    initials: "ME",
    tone: "from-indigo-500 to-cyan-500",
    name: "You",
    time: "10:46",
    body: "Got it. Reading through now 👀",
  },
];

export default function ChatMockup() {
  return (
    <div className="flex bg-slate-100/60">
      {/* Member list */}
      <aside className="hidden w-[200px] shrink-0 flex-col border-r border-slate-200 bg-white sm:flex">
        <div className="border-b border-slate-200 p-3">
          <h2 className="text-xs font-semibold text-slate-900">Direct messages</h2>
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
            <Search className="h-3 w-3" aria-hidden="true" />
            Search members
          </div>
        </div>
        <ul className="flex-1 overflow-hidden">
          {members.map((m) => (
            <li
              key={m.name}
              className={
                m.active
                  ? "flex items-center gap-2 border-l-2 border-indigo-600 bg-indigo-50/50 px-3 py-2"
                  : "flex items-center gap-2 px-3 py-2"
              }
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white ${m.tone}`}
              >
                {m.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="truncate text-[11px] font-medium text-slate-900">
                    {m.name}
                  </p>
                  {m.unread > 0 && (
                    <span className="rounded-full bg-indigo-600 px-1.5 text-[9px] font-semibold text-white">
                      {m.unread}
                    </span>
                  )}
                </div>
                <p className="truncate text-[10px] text-slate-500">{m.preview}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thread header */}
        <div className="flex h-10 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-[10px] font-semibold text-white">
              AS
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-900">Asha Singh</p>
              <p className="text-[10px] text-emerald-600">Active now</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-slate-500">
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-hidden bg-slate-50/60 p-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={
                msg.fromMe
                  ? "flex items-start justify-end gap-2"
                  : "flex items-start gap-2"
              }
            >
              {!msg.fromMe && (
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white ${msg.tone}`}
                >
                  {msg.initials}
                </div>
              )}
              <div className={msg.fromMe ? "flex flex-col items-end" : "flex flex-col"}>
                <div
                  className={
                    msg.fromMe
                      ? "max-w-[260px] rounded-2xl rounded-br-md bg-indigo-600 px-3 py-2 text-[11px] text-white shadow-sm"
                      : "max-w-[260px] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-900 shadow-sm"
                  }
                >
                  {msg.body}
                </div>
                {msg.attachment && (
                  <div className="mt-1.5 max-w-[260px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    {/* Image placeholder — gradient block labelled with the
                        filename so it reads as an image attachment without
                        shipping a binary asset. */}
                    <div className="relative h-24 w-full bg-gradient-to-br from-indigo-100 via-cyan-100 to-emerald-100">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="rounded-md bg-white/80 px-2 py-1 text-[10px] font-medium text-slate-700 backdrop-blur">
                          📎 {msg.attachment.caption}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <p className="mt-1 px-1 text-[9px] text-slate-400">
                  {msg.name} · {msg.time}
                </p>
              </div>
              {msg.fromMe && (
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white ${msg.tone}`}
                >
                  {msg.initials}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Paperclip
              className="h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <Smile
              className="h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <span className="flex-1 text-[11px] text-slate-400">
              Message Asha…
            </span>
            <button
              type="button"
              tabIndex={-1}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm"
            >
              <Send className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
