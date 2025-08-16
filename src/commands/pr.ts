import { Container } from 'inversify';
import { bgCyan, black, green, red, yellow, cyan } from 'kolorist';
import { GitService } from '../services/git.service';
import { GitHubService } from '../services/github.service';
import { AIPRContentService } from '../services/ai-pr-content.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ConfigService } from '../services/config.service';
import { KnownError } from '../utils/error';
import { trimLines } from '../utils/string';

export interface CreatePROptions {
    base?: string;
    head?: string;
    draft?: boolean;
}

export const createPullRequest = async ({
    container,
    base,
    head,
    draft = false,
}: {
    container: Container;
} & CreatePROptions) => {
    const gitService = container.get(GitService);
    const githubService = container.get(GitHubService);
    const aiPRContentService = container.get(AIPRContentService);
    const promptUI = container.get(ClackPromptService);
    const configService = container.get(ConfigService);

    try {
        // Initialize UI
        promptUI.intro(bgCyan(black(' aicommits pr ')));

        // Validate configuration
        await configService.readConfig();
        const validResult = configService.validConfig();
        if (!validResult.valid) {
            promptUI.note(
                trimLines(`
                It looks like you haven't set up aicommits yet. Let's get you started!
                
                Run ${yellow('aicommits setup')} to configure your settings.
            `),
            );
            process.exit(1);
        }

        // Validate git repository and repository state
        await gitService.assertGitRepo();
        
        // Check if repository has a GitHub remote
        const validationSpinner = promptUI.spinner();
        validationSpinner.start('Validating repository and GitHub setup...');
        
        try {
            await githubService.getRepository();
        } catch (error) {
            validationSpinner.stop('Repository validation failed');
            if (error instanceof KnownError) {
                throw error;
            }
            throw new KnownError(
                trimLines(`
                This repository is not connected to GitHub or the GitHub CLI cannot access it.
                
                Make sure:
                1. This repository has a GitHub remote (origin)
                2. The repository exists on GitHub
                3. You have access to the repository
                
                You can check your remotes with: ${yellow('git remote -v')}
            `),
            );
        }

        // Validate GitHub CLI and authentication
        await githubService.validateGitHubCli();
        const isAuthenticated = await githubService.checkAuthentication();
        
        if (!isAuthenticated) {
            validationSpinner.stop('GitHub CLI validation failed');
            throw new KnownError(
                trimLines(`
                GitHub CLI is not authenticated. Please run:
                
                ${yellow('gh auth login')}
                
                Then try again.
            `),
            );
        }
        
        validationSpinner.stop('Repository and GitHub validation successful');

        // Determine and validate branches
        const branchSpinner = promptUI.spinner();
        branchSpinner.start('Determining branches...');
        
        let currentBranch: string;
        let defaultBranch: string;
        
        try {
            currentBranch = await gitService.getCurrentBranch();
            defaultBranch = await gitService.getDefaultBranch();
        } catch (error) {
            branchSpinner.stop('Branch detection failed');
            throw error;
        }
        
        const baseBranch = base || defaultBranch;
        const headBranch = head || currentBranch;

        // Validate branch selection
        if (baseBranch === headBranch) {
            branchSpinner.stop('Branch validation failed');
            throw new KnownError(
                trimLines(`
                Base and head branches cannot be the same (${baseBranch}).
                
                Please either:
                1. Specify different branches: ${yellow(`aicommits agent pr --base ${baseBranch} --head <other-branch>`)}
                2. Switch to a different branch: ${yellow(`git checkout <feature-branch>`)}
                3. Create a new branch: ${yellow(`git checkout -b <new-feature-branch>`)}
            `),
            );
        }

        // Validate that branches exist and are accessible
        try {
            await gitService.validateBranchExists(baseBranch);
            await gitService.validateBranchExists(headBranch);
        } catch (error) {
            branchSpinner.stop('Branch validation failed');
            if (error instanceof KnownError) {
                throw error;
            }
            throw new KnownError(`Branch validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        branchSpinner.stop('Branch validation successful');

        promptUI.note(
            trimLines(`
             Base branch: ${yellow(baseBranch)}
             Head branch: ${yellow(headBranch)}
             Draft PR: ${draft ? yellow('Yes') : 'No'}
            `),
        );

        // Check branch synchronization status and offer recovery
        const syncSpinner = promptUI.spinner();
        syncSpinner.start('Checking branch synchronization...');
        
        try {
            const headStatus = await gitService.getBranchTrackingStatus(headBranch);
            
            if (headStatus.hasRemote) {
                if (headStatus.behind > 0) {
                    syncSpinner.stop('Branch synchronization issues detected');
                    promptUI.note(
                        trimLines(`
                        ⚠️  Your head branch '${headBranch}' is ${headStatus.behind} commit(s) behind its remote.
                        
                        This may cause issues with the PR or result in conflicts.
                        Consider running: ${yellow(`git pull origin ${headBranch}`)}
                    `),
                    );
                    
                    const shouldFetch = await promptUI.confirm({
                        message: 'Would you like to fetch the latest changes first?',
                    });
                    
                    if (!promptUI.isCancel(shouldFetch) && shouldFetch) {
                        const fetchSpinner = promptUI.spinner();
                        fetchSpinner.start('Fetching latest changes...');
                        
                        try {
                            await gitService.fetchFromRemote();
                            fetchSpinner.stop('Latest changes fetched successfully');
                            
                            promptUI.note(
                                trimLines(`
                                ✅ Fetched latest changes. You may still need to merge or rebase:
                                
                                To merge: ${yellow(`git merge origin/${headBranch}`)}
                                To rebase: ${yellow(`git rebase origin/${headBranch}`)}
                            `),
                            );
                        } catch (fetchError) {
                            fetchSpinner.stop('Failed to fetch changes');
                            promptUI.note(
                                trimLines(`
                                ⚠️  Failed to fetch changes: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}
                                
                                You may need to resolve this manually before creating the PR.
                            `),
                            );
                        }
                    }
                    
                    const shouldContinue = await promptUI.confirm({
                        message: 'Continue with PR creation anyway?',
                    });
                    
                    if (promptUI.isCancel(shouldContinue) || !shouldContinue) {
                        promptUI.outro('PR creation cancelled');
                        return;
                    }
                } else if (headStatus.ahead === 0) {
                    syncSpinner.stop('Branch synchronization check complete');
                    promptUI.note(
                        trimLines(`
                        ⚠️  Your head branch '${headBranch}' has no commits ahead of the base branch.
                        This means there are no changes to create a PR for.
                    `),
                    );
                    
                    const shouldContinue = await promptUI.confirm({
                        message: 'Continue anyway? (This may result in an empty PR)',
                    });
                    
                    if (promptUI.isCancel(shouldContinue) || !shouldContinue) {
                        promptUI.outro('PR creation cancelled');
                        return;
                    }
                } else {
                    syncSpinner.stop('Branch synchronization check complete');
                }
            } else {
                syncSpinner.stop('Branch synchronization check complete');
                promptUI.note(
                    trimLines(`
                    ℹ️  Branch '${headBranch}' has no remote tracking branch.
                    Make sure to push your branch before creating the PR:
                    
                    ${yellow(`git push -u origin ${headBranch}`)}
                `),
                );
            }
        } catch (syncError) {
            syncSpinner.stop('Branch synchronization check failed');
            promptUI.note(
                trimLines(`
                ⚠️  Could not check branch synchronization status: ${syncError instanceof Error ? syncError.message : 'Unknown error'}
                
                Continuing with PR creation, but you may want to verify your branch status manually.
            `),
            );
        }

        // Get branch diff with comprehensive validation
        const diffSpinner = promptUI.spinner();
        diffSpinner.start('Analyzing changes between branches...');
        
        let branchDiff: { files: string[]; diff: string };
        
        try {
            branchDiff = await gitService.getBranchDiff(baseBranch, headBranch);
        } catch (error) {
            diffSpinner.stop('Failed to analyze changes');
            
            if (error instanceof KnownError) {
                throw error;
            }
            
            // Provide specific guidance based on common error scenarios
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            if (errorMessage.includes('bad revision') || errorMessage.includes('unknown revision')) {
                throw new KnownError(
                    trimLines(`
                    Failed to compare branches '${baseBranch}' and '${headBranch}'.
                    
                    This usually means one of the branches doesn't exist or isn't accessible.
                    
                    Try:
                    1. Check if branches exist: ${yellow('git branch -a')}
                    2. Fetch latest changes: ${yellow('git fetch origin')}
                    3. Verify branch names are correct
                `),
                );
            }
            
            throw new KnownError(
                trimLines(`
                Failed to analyze changes between branches: ${errorMessage}
                
                Please verify:
                1. Both branches exist and are accessible
                2. You have the latest changes: ${yellow('git fetch origin')}
                3. Branch names are spelled correctly
            `),
            );
        }
        
        if (branchDiff.files.length === 0) {
            diffSpinner.stop('No changes found');
            
            // Check if this might be due to branches being identical
            try {
                const baseCommit = await gitService.getCommitHash(baseBranch);
                const headCommit = await gitService.getCommitHash(headBranch);
                
                if (baseCommit === headCommit) {
                    throw new KnownError(
                        trimLines(`
                        No changes found between '${baseBranch}' and '${headBranch}' because they point to the same commit.
                        
                        This means:
                        1. No new commits have been made on '${headBranch}'
                        2. Both branches are at the same point in history
                        
                        To create a PR, you need to:
                        1. Make some changes and commit them to '${headBranch}'
                        2. Or choose a different head branch that has diverged from '${baseBranch}'
                    `),
                    );
                }
            } catch (error) {
                // If it's a KnownError (like the identical commit message), re-throw it
                if (error instanceof KnownError) {
                    throw error;
                }
                // If we can't get commit hashes due to other errors, fall back to generic message
            }
            
            throw new KnownError(
                trimLines(`
                No changes found between '${baseBranch}' and '${headBranch}'.
                
                Make sure:
                1. Your head branch has commits that differ from the base branch
                2. You've pushed your changes: ${yellow(`git push origin ${headBranch}`)}
                3. The branches are correctly specified
                
                You can check the difference manually with: ${yellow(`git diff ${baseBranch}...${headBranch}`)}
            `),
            );
        }
        
        // Validate that the diff is reasonable (not too large)
        const diffSizeKB = Buffer.byteLength(branchDiff.diff, 'utf8') / 1024;
        if (diffSizeKB > 1024) { // More than 1MB
            diffSpinner.stop('Large changeset detected');
            promptUI.note(
                trimLines(`
                ⚠️  Large changeset detected (${Math.round(diffSizeKB)}KB).
                
                This may affect AI analysis quality and PR creation performance.
                Consider breaking this into smaller, focused PRs for better review.
            `),
            );
            
            const shouldContinue = await promptUI.confirm({
                message: 'Continue with large changeset?',
            });
            
            if (promptUI.isCancel(shouldContinue) || !shouldContinue) {
                promptUI.outro('PR creation cancelled');
                return;
            }
        }
        
        diffSpinner.stop(
            `Found ${branchDiff.files.length} changed file${branchDiff.files.length > 1 ? 's' : ''}:\n` +
            branchDiff.files.slice(0, 5).map(file => `     ${file}`).join('\n') +
            (branchDiff.files.length > 5 ? `\n     ... and ${branchDiff.files.length - 5} more` : '')
        );

        // Generate PR content with AI
        const aiSpinner = promptUI.spinner();
        aiSpinner.start('Generating PR title and description...');
        
        let prContent: { title: string; description: string };
        
        try {
            prContent = await aiPRContentService.generatePRContent({
                diff: branchDiff.diff,
                files: branchDiff.files,
                baseBranch,
                headBranch,
            });
            
            // Validate AI-generated content
            if (!prContent.title || prContent.title.trim().length === 0) {
                throw new Error('AI generated empty title');
            }
            
            if (!prContent.description || prContent.description.trim().length === 0) {
                throw new Error('AI generated empty description');
            }
            
            aiSpinner.stop('PR content generated');
        } catch (error) {
            aiSpinner.stop('AI content generation failed');
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
                throw new KnownError(
                    trimLines(`
                    AI service rate limit exceeded. Please try again later.
                    
                    You can also:
                    1. Wait a few minutes and try again
                    2. Check your AI provider quota/billing
                    3. Create the PR manually with: ${yellow(`gh pr create`)}
                `),
                );
            }
            
            if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
                throw new KnownError(
                    trimLines(`
                    AI service authentication failed. Please check your configuration.
                    
                    Run ${yellow('aicommits setup')} to reconfigure your AI provider.
                `),
                );
            }
            
            if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
                throw new KnownError(
                    trimLines(`
                    Network error while generating PR content: ${errorMessage}
                    
                    Please check your internet connection and try again.
                    You can also create the PR manually with: ${yellow(`gh pr create`)}
                `),
                );
            }
            
            // Fallback: offer to continue with basic content
            promptUI.note(
                trimLines(`
                ⚠️  Failed to generate AI content: ${errorMessage}
                
                You can still create the PR with basic content.
            `),
            );
            
            const shouldContinueWithBasic = await promptUI.confirm({
                message: 'Continue with basic PR content?',
            });
            
            if (promptUI.isCancel(shouldContinueWithBasic) || !shouldContinueWithBasic) {
                promptUI.outro('PR creation cancelled');
                return;
            }
            
            // Generate basic fallback content
            prContent = {
                title: `Merge ${headBranch} into ${baseBranch}`,
                description: trimLines(`
                    ## Changes
                    
                    This PR includes changes from \`${headBranch}\` to be merged into \`${baseBranch}\`.
                    
                    ### Files changed:
                    ${branchDiff.files.map(file => `- ${file}`).join('\n')}
                    
                    ### Summary
                    
                    Please review the changes and provide a description of what this PR accomplishes.
                `),
            };
        }

        // Display preview
        promptUI.log.step('Generated PR content:');
        promptUI.log.message(cyan('Title:'));
        promptUI.log.message(prContent.title);
        promptUI.log.message('');
        promptUI.log.message(cyan('Description:'));
        promptUI.log.message(prContent.description);

        // Allow user to edit content
        const shouldEdit = await promptUI.confirm({
            message: 'Would you like to edit the PR title or description?',
        });

        let finalTitle = prContent.title;
        let finalDescription = prContent.description;

        if (!promptUI.isCancel(shouldEdit) && shouldEdit) {
            const editedTitle = await promptUI.text({
                message: 'Edit PR title:',
                initialValue: prContent.title,
            });

            if (!promptUI.isCancel(editedTitle)) {
                finalTitle = editedTitle;
            }

            const editedDescription = await promptUI.text({
                message: 'Edit PR description:',
                initialValue: prContent.description,
            });

            if (!promptUI.isCancel(editedDescription)) {
                finalDescription = editedDescription;
            }
        }

        // Final confirmation
        const shouldCreate = await promptUI.confirm({
            message: `Create ${draft ? 'draft ' : ''}PR from '${headBranch}' to '${baseBranch}'?`,
        });

        if (promptUI.isCancel(shouldCreate) || !shouldCreate) {
            promptUI.outro('PR creation cancelled');
            return;
        }

        // Create the PR with comprehensive error handling
        const createSpinner = promptUI.spinner();
        createSpinner.start('Creating pull request...');
        
        let prResult: { url: string; number: number };
        
        try {
            prResult = await githubService.createPullRequest({
                title: finalTitle,
                body: finalDescription,
                base: baseBranch,
                head: headBranch,
                draft,
            });
            
            createSpinner.stop('Pull request created successfully');
        } catch (error) {
            createSpinner.stop('Pull request creation failed');
            
            if (error instanceof KnownError) {
                // Add recovery suggestions to known errors
                const errorMessage = error.message;
                
                if (errorMessage.includes('already exists')) {
                    throw new KnownError(
                        trimLines(`
                        ${errorMessage}
                        
                        You can:
                        1. View the existing PR and update it if needed
                        2. Use a different head branch: ${yellow(`aicommits agent pr --head <other-branch>`)}
                        3. Close the existing PR first if it's no longer needed
                    `),
                    );
                }
                
                if (errorMessage.includes('No commits')) {
                    throw new KnownError(
                        trimLines(`
                        ${errorMessage}
                        
                        This usually means:
                        1. The branches are identical (no new commits)
                        2. The head branch hasn't been pushed to GitHub
                        
                        Try:
                        1. Push your branch: ${yellow(`git push origin ${headBranch}`)}
                        2. Make sure you have commits on ${headBranch}: ${yellow(`git log ${baseBranch}..${headBranch}`)}
                    `),
                    );
                }
                
                if (errorMessage.includes('not found')) {
                    throw new KnownError(
                        trimLines(`
                        ${errorMessage}
                        
                        This usually means:
                        1. One of the branches doesn't exist on GitHub
                        2. The branch hasn't been pushed yet
                        
                        Try:
                        1. Push your head branch: ${yellow(`git push origin ${headBranch}`)}
                        2. Verify branch names: ${yellow('git branch -a')}
                        3. Check GitHub repository access
                    `),
                    );
                }
                
                throw error;
            }
            
            // Handle unexpected errors with recovery suggestions
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new KnownError(
                trimLines(`
                Failed to create pull request: ${errorMessage}
                
                You can try:
                1. Creating the PR manually: ${yellow(`gh pr create --title "${finalTitle}" --body "${finalDescription}" --base ${baseBranch} --head ${headBranch}`)}
                2. Checking GitHub CLI status: ${yellow('gh auth status')}
                3. Verifying repository access: ${yellow('gh repo view')}
                
                If the issue persists, check GitHub's status page or try again later.
            `),
            );
        }

        // Success message
        promptUI.outro(
            trimLines(`
            ${green('✔')} Pull request created successfully!
            
            PR #${prResult.number}: ${finalTitle}
            URL: ${cyan(prResult.url)}
        `)
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        promptUI.outro(`${red('✖')} ${errorMessage}`);
        process.exit(1);
    }
};