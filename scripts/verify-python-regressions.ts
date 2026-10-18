import { spawnSync } from "node:child_process";
import { ROOT_DIR, resolvePython } from "../server/lib/paths.ts";

const result = spawnSync(resolvePython().bin,
  ["-m", "unittest", "discover", "-s", "tests", "-p", "test_audio_analysis.py", "-v"],
  { cwd: ROOT_DIR, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
