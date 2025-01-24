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
ghx "your search query"
```

The results will be saved to a markdown file in your home directory under `~/searches/` and will attempt to open in Cursor.

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