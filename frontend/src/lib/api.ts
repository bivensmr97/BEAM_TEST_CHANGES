const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface MeResponse {
  id: string;
  email: string;
  tenant_id: string;
  role: "admin" | "user";
  ai_enabled: boolean;
}

export interface FileItem {
  id: string;
  original_name: string;
  uploaded_at: string;
  status: string;
  size_bytes: number | null;
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- AUTH ---

export async function apiLogin(
  email: string,
  password: string
): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleJson<TokenResponse>(res);
}

export async function apiRegister(
  email: string,
  password: string,
  tenant_name: string
): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      tenant_name,
    }),
  });
  return handleJson<TokenResponse>(res);
}

export async function apiRefresh(
  refresh_token: string
): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  return handleJson<TokenResponse>(res);
}

export async function apiMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return handleJson<MeResponse>(res);
}

// --- FILES ---

export async function apiListFiles(
  accessToken: string
): Promise<FileItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/files/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return handleJson<FileItem[]>(res);
}

export async function apiUploadFile(
  accessToken: string,
  file: File
): Promise<FileItem> {
  const formData = new FormData();
  formData.append("uploaded_file", file);

  const res = await fetch(`${API_BASE_URL}/api/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  return handleJson<FileItem>(res);
}
