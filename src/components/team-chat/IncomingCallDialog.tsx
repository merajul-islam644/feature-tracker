// Global ring/accept/decline prompt.
//
// Mounted once in AppLayout next to <GlobalChatAssistant /> + <Toaster />.
// Subscribes to the same incoming-call query the auto-open hook drives,
// and switches into the full <CallDialog role="answerer" /> on Accept.
//
// Why this is separate from CallDialog:
//   - CallDialog is the in-call surface (mute/camera/End), which is the
//     same shape regardless of direction.
//   - IncomingCallDialog is the pre-answer surface (ring/accept/decline)
//     that ONLY the recipient sees, and which hands off to CallDialog
//     once the user clicks Accept. Splitting the two keeps CallDialog's
//     props focused on the in-call lifecycle (no "am I ringing or
//     calling?" branching) and lets us lay out the ring prompt with the
//     chat-style header instead of the in-call call-screen styling.

import { useEffect, useMemo, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useT } from "@/lib/blocks/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import {
  useDeclineCall,
  useIncomingCallAutoOpen,
  useIncomingCallSignals,
  useLogCallOutcome,
} from "@/lib/blocks/hooks";
import { useAllJoinedUsers, type JoinedMember } from "@/lib/blocks/users";
import { startRingtone, stopRingtone } from "@/lib/blocks/ringtone";
import { CallDialog, type CallKind } from "./CallDialog";
import { cn } from "@/lib/utils";

