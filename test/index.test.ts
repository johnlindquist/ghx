// NOTE: If you update or add tests that demonstrate new command usage,
// please update the examples in src/index.ts yargs configuration accordingly.
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
}, 60000);

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

  // Should show 'ghx' in some current examples
  expect(result.output).toContain("ghx 'useState'"); // Simple query example
  expect(result.output).toContain("ghx --repo facebook/react \"useState\""); // Repo example
  expect(result.output).toContain("ghx -l typescript -e tsx \"useState\""); // Language/extension example
  expect(result.output).toContain('ghx -l javascript "const OR let"'); // OR example

  // Should not contain 'index.js' in command examples
  expect(result.output).not.toContain("index.js '");
});

test("Search with multiple terms", async () => {
  const result = await runExample(
    "Search with multiple terms",
    `pnpm node dist/index.js --language typescript --pipe \"async function\" --limit 1`
  );
  // Expect the output to *not* contain the old ** highlighting
  expect(result.output).not.toContain("**async**");
  expect(result.output).not.toContain("**function**");
  // Expect the output to contain the terms without highlighting
  expect(result.output).toContain("async function");
  expect(result.outputPath).toBeTruthy();
});

test("Search multiple separate terms (implicit AND)", async () => {
  const result = await runExample(
    "Search multiple separate terms",
    `pnpm node dist/index.js --language typescript --pipe "import test" --limit 1` // GitHub implicitly ANDs these
  );
  // Expect results containing both terms *without* highlighting
  expect(result.output).not.toContain("**import**");
  expect(result.output).toContain("import");
  expect(result.output).not.toContain("**test**");
  expect(result.output).toContain("test");
  expect(result.outputPath).toBeTruthy();
});

test("Search with OR operator", async () => {
  const result = await runExample(
    "Search with OR operator",
    `pnpm node dist/index.js --language javascript --pipe "const OR let" --limit 1`
  );
  // Expect results containing either term *without* highlighting
  expect(result.output).not.toMatch(/\*\*const\*\*/);
  expect(result.output).not.toMatch(/\*\*let\*\*/);
  expect(result.output).toMatch(/(const|let)/);
  expect(result.outputPath).toBeTruthy();
});

test("Search with NOT operator", async () => {
  const result = await runExample(
    "Search with NOT operator",
    `pnpm node dist/index.js --repo microsoft/vscode --language css --pipe "color NOT background-color" --limit 1`
  );
  // Expect results containing 'color' *without* highlighting, and not 'background-color'
  expect(result.output).not.toContain("**color**");
  expect(result.output).toContain("color");
  expect(result.output).not.toContain("background-color");
  expect(result.outputPath).toBeTruthy();
}, 60000); // Increase timeout as it might be a broader search initially

test.skip("Supports --limit up to 200 results", async () => {
  // Using a broad query (in TypeScript files) expected to yield many results.
  const result = await runExample(
    "Limit flag up to 200",
    `pnpm node dist/index.js --language typescript --pipe "function" --limit 200`
  );
  // Count the number of result headings.
  // In our CLI, each result starts with a markdown heading like "### [<repo name>](<repo url>)"
  const matches = result.output.match(/### \[/g);
  const count = matches ? matches.length : 0;

  // Verify that more than 100 results were processed.
  // (If the CLI properly paginates, it will fetch multiple pages when --limit is greater than 100.)
  expect(count).toBeGreaterThan(100);
}, 120000); // Increase timeout to 120 seconds
