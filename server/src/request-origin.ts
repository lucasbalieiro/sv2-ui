const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export type OriginCheckInput = {
  method: string;
  origin: string | undefined;
  host: string | undefined;
  secFetchSite: string | undefined;
};

export function isSameOriginRequest(input: OriginCheckInput): boolean {
  if (!isStateChangingMethod(input.method)) return true;

  const site = input.secFetchSite?.toLowerCase();
  if (site) {
    return site === 'same-origin' || site === 'same-site' || site === 'none';
  }

  if (!input.origin) return true;

  const originHost = hostnameOf(input.origin);
  if (!originHost) return false;

  const hostHeader = input.host;
  if (!hostHeader) return false;
  const requestHost = hostnameOf(`http://${hostHeader}`);
  if (!requestHost) return false;

  if (originHost === requestHost) return true;

  return isLoopbackHostname(originHost) && isLoopbackHostname(requestHost);
}
