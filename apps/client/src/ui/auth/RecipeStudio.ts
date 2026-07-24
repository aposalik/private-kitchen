import type {
  AuthGateway,
  RecipeDiagnostics,
  RecipeLicense,
  RecipeReportReason,
} from "../../auth/AuthClient.js";

const INGREDIENTS = ["TOMATO", "ONION", "CARROT", "POTATO"] as const;

export interface RecipeLaunchSelection {
  recipeId?: string;
  recipeTestToken?: string;
}

export class RecipeStudio {
  private recipes: Array<Record<string, unknown>> = [];
  private editingId: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly gateway: AuthGateway,
    private readonly options: {
      onLaunch?(selection: RecipeLaunchSelection, title: string): void;
      ownerAccess?: boolean;
    } = {},
  ) {}

  mount(): void {
    this.root.innerHTML = `
      <section class="recipe-studio" data-recipe-studio aria-labelledby="recipe-studio-title">
        <p class="eyebrow">Recipe Studio</p>
        <h3 id="recipe-studio-title">Create a kitchen-ready recipe</h3>
        <form data-recipe-form novalidate>
          <label for="recipe-slug">Recipe slug</label>
          <input id="recipe-slug" name="recipeSlug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="garden-soup" />
          <label for="recipe-title">Title</label>
          <input id="recipe-title" name="recipeTitle" required maxlength="80" />
          <label for="recipe-duration">Round duration (seconds)</label>
          <input id="recipe-duration" name="recipeDuration" type="number" min="30" max="3600" value="300" inputmode="numeric" />
          <fieldset>
            <legend>Ingredient counts</legend>
            ${INGREDIENTS.map((kind) => `
              <label for="ingredient-${kind.toLowerCase()}">${label(kind)}</label>
              <input id="ingredient-${kind.toLowerCase()}" name="ingredient-${kind.toLowerCase()}" type="number" min="0" max="16" value="0" inputmode="numeric" />
            `).join("")}
          </fieldset>
          <p class="studio-help">Actions are safely generated in order: chop and add each selected ingredient, then season, boil, mix, and plate.</p>
          <button type="button" data-studio-action="save">Save draft</button>
        </form>
        <div class="studio-feedback" role="status" tabindex="-1"></div>
        <div class="studio-errors" role="alert" tabindex="-1" hidden></div>
        <section aria-labelledby="owned-recipes-title">
          <h4 id="owned-recipes-title">Your drafts and recipes</h4>
          <label for="recipe-license">Publication license</label>
          <select id="recipe-license" name="recipeLicense">
            <option value="">Choose a license</option>
            <option value="CC0_1_0">CC0 1.0</option>
            <option value="CC_BY_4_0">CC BY 4.0</option>
          </select>
          <ul data-owned-recipes></ul>
        </section>
        <section aria-labelledby="discover-recipes-title">
          <h4 id="discover-recipes-title">Discover published recipes</h4>
          <label for="recipe-search">Search recipes</label>
          <div class="actions">
            <input id="recipe-search" name="recipeSearch" maxlength="80" />
            <button type="button" data-studio-action="search">Search</button>
          </div>
          <p aria-live="polite" data-discovery-status></p>
          <ul data-discovery-results></ul>
        </section>
      </section>`;
    if (!this.hasOwnerAccess()) {
      this.root.querySelector("[data-recipe-form]")?.remove();
      this.root.querySelector("[data-owned-recipes]")?.closest("section")?.remove();
      this.root.querySelector<HTMLElement>(".eyebrow")!.textContent = "Community recipes";
      this.root.querySelector<HTMLElement>("#recipe-studio-title")!.textContent = "Discover a published recipe";
    }
    this.root.querySelector("[data-studio-action=save]")?.addEventListener("click", () => void this.save());
    this.root.querySelector("[data-studio-action=search]")!.addEventListener("click", () => void this.search());
    if (this.hasOwnerAccess()) void this.refreshOwned();
  }

  private async save(): Promise<void> {
    const document = this.buildDocument();
    if (!document) return;
    try {
      if (this.editingId) {
        await this.gateway.updateRecipe(this.editingId, document);
      } else {
        await this.gateway.createRecipe(document);
      }
      this.editingId = undefined;
      this.root.querySelector<HTMLButtonElement>("[data-studio-action=save]")!.textContent = "Save draft";
      await this.refreshOwned();
      this.status("Draft saved.");
    } catch {
      this.error("Unable to save this recipe. Review the fields and try again.");
    }
  }

  private buildDocument(): Record<string, unknown> | null {
    const slug = this.input("recipeSlug").value.trim();
    const title = this.input("recipeTitle").value.trim();
    const durationSeconds = Number(this.input("recipeDuration").value);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return this.error("Use a lowercase hyphenated recipe slug.", "recipe-slug");
    if (title.length < 1 || title.length > 80) return this.error("Enter a title up to 80 characters.", "recipe-title");
    if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 3_600) {
      return this.error("Duration must be between 30 and 3600 seconds.", "recipe-duration");
    }
    const ingredients = INGREDIENTS.flatMap((kind) => {
      const count = Number(this.input(`ingredient-${kind.toLowerCase()}`).value);
      return Number.isInteger(count) && count > 0 ? [{ id: kind.toLowerCase(), kind, count }] : [];
    });
    const total = ingredients.reduce((sum, ingredient) => sum + ingredient.count, 0);
    if (ingredients.length === 0 || total > 16) return this.error("Choose 1 to 16 total ingredient objects.", "ingredient-tomato");
    const chop = ingredients.map(({ id }) => ({ id: `chop-${id}`, action: "CHOP", ingredientId: id, dependsOn: [] }));
    const add = ingredients.map(({ id }) => ({
      id: `add-${id}`, action: "ADD_TO_POT", ingredientId: id, dependsOn: [`chop-${id}`],
    }));
    const addIds = add.map(({ id }) => id);
    const steps = [
      ...chop, ...add,
      { id: "season", action: "SEASON", dependsOn: addIds },
      { id: "boil", action: "BOIL", dependsOn: ["season"] },
      { id: "mix", action: "MIX", dependsOn: ["boil"] },
      { id: "plate", action: "PLATE", dependsOn: ["mix"] },
    ];
    this.clearError();
    return { schemaVersion: 1, id: slug, title, roundDurationMs: durationSeconds * 1_000, ingredients, steps };
  }

  private async refreshOwned(): Promise<void> {
    try {
      this.recipes = await this.gateway.recipes();
      this.renderOwned();
    } catch {
      this.error("Owned recipes could not be loaded.");
    }
  }

  private renderOwned(): void {
    const list = this.root.querySelector<HTMLUListElement>("[data-owned-recipes]")!;
    list.replaceChildren(...this.recipes.map((recipe) => {
      const id = String(recipe.id);
      const title = String(recipe.title ?? "Untitled recipe");
      const status = String(recipe.status ?? "DRAFT");
      const item = document.createElement("li");
      item.dataset.ownedRecipe = id;
      item.innerHTML = `<strong></strong><span class="recipe-status"></span><span class="recipe-updated"></span><div class="actions"></div>`;
      item.querySelector("strong")!.textContent = title;
      item.querySelector(".recipe-status")!.textContent = status;
      item.querySelector(".recipe-updated")!.textContent = String(recipe.updatedAt ?? "");
      const actions = item.querySelector<HTMLElement>(".actions")!;
      actions.append(
        this.action("Validate", "validateRecipe", id, () => void this.validate(id)),
        this.action("Private test", "privateTestRecipe", id, () => void this.privateTest(id, title)),
      );
      if (status === "PUBLISHED") {
        actions.append(this.action("Unpublish", "unpublishRecipe", id, () => void this.unpublish(id)));
      } else if (status === "DRAFT") {
        actions.append(
          this.action("Edit", "editRecipe", id, () => this.editDraft(recipe)),
          this.action("Publish", "publishRecipe", id, () => void this.publish(id)),
          this.action("Delete", "deleteRecipe", id, () => void this.remove(id)),
        );
      }
      return item;
    }));
  }

  private editDraft(recipe: Record<string, unknown>): void {
    const document = recipe.document as {
      id?: unknown;
      title?: unknown;
      roundDurationMs?: unknown;
      ingredients?: Array<{ kind?: unknown; count?: unknown }>;
    } | undefined;
    if (!document || !Array.isArray(document.ingredients)) {
      this.error("This draft could not be loaded into the editor.");
      return;
    }
    this.editingId = String(recipe.id);
    this.input("recipeSlug").value = String(document.id ?? "");
    this.input("recipeTitle").value = String(document.title ?? "");
    this.input("recipeDuration").value = String(Number(document.roundDurationMs ?? 0) / 1_000);
    for (const kind of INGREDIENTS) {
      this.input(`ingredient-${kind.toLowerCase()}`).value = "0";
    }
    for (const ingredient of document.ingredients) {
      const kind = String(ingredient.kind ?? "");
      if (INGREDIENTS.includes(kind as typeof INGREDIENTS[number])) {
        this.input(`ingredient-${kind.toLowerCase()}`).value = String(ingredient.count ?? 0);
      }
    }
    this.root.querySelector<HTMLButtonElement>("[data-studio-action=save]")!.textContent = "Save changes";
    this.input("recipeTitle").focus();
    this.status(`Editing ${String(recipe.title ?? "draft")}.`);
  }

  private async validate(id: string): Promise<void> {
    try {
      const diagnostics = await this.gateway.validateRecipe(id);
      if (diagnostics.valid) {
        this.clearError();
        this.status("Recipe is valid and kitchen-ready.");
      } else {
        this.renderDiagnostics(diagnostics);
      }
    } catch {
      this.error("Recipe validation could not be completed.");
    }
  }

  private async publish(id: string): Promise<void> {
    const license = this.root.querySelector<HTMLSelectElement>("[name=recipeLicense]")!.value as RecipeLicense | "";
    if (!license) return void this.error("Choose a license before publishing.", "recipe-license");
    try {
      await this.gateway.publishRecipe(id, license);
      await this.refreshOwned();
      this.status("Recipe published.");
    } catch {
      this.error("Recipe could not be published.");
    }
  }

  private async unpublish(id: string): Promise<void> {
    await this.gateway.unpublishRecipe(id);
    await this.refreshOwned();
    this.status("Recipe returned to draft.");
  }

  private async remove(id: string): Promise<void> {
    await this.gateway.deleteRecipe(id);
    await this.refreshOwned();
    this.status("Draft deleted.");
  }

  private async privateTest(id: string, title: string): Promise<void> {
    try {
      const result = await this.gateway.createRecipeTestSession(id);
      this.options.onLaunch?.({ recipeTestToken: result.recipeTestToken }, `${title} private test`);
      this.status("Private test selected. Create a room to consume the one-time token.");
    } catch {
      this.error("Private test could not be created.");
    }
  }

  private async search(): Promise<void> {
    const query = this.input("recipeSearch").value;
    const status = this.root.querySelector<HTMLElement>("[data-discovery-status]")!;
    status.textContent = "Searching…";
    try {
      const recipes = await this.gateway.discoverRecipes(query);
      const list = this.root.querySelector<HTMLUListElement>("[data-discovery-results]")!;
      list.replaceChildren(...recipes.map((recipe) => this.discoveryItem(recipe)));
      status.textContent = `${recipes.length} published recipe${recipes.length === 1 ? "" : "s"} found.`;
    } catch {
      status.textContent = "Discovery is unavailable.";
    }
  }

  private discoveryItem(recipe: Record<string, unknown>): HTMLLIElement {
    const id = String(recipe.id);
    const title = String(recipe.title ?? "Published recipe");
    const item = document.createElement("li");
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((entry) => {
          const value = entry as { kind?: unknown; count?: unknown };
          return `${String(value.count)} × ${label(String(value.kind))}`;
        }).join(", ")
      : "";
    item.innerHTML = `<strong></strong><p></p><div class="actions"></div>${
      this.hasOwnerAccess() ? "<details><summary>Report</summary></details>" : ""
    }`;
    item.querySelector("strong")!.textContent = title;
    item.querySelector("p")!.textContent = `${Math.ceil(Number(recipe.roundDurationMs ?? 0) / 60_000)} min · ${ingredients}`;
    item.querySelector(".actions")!.append(this.action("Launch", "launchPublic", id, () => {
      this.options.onLaunch?.({ recipeId: id }, title);
      this.status(`${title} selected. Create a room to launch it.`);
    }));
    const details = item.querySelector("details");
    if (!details) return item;
    details.insertAdjacentHTML("beforeend", `
      <label>Reason<select data-report-reason="${id}">
        <option value="SPAM">Spam</option><option value="COPYRIGHT">Copyright</option><option value="OTHER">Other</option>
      </select></label>
      <label>Details<textarea data-report-details="${id}" maxlength="500"></textarea></label>
      <button type="button" data-report-recipe="${id}">Send report</button>`);
    details.querySelector("button")!.addEventListener("click", () => void this.report(id));
    return item;
  }

  private async report(id: string): Promise<void> {
    const reason = this.root.querySelector<HTMLSelectElement>(`[data-report-reason="${id}"]`)!.value as RecipeReportReason;
    const details = this.root.querySelector<HTMLTextAreaElement>(`[data-report-details="${id}"]`)!.value.trim();
    if (details.length < 10) return void this.error("Report details must be at least 10 characters.");
    await this.gateway.reportRecipe(id, { reason, details });
    this.status("Report sent to moderators.");
  }

  private renderDiagnostics(diagnostics: RecipeDiagnostics): void {
    const alert = this.alert();
    alert.replaceChildren(...diagnostics.issues.map((issue) => {
      const link = document.createElement("a");
      link.href = `#${fieldForPath(issue.path)}`;
      link.textContent = issue.message;
      link.addEventListener("click", () => this.root.querySelector<HTMLElement>(link.getAttribute("href")!)?.focus());
      return link;
    }));
    alert.hidden = false;
    alert.focus();
  }

  private action(labelText: string, dataName: string, id: string, listener: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labelText;
    button.dataset[dataName] = id;
    button.addEventListener("click", listener);
    return button;
  }

  private status(message: string): void {
    const status = this.root.querySelector<HTMLElement>("[role=status]")!;
    status.textContent = message;
    status.focus();
    this.clearError();
  }

  private error(message: string, field?: string): null {
    const alert = this.alert();
    alert.replaceChildren();
    if (field) {
      const link = document.createElement("a");
      link.href = `#${field}`;
      link.textContent = message;
      alert.append(link);
    } else {
      alert.textContent = message;
    }
    alert.hidden = false;
    alert.focus();
    return null;
  }

  private clearError(): void {
    const alert = this.alert();
    alert.hidden = true;
    alert.replaceChildren();
  }

  private alert(): HTMLElement {
    return this.root.querySelector<HTMLElement>("[role=alert]")!;
  }

  private input(name: string): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  }

  private hasOwnerAccess(): boolean {
    return this.options.ownerAccess !== false;
  }
}

function label(value: string): string {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function fieldForPath(path: string): string {
  if (path === "id") return "recipe-slug";
  if (path === "title") return "recipe-title";
  if (path === "roundDurationMs") return "recipe-duration";
  return path.startsWith("ingredients") ? "ingredient-tomato" : "recipe-studio-title";
}
