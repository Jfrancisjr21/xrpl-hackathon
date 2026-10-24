import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Run from apps/api, where the API keeps .env, wallets.json and state.json.
process.chdir(fileURLToPath(new URL("../../../../apps/api/", import.meta.url)));
config({ path: ".env" });