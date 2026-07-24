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
  updateRecipe(id: string, document: unknown): Promise<Record<string, unknown>>;
  validateRecipe(id: string): Promise<RecipeDiagnostics>;
  publishRecipe(id: string, license: RecipeLicense): Promise<Record<string, unknown>>;
  unpublishRecipe(id: string): Promise<Record<string, unknown>>;
  deleteRecipe(id: string): Promise<void>;
  createRecipeTestSession(id: string): Promise<{ recipeTestToken: string; expiresAt: string }>;
  discoverRecipes(query?: string): Promise<Array<Record<string, unknown>>>;
  reportRecipe(id: string, input: { reason: RecipeReportReason; details: string }): Promise<void>;
}

export type RecipeLicense = "CC0_1_0" | "CC_BY_4_0";
export type RecipeReportReason =
  | "HATE_OR_HARASSMENT" | "SEXUAL_CONTENT" | "VIOLENCE" | "SPAM" | "COPYRIGHT" | "OTHER";
export interface RecipeDiagnostics {
  valid: boolean;
  issues: Array<{ code: string; path: string; message: string }>;
}

export class AuthClient implements AuthGateway {
  async restore(): Promise<Account | null> {
    const response = await this.request("/api/auth/session");
    return (response as { account: Account | null }).account;
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

  async updateRecipe(id: string, document: unknown): Promise<Record<string, unknown>> {
    const body = await this.request(`/api/account/recipes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { document },
    });
    return (body as { recipe: Record<string, unknown> }).recipe;
  }

  async validateRecipe(id: string): Promise<RecipeDiagnostics> {
    const body = await this.request(`/api/account/recipes/${encodeURIComponent(id)}/validate`, { method: "POST", body: {} });
    return (body as { diagnostics: RecipeDiagnostics }).diagnostics;
  }

  async publishRecipe(id: string, license: RecipeLicense): Promise<Record<string, unknown>> {
    const body = await this.request(`/api/account/recipes/${encodeURIComponent(id)}/publish`, {
      method: "POST", body: { license },
    });
    return (body as { recipe: Record<string, unknown> }).recipe;
  }

  async unpublishRecipe(id: string): Promise<Record<string, unknown>> {
    const body = await this.request(`/api/account/recipes/${encodeURIComponent(id)}/unpublish`, { method: "POST", body: {} });
    return (body as { recipe: Record<string, unknown> }).recipe;
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.request(`/api/account/recipes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async createRecipeTestSession(id: string): Promise<{ recipeTestToken: string; expiresAt: string }> {
    return await this.request(`/api/account/recipes/${encodeURIComponent(id)}/test-sessions`, {
      method: "POST", body: {},
    }) as { recipeTestToken: string; expiresAt: string };
  }

  async discoverRecipes(query = ""): Promise<Array<Record<string, unknown>>> {
    const body = await this.request(`/api/recipes?query=${encodeURIComponent(query.trim())}`);
    return (body as { recipes: Array<Record<string, unknown>> }).recipes;
  }

  async reportRecipe(id: string, input: { reason: RecipeReportReason; details: string }): Promise<void> {
    await this.request(`/api/recipes/${encodeURIComponent(id)}/reports`, { method: "POST", body: input });
  }

  private async request(
    path: string,
    options: { method?: "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
  ): Promise<unknown | null> {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "include",
      ...(options.body === undefined ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      }),
    });
    if (!response.ok) throw new Error(`Account request failed (${response.status})`);
    if (response.status === 204) return null;
    return response.json() as Promise<unknown>;
  }
}
