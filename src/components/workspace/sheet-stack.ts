/** Layered drawers: which open sheets sit under a newer one. Pure, so the layering rule is tested without a DOM. */
export const pushSheet = (stack: readonly string[], name: string): string[] => (stack.includes(name) ? [...stack] : [...stack, name]);
export const popSheet = (stack: readonly string[], name: string): string[] => stack.filter((n) => n !== name);
/** A sheet is covered when another sheet opened after it is still open. */
export const isCovered = (stack: readonly string[], name: string): boolean => {
  const i = stack.indexOf(name);
  return i >= 0 && i < stack.length - 1;
};
