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
ghx "your search query" [--pipe]
```

The search query supports GitHub's code search qualifiers:

- `filename:FILENAME` - Search in files with a specific name
- `extension:EXT` - Search files with specific extension
- `language:LANG` - Search in a specific programming language
- `repo:OWNER/REPO` - Search in a specific repository
- `path:PATH` - Search in a specific file path
- `size:n` - Files that are n bytes in size
- `fork:true/false` - Include or exclude forks

Examples:
```bash
# Search for TypeScript config files
ghx "filename:tsconfig.json strict"

# Find React components
ghx "language:typescript extension:tsx useState"

# Search in specific repo
ghx "repo:facebook/react useState"

# Search and pipe results to stdout
ghx --pipe "filename:tsconfig.json strict"

# Pipe results to a file
ghx --pipe "language:typescript useState" > results.md
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