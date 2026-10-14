import { useEffect, useRef, useState } from 'react';
import { Miner3D, type MinerPhase } from './steps/Miner3D';
import { ThemeToggle, useTheme } from './OnboardingLayout';

// Scale the miner with the window, up to 1.6×, keeping it within ~85% of the width side-on and ~35% of the height
const fitZoom = () => typeof window === 'undefined'
  ? 1
  : Math.min(1.6, Math.max(0.9, Math.min(window.innerWidth / 360, window.innerHeight / 560)));

export function Welcome({ onStart }: { onStart: () => void }) {
  const { isDark, toggle } = useTheme();
  const [phase, setPhase] = useState<MinerPhase>('idle');
  const [zoom, setZoom] = useState(fitZoom);
  const [leaving, setLeaving] = useState(false);
  const startRef = useRef(onStart);
  startRef.current = onStart;

  const started = phase !== 'idle';

  // Ignition: spool-up, then push into the fan and fade to the next screen
  useEffect(() => {
    if (!started) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers = reduced
      ? [setTimeout(() => startRef.current(), 300)]
      : [
          setTimeout(() => setPhase('launch'), 1300),
          setTimeout(() => setLeaving(true), 1800),
          setTimeout(() => startRef.current(), 2100),
        ];
    return () => timers.forEach(clearTimeout);
  }, [started]);

  useEffect(() => {
    const onResize = () => setZoom(fitZoom());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      {/* zoom rather than transform: scale, so the 3D faces are drawn at full size and stay sharp.
          Thin lines wash out on white, so light mode darkens whatever the primary colour is. */}
      <div style={{ zoom, filter: isDark ? undefined : 'brightness(0.65)' }}>
        <Miner3D phase={phase} />
      </div>

      {/* ── Logo + copy + CTA ── */}
      <div
        className="relative z-10 w-full max-w-[440px] flex flex-col items-center animate-fade-in-up"
        style={{
          // Pulls the title up into the empty space the miner's box leaves below it
          marginTop: Math.round(-24 * zoom),
          animationDelay: '0.08s',
          // Holding the last frame would override the fade-out below
          animationFillMode: 'backwards',
          opacity: started ? 0 : undefined,
          transition: started ? 'opacity 0.5s ease 0.6s' : undefined,
        }}
      >
        <h1>
          <img
            src="/sv2-logo-240x40.png"
            srcSet="/sv2-logo-240x40.png 1x, /sv2-logo-480x80.png 2x"
            alt="Stratum V2"
            width="216"
            height="36"
            className="h-7 md:h-9 w-auto"
            style={isDark ? undefined : { filter: 'brightness(0.3)' }}
          />
        </h1>

        <p className="mt-3 text-sm md:text-base text-muted-foreground text-center text-balance">
          Mine more efficiently through a pool or solo with your own node, over encrypted connections, choosing which transactions go into a block.
        </p>

        <button
          type="button"
          onClick={() => setPhase('arming')}
          disabled={started}
          className="mt-8 h-11 px-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition font-medium"
        >
          Start
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
