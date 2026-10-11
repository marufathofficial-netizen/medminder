const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message || `Request failed with status ${response.status}`,
    );
  }

  return data;
}

export async function loginUser(email: string, password: string) {
  return apiRequest<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
) {
  return apiRequest<{ accessToken: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
}

export async function getCurrentUser(token: string) {
  return apiRequest<{
    userId: string;
    email: string;
    role: string;
  }>("/users/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}