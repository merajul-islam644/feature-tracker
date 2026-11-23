// Problems sidebar view: project-wide diagnostics (Run Anything's
// language-support layer). Checkers run through the runner's exec —
// `tsc --noEmit` for TS/JS projects, `python -m compileall` for Python
// folders — and every row jumps to the file + line on click. Monaco's
// own per-file squiggles stay authoritative inside the editor; this
// view adds the cross-file view of the whole project.

import { TriangleAlert, RotateCw, Search } from "lucide-react";
import type { WorkbenchProblem } from "../data/useTestWorkspace";

export function ProblemsView({ problems, problemsNote, problemsRunning, problemsChecked, onCheck, onOpenProblem }: {
  problems: WorkbenchProblem[];
  /** Non-fatal status: nothing to check, a checker failed, … */
  problemsNote: string | null;
  problemsRunning: boolean;
  /** True once any check completed on this folder — a completed check
   *  with zero rows means "clean", NOT "never ran". */
  problemsChecked: boolean;
  onCheck: () => void;
  onOpenProblem: (problem: WorkbenchProblem) => void;
}) {
  const errors = problems.filter((problem) => problem.severity === "error");
  const warnings = problems.filter((problem) => problem.severity === "warning");

  // Group by file, preserving the sort the hook applied (path, line).
  const groups: { path: string; rows: WorkbenchProblem[] }[] = [];
  for (const problem of problems) {
    const last = groups[groups.length - 1];
    if (last && last.path === problem.path) last.rows.push(problem);
    else groups.push({ path: problem.path, rows: [problem] });
  }

  return (
    <div className="wb-view">
      <div className="wb-view-head">
        <span className="wb-view-title">Problems</span>
        <span className="wb-view-actions">
          <button
            aria-label="Check problems"
            className="wb-icon-btn"
            disabled={problemsRunning}
            onClick={onCheck}
            title="Re-check the workspace — tsc for TS/JS (tsconfig.json), compileall for Python"
            type="button"
          >
            {problemsRunning ? <RotateCw size={13} className="wb-spin" /> : <Search size={13} />}
          </button>
        </span>
      </div>
      <div className="wb-problems-body">
        {problemsRunning ? (
          <p className="wb-problems-note muted">Checking the workspace…</p>
        ) : problemsNote ? (
          <p className="wb-problems-note muted">{problemsNote}</p>
        ) : problems.length === 0 && problemsChecked ? (
          /* A COMPLETED check with zero rows: the workspace is clean —
             never show the "never ran" hint here (that lie sent the user
             hunting for a button that had already done its job). */
          <div className="wb-problems-clean">
            <span className="badge badge-passed">✓ 0 problems</span>
            <p className="wb-problems-note muted">
              The workspace checks clean — tsc found nothing across the project.
            </p>
          </div>
        ) : problems.length === 0 ? (
          <p className="wb-problems-note muted">
            No check run yet — checking starts automatically when you open this view. TS/JS projects need a tsconfig.json.
          </p>
        ) : (
          <>
            <div className="wb-problems-summary">
              <span className={`badge ${errors.length > 0 ? "badge-failed" : "badge-passed"}`}>
                {errors.length} error{errors.length === 1 ? "" : "s"}
              </span>
              {warnings.length > 0 ? (
                <span className="badge badge-medium">{warnings.length} warning{warnings.length === 1 ? "" : "s"}</span>
              ) : null}
            </div>
            {groups.map((group) => (
              <div className="wb-problems-file" key={group.path}>
                <p className="wb-problems-file-path">
                  <TriangleAlert size={11} aria-hidden="true" /> {group.path}
                </p>
                {group.rows.map((problem, index) => (
                  <button
                    className="wb-problems-row"
                    key={`${problem.path}:${problem.line}:${problem.column}:${index}`}
                    onClick={() => onOpenProblem(problem)}
                    title={`${problem.path}:${problem.line}:${problem.column} — click to open`}
                    type="button"
                  >
                    <span className={`wb-problems-sev ${problem.severity}`}>
                      {problem.severity === "error" ? "✖" : "⚠"}
                    </span>
                    <span className="wb-problems-loc">:{problem.line}:{problem.column}</span>
                    <span className="wb-problems-msg">{problem.message}</span>
                    <span className="wb-problems-src">{problem.source}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
