// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthGateway } from "../src/auth/AuthClient.js";
import { RecipeStudio } from "../src/ui/auth/RecipeStudio.js";

describe("RecipeStudio", () => {
  let root: HTMLElement;
  let gateway: AuthGateway;

  beforeEach(() => {
    root = document.createElement("section");
    document.body.replaceChildren(root);
    gateway = {
      recipes: vi.fn(async () => []),
      createRecipe: vi.fn(async () => ({ id: "owned-1", status: "DRAFT" })),
      updateRecipe: vi.fn(async () => ({ id: "owned-1", status: "DRAFT" })),
      validateRecipe: vi.fn(async () => ({ valid: true, issues: [] })),
      publishRecipe: vi.fn(async () => ({ id: "owned-1", status: "PUBLISHED" })),
      unpublishRecipe: vi.fn(async () => ({ id: "owned-1", status: "DRAFT" })),
      deleteRecipe: vi.fn(async () => undefined),
      createRecipeTestSession: vi.fn(async () => ({ recipeTestToken: "opaque-test-token", expiresAt: "2026-07-24T12:00:00Z" })),
      discoverRecipes: vi.fn(async () => [{
        id: "public-1", title: "Garden Soup", roundDurationMs: 180_000,
        ingredients: [{ kind: "CARROT", count: 1 }],
      }]),
      reportRecipe: vi.fn(async () => undefined),
    } as unknown as AuthGateway;
  });

  it("authors a structured bounded recipe and exposes lifecycle and discovery launch controls", async () => {
    const launch = vi.fn();
    new RecipeStudio(root, gateway, { onLaunch: launch }).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-recipe-studio]")).not.toBeNull());

    input("recipe-slug", "garden-soup");
    input("recipe-title", "Garden Soup");
    input("recipe-duration", "180");
    input("ingredient-carrot", "2");
    root.querySelector<HTMLButtonElement>("[data-studio-action=save]")!.click();
    await vi.waitFor(() => expect(gateway.createRecipe).toHaveBeenCalled());
    const document = vi.mocked(gateway.createRecipe).mock.calls[0]![0] as {
      id: string; ingredients: Array<{ kind: string; count: number }>; steps: Array<{ action: string }>;
    };
    expect(document).toMatchObject({
      id: "garden-soup",
      title: "Garden Soup",
      roundDurationMs: 180_000,
      ingredients: [{ id: "carrot", kind: "CARROT", count: 2 }],
    });
    expect(document.steps.map(({ action }) => action)).toEqual([
      "CHOP", "ADD_TO_POT", "SEASON", "BOIL", "MIX", "PLATE",
    ]);
    await vi.waitFor(() => expect(root.querySelector("[role=status]")?.textContent).toContain("Draft saved"));

    root.querySelector<HTMLButtonElement>("[data-studio-action=search]")!.click();
    await vi.waitFor(() => expect(root.querySelector("[data-discovery-results]")?.textContent).toContain("Garden Soup"));
    root.querySelector<HTMLButtonElement>("[data-launch-public=public-1]")!.click();
    expect(launch).toHaveBeenCalledWith({ recipeId: "public-1" }, "Garden Soup");
  });

  it("renders focusable field diagnostics and requires an explicit license", async () => {
    vi.mocked(gateway.validateRecipe).mockResolvedValue({
      valid: false,
      issues: [{ code: "invalid_format", path: "id", message: "Use a lowercase slug." }],
    });
    vi.mocked(gateway.recipes).mockResolvedValue([{
      id: "owned-1", title: "Draft", status: "DRAFT", updatedAt: "2026-07-24T10:00:00Z",
    }]);
    new RecipeStudio(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-owned-recipe=owned-1]")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-validate-recipe=owned-1]")!.click();
    await vi.waitFor(() => expect(root.querySelector("[role=alert] a")?.textContent).toContain("lowercase"));
    expect(root.querySelector("[role=alert] a")?.getAttribute("href")).toBe("#recipe-slug");

    root.querySelector<HTMLButtonElement>("[data-publish-recipe=owned-1]")!.click();
    expect(gateway.publishRecipe).not.toHaveBeenCalled();
    expect(root.querySelector("[role=alert]")?.textContent).toContain("license");
  });

  it("loads a draft into the structured editor and saves owner-scoped changes", async () => {
    vi.mocked(gateway.recipes).mockResolvedValue([{
      id: "owned-1",
      title: "Garden Soup",
      status: "DRAFT",
      document: {
        schemaVersion: 1,
        id: "garden-soup",
        title: "Garden Soup",
        roundDurationMs: 180_000,
        ingredients: [{ id: "carrot", kind: "CARROT", count: 2 }],
        steps: [],
      },
    }]);
    new RecipeStudio(root, gateway).mount();
    await vi.waitFor(() => expect(root.querySelector("[data-edit-recipe=owned-1]")).not.toBeNull());

    root.querySelector<HTMLButtonElement>("[data-edit-recipe=owned-1]")!.click();
    expect(root.querySelector<HTMLInputElement>("[name=recipeSlug]")!.value).toBe("garden-soup");
    expect(root.querySelector<HTMLInputElement>("[name=ingredient-carrot]")!.value).toBe("2");
    input("recipe-title", "Garden Soup Deluxe");
    root.querySelector<HTMLButtonElement>("[data-studio-action=save]")!.click();

    await vi.waitFor(() => expect(gateway.updateRecipe).toHaveBeenCalledWith(
      "owned-1",
      expect.objectContaining({ title: "Garden Soup Deluxe" }),
    ));
  });

  it("offers public discovery and launch without owner controls when signed out", async () => {
    const launch = vi.fn();
    new RecipeStudio(root, gateway, { onLaunch: launch, ownerAccess: false }).mount();
    expect(root.querySelector("[data-recipe-form]")).toBeNull();
    expect(root.querySelector("[data-owned-recipes]")).toBeNull();

    root.querySelector<HTMLButtonElement>("[data-studio-action=search]")!.click();
    await vi.waitFor(() => expect(root.querySelector("[data-discovery-results]")?.textContent).toContain("Garden Soup"));
    expect(root.querySelector("details")).toBeNull();
    root.querySelector<HTMLButtonElement>("[data-launch-public=public-1]")!.click();
    expect(launch).toHaveBeenCalledWith({ recipeId: "public-1" }, "Garden Soup");
  });

  function input(id: string, value: string): void {
    const field = root.querySelector<HTMLInputElement>(`#${id}`)!;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
