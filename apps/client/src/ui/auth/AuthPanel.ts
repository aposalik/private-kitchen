import type { Account, AccountPreferences, AuthGateway } from "../../auth/AuthClient.js";

const DEFAULT_PREFERENCES: AccountPreferences = {
  reducedMotion: false,
  highContrast: false,
  masterVolume: 100,
  voiceVolume: 100,
};

export class AuthPanel {
  private account: Account | null = null;
  private pending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly gateway: AuthGateway,
    private readonly options: { onRestoredAccount?(account: Account): void } = {},
  ) {}

  mount(): void {
    this.root.replaceChildren(statusParagraph("Checking account…"));
    void this.gateway.restore().then(
      (account) => {
        if (!account) return this.renderSignedOut();
        this.options.onRestoredAccount?.(account);
        void this.renderAuthenticated(account);
      },
      () => this.renderSignedOut(),
    );
  }

  private renderSignedOut(): void {
    this.account = null;
    this.root.innerHTML = `
      <section class="account-panel" aria-labelledby="account-title">
        <div><p class="eyebrow">Optional account</p><h2 id="account-title">Save your kitchen</h2></div>
        <form data-auth-form novalidate>
          <label for="account-username">Username</label>
          <input id="account-username" name="username" minlength="3" maxlength="32" autocomplete="username" />
          <label for="account-display-name">Display name</label>
          <input id="account-display-name" name="displayName" maxlength="32" autocomplete="nickname" />
          <label for="account-password">Password</label>
          <input id="account-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="current-password" />
          <div class="actions">
            <button type="button" data-auth-action="register">Sign up</button>
            <button type="button" class="secondary" data-auth-action="login">Sign in</button>
          </div>
          <p class="error" role="alert" hidden></p>
        </form>
        <p class="account-note">Accounts are optional. Guest play remains available.</p>
      </section>`;
    this.button("register").addEventListener("click", () => void this.register());
    this.button("login").addEventListener("click", () => void this.login());
  }

  private async register(): Promise<void> {
    const username = this.input("username").value.trim();
    const displayName = this.input("displayName").value.trim();
    const password = this.input("password").value;
    if (!validUsername(username)) return this.showError("Username must be 3–32 letters, numbers, underscores, or hyphens.");
    if (displayName.length < 1 || displayName.length > 32) return this.showError("Display name must be 1–32 characters.");
    if (password.length < 12 || password.length > 128) return this.showError("Password must be 12–128 characters.");
    await this.authenticate(
      () => this.gateway.register({ username, displayName, password }),
      "Unable to sign up. Check your details and try again.",
    );
  }

  private async login(): Promise<void> {
    const username = this.input("username").value.trim();
    const password = this.input("password").value;
    if (!validUsername(username) || password.length < 12 || password.length > 128) {
      return this.showError("Unable to sign in. Check your details and try again.");
    }
    await this.authenticate(
      () => this.gateway.login({ username, password }),
      "Unable to sign in. Check your details and try again.",
    );
  }

  private async authenticate(action: () => Promise<Account>, errorMessage: string): Promise<void> {
    this.setPending(true);
    this.showError();
    try {
      await this.renderAuthenticated(await action());
    } catch {
      this.showError(errorMessage);
    } finally {
      this.setPending(false);
    }
  }

  private async renderAuthenticated(account: Account): Promise<void> {
    this.account = account;
    this.root.innerHTML = `
      <section class="account-panel" aria-labelledby="account-title">
        <div><p class="eyebrow">Signed in</p><h2 id="account-title" data-authenticated-account></h2></div>
        <button type="button" class="secondary" data-auth-action="logout">Sign out</button>
        <form data-preferences-form>
          <h3>Preferences</h3>
          <label><input type="checkbox" name="reducedMotion" /> Reduced motion</label>
          <label><input type="checkbox" name="highContrast" /> High contrast</label>
          <label for="master-volume">Master volume</label>
          <input id="master-volume" type="range" name="masterVolume" min="0" max="100" />
          <label for="voice-volume">Voice volume</label>
          <input id="voice-volume" type="range" name="voiceVolume" min="0" max="100" />
          <button type="button" data-auth-action="save-preferences">Save preferences</button>
        </form>
        <section><h3>Game history</h3><ul data-history></ul></section>
        <section><h3>Owned recipes</h3><ul data-owned-recipes></ul>
          <label for="recipe-document">Recipe JSON</label>
          <textarea id="recipe-document" name="recipeDocument" rows="5"></textarea>
          <button type="button" data-auth-action="create-recipe">Save recipe</button>
        </section>
        <p class="error" role="alert" hidden></p>
      </section>`;
    this.root.querySelector<HTMLElement>("[data-authenticated-account]")!.textContent = account.displayName;
    this.button("logout").addEventListener("click", () => void this.logout());
    this.button("save-preferences").addEventListener("click", () => void this.savePreferences());
    this.button("create-recipe").addEventListener("click", () => void this.createRecipe());
    try {
      const [preferences, history, recipes] = await Promise.all([
        this.gateway.preferences(), this.gateway.history(), this.gateway.recipes(),
      ]);
      if (this.account !== account) return;
      this.renderPreferences(preferences);
      this.renderHistory(history);
      this.renderRecipes(recipes);
    } catch {
      this.renderPreferences(DEFAULT_PREFERENCES);
      this.showError("Some account data could not be loaded.");
    }
  }

  private async logout(): Promise<void> {
    this.setPending(true);
    try {
      await this.gateway.logout();
      this.renderSignedOut();
    } catch {
      this.showError("Unable to sign out. Try again.");
    } finally {
      this.setPending(false);
    }
  }

  private async savePreferences(): Promise<void> {
    const preferences: AccountPreferences = {
      reducedMotion: this.checkbox("reducedMotion").checked,
      highContrast: this.checkbox("highContrast").checked,
      masterVolume: Number(this.input("masterVolume").value),
      voiceVolume: Number(this.input("voiceVolume").value),
    };
    this.setPending(true);
    try {
      this.renderPreferences(await this.gateway.updatePreferences(preferences));
      this.showError();
    } catch {
      this.showError("Unable to save preferences. Try again.");
    } finally {
      this.setPending(false);
    }
  }

  private async createRecipe(): Promise<void> {
    let document: unknown;
    try {
      document = JSON.parse(this.root.querySelector<HTMLTextAreaElement>("[name=recipeDocument]")!.value) as unknown;
    } catch {
      return this.showError("Recipe JSON is malformed.");
    }
    this.setPending(true);
    try {
      await this.gateway.createRecipe(document);
      this.renderRecipes(await this.gateway.recipes());
      this.showError();
    } catch {
      this.showError("Unable to save recipe. Check the recipe document.");
    } finally {
      this.setPending(false);
    }
  }

  private renderPreferences(preferences: AccountPreferences): void {
    this.checkbox("reducedMotion").checked = preferences.reducedMotion;
    this.checkbox("highContrast").checked = preferences.highContrast;
    this.input("masterVolume").value = String(preferences.masterVolume);
    this.input("voiceVolume").value = String(preferences.voiceVolume);
  }

  private renderHistory(history: Array<Record<string, unknown>>): void {
    const list = this.root.querySelector<HTMLElement>("[data-history]")!;
    list.replaceChildren(...history.map((row) => {
      const item = document.createElement("li");
      item.textContent = `${String(row.outcome ?? "Round")} · ${String(row.finishedAt ?? "")}`;
      return item;
    }));
  }

  private renderRecipes(recipes: Array<Record<string, unknown>>): void {
    const list = this.root.querySelector<HTMLElement>("[data-owned-recipes]")!;
    list.replaceChildren(...recipes.map((row) => {
      const item = document.createElement("li");
      item.textContent = String(row.title ?? "Untitled recipe");
      return item;
    }));
  }

  private setPending(pending: boolean): void {
    this.pending = pending;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("button")) button.disabled = pending;
  }

  private showError(message = ""): void {
    const element = this.root.querySelector<HTMLElement>("[role=alert]");
    if (!element) return;
    element.textContent = message;
    element.hidden = message.length === 0;
  }

  private input(name: string): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  }

  private checkbox(name: string): HTMLInputElement {
    return this.input(name);
  }

  private button(action: string): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>(`[data-auth-action=${action}]`)!;
  }
}

function validUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 32 && /^[A-Za-z0-9_-]+$/.test(username);
}

function statusParagraph(message: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  paragraph.setAttribute("aria-live", "polite");
  return paragraph;
}
