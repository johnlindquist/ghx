// NOTE: If you update or add tests that demonstrate new command usage,
// please update the examples in src/index.ts yargs configuration accordingly.
import { test, expect } from "vitest";
import { execaCommand } from "execa";
import { RESULTS_SAVED_MARKER } from "../src/constants.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";

type SearchResult = {
  description: string;
  outputPath: string | null;
  output: string;
};

const runExample = async (
  description: string,
  command: string
): Promise<SearchResult> => {
  let outputPath: string | null = null;
  const cliCommand = `pnpm node ${join(process.cwd(), "dist/index.js")}`;

  console.log("\nRunning command:", command);

  const result = await execaCommand(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  console.log(JSON.stringify(result, null, 2));
  const output = result.stdout + result.stderr;
  console.log("Total output:", output);
  console.log("Looking for marker:", RESULTS_SAVED_MARKER);

  // Split by newlines (handling both LF and CRLF) and find the line with our marker
  const lines = output.split(/\r?\n/);
  const markerLine = lines.find((line) =>
    line.trim().startsWith(RESULTS_SAVED_MARKER)
  );

  if (markerLine) {
    outputPath = markerLine.trim().replace(RESULTS_SAVED_MARKER, "").trim();
    console.log("Found marker line:", markerLine);
  }

  console.log("Output path:", outputPath);

  return { description, outputPath, output };
};

test("Config paths and user messages match actual file locations", async () => {
  // Run a simple search that will trigger config creation and file output
  const result = await runExample(
    "Config path verification",
    `pnpm node dist/index.js --pipe "test" --limit 1`
  );

  // Get the user's home directory in a cross-platform way
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";

  // Expected paths based on conf package conventions
  const expectedConfigDir =
    process.platform === "darwin"
      ? `${homeDir}/Library/Preferences/johnlindquist/ghx-nodejs`
      : process.platform === "win32"
        ? `${homeDir}/AppData/Roaming/johnlindquist/ghx-nodejs`
        : `${homeDir}/.config/johnlindquist/ghx-nodejs`;

  const expectedConfigPath = `${expectedConfigDir}/config.json`;

  // Verify the output path is in the correct directory
  if (result.outputPath) {
    const outputDir = result.outputPath.substring(
      0,
      result.outputPath.lastIndexOf("/")
    );
    expect(outputDir).toBe(join(expectedConfigDir, "searches"));
  } else {
    throw new Error("No output path found in command result");
  }

  // Verify config.json exists in the correct location
  expect(() => readFileSync(expectedConfigPath)).not.toThrow();

  // Verify searches directory exists in the correct location
  const searchesDir = join(expectedConfigDir, "searches");
  expect(existsSync(searchesDir)).toBe(true);
}, 120000);
