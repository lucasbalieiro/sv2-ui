/**
 * Centred SV2 pulse used while the app resolves server-side state.
 * Shared between the auth gate and the router so both look identical.
 */
export function BrandSplash({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <div className="h-8 w-8 mx-auto rounded-lg bg-primary animate-pulse flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-sm">SV2</span>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
