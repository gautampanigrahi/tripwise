import { Amplify } from "aws-amplify";
import type { KeyValueStorageInterface } from "aws-amplify/utils";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { fetchAuthSession, signInWithRedirect, signOut } from "aws-amplify/auth";
import type { AppConfig } from "../config";
import { currentInvitePath } from "../router";

/**
 * Token storage that lives only in memory (design: "keeps tokens in memory").
 * Tokens are lost on reload; the Hosted UI session cookie lets the user
 * sign back in without re-entering credentials.
 */
export class MemoryStorage implements KeyValueStorageInterface {
  private readonly items = new Map<string, string>();
  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }
  async getItem(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }
  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }
  async clear(): Promise<void> {
    this.items.clear();
  }
}

/** Configures Amplify Auth for the Cognito Hosted UI with Authorization Code + PKCE. */
export function configureAuth(config: AppConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: {
          oauth: {
            domain: config.cognitoDomain,
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [config.redirectUrl],
            redirectSignOut: [config.redirectUrl],
            // "code" = Authorization Code grant; Amplify always adds PKCE.
            responseType: "code",
          },
        },
      },
    },
  });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(new MemoryStorage());
}

/** Returns the current Cognito ID token, or null when there is no session. */
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export function signIn(): Promise<void> {
  // The invite path travels in the OAuth `state` parameter, which survives the Hosted UI
  // redirect. Session storage does not, so sign-in was returning to `/` and never accepting.
  const returnTo = currentInvitePath();
  return returnTo ? signInWithRedirect({ customState: returnTo }) : signInWithRedirect();
}

export function signOutUser(): Promise<void> {
  return signOut();
}
