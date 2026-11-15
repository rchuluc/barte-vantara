export function tenantNotFoundRedirectUrl(): string | undefined {
  const value = process.env.TENANT_NOT_FOUND_REDIRECT_URL?.trim();

  if (!value) return undefined;

  const url = new URL(value);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "TENANT_NOT_FOUND_REDIRECT_URL must be an absolute HTTP(S) URL without credentials",
    );
  }

  return url.toString();
}
