import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { Container } from 'inversify';
import { createPullRequest } from './pr';
import { GitService } from '../services/git.service';
import { GitHubService } from '../services/github.service';
import { AIPRContentService } from '../services/ai-pr-content.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ConfigService } from '../services/config.service';
import { KnownError } from '../utils/error';

// Mock all services
vi.mock('../services/git.service');
vi.mock('../services/github.service');
vi.mock('../services/ai-pr-content.service');
vi.mock('../services/clack-prompt.service');
vi.mock('../services/config.service');

describe('createPullRequest', () => {
    let container: Container;
    let mockGitService: vi.Mocked<GitService>;
    let mockGitHubService: vi.Mocked<GitHubService>;
    let mockAIPRContentService: vi.Mocked<AIPRContentService>;
    let mockPromptUI: vi.Mocked<ClackPromptService>;
    let mockConfigService: vi.Mocked<ConfigService>;
    let mockProcessExit: MockedFunction<typeof process.exit>;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock process.exit
        mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit called');
        });

        // Create container and mock services
        container = new Container();
        
        mockGitService = {
            assertGitRepo: vi.fn(),
            getCurrentBranch: vi.fn(),
            getDefaultBranch: vi.fn(),
            getBranchTrackingStatus: vi.fn(),
            getBranchDiff: vi.fn(),
            validateBranchExists: vi.fn(),
            getCommitHash: vi.fn(),
            fetchFromRemote: vi.fn(),
        } as any;

        mockGitHubService = {
            validateGitHubCli: vi.fn(),
            checkAuthentication: vi.fn(),
            createPullRequest: vi.fn(),
            getRepository: vi.fn(),
        } as any;

        mockAIPRContentService = {
            generatePRContent: vi.fn(),
        } as any;

        mockPromptUI = {
            intro: vi.fn(),
            note: vi.fn(),
            outro: vi.fn(),
            spinner: vi.fn(),
            confirm: vi.fn(),
            text: vi.fn(),
            isCancel: vi.fn(),
            log: {
                step: vi.fn(),
                message: vi.fn(),
            },
        } as any;

        mockConfigService = {
            readConfig: vi.fn(),
            validConfig: vi.fn(),
        } as any;

        // Bind mocks to container
        container.bind(GitService).toConstantValue(mockGitService);
        container.bind(GitHubService).toConstantValue(mockGitHubService);
        container.bind(AIPRContentService).toConstantValue(mockAIPRContentService);
        container.bind(ClackPromptService).toConstantValue(mockPromptUI);
        container.bind(ConfigService).toConstantValue(mockConfigService);

        // Setup default mock implementations
        const mockSpinner = {
            start: vi.fn(),
            stop: vi.fn(),
            message: vi.fn(),
        };
        mockPromptUI.spinner.mockReturnValue(mockSpinner);
        mockPromptUI.isCancel.mockReturnValue(false);
        mockConfigService.validConfig.mockReturnValue({ valid: true });
        mockGitHubService.getRepository.mockResolvedValue({ owner: 'test', repo: 'repo' });
        mockGitHubService.checkAuthentication.mockResolvedValue(true);
        mockGitService.getCurrentBranch.mockResolvedValue('feature-branch');
        mockGitService.getDefaultBranch.mockResolvedValue('main');
        mockGitService.validateBranchExists.mockResolvedValue(undefined);
        mockGitService.getBranchTrackingStatus.mockResolvedValue({
            ahead: 1,
            behind: 0,
            upToDate: false,
            hasRemote: true,
        });
        mockGitService.getBranchDiff.mockResolvedValue({
            files: ['src/test.ts'],
            diff: 'mock diff content',
        });
        mockAIPRContentService.generatePRContent.mockResolvedValue({
            title: 'Test PR Title',
            description: 'Test PR Description',
        });
        // Setup confirm to return false for editing by default, true for final confirmation
        mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
        mockPromptUI.confirm.mockResolvedValue(true); // shouldCreate
        mockGitHubService.createPullRequest.mockResolvedValue({
            url: 'https://github.com/test/repo/pull/123',
            number: 123,
        });
    });

    describe('successful PR creation', () => {
        it('should create PR with default branches', async () => {
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockGitService.getCurrentBranch).toHaveBeenCalled();
            expect(mockGitService.getDefaultBranch).toHaveBeenCalled();
            expect(mockGitService.getBranchDiff).toHaveBeenCalledWith('main', 'feature-branch');
            expect(mockAIPRContentService.generatePRContent).toHaveBeenCalledWith({
                diff: 'mock diff content',
                files: ['src/test.ts'],
                baseBranch: 'main',
                headBranch: 'feature-branch',
            });
            expect(mockGitHubService.createPullRequest).toHaveBeenCalledWith({
                title: 'Test PR Title',
                body: 'Test PR Description',
                base: 'main',
                head: 'feature-branch',
                draft: false,
            });
        });

        it('should create PR with custom branches', async () => {
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({
                container,
                base: 'develop',
                head: 'custom-feature',
            });

            expect(mockGitService.getBranchDiff).toHaveBeenCalledWith('develop', 'custom-feature');
            expect(mockGitHubService.createPullRequest).toHaveBeenCalledWith({
                title: 'Test PR Title',
                body: 'Test PR Description',
                base: 'develop',
                head: 'custom-feature',
                draft: false,
            });
        });

        it('should create draft PR when specified', async () => {
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({
                container,
                draft: true,
            });

            expect(mockGitHubService.createPullRequest).toHaveBeenCalledWith({
                title: 'Test PR Title',
                body: 'Test PR Description',
                base: 'main',
                head: 'feature-branch',
                draft: true,
            });
        });

        it('should allow editing PR content', async () => {
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate
            mockPromptUI.text.mockResolvedValueOnce('Edited Title');
            mockPromptUI.text.mockResolvedValueOnce('Edited Description');

            await createPullRequest({ container });

            expect(mockPromptUI.text).toHaveBeenCalledWith({
                message: 'Edit PR title:',
                initialValue: 'Test PR Title',
            });
            expect(mockPromptUI.text).toHaveBeenCalledWith({
                message: 'Edit PR description:',
                initialValue: 'Test PR Description',
            });
            expect(mockGitHubService.createPullRequest).toHaveBeenCalledWith({
                title: 'Edited Title',
                body: 'Edited Description',
                base: 'main',
                head: 'feature-branch',
                draft: false,
            });
        });
    });

    describe('validation errors', () => {
        it('should exit when config is invalid', async () => {
            mockConfigService.validConfig.mockReturnValue({ valid: false });

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('aicommits setup')
            );
        });

        it('should exit when GitHub CLI is not authenticated', async () => {
            mockGitHubService.checkAuthentication.mockResolvedValue(false);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
        });

        it('should throw error when base and head branches are the same', async () => {
            mockGitService.getCurrentBranch.mockResolvedValue('main');
            mockGitService.getDefaultBranch.mockResolvedValue('main');

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
        });

        it('should throw error when no changes found between branches', async () => {
            mockGitService.getBranchDiff.mockResolvedValue({
                files: [],
                diff: '',
            });

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
        });
    });

    describe('user interactions', () => {
        it('should cancel PR creation when user cancels confirmation', async () => {
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldCreate

            await createPullRequest({ container });

            expect(mockGitHubService.createPullRequest).not.toHaveBeenCalled();
            expect(mockPromptUI.outro).toHaveBeenCalledWith('PR creation cancelled');
        });

        it('should cancel PR creation when user cancels with isCancel', async () => {
            const cancelSymbol = Symbol('cancel');
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(cancelSymbol as any); // shouldCreate
            mockPromptUI.isCancel.mockReturnValue(true);

            await createPullRequest({ container });

            expect(mockGitHubService.createPullRequest).not.toHaveBeenCalled();
            expect(mockPromptUI.outro).toHaveBeenCalledWith('PR creation cancelled');
        });

        it('should handle branch synchronization warning', async () => {
            mockGitService.getBranchTrackingStatus.mockResolvedValue({
                ahead: 0,
                behind: 2,
                upToDate: false,
                hasRemote: true,
            });
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(true); // continue anyway
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockPromptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('2 commit(s) behind')
            );
            expect(mockPromptUI.confirm).toHaveBeenCalledWith({
                message: 'Continue with PR creation anyway?',
            });
        });

        it('should cancel when user declines to continue with out-of-sync branch', async () => {
            mockGitService.getBranchTrackingStatus.mockResolvedValue({
                ahead: 0,
                behind: 2,
                upToDate: false,
                hasRemote: true,
            });
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // decline fetch
            mockPromptUI.confirm.mockResolvedValueOnce(false); // decline to continue

            await createPullRequest({ container });

            expect(mockGitHubService.createPullRequest).not.toHaveBeenCalled();
            expect(mockPromptUI.outro).toHaveBeenCalledWith('PR creation cancelled');
        });

        it('should offer to fetch when branch is behind', async () => {
            mockGitService.getBranchTrackingStatus.mockResolvedValue({
                ahead: 1,
                behind: 2,
                upToDate: false,
                hasRemote: true,
            });
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(true); // accept fetch
            mockPromptUI.confirm.mockResolvedValueOnce(true); // continue
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockGitService.fetchFromRemote).toHaveBeenCalled();
            expect(mockPromptUI.confirm).toHaveBeenCalledWith({
                message: 'Would you like to fetch the latest changes first?',
            });
        });

        it('should warn about branches with no commits ahead', async () => {
            mockGitService.getBranchTrackingStatus.mockResolvedValue({
                ahead: 0,
                behind: 0,
                upToDate: true,
                hasRemote: true,
            });
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(true); // continue anyway
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockPromptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('no commits ahead')
            );
            expect(mockPromptUI.confirm).toHaveBeenCalledWith({
                message: 'Continue anyway? (This may result in an empty PR)',
            });
        });

        it('should handle branches without remote tracking', async () => {
            mockGitService.getBranchTrackingStatus.mockResolvedValue({
                ahead: 0,
                behind: 0,
                upToDate: true,
                hasRemote: false,
            });
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockPromptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('no remote tracking branch')
            );
            expect(mockPromptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('git push -u origin')
            );
        });
    });

    describe('error handling', () => {
        it('should handle repository validation errors', async () => {
            const error = new KnownError('Repository not connected to GitHub');
            mockGitHubService.getRepository.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Repository not connected to GitHub'));
        });

        it('should handle GitHub CLI validation errors', async () => {
            const error = new KnownError('GitHub CLI not found');
            mockGitHubService.validateGitHubCli.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith('✖ GitHub CLI not found');
        });

        it('should handle git repository validation errors', async () => {
            const error = new KnownError('Not a git repository');
            mockGitService.assertGitRepo.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith('✖ Not a git repository');
        });

        it('should handle branch validation errors', async () => {
            const error = new KnownError('Branch does not exist');
            mockGitService.validateBranchExists.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith('✖ Branch does not exist');
        });

        it('should handle branch diff errors with helpful messages', async () => {
            const error = new Error('bad revision main...nonexistent');
            mockGitService.getBranchDiff.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Failed to compare branches'));
        });

        it('should handle AI content generation rate limit errors', async () => {
            const error = new Error('rate limit exceeded');
            mockAIPRContentService.generatePRContent.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('rate limit exceeded'));
        });

        it('should offer fallback content when AI generation fails', async () => {
            const error = new Error('AI service unavailable');
            mockAIPRContentService.generatePRContent.mockRejectedValue(error);
            
            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(true); // continue with basic content
            mockPromptUI.confirm.mockResolvedValueOnce(false); // shouldEdit
            mockPromptUI.confirm.mockResolvedValueOnce(true); // shouldCreate

            await createPullRequest({ container });

            expect(mockPromptUI.confirm).toHaveBeenCalledWith({
                message: 'Continue with basic PR content?',
            });
            expect(mockGitHubService.createPullRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Merge feature-branch into main',
                })
            );
        });

        it('should handle PR creation errors with recovery suggestions', async () => {
            const error = new KnownError('A pull request already exists between feature-branch and main');
            mockGitHubService.createPullRequest.mockRejectedValue(error);

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('already exists'));
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('You can:'));
        });

        it('should handle large changeset warnings', async () => {
            // Create a large diff (> 1MB)
            const largeDiff = 'a'.repeat(1024 * 1024 + 1);
            mockGitService.getBranchDiff.mockResolvedValue({
                files: ['large-file.txt'],
                diff: largeDiff,
            });

            // Reset confirm mock for this test
            mockPromptUI.confirm.mockReset();
            mockPromptUI.confirm.mockResolvedValueOnce(false); // decline large changeset
            
            await createPullRequest({ container });

            expect(mockPromptUI.confirm).toHaveBeenCalledWith({
                message: 'Continue with large changeset?',
            });
            expect(mockPromptUI.outro).toHaveBeenCalledWith('PR creation cancelled');
        });

        it('should handle identical branches error', async () => {
            mockGitService.getBranchDiff.mockResolvedValue({
                files: [],
                diff: '',
            });
            mockGitService.getCommitHash
                .mockResolvedValueOnce('abc123') // base branch
                .mockResolvedValueOnce('abc123'); // head branch (same commit)

            await expect(async () => {
                await createPullRequest({ container });
            }).rejects.toThrow('process.exit called');

            expect(mockProcessExit).toHaveBeenCalledWith(1);
            expect(mockPromptUI.outro).toHaveBeenCalledWith(expect.stringContaining('same commit'));
        });
    });

    describe('progress indicators', () => {
        it('should show appropriate spinner messages', async () => {
            const mockSpinner = {
                start: vi.fn(),
                stop: vi.fn(),
                message: vi.fn(),
            };
            mockPromptUI.spinner.mockReturnValue(mockSpinner);

            await createPullRequest({ container });

            expect(mockSpinner.start).toHaveBeenCalledWith('Validating repository and GitHub setup...');
            expect(mockSpinner.start).toHaveBeenCalledWith('Determining branches...');
            expect(mockSpinner.start).toHaveBeenCalledWith('Checking branch synchronization...');
            expect(mockSpinner.start).toHaveBeenCalledWith('Analyzing changes between branches...');
            expect(mockSpinner.start).toHaveBeenCalledWith('Generating PR title and description...');
            expect(mockSpinner.start).toHaveBeenCalledWith('Creating pull request...');
        });

        it('should display file changes summary', async () => {
            mockGitService.getBranchDiff.mockResolvedValue({
                files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
                diff: 'mock diff',
            });

            const mockSpinner = {
                start: vi.fn(),
                stop: vi.fn(),
                message: vi.fn(),
            };
            mockPromptUI.spinner.mockReturnValue(mockSpinner);

            await createPullRequest({ container });

            expect(mockSpinner.stop).toHaveBeenCalledWith(
                expect.stringContaining('Found 3 changed files')
            );
        });
    });
});