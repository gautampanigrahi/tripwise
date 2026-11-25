import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
// Base tokens and primitives first, so co-located component stylesheets imported below override them.
import "./styles.css";
import "aws-amplify/auth/enable-oauth-listener";
import { readConfig } from "./config";
import { configureAuth, getIdToken } from "./auth/amplify";
import { RequireAuth } from "./auth/RequireAuth";
import { createApiClient } from "./api/client";
import { ApiClientProvider } from "./api/ApiClientContext";
import { Link, matchRoute, rememberDeepLink, restoreDeepLink, usePathname } from "./router";
import { TripsPage } from "./pages/TripsPage";
import { TripPage } from "./pages/TripPage";
import { AcceptInvite } from "./pages/AcceptInvite";
import { AppShell } from "./components/AppShell";
import { EmptyState, ToastProvider, useBreadcrumbs } from "./ui";

const config = readConfig(import.meta.env, window.location.origin);
configureAuth(config);
const apiClient = createApiClient({ baseUrl: config.apiUrl, getIdToken });
// Keep deep links (e.g. invitation accept links) across the Hosted UI sign-in redirect.
rememberDeepLink();

function App() {
  useEffect(() => {
    restoreDeepLink();
  }, []);
  const route = matchRoute(usePathname());
  return (
    <AppShell>
      {route.name === "trips" && <TripsPage />}
      {/* key forces a fresh mount (and fresh fetch) when switching trips */}
      {route.name === "trip" && <TripPage key={route.tripId} tripId={route.tripId} />}
      {route.name === "acceptInvite" && <AcceptInvite inviteId={route.inviteId} />}
      {route.name === "notFound" && <NotFound />}
    </AppShell>
  );
}

function NotFound() {
  useBreadcrumbs([{ label: "Not found" }]);
  return (
    <EmptyState
      title="Page not found"
      description="The link may be wrong or the page may have moved."
      action={
        <Link to="/" className="btn btn--primary btn--md">
          Go to your trips
        </Link>
      }
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <RequireAuth>
        <ApiClientProvider client={apiClient}>
          <App />
        </ApiClientProvider>
      </RequireAuth>
    </ToastProvider>
  </StrictMode>,
);
