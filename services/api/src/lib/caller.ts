import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/** The authenticated caller, as stated by the verified Cognito ID token. */
export interface Caller {
  userId: string;
  email: string;
  emailVerified: boolean;
}

/** The part of the HTTP API event `getCaller` reads. Nothing outside the JWT claims is used. */
export type CallerEvent = Pick<APIGatewayProxyEventV2WithJWTAuthorizer, 'requestContext'>;

/**
 * The only way handlers learn who the caller is (Req 4.4). Reads the JWT claims that API Gateway
 * verified and ignores the body, query string, path, and headers, so a client-supplied user ID
 * can never become the caller.
 *
 * Throws when the `sub` claim is missing, which only happens if a route is not behind the JWT
 * authorizer. The request-logging wrapper maps that to a 500.
 */
export function getCaller(event: CallerEvent): Caller {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || sub === '') {
    throw new Error('Missing sub claim: route is not behind the JWT authorizer');
  }
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const verified = claims?.email_verified;
  return {
    userId: sub,
    email,
    emailVerified: email !== '' && (verified === true || verified === 'true'),
  };
}
