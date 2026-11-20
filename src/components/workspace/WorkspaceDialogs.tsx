// WorkspaceDialogs — the confirmation modals the workspace editor
// needs to interrupt a destructive action with a "are you sure?"
// prompt.
//
// Two flavours, one component:
//
//   1. Unsaved-changes confirm` — fired when the user closes a dirty
//      tab (close button, middle-click close, Cmd+W). Buttons are
//      "Save" / "Don't save" / "Cancel". Save runs the debounced
//      flush and then closes; Cancel aborts.
//
//   2. External-change prompt — fired when the chokidar watcher
//      reports a `change` for a path that's currently open in the
//      editor. Buttons are "Reload" / "Keep mine" / "Cancel".
//      Reload refetches from disk and overwrites the editor doc;
//      Keep mine ignores the disk version.
//
// Both dialogs use Radix Dialog with `role="alertdialog"` so a
// screen reader announces the prompt without the user needing to
// focus it.

import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileWarning, Save, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "@radix-ui/react-dialog";
import { basename } from "./treeHelpers";

interface UnsavedConfirmDialogProps {
  open: boolean;
  path: string;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedConfirmDialog({
  open,
  path,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedConfirmDialogProps) {
  return (
    <DialogPrimitive open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            >
              <Save className="h-4 w-4" />
            </span>
            <DialogTitle>Save changes to {basename(path)}?</DialogTitle>
          </div>
          <DialogDescription>
            This file has unsaved edits in the editor. Closing it now
            will discard your changes.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="text-xs text-muted-foreground">
          <span className="font-mono">{path}</span>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Don't save
          </Button>
          <Button onClick={() => void onSave()}>
            <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogPrimitive>
  );
}

interface ExternalChangeDialogProps {
  open: boolean;
  path: string;
  onReload: () => void | Promise<void>;
  onKeepMine: () => void;
}

export function ExternalChangeDialog({
  open,
  path,
  onReload,
  onKeepMine,
}: ExternalChangeDialogProps) {
  return (
    <DialogPrimitive open={open}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            >
              <FileWarning className="h-4 w-4" />
            </span>
            <DialogTitle>File changed on disk</DialogTitle>
          </div>
          <DialogDescription>
            Another program (or a teammate via git) wrote to{" "}
            <span className="font-mono">{basename(path)}</span> since
            you opened it. Reload from disk to keep your in-editor
            changes safe.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            <span className="font-mono">{path}</span>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onKeepMine}>
            Keep mine
          </Button>
          <Button onClick={() => void onReload()}>Reload from disk</Button>
        </DialogFooter>
      </DialogContent>
    </DialogPrimitive>
  );
}