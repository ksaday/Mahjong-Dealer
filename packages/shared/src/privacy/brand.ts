declare const brand: unique symbol;

/**
 * A phantom-branded type: `T` carrying a nominal tag `B`. Adds no runtime
 * representation — it exists purely so the type checker can refuse a value
 * where it does not belong (docs/14_Player_Privacy.md §6.1).
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
