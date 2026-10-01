// Real WebRTC voice / video call dialog.
//
// Renders the full in-call UI for either direction of a call: `role="caller"`
// is invoked when the local user clicks the Phone/Video icon; `role="answerer"`
// is invoked by IncomingCallDialog after the user clicks Accept.
//
// Under the hood: getUserMedia → RTCPeerConnection with public STUN → SDP
// offer/answer handshake → ICE candidates trickled via a 2s polling loop
// over a Blocks Data row. The polling loop is the only mechanism for
// cross-tab signaling — there's no WebSocket / push channel.
//
// Limitation (documented here, in the Phone/Video tooltip in ChatThread,
// and in the ICE-failure toast below): STUN-only means calls may fail to
// establish on networks behind strict / symmetric NAT or corporate
// firewalls. A TURN server is out of scope for v1.

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
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
  useAcceptCall,
  useActiveCallSignal,
  useAppendIceCandidates,
  useEndCall,
  useStartCall,
} from "@/lib/blocks/hooks";
import { createIceExchange, type IceExchangeController } from "@/lib/blocks/callSignals";
import { startRingtone, stopRingtone } from "@/lib/blocks/ringtone";
import type { CallSignal } from "@/lib/blocks/data";
import type { ChatMember } from "@/pages/ChatPage";
import { cn } from "@/lib/utils";

export type CallKind = "voice" | "video";

// How long a caller waits with no answer before flipping the row to
// `missed`. The 2s polling loop reads this off the row, so a longer
// timeout is a trade-off between false positives on slow networks and
// leaving the user staring at a ringing dialog.
const MISSED_TIMEOUT_MS = 30_000;

export interface CallDialogProps {
  member: ChatMember;
  kind: CallKind;
  role: "caller" | "answerer";
  /** Existing CallSignal id (answerer-side must provide; caller-side can
   *  omit and the start-call mutation returns one synchronously). */
  signalId?: string;
  callerId?: string;
  /** Caller's SDP offer (answerer-side only). Forwarded straight from
   *  the parent so the answerer's setup effect doesn't have to wait
   *  for `useActiveCallSignal` to resolve — IncomingCallDialog
   *  already has the row data when it renders <CallDialog />, so
   *  handing the offer through a prop sidesteps a race that would
   *  otherwise toast "offer missing" and close the dialog on Accept.
   *  Unused on the caller side. */
  sdpOffer?: RTCSessionDescriptionInit | null;
  open: boolean;
  onClose: () => void;
  /** Fires once when the dialog transitions into the `ended` phase so the
   *  parent can toast the result + clear its own activeCall state. The
   *  extra fields (`peerId`, `signalId`) give the parent everything it
   *  needs to also fire a system-message log row (useLogCallOutcome)
   *  so the conversation thread carries a permanent record of the call
   *  outcome. */
  onEnded?: (
    kind: CallKind,
    durationSec: number,
    reason: "hangup" | "declined" | "missed" | "error",
    peerId: string,
    signalId: string,
  ) => void;
  /** Fired when the OS denies microphone / camera permission so the
   *  parent can disable the Phone/Video header buttons until the user
   *  re-grants via site settings. */
  onPermissionDenied?: () => void;
}

