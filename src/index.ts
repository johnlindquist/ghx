#!/usr/bin/env node
// Testing pre-push hook with Husky
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
import { readdir } from "node:fs/promises";
import { statSync } from "node:fs";

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
  pipe = false,
  debug = false,
  limit = DEFAULT_SEARCH_LIMIT,
  maxFilenameLength = MAX_FILENAME_LENGTH,
  contextLines = CONTEXT_LINES
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
        (item: Record<string, unknown>) => ({
          path: item['path'] as string,
          repository: {
            nameWithOwner: (item['repository'] as Record<string, unknown>)['full_name'] as string,
            url: (item['repository'] as Record<string, unknown>)['html_url'] as string,
          },
          url: item['html_url'] as string,
          text_matches: item['text_matches'] as TextMatch[],
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

            // Adjust contextStart to the beginning of the line
            contextStart = fileContent.lastIndexOf("\n", contextStart) + 1;

            // Ensure we don't go below 0
            if (contextStart < 0) contextStart = 0;

            const fragment = fileContent.slice(contextStart, contextEnd);

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
          const statusError = err as { status?: number };
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
    typeof (maybeError as { message?: unknown }).message === "string"
  ) {
    return maybeError as Error;
  }
  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    return new Error(String(maybeError));
  }
}

// Utility: Find the most recently modified file in a directory
async function findLatestResultsFile(dir: string): Promise<string | null> {
  try {
    const files = await readdir(dir);
    if (!files.length) return null;
    let latestFile: string | null = null;
    let latestMtime = Number.NEGATIVE_INFINITY;
    for (const file of files) {
      const mtime = statSync(join(dir, file)).mtimeMs;
      if (mtime > latestMtime) {
        latestFile = file;
        latestMtime = mtime;
      }
    }
    return latestFile ? join(dir, latestFile) : null;
  } catch {
    return null;
  }
}

// Yargs CLI configuration

