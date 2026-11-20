// Interactive shell panel — xterm.js front-end for the
// WorkspacePage terminal.
//
// Lifecycle
// ──────────
//   • On mount, opens a WebSocket to
//     `/api/dev-terminal/shell?workspaceId=…&cwd=…&terminalId=…[&shellId=…]`
//     (vite proxies to mcp-server, which spawns (or reattaches to)
//     a node-pty PTY at `cwd` keyed by
//     `${workspaceId}:${cwd}:${terminalId}`).
//   • xterm `onData` → base64 → WS `input` frame → PTY stdin.
//   • PTY stdout → WS `output` frame → base64-decode → xterm.write.
//   • ResizeObserver on the panel div → FitAddon.proposeDimension
//     → WS `resize` frame → PTY.resize.
//   • Shell switch via the header dropdown: tear down the WS (SIGTERM
//     the running PTY) and reopen with the new `shellId`. The
//     xterm instance is preserved so the user keeps their scrollback
//     — clearer than a full remount.
//   • xterm scrollback persistence: on every output frame we schedule
//     a debounced `SerializeAddon.serialize()` → localStorage. On
//     mount we deserialize from localStorage before the user sees
//     the xterm, so refresh / Vite HMR / folder close+reopen keeps
//     the buffer.
//   • On unmount: ws.close() — the PTY itself is NOT killed. mcp-server
//     keeps it alive keyed by `${workspaceId}:${cwd}:${terminalId}`
//     so a refresh or navigation away reattaches to the same running
//     shell. The PTY only dies on natural shell exit (Ctrl+C, `exit`,
//     crash) or mcp-server shutdown. See `mcp-server/src/terminal.ts`
//     for the persistent registry.
//
// The WS handle itself is owned by `devServerApi.connectTerminal`
// (see `src/services/devServerApi.ts`); this component only owns
// xterm + the DOM container.
//
// We deliberately import `@xterm/xterm/css/xterm.css` here (not
// from `globals.css`) so removing the panel also removes the
// styles — keeps the global CSS file lean.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  Terminal as TerminalIcon,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast as toastFn } from "sonner";
import "@xterm/xterm/css/xterm.css";

import { devServerApi } from "@/services/devServerApi";
import type { ShellDescriptor, TerminalPhase } from "@/types/dev-server";
import {
  loadWorkspaceTerminalCollapsed,
  saveWorkspaceTerminalCollapsed,
} from "@/lib/blocks/devServerStorage";
import { useDevServer } from "@/contexts/DevServerContext";

interface TerminalPanelProps {
  /** Workspace id (passed to the backend for routing/audit). */
  workspaceId: string;
  /** Absolute path the shell should start in. Must exist. */
  cwd: string;
  /** Per-tab stable id (matches TerminalInstance.id). Required. */
  terminalId: string;
  /** Optional shell id from the parent's persisted `TerminalInstance`.
   *  When set, takes priority over the global shell pref so the
   *  picker shows the correct shell on first paint. */
  shellIdOverride?: string | null;
  /** Default height in pixels when expanded. */
  height?: number;
  /** When true the panel fills its flex slot (the dock wrapper is
   *  `flex-1`) instead of using the fixed `height` — VS Code's
   *  maximized panel. The parent hides the editor rows to make the
   *  slot actually available. */
  maximized?: boolean;
  /** Flips the parent's maximize flag. Only the active tab gets a
   *  handler — inactive panels render the button inert. */
  onToggleMaximize?: () => void;
  /** True while the user is dragging the dock's resize sash. Kills
   *  the 200 ms height transition so the panel tracks the cursor
   *  1:1 instead of rubber-banding behind it. */
  resizing?: boolean;
  /** Mirrors `collapsed` up to the parent (which hides the resize
   *  sash and drops maximize when the panel folds). Fired on user
   *  toggle AND on the hydration read below. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Bump to expand the panel from outside (command palette "Show
   *  terminal"). The value itself is meaningless — each increment
   *  fires the expand effect below. */
  expandSignal?: number;
  /** One-shot "run this command in the PTY" request (npm Scripts
   *  panel → WorkspacePage). Each new `seq` expands the panel (if
   *  folded) and writes `command + \r` into the shell — the PTY
   *  echoes it like typed input. Only the active tab receives the
   *  signal (same rule as `expandSignal`). */
  runCommandSignal?: { seq: number; command: string } | null;
}

