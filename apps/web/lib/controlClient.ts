export async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    const isAuthRoute = url.startsWith("/api/auth/");
    if (response.status === 401 && !isAuthRoute && typeof window !== "undefined") {
      window.dispatchEvent(new Event("growing-trader-auth-required"));
    }
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}
