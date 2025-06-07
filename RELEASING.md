# Releasing

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to automate version management and package publishing.

## How it works

- **Automated Versioning**: Version numbers are automatically determined based on commit messages
- **Automated Publishing**: Packages are automatically published to npm when code is pushed to `main` or `develop`
- **Automated Changelog**: Release notes are automatically generated based on commit messages
- **GitHub Releases**: GitHub releases are automatically created with assets

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages should follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Examples:

- `feat: add new AI model support` → Minor version bump
- `fix: resolve configuration parsing issue` → Patch version bump
- `feat!: change CLI interface` → Major version bump (breaking change)
- `docs: update README` → No version bump
- `chore: update dependencies` → No version bump

### Types that trigger releases:

- `feat` → Minor version bump (new feature)
- `fix` → Patch version bump (bug fix)
- `perf` → Patch version bump (performance improvement)

### Types that don't trigger releases:

- `docs` → Documentation changes
- `style` → Code style changes
- `refactor` → Code refactoring
- `test` → Test changes
- `chore` → Maintenance tasks

## Branches

- **develop**: Production releases (e.g., `1.0.0`, `1.1.0`, `1.1.1`)

## Manual Release

You can test releases locally:

```bash
# Dry run to see what would be released
npm run release:dry-run

# Actual release (only use if you know what you're doing)
npm run release
```

## NPM Token Setup

For automated publishing to work, you need to set up an `NPM_TOKEN` secret in your GitHub repository:

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Go to Access Tokens → Generate New Token
3. Choose "Automation" token type (works with 2FA)
4. Copy the token
5. In your GitHub repository, go to Settings → Secrets and variables → Actions
6. Add a new secret named `NPM_TOKEN` with the token value

## Provenance

This project publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) enabled, which provides additional security and verification for published packages.
