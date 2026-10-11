/** Thrown by a data loader asked to answer a role the registry does not allow. Loaders fail closed: nothing is queried first. */
export class AccessDenied extends Error {
  constructor(readonly area: string) {
    super(`Access denied: ${area}`);
    this.name = "AccessDenied";
  }
}
