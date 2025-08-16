# Design Document

## Overview

The PR creation feature extends the existing `agent` command with a new `pr` subcommand that creates GitHub Pull Requests with AI-generated descriptions. The feature leverages the existing GitService for git operations, integrates with GitHub CLI for authentication and API access, and uses the AI services for intelligent content generation.

The implementation follows the established patterns in the codebase:
- Command structure using Commander.js with subcommands
- Dependency injection using Inversify container
- Service-based architecture with clear separation of concerns
- Error handling using KnownError for user-friendly messages
- UI interactions using ClackPromptService for consistent user experience

## Architecture

### Command Structure
```
aicommits agent pr [options]
```

The PR subcommand will be added to the existing `agentCommand` using Commander.js's `addCommand` method, following the same pattern as the `config` and `ignore` commands.

### Service Dependencies
- **GitService**: For git operations (branch detection, diff generation, repository validation)
- **AIAgentService**: For generating PR titles and descriptions using AI
- **ClackPromptService**: For user interactions and progress feedback
- **ConfigService**: For accessing user configuration and AI provider settings
- **GitHubService** (new): For GitHub CLI integration and PR creation

### Data Flow
1. Validate GitHub CLI installation and authentication
2. Detect or validate base/head branches
3. Check branch synchronization status with remote
4. Fetch latest changes if needed and warn user about out-of-sync branches
5. Generate diff between branches
6. Use AI to analyze changes and generate PR content
7. Present preview to user for review/editing
8. Create PR via GitHub CLI
9. Display success message with PR link

## Components and Interfaces

### GitHubService
A new service responsible for GitHub CLI integration and PR operations.

```typescript
@Injectable()
export class GitHubService {
    async validateGitHubCli(): Promise<void>
    async checkAuthentication(): Promise<boolean>
    async getAuthToken(): Promise<string>
    async createPullRequest(options: CreatePROptions): Promise<PRResult>
    async checkExistingPR(base: string, head: string): Promise<string | null>
    async getRepository(): Promise<{ owner: string; repo: string }>
}
```

### Extended GitService Methods
Add branch synchronization methods to the existing GitService:

```typescript
// New methods to add to GitService
async getBranchTrackingStatus(branch: string): Promise<BranchStatus>
async fetchFromRemote(): Promise<void>
async getBranchDiff(base: string, head: string): Promise<{ files: string[]; diff: string }>
async getCurrentBranch(): Promise<string>
async getDefaultBranch(): Promise<string>

interface BranchStatus {
    ahead: number;
    behind: number;
    upToDate: boolean;
    hasRemote: boolean;
}

interface CreatePROptions {
    title: string;
    body: string;
    base: string;
    head: string;
    draft?: boolean;
}

interface PRResult {
    url: string;
    number: number;
}
```

### PR Command Handler
A new command handler that orchestrates the PR creation process.

```typescript
export const createPullRequest = async ({
    container,
    base,
    head,
    draft = false,
}: {
    container: Container;
    base?: string;
    head?: string;
    draft?: boolean;
}) => Promise<void>
```

### AI Integration
Extend the existing AIAgentService or create specialized prompts for PR content generation:

```typescript
interface PRContentRequest {
    diff: string;
    files: string[];
    baseBranch: string;
    headBranch: string;
}

interface PRContentResponse {
    title: string;
    description: string;
}
```

## Data Models

### Branch Information
```typescript
interface BranchInfo {
    base: string;
    head: string;
    baseSha: string;
    headSha: string;
}
```

### File Change Analysis
```typescript
interface FileChangeAnalysis {
    files: string[];
    additions: number;
    deletions: number;
    categories: {
        [category: string]: string[];
    };
}
```

### PR Template Data
```typescript
interface PRTemplateData {
    title: string;
    description: string;
    fileChanges: FileChangeAnalysis;
    branchInfo: BranchInfo;
}
```

## Error Handling

### GitHub CLI Validation
- Check if `gh` command is available in PATH
- Verify authentication status with `gh auth status`
- Provide clear installation/authentication instructions on failure

### Repository Validation
- Ensure current directory is a git repository
- Verify repository has GitHub remote
- Check that specified branches exist
- Verify head branch is up to date with its remote tracking branch
- Check if base branch needs to be fetched from remote

### PR Creation Errors
- Handle existing PR conflicts
- Manage API rate limiting
- Provide meaningful error messages for GitHub API failures

### User Input Validation
- Validate branch names exist
- Ensure base and head branches are different
- Check for uncommitted changes that might affect diff

## Testing Strategy

### Unit Tests
- **GitHubService**: Mock GitHub CLI commands and test all methods
- **PR Command Handler**: Test command flow with mocked dependencies
- **AI Integration**: Test PR content generation with sample diffs
- **Error Handling**: Verify proper error messages and recovery

### Integration Tests
- **GitHub CLI Integration**: Test with actual `gh` commands (in CI environment)
- **Git Operations**: Test branch detection and diff generation
- **End-to-End Flow**: Test complete PR creation process with test repository

### Manual Testing
- Test with various repository states (clean, dirty, different branches)
- Verify AI-generated content quality with different types of changes
- Test error scenarios (no auth, missing branches, existing PRs)
- Validate user experience and prompt flows

## Implementation Considerations

### GitHub CLI Integration
- Use `child_process.exec` or `execa` for running GitHub CLI commands
- Parse JSON output from `gh` commands for structured data
- Handle authentication token extraction securely
- Implement proper error parsing from CLI output

### AI Content Generation
- Design prompts that analyze file changes effectively
- Include context about file types and change patterns
- Generate concise but informative PR descriptions
- Handle large diffs by summarizing or truncating appropriately

### User Experience
- Provide clear progress indicators during operations
- Allow editing of generated content before PR creation
- Show preview of PR content with formatting
- Offer option to create draft PRs for review

### Performance
- Cache GitHub CLI authentication checks
- Optimize diff generation for large changesets
- Implement timeout handling for AI requests
- Use streaming for large file analysis

### Security
- Never log or expose authentication tokens
- Validate all user inputs to prevent command injection
- Use secure methods for executing shell commands
- Handle sensitive repository information appropriately