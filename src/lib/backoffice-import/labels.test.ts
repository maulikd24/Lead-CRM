import { describe, expect, it } from "vitest";

import { errorLabel, failureLabel, kindLabel } from "./labels";

describe("labels", () => {
  it("every code the importer can emit has a plain-English label", () => {
    for (const code of ["NO_STRONG_ID", "INVALID_ROW", "DUPLICATE_KEY", "TOO_MANY_COLUMNS", "CUSTOMER_UNMATCHED", "CUSTOMER_AMBIGUOUS", "INVALID_ENTRY", "INVALID_IDENTIFIER", "TOO_MANY_ROWS", "ACCOUNT_OWNED_BY_OTHER_CUSTOMER", "REFERENCE_OWNED_BY_OTHER_ACCOUNT", "WRITE_FAILED"]) {
      expect(errorLabel(code)).not.toBe(code);
    }
    for (const code of ["EMPTY", "TOO_LARGE", "TOO_MANY_ROWS", "TOO_MANY_COLUMNS", "FIELD_TOO_LONG", "DUPLICATE_HEADER", "UNTERMINATED_QUOTE", "MISSING_COLUMN", "INTERNAL_ERROR"]) {
      expect(failureLabel(code)).not.toBe(code);
    }
  });
  it("unknown codes fall back to the code itself and kinds are labelled", () => {
    expect(errorLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(kindLabel("HOLDINGS")).toBe("Holdings");
  });
});
