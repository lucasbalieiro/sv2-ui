import { useEffect, useState, type ReactNode } from 'react';
import {
  Bot,
  ExternalLink,
  Loader2,
  Send,
  Unplug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTelegram, type TelegramSettings } from '@/hooks/useTelegram';

const TELEGRAM_EXPERIMENT_STORAGE_KEY = 'sv2-ui-experiment-telegram-enabled';

// localStorage can throw (blocked site data, some private modes). This is
// only a UI convenience, so fall back to the server state instead of crashing.
function readStoredTelegramExperimentState(): boolean | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(TELEGRAM_EXPERIMENT_STORAGE_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}

function storeTelegramExperimentState(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(TELEGRAM_EXPERIMENT_STORAGE_KEY, String(enabled));
  } catch {
    // The toggle still works for this visit; it just won't be remembered.
  }
}

export function isTelegramExperimentOpen(
  settings: Pick<TelegramSettings, 'connected' | 'paired' | 'enabled'>,
  setupEnabled: boolean | null,
): boolean {
  return settings.paired
    ? settings.enabled
    : setupEnabled ?? settings.connected;
}

function runMutation(promise: Promise<unknown>): void {
  void promise.catch(() => {
    // Mutation errors are rendered from the hook state.
  });
}

export function ExperimentalTab() {
  const {
    settings,
    isLoading,
    retry,
    isPending,
    error,
    testSent,
    connect,
    pair,
    update,
    sendTest,
    disconnect,
    clearError,
  } = useTelegram();
  const [botToken, setBotToken] = useState('');
  const [summaryInterval, setSummaryInterval] = useState('60');
  const [telegramSetupEnabled, setTelegramSetupEnabled] = useState<boolean | null>(
    readStoredTelegramExperimentState,
  );

  useEffect(() => {
    if (settings) {
      setSummaryInterval(String(settings.summaryIntervalMinutes));
    }
  }, [settings]);

  const handleConnect = async () => {
    clearError();
    try {
      await connect(botToken);
      setBotToken('');
    } catch {
      // Mutation errors are rendered from the hook state.
    }
  };

  const handleUpdateSummary = async () => {
    clearError();
    const value = Number(summaryInterval);
    try {
      await update({ summaryIntervalMinutes: value });
    } catch {
      // Mutation errors are rendered from the hook state.
    }
  };

  const openPairingLink = () => {
    if (!settings?.pairingUrl) return;
    window.open(settings.pairingUrl, '_blank', 'noopener,noreferrer');
  };

  const handleTelegramExperimentChange = (enabled: boolean) => {
    clearError();

    if (settings?.paired) {
      runMutation(update({ enabled }));
      return;
    }

    setTelegramSetupEnabled(enabled);
    storeTelegramExperimentState(enabled);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading experimental settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm">
        <p className="max-w-lg text-center text-destructive">
          {error || 'Telegram settings could not be loaded.'}
        </p>
        <Button variant="outline" onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    );
  }

  const telegramExperimentOpen = isTelegramExperimentOpen(
    settings,
    telegramSetupEnabled,
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-1">
        <h3 className="text-xl font-semibold tracking-tight">Experiments</h3>
        <p className="text-sm text-muted-foreground">
          Early features that are still being refined. Opt in to try them.
        </p>
      </div>

      <div className="space-y-3">
        <ExperimentToggleCard
          id="telegram-experiment"
          title="Telegram activity updates"
          enabled={telegramExperimentOpen}
          disabled={isPending}
          onEnabledChange={handleTelegramExperimentChange}
        >
          {!settings.paired && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Create a bot with{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  @BotFather
                </a>{' '}
                and copy its token.
              </li>
              <li>Paste the token below and connect.</li>
              <li>Open the bot in Telegram, press Start, then check pairing.</li>
            </ol>
          )}

          {!settings.connected && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="telegram-bot-token">Bot token</Label>
                <Input
                  id="telegram-bot-token"
                  type="password"
                  autoComplete="off"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder="Paste the token from @BotFather"
                />
                <p className="text-xs text-muted-foreground">
                  Stored only on your SV2 UI server. Use a bot made just for SV2 UI.
                </p>
              </div>

              <Button
                onClick={() => void handleConnect()}
                disabled={isPending || botToken.trim().length === 0}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="mr-2 h-4 w-4" />
                )}
                Connect bot
              </Button>
            </div>
          )}

          {settings.connected && !settings.paired && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <Bot className="h-4 w-4 text-primary" />
                  {settings.botName} · @{settings.botUsername}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open Telegram, press Start, then check pairing.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={openPairingLink} disabled={!settings.pairingUrl}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Telegram
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    clearError();
                    runMutation(pair());
                  }}
                  disabled={isPending}
                >
                  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Check pairing
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    clearError();
                    runMutation(disconnect());
                  }}
                  disabled={isPending}
                >
                  Use a different bot
                </Button>
              </div>
            </div>
          )}

          {settings.paired && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 rounded-md border border-green-500/30 bg-green-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">Paired with {settings.recipient}</p>
                  <p className="text-sm text-muted-foreground">
                    Alerts come from @{settings.botUsername}. Send{' '}
                    <span className="font-mono">/settings</span> to it to change them from Telegram.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearError();
                    runMutation(sendTest());
                  }}
                  disabled={isPending}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send test
                </Button>
              </div>

              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-block-found">Block found</Label>
                  <Switch
                    id="telegram-block-found"
                    checked={settings.notifyOnBlockFound}
                    onCheckedChange={(notifyOnBlockFound) => {
                      clearError();
                      runMutation(update({ notifyOnBlockFound }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-best-difficulty">New best difficulty</Label>
                  <Switch
                    id="telegram-best-difficulty"
                    checked={settings.notifyOnBestDifficulty}
                    onCheckedChange={(notifyOnBestDifficulty) => {
                      clearError();
                      runMutation(update({ notifyOnBestDifficulty }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-pool-change">Pool failover</Label>
                  <Switch
                    id="telegram-pool-change"
                    checked={settings.notifyOnPoolChange}
                    onCheckedChange={(notifyOnPoolChange) => {
                      clearError();
                      runMutation(update({ notifyOnPoolChange }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-status-changes">Mining start and stop</Label>
                  <Switch
                    id="telegram-status-changes"
                    checked={settings.notifyOnStatusChange}
                    onCheckedChange={(notifyOnStatusChange) => {
                      clearError();
                      runMutation(update({ notifyOnStatusChange }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-worker-changes">Worker changes</Label>
                  <Switch
                    id="telegram-worker-changes"
                    checked={settings.notifyOnWorkerChange}
                    onCheckedChange={(notifyOnWorkerChange) => {
                      clearError();
                      runMutation(update({ notifyOnWorkerChange }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="telegram-rejected-shares">Rejected shares</Label>
                  <Switch
                    id="telegram-rejected-shares"
                    checked={settings.notifyOnRejectedShares}
                    onCheckedChange={(notifyOnRejectedShares) => {
                      clearError();
                      runMutation(update({ notifyOnRejectedShares }));
                    }}
                    disabled={isPending || !settings.enabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telegram-summary-interval">Summary interval in minutes</Label>
                  <div className="flex max-w-sm gap-2">
                    <Input
                      id="telegram-summary-interval"
                      type="number"
                      min={0}
                      max={1440}
                      step={15}
                      value={summaryInterval}
                      onChange={(event) => setSummaryInterval(event.target.value)}
                      disabled={isPending || !settings.enabled}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void handleUpdateSummary()}
                      disabled={isPending || !settings.enabled || summaryInterval.length === 0}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    clearError();
                    runMutation(disconnect());
                  }}
                  disabled={isPending}
                >
                  <Unplug className="mr-2 h-4 w-4" />
                  Disconnect Telegram
                </Button>
              </div>
            </div>
          )}

          {testSent && !error && (
            <p className="text-sm text-green-600 dark:text-green-400" aria-live="polite">
              Test update sent to Telegram.
            </p>
          )}
        </ExperimentToggleCard>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ExperimentToggleCard({
  id,
  title,
  description,
  enabled,
  disabled = false,
  onEnabledChange,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const switchId = `${id}-enabled`;
  const labelId = `${id}-label`;
  const contentId = `${id}-content`;

  return (
    <Card className={`overflow-hidden shadow-none transition-colors ${
      enabled ? 'border-primary/35' : 'border-border/70'
    }`}>
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <label id={labelId} htmlFor={switchId} className="font-medium text-foreground">
            {title}
          </label>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-controls={contentId}
          aria-expanded={enabled}
          className="shrink-0"
        />
      </div>

      {enabled && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={labelId}
          className="space-y-6 border-t border-border/70 bg-muted/10 p-4 animate-in fade-in slide-in-from-top-1 duration-200 sm:p-5"
        >
          {children}
        </div>
      )}
    </Card>
  );
}
