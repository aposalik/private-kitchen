export interface Account {
  username: string;
  displayName: string;
}

export interface AccountPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  masterVolume: number;
  voiceVolume: number;
}

export interface AuthGateway {
  restore(): Promise<Account | null>;
  register(input: { username: string; displayName: string; password: string }): Promise<Account>;
  login(input: { username: string; password: string }): Promise<Account>;
  logout(): Promise<void>;
  preferences(): Promise<AccountPreferences>;
  updatePreferences(preferences: AccountPreferences): Promise<AccountPreferences>;
  history(): Promise<Array<Record<string, unknown>>>;
  recipes(): Promise<Array<Record<string, unknown>>>;
  createRecipe(document: unknown): Promise<Record<string, unknown>>;
}

export class AuthClient implements AuthGateway {
  async restore(): Promise<Account | null> {
    const response = await this.request("/api/auth/me", { allowUnauthorized: true });
    if (!response) return null;
    return (response as { account: Account }).account;
  }

  async register(input: { username: string; displayName: string; password: string }): Promise<Account> {
    const body = await this.request("/api/auth/register", { method: "POST", body: input });
    return (body as { account: Account }).account;
  }

  async login(input: { username: string; password: string }): Promise<Account> {
    const body = await this.request("/api/auth/login", { method: "POST", body: input });
    return (body as { account: Account }).account;
  }

  async logout(): Promise<void> {
    await this.request("/api/auth/logout", { method: "POST" });
  }

  async preferences(): Promise<AccountPreferences> {
    const body = await this.request("/api/account/preferences");
    return (body as { preferences: AccountPreferences }).preferences;
  }

  async updatePreferences(preferences: AccountPreferences): Promise<AccountPreferences> {
    const body = await this.request("/api/account/preferences", { method: "PATCH", body: preferences });
    return (body as { preferences: AccountPreferences }).preferences;
  }

  async history(): Promise<Array<Record<string, unknown>>> {
    const body = await this.request("/api/account/history");
    return (body as { history: Array<Record<string, unknown>> }).history;
  }

  async recipes(): Promise<Array<Record<string, unknown>>> {
    const body = await this.request("/api/account/recipes");
    return (body as { recipes: Array<Record<string, unknown>> }).recipes;
  }

  async createRecipe(document: unknown): Promise<Record<string, unknown>> {
    const body = await this.request("/api/account/recipes", { method: "POST", body: { document } });
    return (body as { recipe: Record<string, unknown> }).recipe;
  }

  private async request(
    path: string,
    options: { method?: "POST" | "PATCH"; body?: unknown; allowUnauthorized?: boolean } = {},
  ): Promise<unknown | null> {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "include",
      ...(options.body === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      }),
    });
    if (options.allowUnauthorized && response.status === 401) return null;
    if (!response.ok) throw new Error(`Account request failed (${response.status})`);
    if (response.status === 204) return null;
    return response.json() as Promise<unknown>;
  }
}
