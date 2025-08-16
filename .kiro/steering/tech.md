# Technology Stack

## Core Technologies

- **Runtime**: Node.js (minimum v14, ES2020 target)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES modules (ESM)
- **Build Tool**: Rollup with TypeScript plugin
- **Package Manager**: npm

## Key Dependencies

- **AI Integration**: Vercel AI SDK v5 (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- **CLI Framework**: Commander.js with extra typings
- **Dependency Injection**: InversifyJS with decorators
- **Git Operations**: simple-git
- **User Interface**: @clack/prompts for interactive CLI
- **Configuration**: YAML parsing/stringification
- **Validation**: Zod schemas
- **Utilities**: radash (functional utilities), kolorist (colors)

## Development Tools

- **Testing**: Vitest with coverage via v8
- **Linting**: ESLint with TypeScript rules
- **Formatting**: Prettier (4 spaces, single quotes, 120 char width)
- **Git Hooks**: Husky with commitlint
- **Release**: Semantic Release with conventional commits

## Common Commands

### Development
```bash
npm run dev                    # Run CLI in development mode
npm run dev:agent             # Run agent command in dev
npm run dev:setup             # Run setup command in dev
```

### Code Quality
```bash
npm run cq                    # Run all quality checks
npm run cq:type-check         # TypeScript type checking
npm run cq:eslint             # Lint code
npm run cq:prettier           # Check formatting
npm run cq:eslint:fix         # Fix linting issues
npm run cq:prettier:fix       # Fix formatting
```

### Testing
```bash
npm test                      # Run tests
npm run test:watch            # Run tests in watch mode
npm run test:coverage         # Run tests with coverage
```

### Build & Release
```bash
npm run build                 # Build for production
npm run prepack               # Prepare for npm publish
npm run release               # Create semantic release
npm run release:dry-run       # Test release process
```

### Local Installation Testing
```bash
npm run install:link          # Build and link globally
npm run install:test          # Build, pack, and install globally
npm run uninstall:test        # Remove global installation
```

## Architecture Patterns

- **Dependency Injection**: Services use InversifyJS with decorators
- **Service Layer**: Business logic separated into injectable services
- **Command Pattern**: CLI commands as separate modules
- **Factory Pattern**: AI provider abstraction via factory
- **Configuration**: Profile-based YAML configuration with environment overrides