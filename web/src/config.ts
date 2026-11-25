/** Runtime configuration sourced from Vite env vars (VITE_*). */
export interface AppConfig {
  userPoolId: string;
  userPoolClientId: string;
  /** Hosted UI domain without scheme. */
  cognitoDomain: string;
  /** API base URL without trailing slash. */
  apiUrl: string;
  redirectUrl: string;
}

type Env = Record<string, string | boolean | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required env var ${key}`);
  }
  return value.trim();
}

export function readConfig(env: Env, origin: string): AppConfig {
  const redirect = env["VITE_REDIRECT_URL"];
  return {
    userPoolId: required(env, "VITE_USER_POOL_ID"),
    userPoolClientId: required(env, "VITE_USER_POOL_CLIENT_ID"),
    cognitoDomain: required(env, "VITE_COGNITO_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    apiUrl: required(env, "VITE_API_URL").replace(/\/+$/, ""),
    redirectUrl: typeof redirect === "string" && redirect !== "" ? redirect : `${origin}/`,
  };
}
