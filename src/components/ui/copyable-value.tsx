import { useState, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

function copyWithSelectionFallback(text: string): boolean {
  const textArea = document.createElement('textarea');

  textArea.value = text;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.opacity = '0';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}

interface CopyableValueProps {
  value: string;
  className?: string;
}

export function CopyableValue({ value, className }: CopyableValueProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = copyWithSelectionFallback(value);
    }

    setCopyState(copied ? 'copied' : 'failed');

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => setCopyState('idle'), 2000);
  };

  const copyLabel =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy to clipboard';

  return (
    <div className={cn('flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm', className)}>
      <code className="min-w-0 flex-1 select-all break-all font-mono leading-relaxed text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-0.5 flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        title={copyLabel}
        aria-label={copyLabel}
        aria-live="polite"
      >
        {copyState === 'copied' ? (
          <Check className="h-4 w-4 text-green-500" aria-hidden="true" />
        ) : (
          <Copy
            className={cn('h-4 w-4', copyState === 'failed' && 'text-destructive')}
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  );
}
