import { useEffect } from 'react';
import { Switch, Route, useLocation } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { UnifiedDashboard } from '@/pages/UnifiedDashboard';
import { Settings } from '@/pages/Settings';
import { Setup } from '@/pages/Setup';
import { FAQ } from '@/pages/FAQ';
import { LoginGate } from '@/components/auth/LoginGate';
import { BrandSplash } from '@/components/auth/BrandSplash';
import { useSetupStatus } from '@/hooks/useSetupStatus';

export { isRouteAuthorized } from '@/lib/routeAuth';
export type { Principal } from '@/lib/routeAuth';

function Router() {
  const [location, navigate] = useLocation();
  const { isLoading, isOrchestrated, needsSetup } = useSetupStatus();

  // Redirect to setup if needed (only when orchestration backend is present)
  useEffect(() => {
    if (!isLoading && isOrchestrated && needsSetup && location !== '/setup') {
      navigate('/setup');
    }
  }, [isLoading, isOrchestrated, needsSetup, location, navigate]);

  useEffect(() => {
    if (!isLoading && isOrchestrated && !needsSetup && location === '/setup') {
      navigate('/');
    }
  }, [isLoading, isOrchestrated, needsSetup, location, navigate]);

  if (isLoading) {
    return <BrandSplash message="Checking configuration..." />;
  }

  return (
    <Switch>
      <Route path="/">
        <UnifiedDashboard />
      </Route>
      <Route path="/setup">
        <Setup />
      </Route>
      <Route path="/settings">
        <Settings />
      </Route>
      <Route>
        <UnifiedDashboard />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Switch>
        {/* Public, non-sensitive route rendered outside the auth gate. */}
        <Route path="/faq">
          <FAQ />
        </Route>
        <Route>
          <LoginGate>
            <Router />
          </LoginGate>
        </Route>
      </Switch>
    </QueryClientProvider>
  );
}

export default App;