async function main() {
  yargs(hideBin(process.argv))
    .scriptName("ghx")
    .version(packageJson.version)
    .command(
      "$0 [query..]",
      "Search GitHub Code",
      (yargs: Argv) =>
        yargs
          .positional("query", {
            describe: "One or more search terms",
            type: "string",
            array: true,
          })
          .option("pipe", {
            alias: "p",
            type: "boolean",
            description: "Pipe results to stdout",
            default: false,
          })
          .option("debug", {
            alias: "d",
            type: "boolean",
            description: "Enable debug logging",
            default: false,
          })
          .option("limit", {
            alias: "l",
            type: "number",
            description: "Maximum number of results to fetch",
            default: DEFAULT_SEARCH_LIMIT,
          })
          .option("editor", {
            alias: "e",
            type: "string",
            description: "Specify editor command (e.g., 'code', 'cursor', 'vim')",
          })
          .option("max-filename-length", {
            type: "number",
            description: "Maximum length for generated filename",
            default: MAX_FILENAME_LENGTH,
            hidden: true,
          })
          .option("context-lines", {
            type: "number",
            description: "Number of context lines around matches",
            default: CONTEXT_LINES,
            hidden: true,
          })
          .option("filename", {
            type: "string",
            description: "Filter on filename",
          })
          .option("extension", {
            type: "string",
            description: "Filter on file extension",
          })
          .option("language", {
            type: "string",
            description: "Filter results by language",
          })
          .option("repo", {
            alias: "R",
            type: "string",
            array: true,
            description: "Filter on repository",
          })
          .option("path", {
            type: "string",
            description: "Filter on file path",
          })
          .option("size", {
            type: "string",
            description: "Filter on size range, in kilobytes",
          })
          .option("fork", {
            type: "string",
            description: "Include forked repositories: {true|false|only}",
          })
          .option("owner", {
            type: "string",
            array: true,
            description: "Filter on owner",
          })
          .option("match", {
            type: "string",
            array: true,
            description: "Restrict search to file contents or file path: {file|path}",
          }),
      async (argv) => {
        const searchTermsArray: string[] = [
          ...(Array.isArray(argv.query)
            ? argv.query
            : argv.query
              ? [argv.query]
              : []),
          ...argv._.map(String),
        ].filter(Boolean);

        // Allow empty search terms if using search qualifiers
        const hasSearchQualifiers = argv.filename || argv.extension || argv.language || 
          argv.repo || argv.path || argv.size || argv.fork || argv.owner || argv.match;
        
        if (searchTermsArray.length === 0 && !hasSearchQualifiers) {
          console.error("Error: No search terms or search qualifiers provided.");
          console.log("\nUsage: ghx [query..] [options]");
          console.log("\nFor more help, run: ghx --help");
          process.exit(1);
        }

        // Build search query with GitHub search qualifiers
        let searchQuery = searchTermsArray.join(" ");
        
        // Add search qualifiers based on flags
        if (argv.filename) {
          searchQuery += ` filename:${argv.filename}`;
        }
        if (argv.extension) {
          searchQuery += ` extension:${argv.extension}`;
        }
        if (argv.language) {
          searchQuery += ` language:${argv.language}`;
        }
        if (argv.repo) {
          const repos = Array.isArray(argv.repo) ? argv.repo : [argv.repo];
          repos.forEach(repo => {
            searchQuery += ` repo:${repo}`;
          });
        }
        if (argv.path) {
          searchQuery += ` path:${argv.path}`;
        }
        if (argv.size) {
          searchQuery += ` size:${argv.size}`;
        }
        if (argv.fork) {
          searchQuery += ` fork:${argv.fork}`;
        }
        if (argv.owner) {
          const owners = Array.isArray(argv.owner) ? argv.owner : [argv.owner];
          owners.forEach(owner => {
            searchQuery += ` user:${owner}`;
          });
        }
        if (argv.match) {
          const matches = Array.isArray(argv.match) ? argv.match : [argv.match];
          matches.forEach(match => {
            searchQuery += ` in:${match}`;
          });
        }

        if (argv.editor) {
          config.set("editor.command", argv.editor);
          config.set("editor.skipEditor", false);
        }
        const numResults = await ghx(
          searchQuery,
          argv.pipe,
          argv.debug,
          argv.limit,
          argv["max-filename-length"],
          argv["context-lines"]
        );
        if (!argv.pipe && numResults > 0) {
          const editorConfig = await getEditorCommand();
          if (editorConfig.command && !editorConfig.skipEditor) {
            const s = p.spinner();
            s.start("Opening results in editor...");
            const latestFile = await findLatestResultsFile(searchesPath);
            if (latestFile) {
              try {
                execSync(`${editorConfig.command} "${latestFile}"`);
                s.stop(`Results opened in ${editorConfig.command}`);
              } catch (error) {
                s.stop("Failed to open editor");
                console.error(
                  `Error opening file ${latestFile} with command '${editorConfig.command}'. Is it installed and in your PATH?`
                );
              }
            } else {
              s.stop("Could not find the results file to open.");
            }
          }
        }
      }
    )
    .command({
      command: "config set <key> <value>",
      describe: "Set a configuration value (e.g., 'editor.command')",
      builder: (yargs: Argv) =>
        yargs
          .positional("key", {
            describe: "Config key",
            type: "string",
            demandOption: true,
          })
          .positional("value", {
            describe: "Config value",
            type: "string",
            demandOption: true,
          }),
      handler(argv) {
        config.set(argv.key, argv.value);
        console.log(`Set ${argv.key} to ${config.get(argv.key)}`);
      },
    })
    .usage("Usage: ghx [query..] [options]\n\nExamples:\n  ghx database migration postgres --limit 3\n  ghx --repo facebook/react useState hooks --limit 3\n  ghx --language typescript async function --limit 3\n  ghx --filename tsconfig.json strict --limit 3\n  ghx --extension tsx --language typescript useState --limit 3\n  ghx --path src/components Button --limit 3\n  ghx --owner microsoft --language typescript interface --limit 3\n  ghx --size '>1000' class --limit 3\n  ghx --pipe database migration postgres --limit 3\n  ghx --repo vercel/next.js getServerSideProps getStaticProps --limit 3\n\nTip: For searches containing OR/NOT, enclose the query in quotes (e.g., 'foo OR bar').")
    .epilog("Tip: For searches containing OR/NOT, enclose the query in quotes. Spaces are always treated as AND.")
    .help()
    .alias("h", "help")
    .parse();
}

main().catch(console.error);
