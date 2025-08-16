import { exec } from 'child_process';
import { promisify } from 'util';
import { Injectable } from '../utils/inversify';
import { KnownError } from '../utils/error';

const execAsync = promisify(exec);

export interface CreatePROptions {
    title: string;
    body: string;
    base: string;
    head: string;
    draft?: boolean;
}

export interface PRResult {
    url: string;
    number: number;
}

export interface RepositoryInfo {
    owner: string;
    repo: string;
}

@Injectable()
export class GitHubService {
    /**
     * Validate that GitHub CLI is installed and available
     */
    async validateGitHubCli(): Promise<void> {
        try {
            await execAsync('gh --version');
        } catch {
            throw new KnownError(
                'GitHub CLI (gh) is not installed or not available in PATH.\n' +
                'Please install it from: https://cli.github.com/\n' +
                'Or install via package manager:\n' +
                '  - macOS: brew install gh\n' +
                '  - Windows: winget install GitHub.cli\n' +
                '  - Linux: See https://github.com/cli/cli/blob/trunk/docs/install_linux.md'
            );
        }
    }

    /**
     * Check if user is authenticated with GitHub CLI
     */
    async checkAuthentication(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('gh auth status');
            return stdout.includes('Logged in to github.com');
        } catch {
            return false;
        }
    }

    /**
     * Get authentication token from GitHub CLI
     */
    async getAuthToken(): Promise<string> {
        try {
            const { stdout } = await execAsync('gh auth token');
            const token = stdout.trim();
            if (!token) {
                throw new Error('Empty token received');
            }
            return token;
        } catch {
            throw new KnownError(
                'Failed to get authentication token from GitHub CLI.\n' +
                'Please run: gh auth login'
            );
        }
    }

    /**
     * Get repository information (owner and repo name)
     */
    async getRepository(): Promise<RepositoryInfo> {
        try {
            const { stdout } = await execAsync('gh repo view --json owner,name');
            const repoData = JSON.parse(stdout);
            
            if (!repoData.owner?.login || !repoData.name) {
                throw new Error('Invalid repository data received');
            }

            return {
                owner: repoData.owner.login,
                repo: repoData.name,
            };
        } catch (error) {
            if (error instanceof KnownError) {
                throw error;
            }
            throw new KnownError(
                'Failed to get repository information. Make sure you are in a GitHub repository directory.\n' +
                'If this is a new repository, make sure it has been pushed to GitHub.'
            );
        }
    }

    /**
     * Check if a PR already exists between the specified branches
     */
    async checkExistingPR(base: string, head: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `gh pr list --base "${base}" --head "${head}" --json url --limit 1`
            );
            const prs = JSON.parse(stdout);
            
            if (prs.length > 0 && prs[0].url) {
                return prs[0].url;
            }
            
            return null;
        } catch {
            // If command fails, assume no existing PR
            return null;
        }
    }

    /**
     * Create a pull request using GitHub CLI
     */
    async createPullRequest(options: CreatePROptions): Promise<PRResult> {
        const { title, body, base, head, draft = false } = options;

        // Comprehensive input validation
        if (!title || !title.trim()) {
            throw new KnownError('PR title cannot be empty');
        }
        if (title.trim().length > 256) {
            throw new KnownError('PR title is too long (maximum 256 characters)');
        }
        if (!base || !base.trim() || !head || !head.trim()) {
            throw new KnownError('Base and head branches must be specified');
        }
        if (base.trim() === head.trim()) {
            throw new KnownError('Base and head branches cannot be the same');
        }
        if (body && body.length > 65536) {
            throw new KnownError('PR description is too long (maximum 65536 characters)');
        }

        // Validate branch names (basic format check)
        const branchNameRegex = /^[a-zA-Z0-9._/-]+$/;
        if (!branchNameRegex.test(base.trim())) {
            throw new KnownError(`Invalid base branch name: ${base}`);
        }
        if (!branchNameRegex.test(head.trim())) {
            throw new KnownError(`Invalid head branch name: ${head}`);
        }

        // Check for existing PR
        const existingPR = await this.checkExistingPR(base, head);
        if (existingPR) {
            throw new KnownError(
                `A pull request already exists between ${head} and ${base}:\n${existingPR}`
            );
        }

        // Verify repository access before attempting PR creation
        try {
            await this.getRepository();
        } catch (error) {
            throw new KnownError(
                'Cannot access repository information. Please verify:\n' +
                '1. You are in a GitHub repository directory\n' +
                '2. The repository exists on GitHub\n' +
                '3. You have access to the repository\n' +
                '4. GitHub CLI is properly authenticated'
            );
        }

        try {
            // Escape title and body for shell execution
            const escapedTitle = this.escapeShellArg(title);
            const escapedBody = this.escapeShellArg(body);
            const draftFlag = draft ? '--draft' : '';

            const command = `gh pr create --title ${escapedTitle} --body ${escapedBody} --base "${base}" --head "${head}" ${draftFlag} --json url,number`;
            
            const { stdout } = await execAsync(command);
            const result = JSON.parse(stdout);

            if (!result.url || !result.number) {
                throw new Error('Invalid PR creation response');
            }

            return {
                url: result.url,
                number: result.number,
            };
        } catch (error) {
            if (error instanceof KnownError) {
                throw error;
            }

            // Parse GitHub CLI error messages for better user experience
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (errorMessage.includes('No commits between')) {
                throw new KnownError(
                    `No commits found between ${base} and ${head}. ` +
                    'Make sure your branch has commits that differ from the base branch.'
                );
            }
            
            if (errorMessage.includes('not found')) {
                throw new KnownError(
                    `One of the specified branches was not found. ` +
                    `Please verify that both '${base}' and '${head}' branches exist.`
                );
            }

            if (errorMessage.includes('authentication')) {
                throw new KnownError(
                    'GitHub authentication failed. Please run: gh auth login'
                );
            }

            throw new KnownError(
                `Failed to create pull request: ${errorMessage}\n` +
                'Please check your branch names and repository permissions.'
            );
        }
    }

    /**
     * Escape shell arguments to prevent command injection
     */
    private escapeShellArg(arg: string): string {
        // Replace single quotes with '\'' and wrap in single quotes
        return `'${arg.replace(/'/g, "'\\''")}'`;
    }
}