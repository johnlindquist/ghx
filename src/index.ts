#!/usr/bin/env node
import { Octokit } from "@octokit/rest";
import { format } from "date-fns";
import { join, dirname, parse } from "node:path";
import { mkdirp } from "mkdirp";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import fetch from "node-fetch";
import Conf from "conf";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { RESULTS_SAVED_MARKER } from "./constants.js";
import { fileURLToPath } from "node:url";

// Define TypeScript interfaces for our types
interface EditorConfig {
  command: string | null;
  skipEditor: boolean;
}

interface ConfigSchema {
  editor: EditorConfig;
}

interface CodeMatch {
  text: string;
  indices: [number, number];
}

interface TextMatch {
  object_url: string;
  object_type: string | null;
  property: string;
  fragment: string;
  matches: CodeMatch[];
}

interface SearchResult {
  path: string;
  repository: { nameWithOwner: string; url: string };
  url: string;
  text_matches?: TextMatch[];
}

// Initialize configuration with the conf package
const config = new Conf<ConfigSchema>({
  projectName: "johnlindquist/ghx",
});
const configPath = dirname(config.path);
const searchesPath = join(configPath, "searches");

// Constants for search defaults
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_FILENAME_LENGTH = 50;
const CONTEXT_LINES = 20;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8")
);

// Helper functions

/**
 * Prompts the user for an editor command if not already set.
 * @returns {Promise<EditorConfig>}
 */
