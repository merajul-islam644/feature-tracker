// Run sidebar view: the workbench's Run and Debug pane. TWO run kinds:
//
//   • Scripts (Run Anything) — the workspace package.json's own scripts
//     (build, lint, test, …) plus a free-form command box, executed
//     through the runner's one-shot exec with output in the Output
//     panel. This is the general-development half.
//   • Playwright specs — the original flow: base URL + dispatch to the
//     runner with gateway-persisted results. The test preset.
//
// Both share the runner-liveness row and the stats tiles.

import { useState } from "react";
import { Play, RotateCw, Square, TerminalSquare } from "lucide-react";
import { formatMs } from "../../../lib/format";
import { useT } from "../../../lib/testpilot/i18n";
import type { PlaywrightRunOutcome } from "../../../lib/demo/store";

export function RunView({ baseURL, onBaseURLChange, onCancel, onRun, running, runnableCount, filesCount, runnerOnline, outcome, errorText, runnerUrl, scripts, scriptsRunning, onRunScript, onRunCommand }: {
  baseURL: string;
  onBaseURLChange: (value: string) => void;
  /** Stop the in-flight run — kills the runner's Playwright child. */
  onCancel: () => void;
  onRun: () => void;
  running: boolean;
  runnableCount: number;
  filesCount: number;
  runnerOnline: boolean | undefined;
  outcome: PlaywrightRunOutcome | undefined;
  errorText: string | undefined;
  runnerUrl: string;
  /** package.json scripts of the open workspace (null = not read yet,
   *  [] = no scripts / no package.json). */
  scripts: { name: string; command: string }[] | null;
  /** The script (or "__custom__") currently executing. */
  scriptsRunning: string | null;
  onRunScript: (name: string, command: string) => void;
  onRunCommand: (command: string) => void;
}) {
  const { t } = useT();
  const [customCommand, setCustomCommand] = useState("");
  const scriptsAvailable = runnerOnline !== false;
  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Run</span>
      </div>
      <div className="wb-run-body">
        {/* ── Scripts (Run Anything) ──────────────────────────────── */}
        <div className="wb-run-config">
          <p className="wb-run-subtitle">Run this project's own commands (package.json):</p>
          {scripts === null ? (
            <p className="wb-run-meta muted">Open a folder to discover its scripts.</p>
          ) : scripts.length === 0 ? (
            <p className="wb-run-meta muted">No scripts in package.json.</p>
          ) : (
            <div className="wb-run-scripts">
              {scripts.map((script) => {
                const isRunning = scriptsRunning === script.name;
                const busy = scriptsRunning !== null || !scriptsAvailable;
                return (
                  <div className="wb-run-script-row" key={script.name}>
                    <span className="wb-run-script-name">npm run {script.name}</span>
                    <span className="wb-run-script-cmd" title={script.command}>{script.command}</span>
                    <button
                      aria-label={`Run ${script.name}`}
                      className="wb-icon-btn"
                      disabled={busy}
                      onClick={() => onRunScript(script.name, script.command)}
                      title={`npm run ${script.name} — output lands in the Output panel`}
                      type="button"
                    >
                      {isRunning ? <RotateCw size={13} className="wb-spin" /> : <Play size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {/* Free-form command: builds, typecheck, one-off tools. The
              hook refuses long-lived dev servers with a terminal hint. */}
          <div className="wb-run-custom">
            <input
              className="wb-run-custom-input"
              onChange={(event) => setCustomCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && customCommand.trim() && scriptsRunning === null && scriptsAvailable) {
                  onRunCommand(customCommand);
                  setCustomCommand("");
                }
              }}
              placeholder="Custom command — npx tsc --noEmit, node scripts/x.js, …"
              spellCheck={false}
              value={customCommand}
            />
            <button
              aria-label="Run command"
              className="wb-icon-btn"
              disabled={!customCommand.trim() || scriptsRunning !== null || !scriptsAvailable}
              onClick={() => {
                onRunCommand(customCommand);
                setCustomCommand("");
              }}
              title="Run at the workspace root — output lands in the Output panel"
              type="button"
            >
              {scriptsRunning === "__custom__" ? <RotateCw size={13} className="wb-spin" /> : <TerminalSquare size={13} />}
            </button>
          </div>
        </div>

        {/* ── Playwright specs (the test preset) ──────────────────── */}
        <div className="wb-run-config">
          <p className="wb-run-subtitle">Run the Playwright specs in this workspace against:</p>
          <label className="form-field wb-run-url">
            <span>{t("tests.baseURL")}</span>
            <input
              onChange={(event) => onBaseURLChange(event.target.value)}
              placeholder={t("tests.baseURLPlaceholder")}
              spellCheck={false}
              value={baseURL}
            />
          </label>
          {running ? (
            /* While a suite executes the primary action becomes the stop
               button — a disabled "Running…" label gave the user no way out
               of a slow (tens-of-minutes) run. */
            <button className="danger-button wb-run-btn" onClick={onCancel} type="button">
              <Square size={15} /> {t("run.cancel")}
            </button>
          ) : (
            <button className="primary-button wb-run-btn" disabled={runnableCount === 0} onClick={onRun} type="button">
              <Play size={15} /> {t("tests.run")}
            </button>
          )}
        </div>

        {/* The workspace's shape as count tiles — the numbers were buried in
            a muted sentence before; now they read at a glance like the
            metric tiles elsewhere in the app. */}
        <div className="wb-run-stats">
          <div className="wb-run-stat">
            <div className="wb-run-stat-num">{runnableCount}</div>
            <div className="wb-run-stat-label">runnable spec{runnableCount === 1 ? "" : "s"}</div>
          </div>
          <div className="wb-run-stat">
            <div className="wb-run-stat-num">{filesCount}</div>
            <div className="wb-run-stat-label">file{filesCount === 1 ? "" : "s"}</div>
          </div>
        </div>

        {/* Runner liveness as its own status row — dot + state + the URL it
            answers on, instead of a muted inline line that scrolled past. */}
        {runnerOnline !== undefined ? (
          <div className="wb-run-status">
            <span className={`health-dot ${runnerOnline ? "ok" : ""}`} />
            <div className="wb-run-status-text">
              <span>{runnerOnline ? t("tests.runnerOnline") : t("tests.runnerOff")}</span>
              <span className="mono wb-run-status-url">{runnerUrl}</span>
            </div>
          </div>
        ) : null}

        {running ? (
          <p className="wb-run-meta muted"><RotateCw size={13} className="wb-spin" style={{ verticalAlign: -2 }} /> {t("tests.running")}</p>
        ) : null}

        {outcome ? (
          <div className="wb-run-result">
            <p className="wb-run-result-title">{t("tests.results")}</p>
            <div className="wb-run-chips">
              <span className="badge badge-passed">{outcome.run.passed} {t("status.passed")}</span>
              {outcome.run.failed > 0 ? <span className="badge badge-failed">{outcome.run.failed} {t("status.failed")}</span> : null}
              {outcome.run.total - outcome.run.passed - outcome.run.failed > 0 ? (
                <span className="badge badge-neutral">{outcome.run.total - outcome.run.passed - outcome.run.failed} {t("status.skipped")}</span>
              ) : null}
            </div>
            <p className="wb-run-meta muted">{t("common.duration")}: {formatMs(outcome.run.durationSec * 1000)}</p>
          </div>
        ) : null}

        {errorText ? (
          <p className="wb-run-error">{errorText.length > 200 ? `${errorText.slice(0, 200)}…` : errorText}</p>
        ) : null}
      </div>
    </div>
  );
}
