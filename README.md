# ghx - GitHub Code Search CLI

A CLI tool for searching GitHub code and viewing results in your editor.

## Prerequisites

### GitHub CLI Required

This tool requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be:

1. Installed and available in your PATH
2. Authenticated with your GitHub account

Without these requirements, the tool will fail to work due to GitHub API rate limiting.

### Installation & Authentication Steps

1. Install GitHub CLI:
   - macOS: `brew install gh`
   - [Other installation methods](https://github.com/cli/cli#installation)

2. Authenticate with GitHub:
   ```bash
   gh auth login
   ```
   Follow the prompts to complete authentication.

3. Install ghx:
   ```bash
   pnpm add -g @johnlindquist/ghx
   ```

## Usage

```bash
ghx "your search query" [options]
```

### Options

- `--pipe` - Output results directly to stdout
- `--debug` - Output code fence contents for testing
- `--limit, -L <n>` - Maximum number of results to fetch (default: 50)
- `--context, -c <n>` - Number of context lines around matches (default: 20)
- `--max-filename, -f <n>` - Maximum length of generated filenames (default: 50)

### Search Qualifiers

You can use either CLI flags or GitHub's search qualifiers:

CLI Flags:
- `--filename <name>` - Search in files with a specific name
- `--extension <ext>` - Search files with specific extension
- `--language <lang>` - Search in a specific programming language
- `--repo <owner/repo>` - Search in a specific repository
- `--path <path>` - Search in a specific file path
- `--size <n>` - Files that are n bytes in size
- `--fork` - Include or exclude forked repositories

GitHub Qualifiers (Alternative Syntax):
- `filename:FILENAME`
- `extension:EXT`
- `language:LANG`
- `repo:OWNER/REPO`
- `path:PATH`
- `size:n`
- `fork:true/false`

Examples:
```bash
# Search for TypeScript config files
ghx --filename tsconfig.json "strict"

# Find React components
ghx --language typescript --extension tsx "useState"

# Search in specific repo
ghx --repo facebook/react "useState"

# Search and pipe results to stdout
ghx --pipe --filename tsconfig.json "strict"

# Pipe results to a file
ghx --pipe --language typescript "useState" > results.md

# Get more results
ghx --limit 100 --filename package.json "dependencies"

# Show more context around matches
ghx --context 50 --language typescript "useState"

# Allow longer filenames
ghx --max-filename 100 --filename package.json "devDependencies"

# Combine options
ghx -L 100 -c 30 -f 75 --repo facebook/react "hooks"
```

### Search Results

Results are saved as markdown files in your system's config directory:
- macOS: `~/Library/Preferences/ghx/searches/`
- Linux: `~/.config/ghx/searches/`
- Windows: `%APPDATA%/ghx/searches/`

### Editor Integration

On first run, ghx will prompt you to:
1. Choose whether to automatically open results in an editor
2. Specify your preferred editor command (e.g., 'code', 'cursor', 'vim')

You can change these settings by editing the config file in:
- macOS: `~/Library/Preferences/ghx/config.json`
- Linux: `~/.config/ghx/config.json`
- Windows: `%APPDATA%/ghx/config.json`

## Features

- Searches GitHub code using the GitHub API
- Shows matching code snippets with context
- Saves results as markdown for easy viewing
- Handles rate limiting and authentication through GitHub CLI
- Opens results in Cursor (if available)

## Troubleshooting

If you get authentication errors:
1. Make sure GitHub CLI is installed: `gh --version`
2. Make sure you're logged in: `gh auth status`
3. Try logging in again: `gh auth login`

## Development

```bash
# Clone the repo
git clone https://github.com/johnlindquist/ghx.git

# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build
pnpm build
```

## License

ISC 