export function IncomingCallDialog() {
  const t = useT();
  const { currentUser } = useAuth();
  const me = currentUser?.id ?? "";
  const toast = useToast();
  const [open, setOpen] = useIncomingCallAutoOpen();
  // Once the user accepts, we hand off to CallDialog; this state holds
  // the row id + caller id + SDP offer so the answerer-side CallDialog
  // has everything it needs without having to wait for its own
  // `useActiveCallSignal` query to resolve.
  const [acceptedSignal, setAcceptedSignal] = useState<{
    signalId: string;
    callerId: string;
    kind: CallKind;
    sdpOffer: RTCSessionDescriptionInit | null;
  } | null>(null);
  // Tracks which signal row id this dialog has already auto-opened for,
  // so the polling-driven useEffect doesn't reopen the ring prompt on
  // every fresh ICE update.
  const [openedSignalId, setOpenedSignalId] = useState<string | null>(null);

  // Every row addressed to me as the recipient — the candidate list for
  // the ring prompt. Sorted by updatedAt desc by the hook.
  const incoming = useIncomingCallSignals();
  const declineCall = useDeclineCall();
  // Fire a "Declined voice/video call" system row into the conversation
  // thread when the user dismisses the ring prompt (button click or
  // backdrop/Esc — both paths below route through this mutation). The
  // senderId on the row is me (the recipient); the recipientId is the
  // caller, so the caller's thread surfaces the row on the next poll.
  const logCallOutcome = useLogCallOutcome();
  // Roster lookup for the caller's name + avatar. Indexed by id so the
  // ring prompt can render the caller's full member card without a join.
  const joinedQuery = useAllJoinedUsers();
  const membersById = useMemo(() => {
    const m = new Map<string, JoinedMember>();
    for (const x of joinedQuery.data ?? []) m.set(x.id, x);
    return m;
  }, [joinedQuery.data]);

  // Pick the row to ring on:
  //   - status === 'ringing' (we never auto-pop an accepted/ended row)
  //   - callerId !== me (defensive — guards against a self-call)
  //   - not already opened / answered / declined in this session
  // The first match wins because the hook sorts by updatedAt desc.
  const incomingRow = useMemo(() => {
    if (acceptedSignal) return null;
    const rows = incoming.data ?? [];
    return rows.find(
      (r) =>
        r.status === "ringing" &&
        r.callerId !== me &&
        r.id !== openedSignalId,
    ) ?? null;
  }, [incoming.data, acceptedSignal, openedSignalId, me]);

  // Auto-open on a fresh row. Mirrors the useIncomingCallAutoOpen
  // baseline-capture pattern, but at the row level (we re-open only on
  // a NEW row id, not on every LastUpdatedDate tick of the same row).
  useEffect(() => {
    if (!open) {
      // User closed the ring prompt without accepting → mark this row
      // as handled so subsequent ICE-tick updates don't re-pop.
      if (incomingRow) setOpenedSignalId(incomingRow.id);
      return;
    }
    if (incomingRow) setOpenedSignalId(incomingRow.id);
  }, [open, incomingRow]);

  // Ringtone — plays while the ring prompt is open AND the call is
  // still in `ringing` (stops once the user Accepts — the answerer's
  // CallDialog mounts and silence replaces the ring), and stops on
  // Decline / Esc / backdrop close. Browsers gate AudioContext on a
  // user gesture; the dialog opens from a polling-driven auto-pop,
  // so the first startRingtone() call may fail to resume the
  // context. ringtone.ts handles that internally (catches the
  // resume failure, retries on the next gesture), so we just call
  // it once on every open transition.
  useEffect(() => {
    if (open && !acceptedSignal && incomingRow) {
      void startRingtone();
      return () => {
        stopRingtone();
      };
    }
    // Explicit close (no incomingRow) — also stop.
    if (!open) stopRingtone();
    return undefined;
  }, [open, acceptedSignal, incomingRow]);

  // Once the row flips away from `ringing` while we're still open, the
  // call has been answered elsewhere OR declined by someone else on the
  // same row (impossible today, but defensive) — close the dialog so we
  // don't sit on a stale ring prompt.
  useEffect(() => {
    if (!open || !openedSignalId) return;
    const row = (incoming.data ?? []).find((r) => r.id === openedSignalId);
    if (!row) return;
    if (row.status !== "ringing") {
      setOpen(false);
    }
  }, [incoming.data, open, openedSignalId, setOpen]);

  const caller = incomingRow ? membersById.get(incomingRow.callerId) : undefined;
  const isVideo = incomingRow?.kind === "video";

  const onDecline = () => {
    if (!incomingRow) {
      setOpen(false);
      return;
    }
    declineCall.mutate({
      signalId: incomingRow.id,
      callerId: incomingRow.callerId,
      recipientId: me,
      kind: incomingRow.kind,
    });
    // Persist a "Declined …" pill in the conversation thread. Same
    // senderId/recipientId asymmetry as the hangup/missed/error log
    // rows (see useLogCallOutcome for the why).
    logCallOutcome.mutate({
      recipientId: incomingRow.callerId,
      kind: incomingRow.kind,
      outcome: "declined",
      endedAtIso: new Date().toISOString(),
    });
    setOpen(false);
  };

  const onAccept = () => {
    if (!incomingRow) {
      setOpen(false);
      return;
    }
    setAcceptedSignal({
      signalId: incomingRow.id,
      callerId: incomingRow.callerId,
      kind: incomingRow.kind,
      // Forward the caller's SDP offer straight through so the
      // answerer-side CallDialog can call setRemoteDescription
      // without waiting for its own `useActiveCallSignal` query to
      // resolve. Closing that race used to cause the dialog to
      // toast "offer missing" and close on Accept.
      sdpOffer: incomingRow.sdpOffer,
    });
    setOpen(false);
  };

  return (
    <>
      <Dialog
        open={open && !acceptedSignal}
        onOpenChange={(o) => {
          // Closing without answering → decline so the caller doesn't
          // ring until their missed-call timer fires 30s later.
          if (!o) {
            if (incomingRow) {
              declineCall.mutate({
                signalId: incomingRow.id,
                callerId: incomingRow.callerId,
                recipientId: me,
                kind: incomingRow.kind,
              });
              // Persist the "Declined …" pill in the conversation
              // thread (same write as the explicit Decline button).
              logCallOutcome.mutate({
                recipientId: incomingRow.callerId,
                kind: incomingRow.kind,
                outcome: "declined",
                endedAtIso: new Date().toISOString(),
              });
              // If another live call is in flight, the toast above
              // makes that explicit; otherwise this is a regular
              // decline and the dialog closes silently.
              toast.info(
                t("chat.callDeclined", "Call declined."),
              );
            }
            setOpen(false);
          }
        }}
      >
        <DialogContent
          className="max-w-sm overflow-hidden border-none bg-slate-950 p-0 text-slate-100 shadow-2xl"
          // Match the in-call dialog's no-backdrop-dismiss behavior so
          // a stray click on the overlay doesn't silently decline.
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">
            {t("chat.callIncoming", "Incoming call")}
          </DialogTitle>

          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            {/* Ringing pulse — same visual language as CallDialog so the
                user sees this as part of the same call experience. */}
            <div className="relative">
              <div className="absolute inset-0 -m-6 animate-ping rounded-full bg-emerald-500/20" />
              <div className="absolute inset-0 -m-3 animate-pulse rounded-full bg-emerald-500/30" />
              <UserAvatar
                userId={incomingRow?.callerId ?? ""}
                name={caller?.name ?? t("chat.someone", "Someone")}
                className="relative h-20 w-20 text-2xl ring-2 ring-white/20"
              />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-50">
                {caller?.name ?? t("chat.someone", "Someone")}
              </p>
              <p className="mt-1 flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-slate-400">
                {isVideo ? (
                  <Video className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Phone className="h-3 w-3" aria-hidden="true" />
                )}
                {isVideo
                  ? t("chat.callIncomingVideo", "Incoming video call…")
                  : t("chat.callIncomingVoice", "Incoming voice call…")}
              </p>
            </div>

            <div className="mt-2 flex w-full items-center justify-center gap-3">
              <Button
                type="button"
                onClick={onDecline}
                aria-label={t("chat.callDecline", "Decline")}
                className="h-10 gap-2 rounded-full bg-red-600 px-5 text-white hover:bg-red-500"
              >
                <PhoneOff className="h-4 w-4" aria-hidden="true" />
                {t("chat.callDecline", "Decline")}
              </Button>
              <Button
                type="button"
                onClick={onAccept}
                aria-label={t("chat.callAccept", "Accept")}
                className="h-10 gap-2 rounded-full bg-emerald-600 px-5 text-white hover:bg-emerald-500"
              >
                {isVideo ? (
                  <Video className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Phone className="h-4 w-4" aria-hidden="true" />
                )}
                {t("chat.callAccept", "Accept")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* After Accept — drop into the full CallDialog in answerer mode.
          Closes back to nothing when the call ends; the closing toast
          is fired by CallDialog's own onEnded. The SDP offer rides
          straight through from the row data so the answerer's
          handshake doesn't have to wait for its own
          `useActiveCallSignal` query — closing the "offer missing"
          race that previously dismissed the dialog immediately on
          Accept. */}
      {acceptedSignal && caller && (
        <CallDialog
          member={caller}
          kind={acceptedSignal.kind}
          role="answerer"
          signalId={acceptedSignal.signalId}
          callerId={acceptedSignal.callerId}
          sdpOffer={acceptedSignal.sdpOffer}
          open={true}
          onClose={() => setAcceptedSignal(null)}
          onPermissionDenied={() => setAcceptedSignal(null)}
        />
      )}

      {/* cn is intentionally imported even though the file doesn't
          reference it directly — keeps the cn barrel alive for the
          footer variant toggles that may land in future iterations. */}
      <span className={cn("hidden")} aria-hidden="true" />
    </>
  );
}
