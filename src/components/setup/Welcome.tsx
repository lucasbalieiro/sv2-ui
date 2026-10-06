import { useEffect, useRef, useState } from 'react';
import { Miner3D, type MinerPhase } from './steps/Miner3D';
import { ThemeToggle, useTheme } from './OnboardingLayout';

export function Welcome({ onStart }: { onStart: () => void }) {
  const { isDark, toggle } = useTheme();
  const [phase, setPhase] = useState<MinerPhase>('idle');
  const [leaving, setLeaving] = useState(false);
  const startRef = useRef(onStart);
  startRef.current = onStart;

  // Glow builds for 700 ms, then the screen fades out before moving on
  useEffect(() => {
    if (phase !== 'arming') return;
    const fade = setTimeout(() => setLeaving(true), 700);
    const next = setTimeout(() => startRef.current(), 1000);
    return () => {
      clearTimeout(fade);
      clearTimeout(next);
    };
  }, [phase]);

  const isArming = phase === 'arming';

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      <div className="absolute top-3 right-4 z-10"><ThemeToggle isDark={isDark} toggle={toggle} /></div>

      {/* Base ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 34%, hsl(var(--primary) / 0.08), transparent 36%), radial-gradient(circle at 50% 60%, hsl(var(--primary) / 0.04), transparent 55%)',
        }}
        aria-hidden
      />

      {/* ── Miner hero ── */}
      <Miner3D phase={phase} />

      {/* ── Logo + CTA ── */}
      <div
        className="relative z-10 w-full max-w-[440px] flex flex-col items-center gap-5 mt-3 animate-fade-in-up"
        style={{
          animationDelay: '0.08s',
          opacity: isArming ? 0 : undefined,
          transition: isArming ? 'opacity 0.5s ease' : undefined,
        }}
      >
        <img
          src="/sv2-logo-240x40.png"
          srcSet="/sv2-logo-240x40.png 1x, /sv2-logo-480x80.png 2x"
          alt="Stratum V2"
          width="144"
          height="24"
          className="h-5 w-auto"
          style={isDark ? undefined : { filter: 'brightness(0.3)' }}
        />

        <button
          type="button"
          onClick={() => setPhase('arming')}
          disabled={isArming}
          className="h-11 px-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors font-medium"
        >
          Start mining
        </button>
      </div>

      <div
        aria-hidden
        className="fixed inset-0 z-50 pointer-events-none bg-background transition-opacity duration-300"
        style={{ opacity: leaving ? 1 : 0 }}
      />
    </div>
  );
}
