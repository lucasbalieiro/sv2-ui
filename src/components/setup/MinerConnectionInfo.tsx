import { TRANSLATOR_PORT, JDC_PORT, JDC_AUTHORITY_PUBLIC_KEY } from '@/lib/ports';
import { useHostEnv } from '@/hooks/useHostEnv';
import { InfoPopover } from '@/components/ui/info-popover';
import { CopyableValue } from '@/components/ui/copyable-value';

function HostHint() {
  return (
    <InfoPopover ariaLabel="Local network IP help">
      Replace{' '}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
        &lt;your-machine-ip&gt;
      </code>{' '}
      with your local network IP (for example,{' '}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
        192.168.1.100
      </code>
      ).
    </InfoPopover>
  );
}

interface MinerConnectionInfoProps {
  isJdMode: boolean;
  centered?: boolean;
}

export function MinerConnectionInfo({ isJdMode, centered = false }: MinerConnectionInfoProps) {
  const { stratumHost } = useHostEnv();
  const host = stratumHost ?? '<your-machine-ip>';
  const translatorUrl = `stratum+tcp://${host}:${TRANSLATOR_PORT}`;
  const jdcUrl = `stratum2+tcp://${host}:${JDC_PORT}/${JDC_AUTHORITY_PUBLIC_KEY}`;

  // When only one card is shown (SV1-only mode) it should stretch to full width.
  // In JD mode two cards sit side-by-side on md+ screens.
  const wrapperClass = centered
    ? 'flex flex-wrap justify-center gap-3'
    : isJdMode
      ? 'grid gap-3 md:grid-cols-2'
      : 'grid gap-3';

  return (
    <div className={wrapperClass}>
      <div className={`p-4 rounded-xl border border-border bg-card space-y-2${centered ? ' w-full max-w-sm' : ''}`}>
        <div className="flex items-center gap-1.5">
          <div className="font-semibold text-sm">SV1 Firmware</div>
          {!stratumHost && <HostHint />}
        </div>
        <CopyableValue value={translatorUrl} />
      </div>

      {isJdMode && (
        <div className={`p-4 rounded-xl border border-border bg-card space-y-2${centered ? ' w-full max-w-sm' : ''}`}>
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-sm">SV2 Firmware</div>
            {!stratumHost && <HostHint />}
          </div>
          <CopyableValue value={jdcUrl} />
        </div>
      )}
    </div>
  );
}
