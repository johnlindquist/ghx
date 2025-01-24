# ghx

A CLI tool for searching and exploring GitHub examples.

## Installation

```bash
pnpm add -g @johnlindquist/ghx
```

## Usage

```bash
# Search GitHub for examples
ghx search "react hooks"

# Get examples from a specific user
ghx user "johnlindquist"

# Search for specific file types
ghx search "typescript config" --ext=ts
```

## Features

- Fast GitHub search with smart filtering
- Save examples locally
- Filter by language, date, stars, and more
- Supports TypeScript/JavaScript examples

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