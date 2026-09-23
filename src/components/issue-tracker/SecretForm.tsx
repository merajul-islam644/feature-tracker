// Form for adding a new secret. Password is masked by default with a show/hide
// toggle. The plaintext password only lives in this component's local state —
// it is forwarded once to the parent's addSecret callback and immediately
// dropped (spec section 12.2 & 12.3).
//
// A target dropdown lets the user bind the secret to exactly one configured
// verification target at creation time. Binding is optional — secrets can also
// be saved without a target and bound later via the SecretCard row.

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { VerificationTarget } from "@/types/issue-tracker";

interface Props {
  onSubmit: (payload: {
    name: string;
    email: string;
    password: string;
    // Optional — empty/missing means "do not bind to any target right now".
    targetId?: string;
  }) => Promise<void>;
  // List of configured targets shown in the dropdown. May be empty — the
  // dropdown then renders an empty-state message instead of options.
  targets?: VerificationTarget[];
  // Optional map targetId → name of the currently-bound secret. Used to warn
  // the user before they overwrite an existing binding.
  boundSecretByTargetId?: Record<string, string>;
}

export function SecretForm({
  onSubmit,
  targets = [],
  boundSecretByTargetId = {},
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [targetId, setTargetId] = useState<string>(""); // "" = no binding
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});

  const validate = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Enter a valid email.";
    if (!password) next.password = "Password is required.";
    else if (password.length < 6) next.password = "Use at least 6 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setShow(false);
    setTargetId("");
    setErrors({});
  };

  // Surface the existing binding (if any) so the user knows what they're
  // about to replace when they pick a target.
  const targetWarning =
    targetId && boundSecretByTargetId[targetId]
      ? `Heads up — this target is currently bound to "${boundSecretByTargetId[targetId]}". Saving will replace that binding.`
      : null;

  const onSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        password,
        targetId: targetId || undefined,
      });
      reset();
    } catch {
      // parent surfaces the toast
    } finally {
      setBusy(false);
    }
  };

  // Build the Select's options. Empty-string sentinel for "no binding"
  // so the user can opt out without disabling the field.
  const targetOptions = [
    { value: "", label: "— No target (credential will not be used) —" },
    ...targets.map((t) => ({
      value: t.id,
      label: `${t.applicationName} — ${t.url}`,
    })),
  ];

  return (
    <form
      onSubmit={onSubmitForm}
      className="space-y-3 rounded-md border border-border bg-muted/20 p-4"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="secret-name">Credential name</Label>
          <Input
            id="secret-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="QA Account"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "secret-name-err" : undefined}
          />
          {errors.name && (
            <p id="secret-name-err" className="text-xs text-destructive">
              {errors.name}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="secret-email">Email</Label>
          <Input
            id="secret-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="qa@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "secret-email-err" : undefined}
          />
          {errors.email && (
            <p id="secret-email-err" className="text-xs text-destructive">
              {errors.email}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="secret-password">Password</Label>
        <div className="flex gap-2">
          <Input
            id="secret-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "secret-password-err" : undefined}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        {errors.password && (
          <p id="secret-password-err" className="text-xs text-destructive">
            {errors.password}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Passwords are kept only for the current session and never written to local storage.
        </p>
      </div>

      {/* Target binding — optional. The credential can be created without
          a binding and bound later from the secret row. */}
      <div className="space-y-1">
        <Label
          htmlFor="secret-target"
          className="flex items-center gap-1.5"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Bind to target (optional)
        </Label>
        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border bg-background px-3 py-2">
            No verification targets configured yet. Add one in the
            Verification Targets section above, then bind this credential to
            it.
          </p>
        ) : (
          <div className="space-y-2">
            <Select
              id="secret-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              options={targetOptions}
            />
            {/* Visible list of available targets so URLs aren't clipped by
                the native select. Helpful when the user has many targets
                and wants to confirm which is which before opening the
                dropdown. */}
            <ul className="space-y-1 text-xs text-muted-foreground">
              {targets.map((t) => {
                const bound = boundSecretByTargetId[t.id];
                const selected = targetId === t.id;
                return (
                  <li
                    key={t.id}
                    className={
                      selected
                        ? "rounded border border-primary/40 bg-primary/5 px-2 py-1"
                        : "rounded border border-border/60 bg-background px-2 py-1"
                    }
                  >
                    <span className="font-medium text-foreground">
                      {t.applicationName}
                    </span>
                    <span className="ml-1.5 break-all">{t.url}</span>
                    {bound && (
                      <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                        (bound to {bound})
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {targetWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {targetWarning}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Each credential can only be used by the target it's bound to. The
          verification agent will not pass this secret to any other URL.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Adding…" : "Add Secret"}
        </Button>
      </div>
    </form>
  );
}
