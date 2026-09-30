import { useLayoutEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import type { ContainerLogLine } from '@/types/log-diagnostics';
import { cn } from '@/lib/utils';

// Full retained history is exported by a dedicated server endpoint that
// streams formatted text with a hard byte cap, so the browser never
// materializes a JSON object graph of the whole log history. The link is
// followed as a normal navigation: the browser streams the body straight to
// disk under the server's content-disposition name, with no client-side
// timeout that could abort a large export on a slow link and no second full
// copy of it in the JS heap.
export const LOG_DOWNLOAD_PATH = '/api/logs/download';

interface ContainerLogsPanelProps {
  lines: ContainerLogLine[];
  isLoading: boolean;
  isJdMode: boolean;
}

function getLogColorClass(line: ContainerLogLine) {
  if (line.stream === 'stderr') return 'text-red-400';
  const msg = line.message.toUpperCase();
  if (msg.includes('ERROR ') || msg.includes('FATAL ') || msg.includes('EXCEPTION') || msg.includes('LEVEL=ERROR')) {
    return 'text-red-400';
  }
  if (msg.includes('WARN ') || msg.includes('LEVEL=WARN')) {
    return 'text-yellow-400';
  }
  return 'text-green-300/90';
}

export function ContainerLogsPanel({ lines, isLoading, isJdMode }: ContainerLogsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // While paused, render a frozen snapshot so the user can read/scroll back
  // without new lines shifting the view.
  const [pausedLines, setPausedLines] = useState<ContainerLogLine[] | null>(null);
  const isPaused = pausedLines !== null;
  const visibleLines = pausedLines ?? lines;
  // Only a pause caused by scrolling is undone by scrolling back down;
  // a pause from the button waits for Resume.
  const pausedByScroll = useRef(false);

  const togglePause = () => {
    pausedByScroll.current = false;
    setPausedLines(isPaused ? null : lines);
  };

  // Scrolling up pauses; scrolling back to the very bottom resumes.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (!isPaused && distanceFromBottom > 40) {
      pausedByScroll.current = true;
      setPausedLines(lines);
    } else if (isPaused && pausedByScroll.current && distanceFromBottom < 2) {
      setPausedLines(null);
    }
  };

  // Follow the latest lines while live (also jumps to the end on resume).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && !isPaused) el.scrollTop = el.scrollHeight;
  }, [visibleLines, isPaused]);

  if (isLoading && visibleLines.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center rounded-md bg-black/80 text-zinc-500 text-xs font-mono">
        Loading logs…
      </div>
    );
  }

  if (visibleLines.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center rounded-md bg-black/80 text-zinc-500 text-xs font-mono">
        No log output yet. Services may not be running.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={togglePause}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-muted/40',
            isPaused ? 'text-amber-700 dark:text-yellow-400' : 'text-muted-foreground hover:text-foreground'
          )}
          title={isPaused ? 'Resume live logs and jump to latest' : 'Pause auto-scroll'}
        >
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <a
          href={LOG_DOWNLOAD_PATH}
          download
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Download logs as .txt"
        >
          <Download className="h-3.5 w-3.5" />
          Download logs
        </a>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[70vh] min-h-72 overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed"
      >
        {visibleLines.map((line, i) => (
          <div
            key={`${line.container}-${line.timestamp ?? ''}-${i}`}
            className={cn(
              'flex gap-2 min-w-0 py-px',
              getLogColorClass(line)
            )}
          >
            {line.timestamp && (
              <span className="shrink-0 text-zinc-500 select-none">
                {new Date(line.timestamp).toLocaleTimeString()}
              </span>
            )}
            {isJdMode && (
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-[10px] font-semibold leading-[1.6] select-none',
                  line.container === 'translator'
                    ? 'bg-cyan-900/60 text-cyan-300'
                    : 'bg-purple-900/60 text-purple-300'
                )}
              >
                {line.container}
              </span>
            )}
            <span className="break-all">{line.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
