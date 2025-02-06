import { test, expect, beforeAll } from "vitest";
import { execaCommand } from "execa";
import { RESULTS_SAVED_MARKER } from "../src/constants.ts";

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
  await execaCommand("pnpm build");
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
});

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
