// Side-effect module: import it right after "dotenv/config" so it evaluates before any other import.
import { assertLocalDatabase } from "./local-db-guard";

assertLocalDatabase(process.env.DATABASE_URL);
