# Project Structure

## Root Directory

- **Entry Point**: `src/cli.ts` - Main CLI entry with Commander.js setup
- **Build Output**: `dist/cli.mjs` - Rollup-built ESM bundle with shebang
- **Configuration**: TypeScript, ESLint, Prettier, Vitest, Commitlint configs

## Source Organization (`src/`)

### Commands (`src/commands/`)
CLI command implementations following Commander.js patterns:
- `aicommits.ts` - Main commit message generation
- `agent.ts` - AI agent for commit splitting
- `config.ts` - Configuration management
- `pr.ts` - Pull request content generation
- `setup/` - Interactive setup wizard with provider/model selection
- `prepare-commit-msg.ts` - Git hook integration
- `ignore.ts` - File exclusion management
- `version.ts` - Version display

### Services (`src/services/`)
Business logic layer with dependency injection:
- `ai-*.service.ts` - AI-related services (commit messages, PR content, text generation)
- `config.service.ts` - Configuration management with profile support
- `git*.service.ts` - Git operations and GitHub API integration
- `prompt.service.ts` - User interaction and prompting
- `ai-provider.factory.ts` - AI provider abstraction

### Utilities (`src/utils/`)
Shared utilities and infrastructure:
- `di.ts` - Dependency injection container setup
- `config.ts` - Configuration schemas and types
- `inversify.ts` - InversifyJS decorators and symbols
- `error.ts` - Error handling utilities
- `string.ts` - String manipulation helpers
- `typeguards.ts` - TypeScript type guards

## Testing Structure

- **Location**: `**/*.spec.ts` files alongside source
- **Framework**: Vitest with globals enabled
- **Coverage**: V8 provider with HTML/text reports
- **Setup**: `setup-vitest.ts` for test configuration

## Configuration Files

- **Build**: `rollup.config.ts` - ESM bundle with external dependencies
- **TypeScript**: Strict mode, ES2020 target, decorators enabled
- **ESLint**: TypeScript rules, single quotes, curly braces required
- **Prettier**: 4 spaces, 120 char width, trailing commas
- **Commitlint**: Conventional commits with custom rules

## Development Workflow

1. **Development**: Use `npm run dev` for local testing
2. **Quality**: Run `npm run cq` before commits
3. **Testing**: Vitest for unit tests with coverage
4. **Building**: Rollup creates single ESM bundle
5. **Release**: Semantic release with conventional commits

## Key Patterns

- **Service Layer**: Injectable services with clear responsibilities
- **Command Pattern**: Each CLI command as separate module
- **Factory Pattern**: AI provider abstraction
- **Configuration**: YAML-based with profile support
- **Error Handling**: Centralized error utilities
- **Type Safety**: Zod schemas for runtime validation