import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderRelationshipsDoc } from "../../src/lib/relationships/docs";

// Regenerates docs/customer-relationships.md from the relationship registry. Run: npm run relationships:docs
const file = join(process.cwd(), "docs", "customer-relationships.md");
writeFileSync(file, renderRelationshipsDoc());
console.log(`wrote ${file}`);
