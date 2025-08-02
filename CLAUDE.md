# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ghx is a GitHub Code Search CLI tool that searches for code snippets across GitHub repositories and displays them with context. It integrates with the GitHub CLI (`gh`) for authentication and supports various search parameters like language, repository, and file extensions.

## Essential Commands

### Development
- `pnpm dev` - Run the TypeScript source directly with `--experimental-strip-types`
- `pnpm build` - Compile TypeScript to JavaScript (output to `dist/`)
- `pnpm build:check` - Type check without emitting files

### Testing
- `pnpm test` - Run all tests with Vitest (uses --bail 1 to stop on first failure)
- Single test file: `pnpm vitest run test/index.test.ts`
- Watch mode: `pnpm vitest watch`

### Publishing
- `pnpm commit` - Create a conventional commit using commitizen
- `pnpm semantic-release` - Handle automated releases (configured for main branch)

## Architecture

### Core Flow
1. **CLI Entry** (`src/index.ts`): Yargs-based CLI that handles command parsing and options
2. **GitHub Authentication**: Uses `gh auth token` to get GitHub access token
3. **Search Execution**: Uses Octokit REST API to search GitHub code
4. **Result Processing**: Fetches file contents and extracts context around matches
5. **Output**: Saves results as markdown files or pipes to stdout

### Key Dependencies
- `@octokit/rest` - GitHub API client
- `@clack/prompts` - Interactive CLI prompts
- `yargs` - Command-line argument parsing
- `conf` - Configuration management (stores editor preferences)
- `vitest` - Testing framework

### Configuration
- User config stored via `conf` package in platform-specific directories
- Editor preferences saved in `config.json`
- Search results saved in `searches/` subdirectory
- Claude Code settings stored in `.claude/` directory:
  - `settings.local.json` - Permissions for MCP tools and commands
  - `.gitkeep` - Ensures the configuration directory is tracked

### TypeScript Setup
- Extends Node 23 and strictest TypeScript configs
- Compiles to ES modules with NodeNext resolution
- Source files in `src/`, output to `dist/`

## Testing Approach
- Tests located in `test/` directory
- 15-second timeout for all tests (GitHub API operations can be slow)
- Console output not intercepted to allow debugging
- Test files must match `*.test.ts` or `*.spec.ts` pattern

## Important Notes
- Always check that `gh` CLI is authenticated before running
- The tool requires GitHub CLI to be installed and authenticated
- Rate limiting is handled through GitHub CLI's token management
- Search results are saved with sanitized filenames based on the query