# @lucavb/aicommits

**aicommits helps you write better commit messages by generating AI-powered summaries for your git diffs - and it keeps your work and private environments separate with configurable profiles.**

> **🆕 Latest**: Now powered by Vercel AI SDK v5 for improved performance and better AI provider integration!

[![npm version](https://img.shields.io/npm/v/@lucavb/aicommits.svg?style=flat)](https://www.npmjs.com/package/@lucavb/aicommits)
[![Build Status](https://github.com/lucavb/aicommits/actions/workflows/test.yml/badge.svg)](https://github.com/lucavb/aicommits/actions)

## Quick Start

Install globally:

```sh
npm install -g @lucavb/aicommits
```

Run the setup command to configure your environment:

```sh
aicommits setup
```

Stage your changes and generate a commit message:

```sh
git add <files...>
aicommits
```

Example output:

```
✔ Generating commit message...
feat: Add user authentication and update login flow
```

> The minimum supported version of Node.js is the latest v14. Check your Node.js version with `node --version`.

## Setup

1. Install _aicommits_:

    ```sh
    npm install -g @lucavb/aicommits
    ```

2. Run the interactive setup:

    ```sh
    aicommits setup
    ```

    This will guide you through:
    - Selecting your AI provider (OpenAI or Anthropic)
    - Configuring the API base URL
    - Setting up your API key
    - Choosing the model to use

    You can also set up different profiles for different projects or environments:

    ```sh
    aicommits setup --profile development
    ```

    > **Note**: For OpenAI, you'll need an API key from [OpenAI's platform](https://platform.openai.com/account/api-keys). Make sure you have an account and billing set up.

    > **Ollama Users**: Direct Ollama support is temporarily unavailable in the latest version due to the migration to Vercel AI SDK v5. As a workaround, you can use Ollama's OpenAI-compatible API by:
    >
    > 1. Starting Ollama with: `OLLAMA_ORIGINS="*" ollama serve`
    > 2. Setting up aicommits with provider "OpenAI" and base URL `http://localhost:11434/v1`
    > 3. Using any API key (Ollama ignores it)
    >
    > Native Ollama support will be restored once it's available in AI SDK v5.

### Upgrading

Upgrade to the latest version:

```sh
npm update -g @lucavb/aicommits
```

## Usage

### CLI mode

You can call `aicommits` directly to generate a commit message for your staged changes:

```sh
git add <files...>
aicommits
```

`aicommits` passes down unknown flags to `git commit`, so you can pass in [`commit` flags](https://git-scm.com/docs/git-commit).

For example, you can stage all changes in tracked files with as you commit:

```sh
aicommits --stage-all # or -a
```

You can also use different profiles for different projects or environments:

```sh
aicommits --profile <profile-name>
```

> 👉 **Tip:** Use the `aic` alias if `aicommits` is too long for you.

#### Generating Conventional Commits

If you'd like to generate [Conventional Commits](https://conventionalcommits.org/), you can use the `--type` flag followed by `conventional`. This will prompt `aicommits` to format the commit message according to the Conventional Commits specification:

```sh
aicommits --type conventional # or -t conventional
```

This feature can be useful if your project follows the Conventional Commits standard or if you're using tools that rely on this commit format.

#### Usage

1. Stage your files and commit:

    ```sh
    git add <files...>
    git commit # Only generates a message when it's not passed in
    ```

    > If you ever want to write your own message instead of generating one, you can simply pass one in: `git commit -m "My message"`

2. Aicommits will generate the commit message for you and pass it back to Git. Git will open it with the [configured editor](https://docs.github.com/en/get-started/getting-started-with-git/associating-text-editors-with-git) for you to review/edit it.

3. Save and close the editor to commit!

### AI-Guided Commit Splitting

Need to split a large change into multiple focused commits? The `--split` mode uses AI to analyze your staged changes and intelligently group related modifications into separate logical commits.

```sh
git add <files...>
aicommits --split
```

**How it works:**

1. **AI Analysis**: The AI agent examines all staged changes and identifies logical groupings based on:
    - Related functionality changes (e.g., feature + tests)
    - Different types of changes (bug fixes vs features vs refactoring)
    - File relationships (implementation + types/interfaces)
    - Change dependencies

2. **Interactive Review**: You'll see a detailed breakdown of proposed commit groups with:
    - Priority levels (high, medium, low)
    - File lists for each group
    - Reasoning for the groupings
    - Clear descriptions of what each commit would contain

3. **Selective Committing**: For each group, you can:
    - Accept and commit the group
    - Skip the group
    - Review the generated commit message before confirming

**Example output:**

```
🔴 High Priority: Add user authentication system
   Files: src/auth/, tests/auth.spec.ts
   Reasoning: Core authentication functionality with corresponding tests

🟡 Medium Priority: Update configuration files
   Files: package.json, tsconfig.json
   Reasoning: Project configuration updates to support new auth system

🟢 Low Priority: Fix code formatting
   Files: src/utils/helpers.ts
   Reasoning: Style-only changes separate from functional updates
```

This mode is perfect for:

- Breaking down large features into reviewable chunks
- Separating functional changes from styling/formatting updates
- Creating atomic commits that follow single-responsibility principle
- Maintaining clean git history with logical commit boundaries

> **Note**: Split mode requires staged changes. Use `--stage-all` to automatically stage all modified files.

## Commit Message Standards

This project uses [commitlint](https://commitlint.js.org/) with [Conventional Commits](https://conventionalcommits.org/) to ensure consistent commit message formatting. The configuration is automatically enforced via Git hooks powered by [husky](https://typicode.github.io/husky/).

### Conventional Commit Format

Commit messages must follow this format:

```
<type>[(optional scope)]: <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

**Examples:**

```bash
feat: add user authentication
fix: resolve memory leak in data processing
docs: update installation instructions
chore: bump dependencies to latest versions
```

### Manual Validation

You can manually check your commit messages using:

```bash
npm run commitlint
```

The commit message validation runs automatically when you commit, so invalid messages will be rejected before they're added to the repository.

## Configuration

### Reading a configuration value

To retrieve a configuration option, use the command:

```sh
aicommits config get <key>
```

### Setting a configuration value

To set a configuration option, use the command:

```sh
aicommits config set <key>=<value>
```

### Options

#### apiKey

Required for OpenAI and Anthropic providers

The API key needed for your provider.

#### baseUrl

Required

The base URL for your AI provider's API. Default values:

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com`

For Ollama users, use `http://localhost:11434/v1` with the OpenAI provider (see setup notes above).

#### profile

Default: `default`

The configuration profile to use. This allows you to maintain different configurations for different projects or environments. You can switch between profiles using the `--profile` flag:

```sh
aicommits --profile development
```

To set a configuration value for a specific profile:

```sh
aicommits config set apiKey <key> --profile development
```

You can also select the active profile via the `AIC_PROFILE` environment variable. See "Environment variables" below for details and precedence rules.

#### locale

Default: `en`

The locale to use for the generated commit messages. Consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes.

#### model

**Required**

The model to use for generating commit messages. The available models depend on your chosen provider:

- OpenAI: Various GPT models (e.g., `gpt-4`, `gpt-4o`, `gpt-4o-mini`)
- Anthropic: Claude models (e.g., `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`)
- Ollama: Use your local model names with the OpenAI provider setup (e.g., `llama3.2`, `mistral`)

#### max-length

The maximum character length of the generated commit message.

Default: `50`

```sh
aicommits config set maxLength 100
```

#### type

Default: `""` (Empty string)

The type of commit message to generate. Set this to "conventional" to generate commit messages that follow the Conventional Commits specification:

```sh
aicommits config set type conventional
```

You can clear this option by setting it to an empty string:

```sh
aicommits config set type ""
```

### Environment variables

You can control some behavior via environment variables:

- **AIC_PROFILE**: Selects the active configuration profile when running the CLI.
    - **Precedence**: `--profile` flag > `AIC_PROFILE` env var > `currentProfile` in `~/.aicommits.yaml` > `default`.
    - **macOS/Linux**:
        ```sh
        AIC_PROFILE=production aicommits
        ```
    - **Windows (PowerShell)**:
        ```powershell
        $env:AIC_PROFILE = 'staging'; aicommits
        ```
    - **Windows (cmd.exe)**:
        ```bat
        set AIC_PROFILE=staging && aicommits
        ```
    - If `AIC_PROFILE` is an empty string or unset, the CLI falls back to the value from your config file's `currentProfile`, or `default` if not set.

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to your chosen AI provider, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Recent Changes

### 🚀 **Migration to Vercel AI SDK v5**

We've completely migrated from custom AI provider implementations to the official [Vercel AI SDK v5](https://ai-sdk.dev/), bringing several improvements:

**✅ Benefits:**

- **Better Performance**: Direct integration with AI SDK's optimized request handling
- **Improved Reliability**: Uses battle-tested provider implementations
- **Future-Proof**: Automatic access to new AI SDK features and provider updates
- **Simplified Codebase**: Removed ~400+ lines of custom provider wrapper code

**⚠️ Breaking Changes:**

- **Ollama**: Temporarily removed native support (use OpenAI-compatible mode as workaround)
- **Configuration**: Users with Ollama configs will need to run `aicommits setup` to reconfigure

**🔄 For Ollama Users:**

1. Start Ollama: `OLLAMA_ORIGINS="*" ollama serve`
2. Run: `aicommits setup`
3. Choose "OpenAI (compatible)" as provider
4. Set base URL: `http://localhost:11434/v1`
5. Use any API key (ignored by Ollama)
6. Select your local model name

Native Ollama support will return once the AI SDK v5 adds official support.

## Maintainers

- **Luca Becker**: [@lucavb](https://github.com/lucavb)
- **Hassan El Mghari**: [@Nutlope](https://github.com/Nutlope) [<img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/nutlope)
- **Hiroki Osame**: [@privatenumber](https://github.com/privatenumber) [<img src="https://img.shields.io/twitter/follow/privatenumbr?style=flat&label=privatenumbr&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/privatenumbr)

## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/lucavb/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project

## Support & Links

- [Documentation](https://github.com/lucavb/aicommits#readme)
- [Report Issues](https://github.com/lucavb/aicommits/issues)
- [NPM Package](https://www.npmjs.com/package/@lucavb/aicommits)
- [License](./LICENSE)
