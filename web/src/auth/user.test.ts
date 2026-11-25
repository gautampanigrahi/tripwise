import { describe, expect, it } from "vitest";
import { decodeJwtPayload, userFromIdToken } from "./user";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const token = (claims: object) => `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(claims))}.sig`;

describe("decodeJwtPayload", () => {
  it("decodes base64url JSON including non-ASCII text", () => {
    expect(decodeJwtPayload(token({ sub: "u1", name: "Zoë Ünal" }))).toEqual({ sub: "u1", name: "Zoë Ünal" });
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.%%%.c")).toBeNull();
    expect(decodeJwtPayload(`a.${b64url("[1,2]")}.c`)).toBeNull();
  });
});

describe("userFromIdToken", () => {
  it("reads sub, email, and name", () => {
    expect(userFromIdToken(token({ sub: "u1", email: "ada@example.com", name: "Ada" }))).toEqual({
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("builds the name from given and family names, else null", () => {
    expect(userFromIdToken(token({ sub: "u1", given_name: "Ada", family_name: "Lovelace" }))?.name).toBe(
      "Ada Lovelace",
    );
    expect(userFromIdToken(token({ sub: "u1", email: "a@b.co" }))?.name).toBeNull();
  });
});
