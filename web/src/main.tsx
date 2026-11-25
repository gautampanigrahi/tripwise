import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "aws-amplify/auth/enable-oauth-listener";
import { readConfig } from "./config";
import { configureAuth, getIdToken, signOutUser } from "./auth/amplify";
import { RequireAuth } from "./auth/RequireAuth";
import { createApiClient } from "./api/client";
import { ApiClientProvider } from "./api/ApiClientContext";
import { Link, matchRoute, rememberDeepLink, restoreDeepLink, usePathname } from "./router";
import { TripsPage } from "./pages/TripsPage";
import { TripPage } from "./pages/TripPage";
import { AcceptInvite } from "./pages/AcceptInvite";
import "./styles.css";

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
    <main>
      <header className="app-header">
        <h1>
          <Link to="/">TripWise</Link>
        </h1>
        <button type="button" onClick={() => void signOutUser()}>
          Sign out
        </button>
      </header>
      {route.name === "trips" && <TripsPage />}
      {/* key forces a fresh mount (and fresh fetch) when switching trips */}
      {route.name === "trip" && <TripPage key={route.tripId} tripId={route.tripId} />}
      {route.name === "acceptInvite" && <AcceptInvite inviteId={route.inviteId} />}
      {route.name === "notFound" && (
        <p>
          Page not found. <Link to="/">Go to your trips</Link>
        </p>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <RequireAuth>
      <ApiClientProvider client={apiClient}>
        <App />
      </ApiClientProvider>
    </RequireAuth>
  </StrictMode>,
);
