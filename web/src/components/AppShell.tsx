import { useState, type ReactNode } from "react";
import { signOutUser } from "../auth/amplify";
import { useCurrentUser } from "../auth/user";
import { Link } from "../router";
import { Avatar, Breadcrumbs, BreadcrumbsProvider, Button, LogoMark, LogOutIcon } from "../ui";

export interface AppShellProps {
  children: ReactNode;
  /** Injectable for tests; defaults to Amplify sign-out. */
  onSignOut?: () => Promise<void>;
}

/** Top bar (logo, current user, Sign out) and breadcrumbs above the routed page. */
export function AppShell({ children, onSignOut = signOutUser }: AppShellProps) {
  const user = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);
  // Show the email (falls back to the name); initials prefer the name when the token has one.
  const display = user?.email ?? user?.name ?? null;
  const avatarName = user?.name ?? display ?? "";

  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <BreadcrumbsProvider>
      <div className="app-shell">
        <a
          href="#main-content"
          className="skip-link"
          onClick={(e) => {
            // Move focus without changing the URL hash (the router reads the path).
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar__inner">
            <Link to="/" className="topbar__brand" aria-label="TripWise home">
              <LogoMark size={28} className="topbar__logo" />
              <span>TripWise</span>
            </Link>
            <div className="topbar__user">
              {display && (
                <>
                  <Avatar name={avatarName} colorKey={user?.userId ?? display} size="md" decorative />
                  <span className="topbar__email" title={user?.name ? `${user.name} (${display})` : display}>
                    {display}
                  </span>
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<LogOutIcon size={14} />}
                loading={signingOut}
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>
        <main id="main-content" className="app-main" tabIndex={-1}>
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </BreadcrumbsProvider>
  );
}
