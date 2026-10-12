const ERRORS: Record<string, string> = {
  NO_STRONG_ID: "No client code or PAN on the row",
  INVALID_ROW: "A value is missing or not valid",
  DUPLICATE_KEY: "The same record appears more than once",
  TOO_MANY_COLUMNS: "More values than the header has columns",
  CUSTOMER_UNMATCHED: "No client with that client code or PAN",
  CUSTOMER_AMBIGUOUS: "The identifiers point at different clients",
  INVALID_ENTRY: "The row could not be read",
  INVALID_IDENTIFIER: "A client code, PAN, mobile or email is malformed",
  TOO_MANY_ROWS: "Too many rows for one client",
  ACCOUNT_OWNED_BY_OTHER_CUSTOMER: "That account number already belongs to another client",
  REFERENCE_OWNED_BY_OTHER_ACCOUNT: "That reference already belongs to another account",
  WRITE_FAILED: "The row could not be saved",
};
const FAILURES: Record<string, string> = {
  EMPTY: "The file is empty",
  TOO_LARGE: "The file is too large",
  TOO_MANY_ROWS: "The file has too many rows",
  TOO_MANY_COLUMNS: "The file has too many columns",
  FIELD_TOO_LONG: "A value in the file is too long",
  DUPLICATE_HEADER: "The header row repeats or leaves out a column name",
  UNTERMINATED_QUOTE: "A quoted value is never closed",
  MISSING_COLUMN: "A column the mapping needs is missing from the file",
  INTERNAL_ERROR: "Something went wrong on our side. Nothing was lost; try again",
};
const KINDS: Record<string, string> = { CLIENTS: "Client master", HOLDINGS: "Holdings", TRANSACTIONS: "Transactions" };

export const errorLabel = (code: string) => ERRORS[code] ?? code;
export const failureLabel = (code: string) => FAILURES[code] ?? code;
export const kindLabel = (kind: string) => KINDS[kind] ?? kind;
