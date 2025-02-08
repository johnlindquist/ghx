import { test, expect, beforeAll } from "vitest";
import { execaCommand } from "execa";
import { RESULTS_SAVED_MARKER } from "../src/constants.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");
const projectRoot = join(__dirname, "..");

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
  const cliCommand = `pnpm node ${join(projectRoot, "dist/index.js")}`;

  console.log("\nRunning command:", command);

  const result = await execaCommand(command, {
    cwd: projectRoot,
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

beforeAll(async () => {
  await execaCommand("pnpm build", { cwd: projectRoot });
});

test("TypeScript config search", async () => {
  const result = await runExample(
    "TypeScript config search",
    `pnpm node dist/index.js --filename tsconfig.json --pipe strict --limit 2`
  );
  console.log("Result:", { result });
  expect(result.outputPath).toBeTruthy();
});

test("React components in TypeScript", async () => {
  const result = await runExample(
    "React components in TypeScript",
    `pnpm node dist/index.js --language typescript --extension tsx --pipe "useState" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
}, 10000);

test("Search in React repo", async () => {
  const result = await runExample(
    "Search in React repo",
    `pnpm node dist/index.js --repo facebook/react --pipe "useState" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Complex search with multiple flags", async () => {
  const result = await runExample(
    "Complex search with multiple flags",
    `pnpm node dist/index.js --language typescript --repo facebook/react --pipe "hooks" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Dependencies search", async () => {
  const result = await runExample(
    "Dependencies search",
    `pnpm node dist/index.js --filename package.json --pipe "dependencies" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Large file search", async () => {
  const result = await runExample(
    "Large file search",
    `pnpm node dist/index.js --size >1000 --language typescript --pipe "class" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Path-specific search", async () => {
  const result = await runExample(
    "Path-specific search",
    `pnpm node dist/index.js --path src/components --extension tsx --pipe "Button" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Search with more context", async () => {
  const result = await runExample(
    "Search with more context",
    `pnpm node dist/index.js --context 50 --language typescript --pipe "interface" --limit 1`
  );
  expect(result.outputPath).toBeTruthy();
});

test("Version flag - development", async () => {
  const result = await runExample(
    "Version flag - development",
    `pnpm node dist/index.js --version`
  );
  expect(result.output).toMatch("0.0.0"); // Expect dev version
});

test("Version flag - simulated published", async () => {
  // Simulate published environment
  const packageJsonPath = join(projectRoot, "package.json");
  const originalPackageJson = readFileSync(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(originalPackageJson);
  packageJson.version = "1.2.3"; // Set a realistic version
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  const result = await runExample(
    "Version flag - simulated published",
    `pnpm node dist/index.js --version`
  );
  expect(result.output).toMatch("1.2.3"); // Expect the set version

  // Restore original package.json
  writeFileSync(packageJsonPath, originalPackageJson);
});

test("Help output shows correct command name", async () => {
  const result = await runExample(
    "Help output command name",
    `pnpm node dist/index.js --help`
  );

  // Should show 'ghx' in usage line
  expect(result.output).toContain("Usage: ghx [options]");

  // Should show 'ghx' in examples
  expect(result.output).toContain("ghx 'filename:tsconfig.json strict'");
  expect(result.output).toContain("ghx --repo facebook/react");
  expect(result.output).toContain("ghx --language typescript");

  // Should not contain 'index.js' in command examples
  expect(result.output).not.toContain("index.js '");
});
