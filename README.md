# @lucavb/aicommits

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

    - Selecting your AI provider (OpenAI, Ollama, or Anthropic)
    - Configuring the API base URL
    - Setting up your API key (if required)
    - Choosing the model to use

    You can also set up different profiles for different projects or environments:

    ```sh
    aicommits setup --profile development
    ```

    > Note: For OpenAI, you'll need an API key from [OpenAI's platform](https://platform.openai.com/account/api-keys). Make sure you have an account and billing set up.

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
- Ollama: `http://localhost:11434`
- Anthropic: `https://api.anthropic.com`

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

#### locale

Default: `en`

The locale to use for the generated commit messages. Consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes.

#### model

**Required**

The model to use for generating commit messages. The available models depend on your chosen provider:

- OpenAI: Various GPT models (e.g., `gpt-4.1`, `gpt-4o`)
- Ollama: Local models you have pulled (e.g., `llama4`, `mistral`)
- Anthropic: Claude models (e.g., `claude-3-7-sonnet-20250219`)

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

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

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
