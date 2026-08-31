import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandSplash } from '@/components/auth/BrandSplash';
import { CopyableValue } from '@/components/ui/copyable-value';
import { useAuth } from '@/hooks/useAuth';

/** Must match MIN_PASSWORD_LENGTH in server/src/auth-store.ts. */
const MIN_PASSWORD_LENGTH = 8;

function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function RecoveryKeyPanel({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <AuthCard
        title="Save your recovery key"
        description="This key resets your password if you ever forget it. Your mining configuration is kept."
      >
        <div className="space-y-4">
          <CopyableValue value={recoveryKey} />

          <p className="text-xs text-muted-foreground">
            Store it somewhere safe. If you lose both your password and this key,
            recovering the device means erasing its config volume.
          </p>

          <Button type="button" className="w-full" onClick={onDone}>
            I&apos;ve saved it
          </Button>
        </div>
      </AuthCard>
    </div>
  );
}

function CreatePasswordForm({
  onRecoveryKey,
}: {
  onRecoveryKey: (key: string) => void;
}) {
  const { createPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setValidationError('Passwords do not match.');
      return;
    }

    setValidationError(null);
    createPassword.mutate(password, {
      onSuccess: (recoveryKey) => {
        if (recoveryKey) onRecoveryKey(recoveryKey);
      },
    });
  };

  return (
    <AuthCard
      title="Create an admin password"
      description="This password protects your mining configuration from anyone else who can reach this device."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="new-password">Password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            className="mt-1.5"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="mt-1.5"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        <FieldError message={validationError ?? createPassword.error?.message} />

        <Button type="submit" className="w-full" disabled={createPassword.isPending}>
          {createPassword.isPending ? 'Creating...' : 'Create password'}
        </Button>

        <p className="text-xs text-muted-foreground">
          Store it somewhere safe. Recovering your account requires the recovery key shown on the next screen. If you lose it, there is nothing we can do to recover your configuration, and you will need to reinstall the application.
        </p>
      </form>
    </AuthCard>
  );
}

function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { recover } = useAuth();
  const [key, setKey] = useState('');

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    recover.mutate(key, {
      onSuccess: () => {
        setKey('');
        onOpenChange(false);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <AuthCard
        title="Reset your password"
        description="Enter your recovery key to set a new password. Your mining configuration will be kept."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="recovery-key">Recovery key</Label>
            <Input
              id="recovery-key"
              value={key}
              autoFocus
              className="mt-1.5"
              onChange={(event) => setKey(event.target.value)}
            />
          </div>

          <FieldError message={recover.error?.message} />

          {recover.isSuccess ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              Password reset. Please create a new password.
            </p>
          ) : (
            <Button type="submit" className="w-full" disabled={recover.isPending}>
              {recover.isPending ? 'Resetting...' : 'Reset password'}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </form>
      </AuthCard>
    </div>
  );
}

function LoginForm({ recoveryKeySet }: { recoveryKeySet: boolean }) {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(password);
  };

  return (
    <>
      <AuthCard title="Unlock sv2-ui" description="Enter your admin password to manage the mining stack.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className="mt-1.5"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <FieldError message={login.error?.message} />

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Unlocking...' : 'Unlock'}
          </Button>

          {recoveryKeySet && (
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                onClick={() => setForgotOpen(true)}
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>
      </AuthCard>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </>
  );
}

/**
 * Gates every operational route behind an authenticated principal.
 *
 * This is a UX layer only - the server middleware in server/src/index.ts is the
 * actual enforcement point and returns 401 for the whole control API without a
 * session.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { isLoading, isError, passwordSet, authenticated, recoveryKeySet } = useAuth();
  const [, navigate] = useLocation();
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);

  if (isLoading) {
    return <BrandSplash message="Checking access..." />;
  }

  // No orchestration backend at all (standalone/static hosting). Preserve the
  // pre-auth behaviour: there is nothing to protect and nothing to log into.
  if (isError) {
    return <>{children}</>;
  }

  const recoveryOverlay = pendingRecoveryKey && (
    <RecoveryKeyPanel
      recoveryKey={pendingRecoveryKey}
      onDone={() => {
        setPendingRecoveryKey(null);
        navigate('/');
      }}
    />
  );

  if (!passwordSet) {
    return (
      <>
        <CreatePasswordForm onRecoveryKey={setPendingRecoveryKey} />
        {recoveryOverlay}
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        <LoginForm recoveryKeySet={recoveryKeySet} />
        {recoveryOverlay}
      </>
    );
  }

  return (
    <>
      {children}
      {recoveryOverlay}
    </>
  );
}
