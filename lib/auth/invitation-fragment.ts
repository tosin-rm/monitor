export type InvitationTokens = {
  access_token: string;
  refresh_token: string;
};

export function invitationTokensFromHash(hash: string): InvitationTokens | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (params.get("type") !== "invite" || !accessToken || !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}