async function getEditorCommand(): Promise<EditorConfig> {
  const savedConfig = config.get<string>("editor") as EditorConfig;
  if (savedConfig?.command || savedConfig?.skipEditor) return savedConfig;
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
    validate(value: string) {
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

/**
 * Gets a GitHub authentication token using the gh cli.
 * @returns {Promise<string>}
 */
async function getGitHubToken(): Promise<string> {
  p.intro("🔑 GitHub Authentication Required");
  try {
    const s = p.spinner();
    s.start("Authenticating with GitHub...");
    // Get token from gh cli
    const token = execSync("gh auth token", { encoding: "utf-8" }).trim();
    if (!token) {
      s.stop("No GitHub token found");
      // Run gh auth login (device flow)
      execSync("gh auth login --web", { stdio: "inherit" });
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

/**
 * Main function that performs GitHub code search.
 * @param {string} initialQuery
 * @param {boolean} pipe
 * @param {boolean} debug
 * @param {number} limit
 * @param {number} maxFilenameLength
 * @param {number} contextLines
 * @returns {Promise<number>}
 */
async function ghx(
  initialQuery: string,
  pipe: boolean = false,
  debug: boolean = false,
  limit: number = DEFAULT_SEARCH_LIMIT,
  maxFilenameLength: number = MAX_FILENAME_LENGTH,
  contextLines: number = CONTEXT_LINES
): Promise<number> {
  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  const logDir = join(configPath, "logs");
  const logFile = join(logDir, `ghx-${timestamp}.log`);
  await mkdirp(logDir);
  await mkdirp(searchesPath);
  function log(level: string, message: string): void {
    const logMessage = `[${level}] ${message}`;
    console.log(logMessage);
    writeFile(logFile, `${logMessage}\n`, { flag: "a" }).catch(console.error);
  }
  log("DEBUG", "Starting ghx function");
  const token = await getGitHubToken();
  log("DEBUG", "GitHub token acquired");

  const query = initialQuery;
  log("DEBUG", `Command: ghx ${query}`);
  log("INFO", `Processing query: ${query}`);

  if (/[^a-zA-Z0-9\s/_.-]/.test(query)) {
    const s = p.spinner();
    s.start("Validating query");
    await new Promise((resolve) => setTimeout(resolve, 500));
    s.stop("Query contains special characters - proceeding with caution");
    log("WARN", `Query contains special characters: ${query}`);
  }

  const sanitizedQuery = query
    .replace(/filename:(\S+)/g, "$1")
    .replace(/path:[^\s]+/g, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_.]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxFilenameLength);
  log("DEBUG", `Sanitized filename: ${sanitizedQuery}`);
  const resultsFile = join(searchesPath, `${sanitizedQuery}-${timestamp}.md`);
  log("INFO", `Will save results to: ${resultsFile}`);
  const octokit = new Octokit({
    auth: token,
    request: { fetch },
  });
  try {
    const s = p.spinner();
    s.start("Searching GitHub");
    let allResults: SearchResult[] = [];
    let page = 1;
    let remaining = limit;
    while (remaining > 0) {
      const perPage = remaining > 100 ? 100 : remaining;
      const searchResponse = await octokit.rest.search.code({
        q: query,
        per_page: perPage,
        page,
        headers: { Accept: "application/vnd.github.v3.text-match+json" },
      });
      const results: SearchResult[] = searchResponse.data.items.map(
        (item: any) => ({
          path: item.path,
          repository: {
            nameWithOwner: item.repository.full_name,
            url: item.repository.html_url,
          },
          url: item.html_url,
          text_matches: item.text_matches,
        })
      );
      allResults = allResults.concat(results);
      if (results.length < perPage) break;
      remaining -= results.length;
      page++;
    }
    const resultCount = allResults.length;
    s.stop(`Found ${resultCount} results`);
    log("DEBUG", `Found ${resultCount} results`);
    if (resultCount === 0) {
      const content = [
        "# GitHub Code Search Results",
        `Query: \`${query}\``,
        `Date: ${new Date().toString()}`,
        "",
        "No results found for this query.",
        "",
        "Note: If you're searching a specific repository and getting no results:",
        "- The repository might be too new",
        "- The repository might not be indexed yet by GitHub's code search",
        "- The repository might be empty or private",
        "",
        "Try:",
        "- Waiting a few minutes if the repository was just created",
        "- Verifying the repository exists and is public",
        "- Using broader search terms",
      ].join("\n");
      await writeFile(resultsFile, content);
      p.note(
        "No results found. The repository might not be indexed yet.",
        "Try a different search query"
      );
      return 0;
    }
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
    for (const result of allResults) {
      content += `### [${result.repository.nameWithOwner}](${result.repository.url})\n\n`;
      content += `File: [${result.path}](${result.url})\n\n`;
      try {
        log("DEBUG", `Fetching content for ${result.path}`);
        const { ext, name } = parse(result.path);
        const lang = name.endsWith(".json") ? "json" : ext.slice(1) || "";
        const urlParts = result.url.split("/");
        const owner = urlParts[3] ?? "";
        const repo = urlParts[4] ?? "";
        const ref = urlParts[6] ?? "";
        const pathParts = urlParts.slice(7).join("/");
        if (!owner || !repo || !ref || !pathParts) {
          throw new Error(`Invalid URL format: ${result.url}`);
        }
        log(
          "DEBUG",
          `Parsed URL parts - owner: ${owner}, repo: ${repo}, ref: ${ref}, path: ${pathParts}`
        );
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: pathParts,
          ref,
          mediaType: { format: "raw" },
        });
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
          `Fetched content for ${result.path} - Length: ${fileContent.length}`
        );
        if (!fileContent.trim()) {
          log("WARN", `Empty content for ${result.path}`);
          content += "```\n/* Empty file */\n```\n\n---\n\n";
          continue;
        }
        const matches = result.text_matches || [];
        for (const match of matches) {
          if (match.property === "content") {
            const fragmentIndex = fileContent.indexOf(match.fragment);
            if (fragmentIndex === -1) {
              log("WARN", `Could not find fragment in ${result.path}`);
              continue;
            }
            let startPos = fileContent.lastIndexOf("\n", fragmentIndex);
            if (startPos === -1) startPos = 0;
            let endPos = fileContent.indexOf(
              "\n",
              fragmentIndex + match.fragment.length
            );
            if (endPos === -1) endPos = fileContent.length;
            let contextStart = startPos;
            let lineCount = 0;
            while (lineCount < contextLines && contextStart > 0) {
              const newContextStart = fileContent.lastIndexOf(
                "\n",
                contextStart - 1
              );
              if (newContextStart === -1) {
                contextStart = 0;
                break;
              }
              contextStart = newContextStart;
              lineCount++;
            }
            let contextEnd = endPos;
            lineCount = 0;
            while (
              lineCount < contextLines &&
              contextEnd < fileContent.length
            ) {
              const nextNewline = fileContent.indexOf("\n", contextEnd + 1);
              if (nextNewline === -1) {
                contextEnd = fileContent.length;
                break;
              }
              contextEnd = nextNewline;
              lineCount++;
            }
            let fragment = fileContent.slice(contextStart, contextEnd);
            const sortedMatches = [...match.matches].sort(
              (a, b) => b.indices[0] - a.indices[0]
            );
            const fragmentOffset = fragmentIndex - contextStart;
            for (const m of sortedMatches) {
              const [start, end] = m.indices;
              const matchText = match.fragment.slice(start, end);
              const adjustedStart = fragmentOffset + start;
              const adjustedEnd = fragmentOffset + end;
              fragment = `${fragment.slice(
                0,
                adjustedStart
              )}**${matchText}**${fragment.slice(adjustedEnd)}`;
            }
            content += `\`\`\`${lang}\n${fragment.trim()}\n\`\`\`\n\n`;
            if (debug) {
              log("DEBUG", "Code fence content:");
              log("DEBUG", fragment.trim());
            }
          }
        }
        content += "---\n\n";
      } catch (error) {
        const err = toErrorWithMessage(error);
        if (err instanceof Error && "status" in err) {
          const statusError = err as any;
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
    if (pipe) {
      console.log(content);
      console.log(`\n${RESULTS_SAVED_MARKER} ${resultsFile}`);
      return resultCount;
    }
    const editorConfig = await getEditorCommand();
    if (!editorConfig.skipEditor && editorConfig.command) {
      try {
        execSync(`${editorConfig.command} "${resultsFile}"`);
        p.note(
          `${RESULTS_SAVED_MARKER} ${resultsFile}\nTo change your editor, edit: ${join(
            configPath,
            "config.json"
          )}`,
          "Opening in editor"
        );
      } catch (error) {
        log("ERROR", `Failed to open editor: ${editorConfig.command}`);
        p.note(
          `${RESULTS_SAVED_MARKER} ${resultsFile}\nTo change your editor, edit: ${join(
            configPath,
            "config.json"
          )}`,
          `You can open manually with: ${editorConfig.command}`
        );
      }
    } else if (editorConfig.skipEditor) {
      p.note(
        `${RESULTS_SAVED_MARKER} ${resultsFile}\nTo change your editor, edit: ${join(
          configPath,
          "config.json"
        )}`,
        "Editor disabled"
      );
    }
    log("DEBUG", "ghx function completed");
    p.outro("Search completed! 🎉");
    return resultCount;
  } catch (error) {
    const err = toErrorWithMessage(error);
    log("ERROR", `GitHub search failed: ${err.message}`);
    if (err.message.includes("ERROR_TYPE_QUERY_PARSING_FATAL")) {
      console.error(
        "\n⚠️  Invalid search query format. Please check the query syntax."
      );
      console.error(
        "ℹ️  See: https://docs.github.com/rest/search/search#search-code\n"
      );
      process.exit(1);
    }
    p.cancel("Search failed");
    return 1;
  }
}

// Helper error conversion
/**
 * Converts an unknown error into an Error instance.
 * @param {unknown} maybeError
 * @returns {Error}
 */
function toErrorWithMessage(maybeError: unknown): Error {
  if (
    typeof maybeError === "object" &&
    maybeError !== null &&
    "message" in maybeError &&
    typeof (maybeError as any).message === "string"
  ) {
    return maybeError as Error;
  }
  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    return new Error(String(maybeError));
  }
}

// Yargs CLI configuration

type ConfigSetArgs = {
  key: string;
  value: string | undefined;
};

type ConfigGetArgs = {
  key: string;
};

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName("ghx")
    .usage("Usage: $0 [options]")
    .version(packageJson.version)
    // Config command group
    .command(
      "config",
      "Manage configuration settings",
      (yargs: Argv) =>
        yargs
          .command(
            "set <key> [value]",
            "Update configuration with a value for the given key",
            {
              key: {
                describe: "Configuration key to set",
                type: "string",
                demandOption: true,
              },
              value: {
                describe: "New value for the key",
                type: "string",
              },
            },
            async (argv: ConfigSetArgs) => {
              let { key, value } = argv;
              if (value === undefined) {
                const result = await p.text({
                  message: `Enter new value for ${key}`,
                });
                if (p.isCancel(result)) {
                  p.cancel("Configuration update cancelled");
                  process.exit(1);
                }
                value = result;
              }
              if (key === "editor") {
                if (value.toLowerCase() === "false" || value === "null") {
                  config.set("editor", { command: null, skipEditor: true });
                  console.log(
                    `Configuration updated: editor = { command: null, skipEditor: true }`
                  );
                } else {
                  config.set("editor", { command: value, skipEditor: false });
                  console.log(
                    `Configuration updated: editor = { command: "${value}", skipEditor: false }`
                  );
                }
              } else {
                config.set(key, value);
                console.log(`Configuration updated: ${key} = ${value}`);
              }
            }
          )
          .command(
            "get <key>",
            "Print the value of a given configuration key",
            {
              key: {
                describe: "Configuration key to get",
                type: "string",
                demandOption: true,
              },
            },
            (argv: ConfigGetArgs) => {
              const { key } = argv;
              const value = config.get(key);
              console.log(`${key}: ${JSON.stringify(value)}`);
            }
          )
          .command(
            "list",
            "Print a list of configuration keys and values",
            () => { },
            () => {
              const all = config.store;
              console.log("Configuration settings:");
              for (const key of Object.keys(all) as Array<keyof typeof all>) {
                console.log(`${key}: ${JSON.stringify(all[key])}`);
              }
            }
          )
          .command(
            "clear-cache",
            "Clear the configuration cache",
            () => { },
            () => {
              config.clear();
              console.log("Configuration cache cleared");
            }
          )
          .demandCommand(
            1,
            "Please specify a valid config command (set, get, list, clear-cache)"
          ),
      () => { }
    )
    // Default search command
    .command(
      "$0 [query]",
      "Search GitHub Code",
      (yargs: Argv) =>
        yargs
          .option("pipe", {
            type: "boolean",
            describe: "Output results directly to stdout",
            alias: "p",
          })
          .option("debug", {
            type: "boolean",
            describe: "Output code fence contents for testing",
            alias: "d",
          })
          .option("limit", {
            alias: "L",
            type: "number",
            describe: "Maximum number of results to fetch",
            default: DEFAULT_SEARCH_LIMIT,
          })
          .option("max-filename", {
            alias: "f",
            type: "number",
            describe: "Maximum length of generated filenames",
            default: MAX_FILENAME_LENGTH,
          })
          .option("context", {
            alias: "c",
            type: "number",
            describe: "Number of context lines around matches",
            default: CONTEXT_LINES,
          })
          // GitHub search qualifiers
          .option("repo", {
            type: "string",
            describe: "Search in a specific repository (owner/repo)",
            alias: "r",
          })
          .option("path", {
            type: "string",
            describe: "Search in a specific path",
            alias: "P",
          })
          .option("language", {
            type: "string",
            describe: "Search for files in a specific language",
            alias: "l",
          })
          .option("extension", {
            type: "string",
            describe: "Search for files with a specific extension",
            alias: "e",
          })
          .option("filename", {
            type: "string",
            describe: "Search for files with a specific name",
            alias: "n",
          })
          .option("size", {
            type: "string",
            describe: "Search for files of a specific size",
            alias: "s",
          })
          .option("fork", {
            type: "boolean",
            describe: "Include or exclude forked repositories",
            alias: "F",
          })
          // Clear existing examples
          // Add new examples based on tests
          .example(
            "$0 'useState'",
            "Search for 'useState' across all indexed code on GitHub"
          )
          .example(
            '$0 --repo facebook/react "useState"',
            "Search for 'useState' in the facebook/react repository"
          )
          .example(
            '$0 -l typescript -e tsx "useState"',
            "Search for 'useState' in TypeScript files with the .tsx extension"
          )
          .example(
            '$0 -n package.json "dependencies"',
            "Search for 'dependencies' specifically within package.json files"
          )
          .example(
            '$0 -P src/components "Button"',
            "Search for 'Button' within the src/components path"
          )
          .example(
            '$0 -s \'">10000\" -l go "package main"',
            "Search for 'package main' in Go files larger than 10KB"
          )
          .example(
            '$0 "async function" -l typescript', // Multi-term example
            "Search for the exact phrase 'async function' in TypeScript files"
          )
          .example(
            '$0 "my search terms" --pipe > results.md', // Piping example
            "Search and pipe the results directly to a markdown file"
          )
          .example(
            '$0 -L 100 -c 30 "complex query"', // Combining options
            "Fetch up to 100 results with 30 lines of context per match"
          )
          .example(
            '$0 -l typescript "import test"', // Multiple separate terms (implicit AND)
            "Search for lines containing both 'import' AND 'test' in TypeScript files"
          )
          .example(
            '$0 -l javascript "const OR let"', // OR operator
            "Search for lines containing either 'const' OR 'let' in JavaScript files"
          )
          .example(
            '$0 -l css "color NOT background-color"', // NOT operator
            "Search for lines containing 'color' BUT NOT 'background-color' in CSS files"
          )
          .positional("query", {
            describe: "Search query",
            type: "string",
          }),
      async (argv) => {
        const qualifiers = [
          argv.repo && `repo:${argv.repo}`,
          argv.path && `path:${argv.path}`,
          argv.language && `language:${argv.language}`,
          argv.extension && `extension:${argv.extension}`,
          argv.filename && `filename:${argv.filename}`,
          argv.size && `size:${argv.size}`,
          argv.fork !== undefined && `fork:${argv.fork}`,
        ]
          .filter(Boolean)
          .join(" ");
        // Simpler handling for search terms to avoid double-quoting issues with operators
        const searchTerms = argv.query ? String(argv.query) : argv._.map(String).join(" ");

        const query = [qualifiers, searchTerms]
          .filter(Boolean)
          .join(" ")
          .trim()
          .replace(/\s+/g, " ");
        console.log("DEBUG: Final query:", query);
        const resultCount = await ghx(
          query,
          argv.pipe as boolean,
          argv.debug as boolean,
          argv.limit as number,
          argv["max-filename"] as number,
          argv.context as number
        );
        process.exit(resultCount === 0 ? 1 : 0);
      }
    )
    .help()
    .alias("help", "h")
    .parseAsync();
}

main().catch(console.error);
