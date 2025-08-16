import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService, type CreatePROptions } from './github.service';
import { KnownError } from '../utils/error';

// Create mock function using vi.hoisted to ensure it's available during module loading
const mockExecAsync = vi.hoisted(() => vi.fn());

// Mock the entire child_process and util modules
vi.mock('child_process', () => ({
    exec: vi.fn(),
}));

vi.mock('util', () => ({
    promisify: () => mockExecAsync,
}));

describe('GitHubService', () => {
    let githubService: GitHubService;

    beforeEach(() => {
        vi.clearAllMocks();
        githubService = new GitHubService();
    });

    describe('validateGitHubCli', () => {
        it('should pass when gh is installed', async () => {
            mockExecAsync.mockResolvedValue({ stdout: 'gh version 2.32.1', stderr: '' });

            await expect(githubService.validateGitHubCli()).resolves.toBeUndefined();
            expect(mockExecAsync).toHaveBeenCalledWith('gh --version');
        });

        it('should throw KnownError when gh is not installed', async () => {
            mockExecAsync.mockRejectedValue(new Error('command not found'));

            await expect(githubService.validateGitHubCli()).rejects.toThrow(KnownError);
            await expect(githubService.validateGitHubCli()).rejects.toThrow(
                'GitHub CLI (gh) is not installed or not available in PATH'
            );
        });
    });

    describe('checkAuthentication', () => {
        it('should return true when authenticated', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: '✓ Logged in to github.com as testuser',
                stderr: '',
            });

            const result = await githubService.checkAuthentication();
            expect(result).toBe(true);
            expect(mockExecAsync).toHaveBeenCalledWith('gh auth status');
        });

        it('should return false when not authenticated', async () => {
            mockExecAsync.mockRejectedValue(new Error('not authenticated'));

            const result = await githubService.checkAuthentication();
            expect(result).toBe(false);
        });

        it('should return false when output does not indicate login', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'Not logged in',
                stderr: '',
            });

            const result = await githubService.checkAuthentication();
            expect(result).toBe(false);
        });
    });

    describe('getAuthToken', () => {
        it('should return token when available', async () => {
            const mockToken = 'ghp_test_token_123';
            mockExecAsync.mockResolvedValue({ stdout: `${mockToken}\n`, stderr: '' });

            const result = await githubService.getAuthToken();
            expect(result).toBe(mockToken);
            expect(mockExecAsync).toHaveBeenCalledWith('gh auth token');
        });

        it('should throw KnownError when token command fails', async () => {
            mockExecAsync.mockRejectedValue(new Error('not authenticated'));

            await expect(githubService.getAuthToken()).rejects.toThrow(KnownError);
            await expect(githubService.getAuthToken()).rejects.toThrow(
                'Failed to get authentication token from GitHub CLI'
            );
        });

        it('should throw KnownError when token is empty', async () => {
            mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

            await expect(githubService.getAuthToken()).rejects.toThrow(KnownError);
        });
    });

    describe('getRepository', () => {
        it('should return repository info when valid', async () => {
            const mockRepoData = {
                owner: { login: 'testowner' },
                name: 'testrepo',
            };
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockRepoData),
                stderr: '',
            });

            const result = await githubService.getRepository();
            expect(result).toEqual({
                owner: 'testowner',
                repo: 'testrepo',
            });
            expect(mockExecAsync).toHaveBeenCalledWith('gh repo view --json owner,name');
        });

        it('should throw KnownError when command fails', async () => {
            mockExecAsync.mockRejectedValue(new Error('not a git repository'));

            await expect(githubService.getRepository()).rejects.toThrow(KnownError);
            await expect(githubService.getRepository()).rejects.toThrow(
                'Failed to get repository information'
            );
        });

        it('should throw KnownError when response is invalid', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify({ invalid: 'data' }),
                stderr: '',
            });

            await expect(githubService.getRepository()).rejects.toThrow(KnownError);
        });
    });

    describe('checkExistingPR', () => {
        it('should return PR URL when PR exists', async () => {
            const mockPRData = [{ url: 'https://github.com/owner/repo/pull/123' }];
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockPRData),
                stderr: '',
            });

            const result = await githubService.checkExistingPR('main', 'feature');
            expect(result).toBe('https://github.com/owner/repo/pull/123');
            expect(mockExecAsync).toHaveBeenCalledWith(
                'gh pr list --base "main" --head "feature" --json url --limit 1'
            );
        });

        it('should return null when no PR exists', async () => {
            mockExecAsync.mockResolvedValue({ stdout: '[]', stderr: '' });

            const result = await githubService.checkExistingPR('main', 'feature');
            expect(result).toBeNull();
        });

        it('should return null when command fails', async () => {
            mockExecAsync.mockRejectedValue(new Error('command failed'));

            const result = await githubService.checkExistingPR('main', 'feature');
            expect(result).toBeNull();
        });
    });

    describe('createPullRequest', () => {
        const validOptions: CreatePROptions = {
            title: 'Test PR',
            body: 'Test description',
            base: 'main',
            head: 'feature',
        };

        beforeEach(() => {
            // Mock checkExistingPR to return null (no existing PR)
            vi.spyOn(githubService, 'checkExistingPR').mockResolvedValue(null);
            // Mock getRepository to return valid repository info
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
        });

        it('should create PR successfully', async () => {
            const mockPRResult = {
                url: 'https://github.com/owner/repo/pull/123',
                number: 123,
            };
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockPRResult),
                stderr: '',
            });

            const result = await githubService.createPullRequest(validOptions);
            expect(result).toEqual(mockPRResult);
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining("gh pr create --title 'Test PR' --body 'Test description'")
            );
        });

        it('should create draft PR when draft option is true', async () => {
            const mockPRResult = {
                url: 'https://github.com/owner/repo/pull/123',
                number: 123,
            };
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockPRResult),
                stderr: '',
            });

            await githubService.createPullRequest({ ...validOptions, draft: true });
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('--draft')
            );
        });

        it('should escape shell arguments properly', async () => {
            const optionsWithQuotes: CreatePROptions = {
                title: "Test 'PR' with quotes",
                body: 'Description with "quotes"',
                base: 'main',
                head: 'feature',
            };

            const mockPRResult = {
                url: 'https://github.com/owner/repo/pull/123',
                number: 123,
            };
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockPRResult),
                stderr: '',
            });

            await githubService.createPullRequest(optionsWithQuotes);
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining("'Test '\\''PR'\\'' with quotes'")
            );
        });

        it('should throw KnownError when title is empty', async () => {
            const invalidOptions = { ...validOptions, title: '' };

            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                'PR title cannot be empty'
            );
        });

        it('should throw KnownError when title is too long', async () => {
            const invalidOptions = { ...validOptions, title: 'a'.repeat(257) };

            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                'PR title is too long'
            );
        });

        it('should throw KnownError when description is too long', async () => {
            const invalidOptions = { ...validOptions, body: 'a'.repeat(65537) };

            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                'PR description is too long'
            );
        });

        it('should throw KnownError for invalid branch names', async () => {
            const invalidOptions = { ...validOptions, base: 'invalid branch name!' };

            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                'Invalid base branch name'
            );
        });

        it('should throw KnownError when repository access fails', async () => {
            vi.spyOn(githubService, 'getRepository').mockRejectedValue(new Error('Access denied'));

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'Cannot access repository information'
            );
        });

        it('should throw KnownError when base and head are the same', async () => {
            const invalidOptions = { ...validOptions, base: 'main', head: 'main' };

            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(invalidOptions)).rejects.toThrow(
                'Base and head branches cannot be the same'
            );
        });

        it('should throw KnownError when PR already exists', async () => {
            vi.spyOn(githubService, 'checkExistingPR').mockResolvedValue(
                'https://github.com/owner/repo/pull/456'
            );

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'A pull request already exists'
            );
        });

        it('should throw KnownError with helpful message for no commits error', async () => {
            // Override the repository mock for this specific test
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
            mockExecAsync.mockRejectedValue(new Error('No commits between main and feature'));

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'No commits found between'
            );
        });

        it('should throw KnownError with helpful message for branch not found error', async () => {
            // Override the repository mock for this specific test
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
            mockExecAsync.mockRejectedValue(new Error('branch not found'));

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'One of the specified branches was not found'
            );
        });

        it('should throw KnownError with helpful message for authentication error', async () => {
            // Override the repository mock for this specific test
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
            mockExecAsync.mockRejectedValue(new Error('authentication failed'));

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'GitHub authentication failed'
            );
        });

        it('should throw KnownError for generic errors', async () => {
            // Override the repository mock for this specific test
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
            mockExecAsync.mockRejectedValue(new Error('Some other error'));

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                'Failed to create pull request: Some other error'
            );
        });

        it('should throw KnownError when PR creation response is invalid', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify({ invalid: 'response' }),
                stderr: '',
            });

            await expect(githubService.createPullRequest(validOptions)).rejects.toThrow(
                KnownError
            );
        });
    });

    describe('escapeShellArg (private method behavior)', () => {
        it('should handle arguments with single quotes correctly in PR creation', async () => {
            const optionsWithQuotes: CreatePROptions = {
                title: "Test's PR",
                body: "It's a test",
                base: 'main',
                head: 'feature',
            };

            vi.spyOn(githubService, 'checkExistingPR').mockResolvedValue(null);
            vi.spyOn(githubService, 'getRepository').mockResolvedValue({ owner: 'test', repo: 'repo' });
            
            const mockPRResult = {
                url: 'https://github.com/owner/repo/pull/123',
                number: 123,
            };
            mockExecAsync.mockResolvedValue({
                stdout: JSON.stringify(mockPRResult),
                stderr: '',
            });

            await githubService.createPullRequest(optionsWithQuotes);
            
            // Verify that single quotes are properly escaped
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining("'Test'\\''s PR'")
            );
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining("'It'\\''s a test'")
            );
        });
    });
});