const DEFAULT_FG = "#e4e4e7";
const DEFAULT_BG = "#18181b";
// Height of the header bar alone — used when the panel is
// collapsed to a single row so the chevron + status remain
// clickable without taking the whole 240px row.
const COLLAPSED_HEADER_PX = 32;

// localStorage key for the user's last-picked shell. Survives
// reloads so the dropdown remembers "Git Bash" between sessions.
// Versioned so a future catalog rename can migrate cleanly.
const SHELL_PREF_KEY = "lattice.terminal.shellId.v1";

// localStorage key for xterm scrollback. Value is a map of
// `${workspaceId}:${cwd}:${terminalId}` → serialized buffer.
// Per-file pattern (mirrors `notepad/storage.ts`); we deliberately
// don't dedupe across panels — each terminal instance is a separate
// PTY and a separate buffer.
const SCROLLBACK_KEY = "lattice.terminal.scrollback.v1";
// Debounce window for persisting the scrollback. Small enough that
// a refresh immediately after a long output burst still captures
// most of the buffer; large enough that we don't write on every
// keystroke.
const SCROLLBACK_SAVE_DEBOUNCE_MS = 250;

function readShellPref(): string | null {
  try {
    return window.localStorage.getItem(SHELL_PREF_KEY);
  } catch {
    /* privacy / quota — fall through to null */
    return null;
  }
}
function writeShellPref(id: string): void {
  try {
    window.localStorage.setItem(SHELL_PREF_KEY, id);
  } catch {
    /* ignore — next mount will default again */
  }
}

function scrollbackRecordKey(
  workspaceId: string,
  cwd: string,
  terminalId: string,
): string {
  return `${workspaceId}:${cwd}:${terminalId}`;
}

