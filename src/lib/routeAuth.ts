/**
 * Route authorization policy.
 *
 * Operational routes ('/', '/setup', '/settings') and any unknown route (which
 * falls back to the dashboard) require an authenticated principal. The FAQ is
 * non-sensitive and stays public.
 */

/** An authenticated principal. Null means "no authenticated visitor". */
export type Principal = { authenticated: true } | null;

/** Routes that expose no operational data or controls. */
export const PUBLIC_ROUTES = ['/faq'];

export function isRouteAuthorized(route: string, principal: Principal): boolean {
  if (PUBLIC_ROUTES.includes(route)) return true;
  return principal !== null && principal.authenticated === true;
}
