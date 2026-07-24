// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, AccountPreferences, AuthGateway } from "../src/auth/AuthClient.js";
import { AuthPanel } from "../src/ui/auth/AuthPanel.js";

const ACCOUNT: Account = { username: "alice", displayName: "Alice" };
const PREFERENCES: AccountPreferences = {
  reducedMotion: false, highContrast: false, masterVolume: 100, voiceVolume: 100,
};

describe("AuthPanel", () => {
  let root: HTMLElement;
  let gateway: FakeAuthGateway;

  beforeEach(() => {
    root = document.createElement("section");
    document.body.replaceChildren(root);
    gateway = new FakeAuthGateway();
    vi.spyOn(Storage.prototype, "setItem");
  });

  it("restores an HttpOnly-cookie session and renders the account without exposing a token", async () => {
    gateway.restore.mockResolvedValue(ACCOUNT);
    const restored = vi.fn();
    new AuthPanel(root, gateway, { onRestoredAccount: restored }).mount();

    await vi.waitFor(() => expect(restored).toHaveBeenCalledWith(ACCOUNT));
    expect(root.querySelector("[data-authenticated-account]")?.textContent).toContain("Alice");
    expect(root.textContent).not.toMatch(/token|bearer|pk_session/i);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("validates sign-up fields before sending and supports registration", async () => {
    gateway.restore.mockResolvedValue(null);
    new AuthPanel(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-auth-form]")).not.toBeNull());
    fill("username", "ab");
    fill("displayName", "Alice");
    fill("password", "short");
    click("register");
    expect(gateway.register).not.toHaveBeenCalled();
    expect(root.querySelector("[role=alert]")?.textContent).toContain("3–32");

    fill("username", "alice");
    fill("password", "correct horse battery staple");
    click("register");
    await vi.waitFor(() => expect(gateway.register).toHaveBeenCalledWith({
      username: "alice", displayName: "Alice", password: "correct horse battery staple",
    }));
    expect(root.querySelector("[data-authenticated-account]")?.textContent).toContain("Alice");
  });

  it("keeps published recipe discovery available to signed-out guests", async () => {
    gateway.restore.mockResolvedValue(null);
    new AuthPanel(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-auth-form]")).not.toBeNull());
    expect(root.querySelector("[data-recipe-studio]")).not.toBeNull();
    expect(root.querySelector("[data-recipe-form]")).toBeNull();
  });

  it("uses a generic non-destructive sign-in error and disables controls while pending", async () => {
    gateway.restore.mockResolvedValue(null);
    gateway.login.mockRejectedValue(new Error("server detail must not render"));
    new AuthPanel(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-auth-form]")).not.toBeNull());
    fill("username", "alice");
    fill("password", "incorrect password value");
    click("login");
    expect(root.querySelectorAll("button:disabled").length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toBe("Unable to sign in. Check your details and try again."));
    expect(root.textContent).not.toContain("server detail must not render");
  });

  it("updates preferences, shows history, creates a recipe, and signs out", async () => {
    gateway.restore.mockResolvedValue(ACCOUNT);
    gateway.history.mockResolvedValue([{ id: "h1", outcome: "WON", finishedAt: "2026-07-22T12:00:00.000Z" }]);
    gateway.recipes.mockResolvedValue([]);
    new AuthPanel(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-preferences-form]")).not.toBeNull());
    const reducedMotion = root.querySelector<HTMLInputElement>("[name=reducedMotion]")!;
    const masterVolume = root.querySelector<HTMLInputElement>("[name=masterVolume]")!;
    reducedMotion.checked = true;
    masterVolume.value = "35";
    click("save-preferences");
    await vi.waitFor(() => expect(gateway.updatePreferences).toHaveBeenCalledWith({
      reducedMotion: true, highContrast: false, masterVolume: 35, voiceVolume: 100,
    }));
    expect(root.querySelector("[data-history]")?.textContent).toContain("WON");

    fill("recipeSlug", "test-soup");
    fill("recipeTitle", "Test Soup");
    fill("ingredient-tomato", "1");
    root.querySelector<HTMLButtonElement>("[data-studio-action=save]")!.click();
    await vi.waitFor(() => expect(gateway.createRecipe).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1, id: "test-soup", title: "Test Soup",
    })));
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>("[data-auth-action=logout]")!.disabled).toBe(false));

    click("logout");
    await vi.waitFor(() => expect(gateway.logout).toHaveBeenCalled());
    expect(root.querySelector("[data-auth-form]")).not.toBeNull();
  });

  function fill(name: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(`[name=${name}]`)!;
    input.value = value;
  }

  function click(action: string): void {
    root.querySelector<HTMLButtonElement>(`[data-auth-action=${action}]`)!.click();
  }
});

class FakeAuthGateway implements AuthGateway {
  restore = vi.fn(async (): Promise<Account | null> => null);
  register = vi.fn(async (): Promise<Account> => ACCOUNT);
  login = vi.fn(async (): Promise<Account> => ACCOUNT);
  logout = vi.fn(async (): Promise<void> => undefined);
  preferences = vi.fn(async (): Promise<AccountPreferences> => PREFERENCES);
  updatePreferences = vi.fn(async (preferences: AccountPreferences): Promise<AccountPreferences> => preferences);
  history = vi.fn(async (): Promise<Array<Record<string, unknown>>> => []);
  recipes = vi.fn(async (): Promise<Array<Record<string, unknown>>> => []);
  createRecipe = vi.fn(async (_document: unknown): Promise<Record<string, unknown>> => ({ id: "recipe-1" }));
  updateRecipe = vi.fn(async (_id: string, _document: unknown): Promise<Record<string, unknown>> => ({ id: "recipe-1" }));
  validateRecipe = vi.fn(async () => ({ valid: true, issues: [] }));
  publishRecipe = vi.fn(async () => ({ id: "recipe-1", status: "PUBLISHED" }));
  unpublishRecipe = vi.fn(async () => ({ id: "recipe-1", status: "DRAFT" }));
  deleteRecipe = vi.fn(async () => undefined);
  createRecipeTestSession = vi.fn(async () => ({ recipeTestToken: "token", expiresAt: "2026-07-24T12:00:00Z" }));
  discoverRecipes = vi.fn(async () => []);
  reportRecipe = vi.fn(async () => undefined);
}