function readScrollback(recordKey: string): string | null {
  try {
    const raw = window.localStorage.getItem(SCROLLBACK_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[recordKey] ?? null;
  } catch {
    /* malformed JSON / quota — fall through */
    return null;
  }
}

function writeScrollback(recordKey: string, data: string): void {
  try {
    const raw = window.localStorage.getItem(SCROLLBACK_KEY);
    const map: Record<string, string> = raw
      ? (JSON.parse(raw) as Record<string, string>)
      : {};
    map[recordKey] = data;
    window.localStorage.setItem(SCROLLBACK_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — best effort */
  }
}

function deleteScrollback(recordKey: string): void {
  try {
    const raw = window.localStorage.getItem(SCROLLBACK_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, string>;
    if (!(recordKey in map)) return;
    delete map[recordKey];
    window.localStorage.setItem(SCROLLBACK_KEY, JSON.stringify(map));
  } catch {
    /* */
  }
}

export function TerminalPanel({
  workspaceId,
  cwd,
  terminalId,
  shellIdOverride = null,
  height = 240,
  maximized = false,
  onToggleMaximize,
  resizing = false,
  onCollapsedChange,
  expandSignal,
  runCommandSignal,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  // The current WS handle — `null` between mounts / during a
  // shell-switch reconnect. The shell-switch effect owns it.
  const handleRef = useRef<ReturnType<typeof devServerApi.connectTerminal> | null>(
    null,
  );
  // Debounce timer for scrollback saves — see
  // `scheduleScrollbackSave` for the trigger.
  const saveScrollbackTimerRef = useRef<number | null>(null);
  // Tracks the previous `selectedShellId` so the WS effect can
  // tell "first open" from "shell switch". The latter drops the
  // persisted scrollback (the new PTY starts empty).
  const prevShellIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<TerminalPhase>("connecting");
  const [shellLabel, setShellLabel] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Local collapse state — owned here (not by the parent) so the
  // terminal survives a parent re-render unchanged. Default
  // collapsed: the workspace editor takes the full viewport on
  // first paint and the user clicks the chevron to reveal the
  // shell. Avoids burning the panel on existing editors and the
  // `npm install`-on-day-one flow is now opt-in via the chevron
  // rather than a permanent fixture.
  //
  // Persisted per (user, project, env) via the mirror in
  // devServerStorage.ts. We can't lazy-init from localStorage the
  // way the shell prefs do — the workspace identity isn't known
  // until `useDevServer()` resolves, and a lazy `useState` init
  // would race against that hydration (read undefined → store
  // collapsed=true → mirror row gets clobbered to default on the
  // first persist). So we hydrate via effect with an identity-key
  // guard, mirroring `editorFullscreen` in WorkspacePage.
  const { workspace } = useDevServer();
  const collapsedLoadKeyRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(true);
  // The (user, project, env) key whose persisted collapse state has
  // actually landed in `collapsed` — set by the hydration effect,
  // but observed by the persist effect only AFTER React has applied
  // the batched update. Refs can't express this gate: both effects
  // run in the same commit, so a ref would already be set when the
  // persist effect fired and the stale value would still win. The
  // state flag closes the one-frame window where the persist effect
  // wrote the pre-hydration default (`true`) over a stored `false`
  // — exactly what a Vite HMR remount does (mount → persist(true) →
  // unmount before the hydration commit lands), which collapsed
  // everyone's terminal on every hot reload. As a bonus the same
  // gate covers workspace switches (the old triple's `collapsed`
  // could otherwise be written to the NEW triple before its
  // hydration read).
  const [collapsedHydratedKey, setCollapsedHydratedKey] = useState<
    string | null
  >(null);

  // Hydrate `collapsed` from the mirror once the workspace identity
  // is known. The ref guard means we only ever read once per
  // (user, project, env) triple — subsequent renders keep the
  // in-memory value so a transient workspace re-resolve (auth
  // bouncing, the context re-running its load effect) can't reset
  // the panel to the stale persisted value mid-session.
  useEffect(() => {
    if (!workspace) return;
    const key = `${workspace.userId}|${workspace.projectId}|${workspace.envSlug}`;
    if (key === collapsedLoadKeyRef.current) return;
    collapsedLoadKeyRef.current = key;
    const persisted = loadWorkspaceTerminalCollapsed(
      workspace.userId,
      workspace.projectId,
      workspace.envSlug,
    );
    setCollapsed(persisted);
    // Arm persistence for THIS identity — but only in the commit
    // where `collapsed` above has also landed (batched), so the
    // persist effect's first eligible run already carries the
    // hydrated value.
    setCollapsedHydratedKey(key);
    // Sync the parent's mirror (it starts `true` to match this
    // component's initial state) so the dock's sash hides/shows
    // correctly before the user's first chevron click.
    onCollapsedChange?.(persisted);
  }, [
    workspace?.userId,
    workspace?.projectId,
    workspace?.envSlug,
    onCollapsedChange,
  ]);

  // Persist on every change — but never before this identity's
  // hydration read has landed (see `collapsedHydratedKey`). Writing
  // earlier would echo the pre-hydration default over the stored
  // value.
  useEffect(() => {
    if (!workspace) return;
    const key = `${workspace.userId}|${workspace.projectId}|${workspace.envSlug}`;
    if (collapsedHydratedKey !== key) return;
    saveWorkspaceTerminalCollapsed(
      workspace.userId,
      workspace.projectId,
      workspace.envSlug,
      collapsed,
    );
  }, [
    workspace?.userId,
    workspace?.projectId,
    workspace?.envSlug,
    collapsed,
    collapsedHydratedKey,
  ]);

  // External expand request (command palette "Show terminal"). Only
  // reacts to increments — the mount-time `undefined`/0 is a no-op,
  // and the persist effect above runs naturally because this goes
  // through the same `setCollapsed` the chevron uses.
  useEffect(() => {
    if (expandSignal) setCollapsed(false);
  }, [expandSignal]);

  // npm Scripts "run" — one-shot command write into the PTY. The seq
  // guard makes the effect idempotent against dep churn (a collapse
  // toggle must not re-send the command). Expanding first means the
  // user actually sees the output land.
  const lastRunSeqRef = useRef(0);
  useEffect(() => {
    if (!runCommandSignal || runCommandSignal.seq === lastRunSeqRef.current) {
      return;
    }
    lastRunSeqRef.current = runCommandSignal.seq;
    const wasCollapsed = collapsed;
    if (collapsed) {
      setCollapsed(false);
      onCollapsedChange?.(false);
    }
    const handle = handleRef.current;
    const term = termRef.current;
    if (!handle || !term) {
      toastFn.error("Terminal isn't connected yet — try again in a moment.");
      return;
    }
    const { command } = runCommandSignal;
    const payload =
      command.endsWith("\r") || command.endsWith("\n")
        ? command
        : `${command}\r`;
    const send = () => {
      // Re-read the refs: an unmount during the settle delay must not
      // send into a dead handle.
      const h = handleRef.current;
      const t = termRef.current;
      if (!h || !t) return;
      h.send(payload);
      t.focus();
    };
    if (wasCollapsed) {
      // The PTY resize triggered by un-collapsing can swallow bytes
      // sent mid-relayout (ConPTY drops pending input; observed as the
      // first character of the command vanishing). Send after the
      // relayout settles instead of in the same tick. The timer is
      // intentionally NOT cleaned up on re-run: un-collapsing changes
      // `collapsed`, which re-runs this effect, and a cleanup here
      // would cancel the send before it ever fires — the seq guard
      // above already keeps a second timer from being scheduled.
      setTimeout(send, 150);
      return;
    }
    send();
  }, [runCommandSignal, collapsed, onCollapsedChange]);

  // Chevron click — flip collapse and mirror it up in the same tick
  // so the dock hides the resize sash while folded and the parent
  // can drop maximize (an expanded editor + 32px folded strip is
  // the useful combination, not a maximized one).
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapsedChange?.(next);
  }, [collapsed, onCollapsedChange]);

  // Maximize button — VS Code's panel "maximize / restore" pair. A
  // collapsed panel can't be maximized meaningfully (the editor
  // would hide behind a 32px header), so maximizing from the folded
  // state expands first, then flips the layout flag.
  const handleMaximizeToggle = useCallback(() => {
    if (!maximized && collapsed) {
      setCollapsed(false);
      onCollapsedChange?.(false);
    }
    onToggleMaximize?.();
  }, [maximized, collapsed, onCollapsedChange, onToggleMaximize]);

  // Shell catalog + the user's current pick. Fetched once on
  // mount; the dropdown re-renders from `shells`. `selectedShellId`
  // precedence on first render:
  //   1. `shellIdOverride` from the parent (per-tab persisted shell)
  //   2. Global `SHELL_PREF_KEY` (last shell the user picked)
  //   3. `null` → catalog effect falls back to first available.
  const [shells, setShells] = useState<ShellDescriptor[]>([]);
  const [selectedShellId, setSelectedShellId] = useState<string | null>(
    () => shellIdOverride ?? readShellPref(),
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Fetch the catalog once on mount. Cheap (whichSync × ~6 paths).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await devServerApi.listShells();
        if (cancelled) return;
        setShells(list);
        // First-mount / pending-sync resolving: pick the first
        // available shell if the localStorage pref is missing OR
        // points at a shell that no longer exists. Honors user
        // choice for every other case.
        setSelectedShellId((cur) => {
          if (cur && list.some((s) => s.id === cur && s.available)) return cur;
          const firstAvailable = list.find((s) => s.available);
          return firstAvailable?.id ?? null;
        });
      } catch (err) {
        if (cancelled) return;
        setCatalogError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount xterm ONCE — the WS handle is torn down + reopened in the
  // shell-switch effect below. Keeping the xterm instance stable
  // preserves the user's scrollback across shell changes (a
  // remount would feel like a tab refresh).
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: false,
      allowProposedApi: true,
      // Match the IDE chrome — `bg-card` from Tailwind translates
      // to a near-black surface. xterm's own canvas then paints
      // on top.
      theme: {
        background: DEFAULT_BG,
        foreground: DEFAULT_FG,
        cursor: DEFAULT_FG,
        cursorAccent: DEFAULT_BG,
        selectionBackground: "#3f3f46",
      },
      // Smaller scrollbar than default so the focus stays on output.
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(serializeAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fit;
    serializeAddonRef.current = serializeAddon;

    // Restore scrollback from localStorage if a previous mount
    // saved one. Must happen AFTER `term.open()` so the addon has
    // a buffer to write into. Failures (malformed JSON, schema
    // mismatch after an upgrade) are intentionally silent — the
    // user just sees an empty terminal, same as a fresh one.
    //
    // The current `@xterm/addon-serialize@0.13` exposes only
    // `serialize()` — restore is `term.write(saved)`. The saved
    // string is a stream of ANSI escape codes; the terminal's
    // input handler paints them back into the buffer.
    //
    // Defer the scrollback write one frame: `term.write` walks into
    // `Viewport.syncScrollArea` which reads `this._renderer.value.dimensions`
    // — undefined until after `term.open()` returns AND the next
    // event-loop tick has run. Writing synchronously throws
    // `Cannot read properties of undefined (reading 'dimensions')`
    // and the scrollback silently disappears. rAF yields the tick.
    const recordKey = scrollbackRecordKey(workspaceId, cwd, terminalId);
    const saved = readScrollback(recordKey);
    const raf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            window.setTimeout(() => cb(performance.now()), 0);
    raf(() => {
      try {
        fit.fit();
        if (saved !== null && saved.length > 0) {
          try {
            term.write(saved);
          } catch {
            /* malformed — drop it so we don't try again next mount */
            deleteScrollback(recordKey);
          }
        }
      } catch {
        deleteScrollback(recordKey);
      }
    });

    // ResizeObserver: keep PTY cols/rows in sync with the panel's
    // actual pixel size. The fit() call writes the new dimensions
    // to xterm; we then send them up via the latest handle.
    //
    // Skip the resize message when the inner has zero size — that
    // happens during the 200 ms collapse animation and whenever the
    // panel starts in the default-collapsed state. PTYs reject
    // 0×0 resize frames, and re-sending them on every animation
    // tick spams the WS for nothing.
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      try {
        fit.fit();
        if (term.cols > 0 && term.rows > 0) {
          handleRef.current?.resize(term.cols, term.rows);
        }
      } catch {
        /* container detached */
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      // Final serialize — captures any output that arrived after the
      // last debounced save (the WS may have closed mid-debounce).
      // Best effort: if the addon throws (e.g. mid-dispose) we
      // silently lose the last fragment; the user will see the
      // previous saved state on next mount.
      //
      // Skip when the buffer is empty: under React StrictMode the
      // mount-unmount-mount cycle in dev fires the first cleanup
      // before `term.write(saved)` from the new mount has flushed
      // into the xterm buffer, so serialize() reads back "" — and
      // writing that empty string would clobber the previously
      // persisted scrollback before the replay even runs. The
      // debounced save path already covers steady-state output, so
      // the only thing we'd lose by skipping is a tiny post-write
      // fragment that the next debounce tick will pick up.
      try {
        const data = serializeAddon.serialize();
        if (data.length > 0) {
          writeScrollback(recordKey, data);
        }
      } catch {
        /* */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      serializeAddonRef.current = null;
    };
    // workspaceId + cwd + terminalId are part of the record key
    // — if any of them changes we have a different PTY identity
    // and must re-key the scrollback read.
  }, [workspaceId, cwd, terminalId]);

  // Open / re-open the WS whenever the chosen shell changes. The
  // first run (mount) goes through the same path as a switch, so
  // there's exactly one source of truth for "what bytes flow on
  // this socket".
  useEffect(() => {
    const term = termRef.current;
    if (!term || selectedShellId === null) return;

    // Switching shells (vs. first open) starts a new PTY with a
    // fresh buffer. Drop the persisted scrollback for this terminal
    // key so we don't restore the previous shell's output, and
    // clear the xterm canvas so the user doesn't see a brief
    // stale-buffer flash before the first output arrives.
    const isShellSwitch = prevShellIdRef.current !== null && prevShellIdRef.current !== selectedShellId;
    prevShellIdRef.current = selectedShellId;
    if (isShellSwitch) {
      deleteScrollback(scrollbackRecordKey(workspaceId, cwd, terminalId));
      term.reset();
    }

    // Cleanly tear down any previous handle before opening a new
    // one. Without this, switching from PowerShell → Git Bash would
    // leave the previous PTY running (and the previous WS open).
    handleRef.current?.close();
    handleRef.current = null;
    setPhase("connecting");
    setErrorMsg(null);

    const handle = devServerApi.connectTerminal({
      workspaceId,
      cwd,
      terminalId,
      shellId: selectedShellId,
      cols: term.cols,
      rows: term.rows,
      onStarted: ({ shell }) => {
        setShellLabel(shell || "shell");
        setPhase("connected");
        // Focus the terminal so keystrokes land here without an
        // extra click. Without this, the user has to click into
        // the panel before `npm install` starts.
        term.focus();
      },
      onResumed: ({ shell, resumed }) => {
        // Reattach to a pre-existing PTY (page refresh, navigation,
        // close+reopen folder). We don't paint the reattach notice
        // here — the SerializeAddon has already restored the saved
        // buffer; painting another line would push the saved content
        // down. Just flip phase and focus.
        setShellLabel(shell || "shell");
        setPhase("connected");
        if (resumed) {
          term.focus();
        }
      },
      onOutput: (data) => {
        term.write(data);
        // Debounced scrollback save — keeps localStorage current
        // within ~250 ms of the last output. Covers long-running
        // dev servers that stream output constantly.
        scheduleScrollbackSave();
      },
      onExit: ({ code, reason }) => {
        // Transient WS drop — the PTY is still alive on mcp-server
        // and `connectTerminal` will reconnect with `resumed: true`.
        // Flip to the reconnecting phase (no banner) and wait for the
        // next `started` frame.
        if (typeof reason === "string" && reason.startsWith("reconnecting:")) {
          setPhase("reconnecting");
          return;
        }
        setPhase("exited");
        // Distinguish a shell-switch reconnect (normal) from a real
        // exit. Reason comes from the WS close code; a shell switch
        // closes with code 1000 (normal) — render a brief
        // notice but don't pretend the user wants to debug it.
        const isSwitch =
          reason === "1000" || reason === "closed" || reason === "pty_exit";
        if (isSwitch) {
          // No message — the next handle will overwrite the prompt.
          return;
        }
        const notice =
          code === 0
            ? `\r\n\x1b[2m[Process completed]\x1b[0m\r\n`
            : `\r\n\x1b[31m[Process exited with code ${code ?? "?"}]\x1b[0m\r\n`;
        term.write(notice);
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setPhase("exited");
        term.write(`\r\n\x1b[31m[Terminal error] ${msg}\x1b[0m\r\n`);
      },
    });
    handleRef.current = handle;

    // Wire keystrokes: term.onData fires on every input char.
    // xterm already handles local echo for printable chars, but the
    // PTY is the one painting the real prompt + output — so we
    // forward everything and let the PTY do the echo.
    const dataSub = term.onData((data) => {
      handle.send(data);
    });

    return () => {
      dataSub.dispose();
      // Cancel any pending debounced save — the next handle's effect
      // either re-schedules or finalizes the save on unmount.
      if (saveScrollbackTimerRef.current !== null) {
        window.clearTimeout(saveScrollbackTimerRef.current);
        saveScrollbackTimerRef.current = null;
      }
      handle.close();
      handleRef.current = null;
    };
  }, [workspaceId, cwd, terminalId, selectedShellId]);

  // Debounced scrollback save — closes over the SerializeAddon ref
  // (set by the mount effect) so we can call `serialize()` from any
  // callback without re-running the mount effect. Captures the
  // current record key via the closure.
  const scheduleScrollbackSave = useCallback(() => {
    if (saveScrollbackTimerRef.current !== null) {
      window.clearTimeout(saveScrollbackTimerRef.current);
    }
    saveScrollbackTimerRef.current = window.setTimeout(() => {
      saveScrollbackTimerRef.current = null;
      const addon = serializeAddonRef.current;
      if (!addon) return;
      try {
        const data = addon.serialize();
        writeScrollback(
          scrollbackRecordKey(workspaceId, cwd, terminalId),
          data,
        );
      } catch {
        /* addon not in a serializable state — skip */
      }
    }, SCROLLBACK_SAVE_DEBOUNCE_MS);
  }, [workspaceId, cwd, terminalId]);

  // Picking a new shell: persist, then close. The close triggers
  // the effect above to tear down the WS + reopen with the new id.
  const onSelectShell = useCallback((id: string) => {
    const entry = shells.find((s) => s.id === id);
    if (!entry) return;
    if (!entry.available) {
      toastFn.error(
        `${entry.label} isn't installed. ${
          entry.resolvedPath ? `Looked at: ${entry.resolvedPath}` : ""
        }`,
      );
      return;
    }
    writeShellPref(id);
    setSelectedShellId(id);
  }, [shells]);

  // The current selected descriptor — for the dropdown trigger
  // label. Falls back to the first available while the catalog is
  // still loading.
  const currentShell = useMemo(
    () => shells.find((s) => s.id === selectedShellId) ?? null,
    [shells, selectedShellId],
  );

  return (
    // Maximized: no fixed height — `flex-1` stretches to the slot the
    // parent opened up by hiding the editor rows. Normal: the fixed
    // `height` from the dock's resizable state. While the dock sash
    // is being dragged, `transition-none` stops the 200 ms ease-out
    // from lagging every pointermove.
    <div
      className={`flex flex-col overflow-hidden border-t border-border bg-card ${
        maximized ? "min-h-0 flex-1" : ""
      } ${
        resizing ? "transition-none" : "transition-[height] duration-200 ease-out"
      }`}
      style={
        maximized
          ? undefined
          : { height: collapsed ? COLLAPSED_HEADER_PX : height }
      }
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-2 px-3">
          <TerminalIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-semibold">Terminal</span>
          <span className="text-muted-foreground/60">
            {phase === "connecting" && "connecting…"}
            {phase === "reconnecting" && "reconnecting…"}
            {phase === "connected" && shellLabel && `· ${shellLabel}`}
            {phase === "exited" &&
              (errorMsg ? `· ${errorMsg}` : "· exited")}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3">
          <PhaseDot phase={phase} />
          <ShellPicker
            shells={shells}
            currentShell={currentShell}
            disabled={catalogError !== null || shells.length === 0}
            onSelect={onSelectShell}
          />
          {onToggleMaximize && (
            <button
              type="button"
              onClick={handleMaximizeToggle}
              aria-label={maximized ? "Restore terminal" : "Maximize terminal"}
              aria-pressed={maximized}
              title={maximized ? "Restore terminal" : "Maximize terminal"}
              className="text-muted-foreground hover:text-foreground"
            >
              {maximized ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}
            aria-expanded={!collapsed}
            className="text-muted-foreground hover:text-foreground"
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      {/*
        Always render the inner so xterm + the PTY stay mounted across
        toggles (recreating them on every click would clobber
        scrollback and the running process). When collapsed, the
        flex item's `flex-1` collapses to 0 height (outer is exactly
        the header height) and `opacity-0 pointer-events-none`
        hides it visually during the 200 ms height transition.
      */}
      <div
        ref={containerRef}
        // Padding keeps xterm's text from sitting flush against
        // the panel border. xterm.js ignores box-sizing: border-box
        // for its canvas so we need the inner padding.
        className={`flex-1 overflow-hidden p-2 transition-opacity duration-200 ease-out ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}
        style={{ minHeight: 0 }}
      />
    </div>
  );
}

function PhaseDot({ phase }: { phase: TerminalPhase }) {
  // Small status dot — green when connected, amber while connecting
  // or reconnecting, red on exit. Pure CSS so it doesn't pull in
  // another component.
  const color =
    phase === "connected"
      ? "bg-emerald-500"
      : phase === "connecting" || phase === "reconnecting"
        ? "bg-amber-500"
        : "bg-destructive";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      aria-hidden="true"
    />
  );
}

interface ShellPickerProps {
  shells: ShellDescriptor[];
  currentShell: ShellDescriptor | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}

function ShellPicker({
  shells,
  currentShell,
  disabled,
  onSelect,
}: ShellPickerProps) {
  // Catalog hasn't loaded yet — render a placeholder trigger so
  // the header layout doesn't shift when the list arrives.
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-6 items-center gap-1 rounded border border-border bg-surface-muted px-2 text-[11px] font-normal normal-case text-muted-foreground"
        title={shells.length === 0 ? "Loading shells…" : "Shell picker unavailable"}
      >
        <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        <span>{currentShell?.label ?? "Shell"}</span>
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-6 items-center gap-1 rounded border border-border bg-surface-muted px-2 text-[11px] font-normal normal-case text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        title={
          currentShell?.available
            ? `Shell: ${currentShell.label}${currentShell.resolvedPath ? ` (${currentShell.resolvedPath})` : ""}`
            : "No shell available"
        }
      >
        <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        <span>{currentShell?.label ?? "Pick shell"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Shell
        </DropdownMenuLabel>
        {shells.map((s) => (
          <DropdownMenuItem
            key={s.id}
            disabled={!s.available}
            onSelect={() => onSelect(s.id)}
            title={
              s.available
                ? s.resolvedPath ?? undefined
                : `${s.label} not found on PATH`
            }
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className={s.available ? "" : "text-muted-foreground"}>
                {s.label}
              </span>
              {currentShell?.id === s.id ? (
                <Check className="h-3 w-3 text-primary" aria-hidden="true" />
              ) : !s.available ? (
                <span className="text-[10px] uppercase text-muted-foreground">
                  not installed
                </span>
              ) : null}
            </span>
            {s.resolvedPath && s.available && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {s.resolvedPath}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          Switching ends the running PTY. Unsaved state in the
          shell is lost.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}