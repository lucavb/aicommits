# Product Overview

**@lucavb/aicommits** is an AI-powered CLI tool that generates meaningful git commit messages by analyzing staged changes. It helps developers maintain consistent, high-quality commit messages without manual effort.

## Key Features

- **AI-Powered**: Uses OpenAI GPT or Anthropic Claude models to analyze git diffs and generate contextual commit messages
- **Multi-Provider Support**: Supports OpenAI, Anthropic, and Ollama (via OpenAI-compatible API)
- **Profile Management**: Multiple configuration profiles for different projects/environments
- **Conventional Commits**: Optional support for Conventional Commits specification
- **Commit Splitting**: AI-guided splitting of large changes into focused, logical commits
- **Git Integration**: Works as both standalone CLI and git prepare-commit-msg hook
- **Internationalization**: Supports multiple languages for commit messages

## Target Users

- Individual developers seeking consistent commit message quality
- Development teams maintaining clean git history
- Projects following Conventional Commits standards
- Developers working across multiple environments/projects

## Distribution

- Published as npm package: `@lucavb/aicommits`
- Global CLI installation with `aicommits` and `aic` commands
- MIT licensed, open source