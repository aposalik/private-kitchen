import tomatoSoupJson from "../recipes/tomato-soup.json" with { type: "json" };

import { recipeSchema } from "./schema.js";

export * from "./schema.js";
export * from "./validator.js";

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Value)[] ? readonly DeepReadonly<Value>[]
      : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const TOMATO_SOUP_RECIPE = deepFreeze(recipeSchema.parse(tomatoSoupJson));
