import { spawn } from "node:child_process";
import { RESULTS_SAVED_MARKER } from "./constants.js";

type SearchResult = {
	description: string;
	outputPath: string | null;
};

const splitCommand = (command: string) => {
	// Split by spaces but preserve quoted strings
	const args = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
	// Remove quotes from the arguments
	return args.map((arg) => arg.replace(/^['"]|['"]$/g, ""));
};

const runExample = async (
	description: string,
	command: string,
): Promise<SearchResult> => {
	console.log(`\n🚀 Testing: ${description}`);
	console.log(`Running: ${command}`);

	let outputPath: string | null = null;
	let output = "";

	return new Promise((resolve) => {
		const args = splitCommand(command);
		const cmd = args.shift() || "";
		const proc = spawn(cmd, args, { stdio: "pipe" });

		proc.stdout.on("data", (data) => {
			const chunk = data.toString();
			output += chunk;
			process.stdout.write(data);
		});

		proc.stderr.on("data", (data) => {
			process.stderr.write(data);
		});

		proc.on("close", (code) => {
			if (code === 0) {
				console.log("✅ Success!");
				// Parse output for the results path
				const match = output.match(
					new RegExp(`${RESULTS_SAVED_MARKER} (.+\\.md)`),
				);
				outputPath = match?.[1] ?? null;
			} else {
				console.error(`❌ Failed with code ${code}`);
			}
			resolve({ description, outputPath });
		});
	});
};

// Run examples sequentially
const runAll = async () => {
	const results: SearchResult[] = [];

	// Basic examples
	results.push(
		await runExample(
			"TypeScript config search",
			`pnpm node index.ts --filename tsconfig.json --pipe "strict"`,
		),
	);

	results.push(
		await runExample(
			"React components in TypeScript",
			`pnpm node index.ts --language typescript --extension tsx --pipe "useState"`,
		),
	);

	results.push(
		await runExample(
			"Search in React repo",
			`pnpm node index.ts --repo facebook/react --pipe "useState"`,
		),
	);

	// Combined flags
	results.push(
		await runExample(
			"Complex search with multiple flags",
			`pnpm node index.ts --language typescript --repo facebook/react --limit 100 --pipe "hooks"`,
		),
	);

	// Package.json searches
	results.push(
		await runExample(
			"Dependencies search",
			`pnpm node index.ts --filename package.json --pipe "dependencies"`,
		),
	);

	// Size-based search
	results.push(
		await runExample(
			"Large file search",
			`pnpm node index.ts --size >1000 --language typescript --pipe "class"`,
		),
	);

	// Path-based search
	results.push(
		await runExample(
			"Path-specific search",
			`pnpm node index.ts --path src/components --extension tsx --pipe "Button"`,
		),
	);

	// Context lines test
	results.push(
		await runExample(
			"Search with more context",
			`pnpm node index.ts --context 50 --language typescript --pipe "interface"`,
		),
	);

	// Show summary of all generated files
	console.log("\n📝 Summary of all search results:");
	console.log("-------------------------------------------");
	for (const result of results) {
		if (result.outputPath) {
			console.log(`${result.description}:`);
			console.log(`- ${result.outputPath}`);
			console.log();
		}
	}
};

runAll().catch(console.error);
