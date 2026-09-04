import { useEffect, useState } from 'react';

type UiConfig = {
  // Stored as HSL triplet string, e.g. '190 100% 45%'
  primaryColor: string;
  // Base64 data URL for custom logo, or '' for default
  customLogoDataUrl: string;
};

const STORAGE_KEY = 'sv2-ui-config';

export type HslTriplet = {
  h: number;
  s: number;
  l: number;
};

// Validates an HSL triplet string and returns its numeric components.
// Accepts any single-separator whitespace (space, tab, repeated spaces) and
// enforces the valid ranges, so validation and parsing can never disagree.
export function parseHslTriplet(input: unknown): HslTriplet | null {
  if (typeof input !== 'string') return null;
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  const h = Number(parts[0]);
  const s = Number(parts[1].replace(/%$/, ''));
  const l = Number(parts[2].replace(/%$/, ''));

  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  if (h < 0 || h > 360) return null;
  if (s < 0 || s > 100) return null;
  if (l < 0 || l > 100) return null;

  return { h, s, l };
}

// Validates that a stored value is an image data URL we can persist and render.
export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(value)
  );
}

export type LogoValidationResult = { ok: true } | { ok: false; error: string };

export const MAX_LOGO_FILE_SIZE = 1 * 1024 * 1024; // 1 MiB

// Validates an uploaded logo file at selection time. Rejects empty,
// oversized, or non-image files, and (where supported) tries to actually
// decode the image so renamed or corrupt files are caught before they are
// stored as a broken logo.
export async function validateLogoFile(
  file: File | null | undefined,
): Promise<LogoValidationResult> {
  if (!file) return { ok: false, error: 'No file selected.' };
  if (!(file.size > 0)) return { ok: false, error: 'The selected file is empty.' };
  if (file.size > MAX_LOGO_FILE_SIZE) {
    return {
      ok: false,
      error: `Logo file is too large. Maximum size is ${Math.round(MAX_LOGO_FILE_SIZE / 1024 / 1024)} MiB.`,
    };
  }
  if (typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    return { ok: false, error: 'Please choose an image file (PNG, JPG, SVG, or GIF).' };
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close?.();
    } catch {
      return { ok: false, error: 'The selected file is not a valid image.' };
    }
  }
  return { ok: true };
}

const DEFAULT_CONFIG: UiConfig = {
  // Cyan — matches --primary in index.css light mode
  primaryColor: '190 100% 45%',
  customLogoDataUrl: '',
};

const PRIMARY_FOREGROUND_LIGHTNESS_THRESHOLD = 60;
const LIGHT_PRIMARY_FOREGROUND = '0 0% 100%';
const DARK_PRIMARY_FOREGROUND = '0 0% 9%';

// Estimates the raw byte size of the binary payload in a base64 data URL.
// The prefix `data:image/...;base64,` is metadata only; the useful bytes are
// the base64-encoded part which decodes to roughly 3/4 of its length.
function encodedDataUrlSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl.length;
  const payload = dataUrl.slice(commaIndex + 1);
  return Math.floor((payload.length * 3) / 4);
}

function loadConfig(): UiConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<UiConfig>;
    const primaryColor = (() => {
      const hsl = parseHslTriplet(parsed.primaryColor);
      return hsl ? `${hsl.h} ${hsl.s}% ${hsl.l}%` : DEFAULT_CONFIG.primaryColor;
    })();

    return {
      primaryColor,
      customLogoDataUrl:
        isImageDataUrl(parsed.customLogoDataUrl) &&
        encodedDataUrlSize(parsed.customLogoDataUrl) <= MAX_LOGO_FILE_SIZE
          ? parsed.customLogoDataUrl
          : DEFAULT_CONFIG.customLogoDataUrl,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: UiConfig) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Quota exceeded or storage unavailable — silently degrade.
  }
}

function getPrimaryForeground(lightness: number): string {
  return lightness >= PRIMARY_FOREGROUND_LIGHTNESS_THRESHOLD
    ? DARK_PRIMARY_FOREGROUND
    : LIGHT_PRIMARY_FOREGROUND;
}

// Apply runtime CSS variable overrides based on config.
// Slightly boosts lightness for dark mode primary (+5% L) and
// keeps foreground text readable for user-selected accent colors.
function applyCssVariables(config: UiConfig) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const p = config.primaryColor;
  const hsl = parseHslTriplet(p);
  if (!hsl) return;

  // Parse HSL to compute a slightly lighter dark-mode variant
  const lDark = Math.min(hsl.l + 5, 100);
  const pDark = `${hsl.h} ${hsl.s}% ${lDark}%`;
  const primaryForeground = getPrimaryForeground(hsl.l);
  const primaryForegroundDark = getPrimaryForeground(lDark);

  // Override the CSS variables that carry the user-selected primary color.
  // Using !important-style inline styles on :root (inline > stylesheet)
  root.style.setProperty('--primary', p);
  root.style.setProperty('--primary-foreground', primaryForeground);
  root.style.setProperty('--ring', p);
  root.style.setProperty('--sidebar-primary', p);
  root.style.setProperty('--sidebar-primary-foreground', primaryForeground);
  root.style.setProperty('--sidebar-ring', p);
  root.style.setProperty('--chart-1', p);
  root.style.setProperty('--cyan-500', p);

  // For dark mode we inject a <style> that overrides .dark with the boosted lightness.
  // We key the element by id so we only ever have one.
  const styleId = 'sv2-primary-dark-override';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `.dark { --primary: ${pDark}; --primary-foreground: ${primaryForegroundDark}; --ring: ${pDark}; --sidebar-primary: ${pDark}; --sidebar-primary-foreground: ${primaryForegroundDark}; --sidebar-ring: ${pDark}; --chart-1: ${pDark}; --cyan-500: ${pDark}; }`;
}

// Convert an HSL triplet to a hex color string. Returns a safe fallback when
// the input is not a valid triplet so callers never render NaN-based colors.
export function hslToHex(hslTriplet: string): string {
  const hsl = parseHslTriplet(hslTriplet);
  if (!hsl) return '#000000';

  const { h, s, l } = hsl;
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (h >= 0 && h < 60) {
    rPrime = c; gPrime = x; bPrime = 0;
  } else if (h >= 60 && h < 120) {
    rPrime = x; gPrime = c; bPrime = 0;
  } else if (h >= 120 && h < 180) {
    rPrime = 0; gPrime = c; bPrime = x;
  } else if (h >= 180 && h < 240) {
    rPrime = 0; gPrime = x; bPrime = c;
  } else if (h >= 240 && h < 300) {
    rPrime = x; gPrime = 0; bPrime = c;
  } else {
    rPrime = c; gPrime = 0; bPrime = x;
  }

  const r = Math.round((rPrime + m) * 255);
  const g = Math.round((gPrime + m) * 255);
  const b = Math.round((bPrime + m) * 255);

  const toHex = (v: number) => v.toString(16).padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function useUiConfig() {
  const [config, setConfig] = useState<UiConfig>(() => loadConfig());

  useEffect(() => {
    applyCssVariables(config);
    saveConfig(config);
  }, [config]);

  const updateConfig = (partial: Partial<UiConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  };

  const resetConfig = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setConfig(DEFAULT_CONFIG);
  };

  return { config, updateConfig, resetConfig };
}
