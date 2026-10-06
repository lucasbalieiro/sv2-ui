import type { MiningMode, SetupMode } from '@sv2-ui/shared';
import type { StepProps } from '../types';

function Option({
  title,
  description,
  footer,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  footer?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col items-start rounded-xl border bg-card p-5 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        selected
          ? 'border-primary/55 bg-primary/[0.05]'
          : 'border-border hover:border-primary/45 hover:bg-primary/[0.03]'
      }`}
      style={
        selected
          ? { boxShadow: '0 0 30px hsl(var(--primary) / 0.12), inset 0 0 0 1px hsl(var(--primary) / 0.14)' }
          : undefined
      }
    >
      <div className="text-foreground font-medium text-sm mb-1">{title}</div>
      <div className="text-muted-foreground text-xs leading-relaxed">{description}</div>
      {footer && <div className="mt-auto pt-3 text-xs text-muted-foreground font-mono">{footer}</div>}
    </button>
  );
}

export function MiningModeSelection({ data, updateData, onNext }: StepProps) {
  const isSoloMode = data.miningMode === 'solo';

  const selectMiningMode = (miningMode: MiningMode) => {
    if (miningMode === data.miningMode) return;
    updateData({ miningMode, mode: null, pool: null, fallbackPools: [], bitcoin: null, jdc: null, translator: null });
  };

  const selectMode = (mode: SetupMode) => {
    const isSovereignSolo = isSoloMode && mode === 'jd';
    updateData({
      mode,
      pool: isSovereignSolo ? null : data.pool,
      fallbackPools: isSovereignSolo ? [] : data.fallbackPools,
      bitcoin: mode === 'jd' ? data.bitcoin : null,
      jdc: mode === 'jd' ? data.jdc : null,
    });
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Choose how you'll mine bitcoin</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Option
          title="Solo"
          description="Full block reward"
          selected={data.miningMode === 'solo'}
          onSelect={() => selectMiningMode('solo')}
        />
        <Option
          title="Pool"
          description="Regular payouts"
          selected={data.miningMode === 'pool'}
          onSelect={() => selectMiningMode('pool')}
        />
      </div>

      {data.miningMode && (
        <div key={data.miningMode} className="space-y-4 animate-fade-in-up">
          <div className="text-center">
            <h3 className="text-lg font-medium">Choose who creates your block templates</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Bitcoin Core IPC currently supports Linux and macOS. Windows is not supported yet.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Option
              title={isSoloMode ? 'Sovereign Solo' : 'Custom Templates'}
              description={isSoloMode
                ? 'Create your own block templates locally with Bitcoin Core. No solo pool required.'
                : 'Create your own block templates locally, using your Bitcoin node.'}
              footer="Requires: Fully synchronized Bitcoin node on Linux or macOS"
              selected={data.mode === 'jd'}
              onSelect={() => selectMode('jd')}
            />
            <Option
              title={isSoloMode ? 'Solo Pool' : 'Pool Templates'}
              description={isSoloMode
                ? 'Connect to a solo pool that provides templates and handles payouts to your address.'
                : 'Use templates provided by the pool. Simpler setup without running a node.'}
              footer={isSoloMode ? 'Simpler setup with a solo pool' : 'Simpler setup'}
              selected={data.mode === 'no-jd'}
              onSelect={() => selectMode('no-jd')}
            />
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onNext}
          disabled={!data.mode}
          className="h-11 px-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
