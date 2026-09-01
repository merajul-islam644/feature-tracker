// Form for adding a new secret. Password is masked by default with a show/hide
// toggle. The plaintext password only lives in this component's local state —
// it is forwarded once to the parent's addSecret callback and immediately
// dropped (spec section 12.2 & 12.3).

import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Props {
  onSubmit: (payload: { name: string; email: string; password: string }) => Promise<void>;
}

export function SecretForm({ onSubmit }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const validate = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email.";
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
    setErrors({});
  };

  const onSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), password });
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
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Adding…" : "Add Secret"}
        </Button>
      </div>
    </form>
  );
}