export function CallDialog({
  member,
  kind,
  role,
  signalId: initialSignalId,
  callerId: initialCallerId,
  sdpOffer: initialSdpOffer,
  open,
  onClose,
  onEnded,
  onPermissionDenied,
}: CallDialogProps) {
  const t = useT();
  const { currentUser } = useAuth();
  const me = currentUser?.id ?? "";
  const toast = useToast();
  const meName = t("chat.you", "You");
  // Phase: ringing → connecting → connected → ended. `connecting` covers
  // the window between accept and the first `ontrack` event — the UI
  // mirrors what the user sees (status text + spinner affordance) instead
  // of claiming "Connected" while the media is still settling.
  const [phase, setPhase] = useState<"ringing" | "connecting" | "connected" | "ended">(
    role === "answerer" ? "connecting" : "ringing",
  );
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(kind === "voice");
  // Media streams — kept in refs because they're bound to <video>.srcObject
  // and never need to trigger a re-render themselves.
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  // ICE controller (RPC + candidate dedup). Created after getUserMedia,
  // torn down on end-of-call.
  const iceRef = useRef<IceExchangeController | null>(null);
  // Signal row id — the caller reads the freshly-created id out of the
  // useStartCall mutation; the answerer starts with `initialSignalId`.
  const signalIdRef = useRef<string | undefined>(initialSignalId);
  // Caller id — needed by useAcceptCall, which has to echo it back as a
  // requiredOn:3 field. Saved as soon as the offer-handling code knows it.
  const callerIdRef = useRef<string | undefined>(initialCallerId);
  // When the dialog entered the live (non-ended) phase — used for the
  // duration counter in onEnded. `null` until we transition.
  const connectedAtRef = useRef<number | null>(null);
  // Final end reason captured before teardown — passed to onEnded so the
  // parent can toast "Call declined" / "No answer" / "Call failed to
  // connect" appropriately.
  const finalReasonRef = useRef<"hangup" | "declined" | "missed" | "error">("hangup");
  // True once onEnded has fired for the current open — prevents double
  // toasts if two state paths trigger close simultaneously (e.g. user
  // clicks End while the row flips to `ended` from the other side).
  const firedEndedRef = useRef(false);
  // Candidates this side has drained+POSTed to the shared JSON blob.
  // The read loop walks `active.iceCandidates` and tries to apply every
  // entry, but the blob is the union of both sides — so a candidate
  // this side already produced is also in the array, and trying to
  // `addIceCandidate` on it throws `InvalidStateError: The remote
  // description was null`. Track our own and skip them on the read
  // side. The appliedRemoteCandidates Set in the controller still
  // dedupes by candidate string, but that runs AFTER we already threw
  // — the catch block in applyRemoteCandidate swallows the throw, but
  // logs a warning on every poll, which the user sees as a flood of
  // console errors during the ring window.
  const localCandidatesSentRef = useRef<Set<string>>(new Set());

  // Mutation hooks
  const startCall = useStartCall();
  const acceptCall = useAcceptCall();
  const endCall = useEndCall();
  const appendIce = useAppendIceCandidates();

  // Live row read (2s while ringing/accepted, 5s otherwise). Re-fires
  // the in-call effect when status flips or new ICE candidates arrive.
  const counterpartId = role === "caller" ? member.id : (initialCallerId ?? "");
  const activeQuery = useActiveCallSignal(open ? counterpartId || undefined : undefined);
  const active = activeQuery.data;

  // ---- Permission + media setup ----
  //
  // Runs once per open. Captures mic+camera (camera only for video calls),
  // builds the IceExchange, and starts the offer/answer handshake on the
  // appropriate side.
  useEffect(() => {
    if (!open) return;
    firedEndedRef.current = false;
    connectedAtRef.current = null;
    finalReasonRef.current = "hangup";
    signalIdRef.current = initialSignalId;
    callerIdRef.current = initialCallerId;
    // Reset the local-sent set on every open so a fresh call doesn't
    // carry candidates from the previous one. Mirrors the firedEndedRef
    // reset on the line above.
    localCandidatesSentRef.current = new Set();
    let cancelled = false;

    const setup = async () => {
      // getUserMedia — voice calls don't request camera, video calls do.
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: kind === "video",
        });
      } catch (err) {
        const name = (err as DOMException | undefined)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          toast.error(
            kind === "video"
              ? t(
                  "chat.callPermissionDeniedVideo",
                  "Allow microphone and camera access to start a video call.",
                )
              : t(
                  "chat.callPermissionDeniedVoice",
                  "Allow microphone access to start a voice call.",
                ),
          );
          onPermissionDenied?.();
        } else {
          toast.error(
            t(
              "chat.callMediaFailed",
              "Couldn't access your microphone or camera.",
            ),
          );
        }
        onClose();
        return;
      }
      if (cancelled) {
        // Race: dialog closed while getUserMedia was awaiting permission.
        localStream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      localStreamRef.current = localStream;

      // Build the ICE controller. Wire onTrack → bind remote stream,
      // onConnectionStateChange → bail on `failed` with a STUN toast.
      const ice = createIceExchange(localStream, {
        onIceCandidate: () => {
          // Hint only — the polling loop also drains the queue, so a
          // UI chip showing "Gathering ICE…" can listen here but the
          // source of truth for what gets POSTed is the drain call.
        },
        onTrack: (stream) => {
          remoteStreamRef.current = stream;
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
          }
        },
        onConnectionStateChange: (state) => {
          if (state === "failed") {
            // Symmetric NAT or no route — surface the v1 limitation.
            finalReasonRef.current = "error";
            toast.info(
              t(
                "chat.callStunFailed",
                "The call failed to connect — calls may fail on networks behind strict NAT.",
              ),
            );
            const sid = signalIdRef.current;
            if (sid) {
              endCall.mutate({
                signalId: sid,
                callerId: callerIdRef.current ?? "",
                recipientId: role === "caller" ? member.id : (initialCallerId ?? ""),
                kind,
                reason: "error",
              });
            }
          }
        },
      });
      iceRef.current = ice;

      // Bind the local stream to the <video> tile now (the remote one
      // gets bound via onTrack when the first RTP packet lands).
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      // Start the right handshake for the role.
      try {
        if (role === "caller") {
          const offer = await ice.pc.createOffer();
          await ice.pc.setLocalDescription(offer);
          // setLocalDescription triggers ICE gathering — drain what we
          // have so far (likely empty) and POST the offer.
          const initialCandidates = ice.drainPendingLocalCandidates();
          for (const c of initialCandidates) localCandidatesSentRef.current.add(c.candidate);
          const created = await startCall.mutateAsync({
            recipientId: member.id,
            kind,
            sdpOffer: offer,
          });
          signalIdRef.current = created.id;
          callerIdRef.current = me;
          // Trickle whatever local candidates have already been gathered.
          if (initialCandidates.length > 0) {
            appendIce.mutate({
              signalId: created.id,
              callerId: me,
              recipientId: member.id,
              kind,
              newCandidates: initialCandidates,
            });
          }
        } else {
          // answerer — we already have the offer via props or the
          // active row. Prefer the prop (handed straight through
          // from IncomingCallDialog) so the handshake doesn't have
          // to wait for the answerer's own `useActiveCallSignal`
          // query to resolve — closing that race used to cause the
          // dialog to toast "offer missing" and close on Accept.
          const offer = initialSdpOffer ?? active?.sdpOffer ?? null;
          if (!offer || !initialSignalId || !initialCallerId) {
            toast.error(
              t("chat.callMissingOffer", "Couldn't join the call — the offer is missing."),
            );
            onClose();
            return;
          }
          await ice.pc.setRemoteDescription(offer);
          const answer = await ice.pc.createAnswer();
          await ice.pc.setLocalDescription(answer);
          const initialCandidates = ice.drainPendingLocalCandidates();
          for (const c of initialCandidates) localCandidatesSentRef.current.add(c.candidate);
          await acceptCall.mutateAsync({
            signalId: initialSignalId,
            callerId: initialCallerId,
            recipientId: me,
            kind,
            sdpAnswer: answer,
          });
          signalIdRef.current = initialSignalId;
          callerIdRef.current = initialCallerId;
          if (initialCandidates.length > 0) {
            appendIce.mutate({
              signalId: initialSignalId,
              callerId: initialCallerId,
              recipientId: me,
              kind,
              newCandidates: initialCandidates,
            });
          }
        }
      } catch (err) {
        console.error("[call] handshake failed", err);
        toast.error(
          t("chat.callHandshakeFailed", "The call failed to start. Try again."),
        );
        finalReasonRef.current = "error";
        onClose();
      }
    };

    setup();

    return () => {
      cancelled = true;
      // Tear down local stream + PC when the dialog closes (open flips
      // false, OR a re-open cycle resets the effect).
      const ls = localStreamRef.current;
      const ic = iceRef.current;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      iceRef.current = null;
      if (ic) ic.teardown(ls);
      else if (ls) ls.getTracks().forEach((tr) => tr.stop());
      // Unbind video tiles so a stale stream doesn't render after close.
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    // Re-running the effect for every activeQuery tick would thrash
    // getUserMedia; the polling-driven updates below handle that case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role, member.id, kind]);

  // ---- In-call poll handler ----
  //
  // Re-runs whenever the active row changes (every 2s while ringing /
  // accepted). Handles:
  //   - Caller side: detecting `accepted` + setting the remote SDP answer.
  //   - Caller side: missed-call timer (30s of ringing without an answer).
  //   - Recipient side: dropping into `connecting` after accept.
  //   - Either side: applying new remote ICE candidates + draining
  //     locally-gathered ones.
  //   - Either side: terminal status transitions (declined / ended /
  //     missed) → teardown + onEnded.
  useEffect(() => {
    if (!open) return;
    if (!active) return;
    const ice = iceRef.current;
    if (!ice) return;

    const isCaller = role === "caller";
    const sid = signalIdRef.current;
    if (!sid) return;

    // 1) Caller: flip to `connecting` once the recipient accepts + an
    //    SDP answer shows up on the row.
    if (
      isCaller &&
      active.status === "accepted" &&
      active.sdpAnswer &&
      phase === "ringing"
    ) {
      ice.pc
        .setRemoteDescription(active.sdpAnswer)
        .then(() => {
          if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
          setPhase("connecting");
        })
        .catch((err) => console.warn("[call] setRemoteDescription failed", err));
    }

    // 2) Caller: missed-call timer — fire useEndCall with reason='missed'
    //    after 30s of ringing with no answer.
    if (isCaller && active.status === "ringing") {
      const ringingMs = Date.now() - new Date(active.createdAt).getTime();
      if (ringingMs > MISSED_TIMEOUT_MS && !firedEndedRef.current) {
        finalReasonRef.current = "missed";
        firedEndedRef.current = true;
        endCall.mutate({
          signalId: sid,
          callerId: callerIdRef.current ?? me,
          recipientId: member.id,
          kind,
          reason: "missed",
        });
        setPhase("ended");
      }
    }

    // 3) Phase advance: connecting → connected when we actually have
    //    a remote track bound.
    if (phase === "connecting" && remoteStreamRef.current) {
      if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
      setPhase("connected");
    }

    // 4) Apply any new remote ICE candidates. Skip candidates this
    //    side already drained+sent — they're in the same blob (the
    //    read returns the union) but `addIceCandidate` on our own
    //    candidate throws InvalidStateError because no remote
    //    description is set yet on the caller side. Track them
    //    here so the next drain also adds them to the local-sent set.
    for (const c of active.iceCandidates) {
      if (localCandidatesSentRef.current.has(c.candidate)) continue;
      void ice.applyRemoteCandidate(c);
    }

    // 5) Drain our own pending local candidates.
    const drained = ice.drainPendingLocalCandidates();
    if (drained.length > 0) {
      for (const c of drained) localCandidatesSentRef.current.add(c.candidate);
      appendIce.mutate({
        signalId: sid,
        callerId: callerIdRef.current ?? me,
        recipientId: role === "caller" ? member.id : me,
        kind,
        newCandidates: drained,
      });
    }

    // 6) Terminal status transitions — fire onEnded once and teardown.
    const terminal =
      active.status === "ended" ||
      active.status === "declined" ||
      active.status === "missed";
    if (terminal && !firedEndedRef.current) {
      firedEndedRef.current = true;
      finalReasonRef.current =
        active.status === "ended"
          ? (active.endReason ?? "hangup")
          : active.status === "declined"
            ? "declined"
            : "missed";
      // Closed → 'hangup' is the only legitimate local reason here.
      if (active.status === "ended" && active.endReason == null) {
        finalReasonRef.current = "hangup";
      }
      setPhase("ended");
    }
  }, [active, open, phase, role, member.id, kind, me, appendIce, endCall]);

  // ---- Mute / camera toggles (local-only — recipient never reflects) ----
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((tr) => {
      tr.enabled = !muted;
    });
  }, [muted]);
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((tr) => {
      tr.enabled = !videoOff;
    });
  }, [videoOff]);

  // ---- Ringback tone for the caller ----
  //
  // While the caller is in `ringing` (waiting for the recipient to
  // accept), play a ringback tone so they have audio confirmation the
  // call is going out — the visual "ringing pulse" alone can be missed
  // if the user is on a different tab. Stops the moment phase leaves
  // `ringing` (accept → connecting/connected, decline/miss → ended)
  // so the tone doesn't bleed into the connected call.
  //
  // Autoplay caveat: the AudioContext is gated on the user gesture
  // that opened the dialog (the Phone/Video button click). If the
  // context can't resume, ringtone.ts catches silently — the rest of
  // the call still works, the caller just doesn't hear ringback.
  useEffect(() => {
    if (!open) return;
    if (role !== "caller") return;
    if (phase !== "ringing") return;
    void startRingtone();
    return () => {
      stopRingtone();
    };
  }, [open, role, phase]);

  // ---- Fire onEnded exactly once on close ----
  useEffect(() => {
    if (open) return;
    if (firedEndedRef.current) return;
    const durationSec =
      connectedAtRef.current != null
        ? Math.max(1, Math.round((Date.now() - connectedAtRef.current) / 1000))
        : 0;
    firedEndedRef.current = true;
    // Resolve the peer id for the log mutation: caller side → the
    // member we're calling; answerer side → the caller we accepted.
    const peerId =
      role === "caller"
        ? member.id
        : (callerIdRef.current ?? initialCallerId ?? "");
    const sid = signalIdRef.current ?? "";
    onEnded?.(kind, durationSec, finalReasonRef.current, peerId, sid);
  }, [open, kind, onEnded, role, member.id, initialCallerId]);

  // End button — caller hangs up, recipient drops out. Either way, mark
  // the row `ended` so the other side's polling loop tears down.
  const endCallNow = (reason: "hangup" | "missed" = "hangup") => {
    if (phase === "ended") {
      onClose();
      return;
    }
    const sid = signalIdRef.current;
    if (sid) {
      finalReasonRef.current = reason;
      endCall.mutate({
        signalId: sid,
        callerId: callerIdRef.current ?? me,
        recipientId: role === "caller" ? member.id : callerIdRef.current ?? me,
        kind,
        reason,
      });
    }
    setPhase("ended");
  };

  // Phase-specific status label. Mirrors the pre-WebRTC mock's UX but
  // adds `connecting` to bridge the accept → first media packet window.
  const statusLabel =
    phase === "ringing"
      ? t("chat.callRinging", "Calling…")
      : phase === "connecting"
        ? t("chat.callConnecting", "Connecting…")
        : phase === "connected"
          ? t("chat.callConnected", "Connected")
          : t("chat.callEnded", "Call ended");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          if (phase !== "ended") endCallNow();
          else onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-md overflow-hidden border-none bg-slate-950 p-0 text-slate-100 shadow-2xl"
        // No close-on-outside-click while the call is live — prevents
        // the user from accidentally dismissing the call by clicking
        // the backdrop. The End Call button is the only escape.
        onInteractOutside={(e) => {
          if (phase !== "ended") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (phase !== "ended") e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">
          {kind === "voice"
            ? t("chat.voiceCall", "Voice call")
            : t("chat.videoCall", "Video call")}{" "}
          {t("chat.callWith", "with")} {member.name}
        </DialogTitle>

        {/* Top half — video tiles (video mode) OR centered avatar
            with a ringing pulse (voice mode OR pre-connected video). */}
        <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
          {kind === "video" && (phase === "connecting" || phase === "connected") ? (
            <div className="grid h-full w-full grid-cols-1 grid-rows-2 gap-1 p-2">
              {/* Remote tile — top, full width. The remote <video> is
                  bound via onTrack to the actual MediaStream; the avatar
                  shows only when no track has arrived yet (covers the
                  connecting window before the first RTP packet). */}
              <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-800 to-slate-900">
                {videoOff ? (
                  <div className="flex flex-col items-center gap-2">
                    <UserAvatar
                      userId={member.id}
                      name={member.name}
                      className="h-16 w-16 text-base"
                    />
                    <p className="text-xs text-slate-300">{member.name}</p>
                  </div>
                ) : (
                  <>
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    {/* Avatar overlay sits on top of the <video> until
                        the first frame paints, then the video takes over
                        (it covers the avatar naturally). */}
                    <div className="pointer-events-none relative flex flex-col items-center gap-2">
                      <UserAvatar
                        userId={member.id}
                        name={member.name}
                        className="h-16 w-16 text-base ring-2 ring-white/20"
                      />
                      <p className="text-xs text-slate-100">{member.name}</p>
                    </div>
                  </>
                )}
              </div>
              {/* Local tile — bottom-right PiP. */}
              <div className="relative ml-auto mr-2 mb-2 aspect-video w-32 overflow-hidden rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 ring-1 ring-white/10">
                {videoOff ? (
                  <div className="flex h-full items-center justify-center">
                    <VideoOff
                      className="h-4 w-4 text-slate-400"
                      aria-hidden="true"
                    />
                  </div>
                ) : (
                  <>
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded bg-technical/70 px-1.5 py-0.5 text-[10px] font-medium text-technical-foreground">
                        {meName}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                {/* Ringing pulse — only while the caller is waiting for
                    the recipient to accept. Stops pulsing once `phase`
                    leaves `ringing`. */}
                {phase === "ringing" && role === "caller" && (
                  <>
                    <div className="absolute inset-0 -m-6 animate-ping rounded-full bg-emerald-500/20" />
                    <div className="absolute inset-0 -m-3 animate-pulse rounded-full bg-emerald-500/30" />
                  </>
                )}
                <UserAvatar
                  userId={member.id}
                  name={member.name}
                  className="relative h-24 w-24 text-2xl ring-2 ring-white/20"
                />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-slate-50">
                  {member.name}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wider text-slate-400">
                  {statusLabel}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer — control bar. Mute / Camera toggles + End Call.
            End Call turns red and reads "Close" once the call has
            already ended, so the user has a single clear exit. */}
        <div className="flex items-center justify-center gap-3 bg-technical px-6 py-5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setMuted((m) => !m)}
            disabled={phase === "ended"}
            aria-pressed={muted}
            aria-label={
              muted
                ? t("chat.callUnmute", "Unmute")
                : t("chat.callMute", "Mute")
            }
            className="h-10 w-10 rounded-full border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
          >
            {muted ? (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          {kind === "video" && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setVideoOff((v) => !v)}
              disabled={phase === "ended"}
              aria-pressed={videoOff}
              aria-label={
                videoOff
                  ? t("chat.callCameraOn", "Turn camera on")
                  : t("chat.callCameraOff", "Turn camera off")
              }
              className="h-10 w-10 rounded-full border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              {videoOff ? (
                <VideoOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Video className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => endCallNow()}
            aria-label={
              phase === "ended"
                ? t("chat.callClose", "Close")
                : t("chat.callEnd", "End call")
            }
            className={cn(
              "h-10 gap-2 rounded-full px-5",
              phase === "ended"
                ? "bg-slate-700 text-slate-100 hover:bg-slate-600"
                : "bg-red-600 text-white hover:bg-red-500",
            )}
          >
            {phase === "ended" ? (
              t("chat.callClose", "Close")
            ) : (
              <>
                <PhoneOff className="h-4 w-4" aria-hidden="true" />
                {t("chat.callEnd", "End call")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-exported so ChatThread can read the CallSignal type when typing
// its caller-state shape.
export type { CallSignal };
