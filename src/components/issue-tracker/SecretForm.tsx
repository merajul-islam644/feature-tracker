// Form for adding a new secret. Password is masked by default with a show/hide
// toggle. The plaintext password only lives in this component's local state —
// it is forwarded once to the parent's addSecret callback and immediately
// dropped (spec section 12.2 & 12.3).
//
// A target dropdown lets the user bind the secret to one or more configured
// verification targets at creation time. Binding is optional — secrets can
// also be saved without any target and bound later via the SecretCard row.

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TargetSelect } from "./TargetSelect";
import type { VerificationTarget } from "@/types/issue-tracker";

interface Props {
  onSubmit: (payload: {
    name: string;
    email: string;
    password: string;
    // Optional — empty/missing array means "do not bind to any target
    // right now". The parent's `addSecret` accepts the array and
    // binds to each requested target via the same diff-based dispatch
    // used by `bindSecret`.
    targetIds?: string[];
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
  // Selected targetIds — empty array means "no binding". Multi-select
  // is now first-class; one credential can land on several targets.
  const [targetIds, setTargetIds] = useState<string[]>([]);
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
    setTargetIds([]);
    setErrors({});
  };

  // Surface existing bindings the user is trying to take. The
  // invariant is one-target-one-secret, so any target already bound to
  // another credential BLOCKS the save — the user must unbind first
  // (from that other secret's row). List every other-secret-held
  // target the user has checked, joined by commas.
  const displacedSecrets = Array.from(
    new Set(
      targetIds
        .map((id) => boundSecretByTargetId[id])
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const targetWarning =
    displacedSecrets.length > 0
      ? `Cannot bind — these targets are already held by "${displacedSecrets.join('", "')}". Unbind them from that credential first.`
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
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      });
      reset();
    } catch {
      // parent surfaces the toast
    } finally {
      setBusy(false);
    }
  };

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
        <TargetSelect
          id="secret-target"
          value={targetIds}
          onChange={setTargetIds}
          targets={targets}
          boundSecretByTargetId={boundSecretByTargetId}
        />
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
