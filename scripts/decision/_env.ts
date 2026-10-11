// Side-effect module: load .env and refuse any database that is not local (the same guard as the seeds).
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";
