#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import { format } from "date-fns";
import { join } from "node:path";
import { mkdirp } from "mkdirp";
import { writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import fetch from "node-fetch";
import Conf from "conf";
import envPaths from "env-paths";

const config = new Conf({
	projectName: "ghx",
});

// Get the config path for the current platform
const configPath = envPaths("ghx").config;
const searchesPath = join(configPath, "searches");

type EditorConfig = {
	command: string | null;
	skipEditor: boolean;
};

async function getEditorCommand(): Promise<EditorConfig> {
	const savedConfig = config.get("editor") as EditorConfig | undefined;

	if (savedConfig) return savedConfig;

	const useEditor = await p.confirm({
		message: "Would you like to open results in an editor?",
		initialValue: true,
	});

	if (p.isCancel(useEditor)) {
		p.cancel("Setup cancelled");
		process.exit(1);
	}

	if (!useEditor) {
		const editorConfig: EditorConfig = { command: null, skipEditor: true };
		config.set("editor", editorConfig);
		return editorConfig;
	}

	const editorCommand = await p.text({
		message: "Enter editor command (e.g. 'code', 'cursor', 'vim')",
		placeholder: "code",
		validate(value) {
			if (!value) return "Please enter an editor command";
			return;
		},
	});

	if (p.isCancel(editorCommand)) {
		p.cancel("Setup cancelled");
		process.exit(1);
	}

	const editorConfig: EditorConfig = {
		command: editorCommand,
		skipEditor: false,
	};
	config.set("editor", editorConfig);
	return editorConfig;
}

// Type for GitHub search result
type SearchResult = {
	path: string;
	repository: {
		nameWithOwner: string;
		url: string;
		full_name?: string;
	};
	url: string;
	text_matches?:
		| Array<{
				object_url: string;
				object_type: string | null;
				property: string;
				fragment: string;
				matches: Array<{
					text: string;
					indices: [number, number];
				}>;
		  }>
		| undefined;
};

async function getGitHubToken(): Promise<string> {
	p.intro("🔑 GitHub Authentication Required");

	try {
		const s = p.spinner();
		s.start("Authenticating with GitHub...");

		// Get token from gh cli
		const token = execSync("gh auth token", { encoding: "utf-8" }).trim();

		if (!token) {
			s.stop("No GitHub token found");

			// Run gh auth login which handles device flow
			execSync("gh auth login --web", { stdio: "inherit" });

			// Try getting token again
			const newToken = execSync("gh auth token", { encoding: "utf-8" }).trim();
			if (!newToken) throw new Error("Failed to get token after login");

			s.stop("Successfully authenticated with GitHub!");
			return newToken;
		}

		s.stop("Found existing GitHub authentication");
		return token;
	} catch (error) {
		p.cancel("Authentication failed");
		process.exit(1);
	}
}

async function ghsearch(initialQuery?: string): Promise<number> {
	const debug = true;
	const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
	const logDir = join(configPath, "logs");
	const logFile = join(logDir, `ghsearch-${timestamp}.log`);

	// Ensure directories exist
	await mkdirp(logDir);
	await mkdirp(searchesPath);

	function log(level: string, message: string) {
		if (level === "DEBUG" && !debug) return;
		const logMessage = `[${level}] ${message}`;
		console.log(logMessage);
		// Append to log file asynchronously
		writeFile(logFile, `${logMessage}\n`, { flag: "a" }).catch(console.error);
	}

	log("DEBUG", "Starting ghsearch function");

	// Get GitHub token first
	const token = await getGitHubToken();
	log("DEBUG", "GitHub token acquired");

	const query =
		initialQuery ??
		(await (async () => {
			p.intro("🔍 GitHub Code Search");

			const searchQuery = await p.text({
				message: "Enter your search query",
				placeholder: 'filename:tsconfig.json path:/ "strict": true',
				validate(value) {
					if (!value) return "Please enter a search query";
					return;
				},
			});

			if (p.isCancel(searchQuery)) {
				p.cancel("Search cancelled");
				process.exit(1);
			}

			return searchQuery;
		})());

	log("DEBUG", `Command: ghsearch ${query}`);
	log("INFO", `Processing query: ${query}`);

	// Check for problematic characters
	if (/[^a-zA-Z0-9\s/_.-]/.test(query)) {
		const s = p.spinner();
		s.start("Validating query");
		await new Promise((resolve) => setTimeout(resolve, 500));
		s.stop("Query contains special characters - proceeding with caution");
		log(
			"WARN",
			`Query contains special characters that might need escaping: ${query}`,
		);
	}

	// Create sanitized filename
	const sanitizedQuery = query
		.replace(/filename:(\S+)/g, "$1") // Extract filename from search
		.replace(/path:[^\s]+/g, "") // Remove path: queries
		.replace(/["']/g, "") // Remove quotes
		.replace(/\s+/g, "-") // Replace spaces with dashes
		.replace(/[^a-zA-Z0-9-_.]/g, "") // Remove any other special chars
		.replace(/^-+|-+$/g, "") // Remove leading/trailing dashes
		.slice(0, 50); // Limit length

	log("DEBUG", `Sanitized filename: ${sanitizedQuery}`);

	// Set up results file
	const resultsFile = join(searchesPath, `${sanitizedQuery}-${timestamp}.md`);

	log("INFO", `Will save results to: ${resultsFile}`);

	// Initialize Octokit with auth token
	const octokit = new Octokit({
		auth: token,
		request: {
			fetch,
		},
	});

	try {
		const s = p.spinner();
		s.start("Searching GitHub");

		const searchResponse = await octokit.rest.search.code({
			q: query,
			per_page: 30,
			headers: {
				Accept: "application/vnd.github.v3.text-match+json",
			},
		});

		const results = searchResponse.data.items.map((item) => ({
			path: item.path,
			repository: {
				nameWithOwner: item.repository.full_name,
				url: item.repository.html_url,
			},
			url: item.html_url,
			text_matches: item.text_matches,
		})) as SearchResult[];

		const resultCount = results.length;

		s.stop(`Found ${resultCount} results`);
		log("DEBUG", `Found ${resultCount} results`);

		if (resultCount === 0) {
			const content = [
				"# GitHub Code Search Results",
				`Query: \`${query}\``,
				`Date: ${new Date().toString()}`,
				"",
				"No results found for this query.",
			].join("\n");

			await writeFile(resultsFile, content);
			p.note("No results found", "Try a different search query");
			return 0;
		}

		// Process results
		const s2 = p.spinner();
		s2.start("Processing results");
		log("INFO", "Processing search results...");

		let content = [
			"# GitHub Code Search Results",
			`Query: \`${query}\``,
			`Date: ${new Date().toString()}`,
			"",
			`Found ${resultCount} results. Showing code snippets containing your search terms.`,
			"",
			"## Results",
			"",
		].join("\n");

		// Process each result
		for (const result of results) {
			content += `### [${result.repository.nameWithOwner}](${result.repository.url})\n\n`;
			content += `File: [${result.path}](${result.url})\n\n`;

			try {
				log("DEBUG", `Fetching content for ${result.path}`);

				// Get file extension for syntax highlighting
				const fileExt = result.path.split(".").pop() || "";
				const lang = fileExt.toLowerCase();

				// Parse owner, repo, and ref from URL
				const urlParts = result.url.split("/");
				const owner = urlParts[3] ?? "";
				const repo = urlParts[4] ?? "";
				const ref = urlParts[6] ?? "";
				const path = urlParts.slice(7).join("/");

				if (!owner || !repo || !ref || !path) {
					throw new Error(`Invalid URL format: ${result.url}`);
				}

				log(
					"DEBUG",
					`Parsed URL parts - owner: ${owner}, repo: ${repo}, ref: ${ref}, path: ${path}`,
				);

				const response = await octokit.rest.repos.getContent({
					owner,
					repo,
					path,
					ref,
					mediaType: {
						format: "raw",
					},
				});

				// Handle different response types
				let fileContent: string;
				if (typeof response.data === "string") {
					fileContent = response.data;
				} else {
					log("WARN", `Unexpected response type for ${result.path}`);
					content +=
						"```\n/* Unable to fetch content: Invalid response type */\n```\n\n---\n\n";
					continue;
				}

				log(
					"DEBUG",
					`Successfully fetched content for ${result.path} - Length: ${fileContent.length}`,
				);
				log("DEBUG", `Content preview: ${fileContent.slice(0, 100)}...`);

				if (!fileContent.trim()) {
					log("WARN", `Empty content received for ${result.path}`);
					content += "```\n/* Empty file */\n```\n\n---\n\n";
					continue;
				}

				// Process each match using the API's text_matches data
				const matches = result.text_matches || [];
				for (const match of matches) {
					if (match.property === "content") {
						let fragment = match.fragment;

						// Sort matches by position (descending) to avoid position shifts
						const sortedMatches = [...match.matches].sort(
							(a, b) => b.indices[0] - a.indices[0],
						);

						// Highlight each match in the fragment
						for (const m of sortedMatches) {
							const [start, end] = m.indices;
							const matchText = fragment.slice(start, end);
							fragment = `${fragment.slice(0, start)}**${matchText}**${fragment.slice(end)}`;
						}

						// Add the fragment with matches highlighted in markdown bold
						content += `\`\`\`${lang}\n${fragment}\n\`\`\`\n\n`;
					}
				}

				content += "---\n\n";
			} catch (error) {
				const err = toErrorWithMessage(error);
				if (err instanceof Error && "status" in err) {
					const statusError = err as { status: number };
					if (statusError.status === 403) {
						log("ERROR", "Rate limit exceeded or authentication required");
						content +=
							"```\n/* Rate limit exceeded or authentication required */\n```\n\n---\n\n";
					} else if (statusError.status === 404) {
						log("ERROR", "File not found or repository is private");
						content +=
							"```\n/* File not found or repository is private */\n```\n\n---\n\n";
					} else {
						const errorMessage = `Error: ${err.message}`;
						log("ERROR", `Failed to fetch content: ${err.message}`);
						content += `\`\`\`\n/* ${errorMessage} */\n\`\`\`\n\n---\n\n`;
					}
				} else {
					log("ERROR", `Failed to fetch content: ${err.message}`);
					content += "```\n/* Error fetching content */\n```\n\n---\n\n";
				}
			}
		}

		await writeFile(resultsFile, content);
		s2.stop("Results processed");

		// Try to open in configured editor
		const editorConfig = await getEditorCommand();

		if (!editorConfig.skipEditor && editorConfig.command) {
			try {
				execSync(`${editorConfig.command} "${resultsFile}"`);
				p.note(
					`Results saved to ${resultsFile}\nTo change your editor, edit: ${join(configPath, "config.json")}`,
					"Opening in editor",
				);
			} catch (error) {
				log(
					"ERROR",
					`Failed to open results in editor: ${editorConfig.command}`,
				);
				p.note(
					`Results saved to ${resultsFile}\nTo change your editor, edit: ${join(configPath, "config.json")}`,
					`You can open manually with: ${editorConfig.command}`,
				);
			}
		} else if (editorConfig.skipEditor) {
			p.note(
				`Results saved to ${resultsFile}\nTo change your editor, edit: ${join(configPath, "config.json")}`,
				"Editor disabled",
			);
		}

		log("DEBUG", "ghsearch function completed");
		p.outro("Search completed! 🎉");
		return resultCount;
	} catch (error) {
		const err = toErrorWithMessage(error);
		log("ERROR", `GitHub search failed: ${err.message}`);
		p.cancel("Search failed");
		return 1;
	}
}

// Run directly when loaded as CLI
const args = process.argv.slice(2);
if (args.length > 0) {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`
GitHub Code Search CLI (ghx)

Usage: ghx [search query]

Search Qualifiers:
  filename:FILENAME    Search for files with a specific name
  extension:EXT       Search for files with a specific extension
  language:LANG       Search for files in a specific language
  repo:OWNER/REPO     Search in a specific repository
  path:PATH           Search in a specific path
  size:n             Search for files of a specific size
  fork:true/false    Include or exclude forked repositories

Examples:
  ghx "filename:tsconfig.json strict"
  ghx "language:typescript extension:tsx useState"
  ghx "repo:facebook/react useState"

Results are saved in:
  macOS:   ~/Library/Preferences/ghx/searches/
  Linux:   ~/.config/ghx/searches/
  Windows: %APPDATA%/ghx/searches/

For more information, visit: https://github.com/johnlindquist/ghx
`);
		process.exit(0);
	}
	ghsearch(args.join(" ")).catch(console.error);
}

// Helper type for error handling
type ErrorWithMessage = {
	message: string;
};

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
	return (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	);
}

function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
	if (isErrorWithMessage(maybeError)) return maybeError;

	try {
		return new Error(JSON.stringify(maybeError));
	} catch {
		return new Error(String(maybeError));
	}
}
