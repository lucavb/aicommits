import { inject as Inject, injectable as Injectable } from 'inversify';
import { generateText, GenerateTextResult, stepCountIs, tool, ToolSet } from 'ai';
import { z } from 'zod';
import { ConfigService } from './config.service';
import { GitToolsService } from './git-tools.service';
import { AIProviderFactory } from './ai-provider.factory';

interface CommitHunk {
    file: string;
    hunkId: string;
    summary: string;
}

interface CommitGroup {
    id: string;
    title: string;
    description: string;
    hunks: CommitHunk[];
    priority: number; // 1 = high, 2 = medium, 3 = low
    reasoning: string;
}

interface SplittingAnalysis {
    groups: CommitGroup[];
    explanation: string;
}

@Injectable()
export class AICommitSplittingService {
    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(GitToolsService) private readonly gitToolsService: GitToolsService,
    ) {}

    async analyzeStagedChangesForSplitting({
        onToolCall,
    }: {
        onToolCall?: (msg: string) => void;
    }): Promise<SplittingAnalysis> {
        const { locale } = this.configService.getConfig();

        const tools = this.createSplittingTools(onToolCall);
        const systemPrompt = this.createSplittingSystemPrompt();
        const userPrompt = this.createSplittingUserPrompt(locale);

        try {
            const model = this.aiProviderFactory.createModel();
            const result = await generateText({
                model,
                tools,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: userPrompt,
                    },
                ],
                stopWhen: stepCountIs(25),
            });

            return this.extractSplittingFromResult(result);
        } catch (error) {
            throw new Error(
                `Failed to analyze changes for splitting: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    private createSplittingTools(onToolCall?: (msg: string) => void) {
        const toolCallFeedback = onToolCall ?? (() => {});
        const gitTools = this.gitToolsService.createTools(toolCallFeedback);

        return {
            ...gitTools,
            proposeCommitGroups: tool({
                description:
                    'Call this when you have analyzed the working changes and want to propose logical groupings of hunks for separate commits.',
                inputSchema: z.object({
                    groups: z
                        .array(
                            z.object({
                                id: z.string().describe('Unique identifier for this commit group (use kebab-case)'),
                                title: z.string().describe('Brief descriptive title for the commit group'),
                                description: z.string().describe('Detailed explanation of what this group contains'),
                                hunks: z
                                    .array(
                                        z.object({
                                            file: z.string().describe('File path for this hunk'),
                                            hunkId: z.string().describe('Hunk ID from getWorkingChangesAsHunks'),
                                            summary: z.string().describe('Brief summary of what this hunk changes'),
                                        }),
                                    )
                                    .describe('Array of specific hunks that belong to this group'),
                                priority: z
                                    .number()
                                    .min(1)
                                    .max(3)
                                    .describe('Priority: 1 (high), 2 (medium), or 3 (low)'),
                                reasoning: z.string().describe('Explanation of why these hunks belong together'),
                            }),
                        )
                        .describe('Array of proposed commit groups with specific hunks'),
                    explanation: z.string().describe('Overall explanation of the grouping strategy'),
                }),
                execute: (x) => x,
            }),
        };
    }

    private createSplittingSystemPrompt(): string {
        return [
            'You are an AI assistant that analyzes git repositories to intelligently group working directory changes into logical commits using precise hunk-level control.',
            'You have access to tools that allow you to:',
            '- Check git status and see what files are modified',
            '- Get working directory changes as structured hunks with precise patch information',
            '- View diffs of changes',
            '- List files in the repository',
            '- Read file contents',
            '- View recent commit history',
            '- Stage specific hunks for commits',
            '- Propose logical commit groupings with specific hunks when ready',
            '',
            'Your goal is to:',
            '1. Analyze the current working directory changes in the repository',
            '2. Get changes as structured hunks using getWorkingChangesAsHunks',
            '3. Understand what each hunk changes and how they relate to each other',
            '4. Group related hunks into logical, focused commits',
            '',
            'Guidelines for grouping hunks:',
            '- Group related functionality hunks together (e.g., function implementation + related test changes)',
            '- Separate different types of changes (e.g., bug fixes vs new features vs refactoring)',
            '- Keep formatting/style hunks separate from functional changes',
            '- Group related hunks from different files if they implement the same feature',
            '- Consider dependencies between hunks',
            '- Aim for 2-5 logical groups (avoid over-splitting)',
            '- Every hunk from getWorkingChangesAsHunks must be assigned to exactly one group',
            '- Use the exact hunkId and patch content from getWorkingChangesAsHunks',
            '',
            'IMPORTANT GUIDELINES:',
            '- Start by calling getWorkingChangesAsHunks to see all available hunks',
            '- Use the tools to explore and understand the changes before proposing groups',
            '- Focus on the actual changes made in each hunk',
            '- Consider the broader context of the repository and recent commits',
            '- If there are only minor changes or everything is closely related, you may suggest keeping it as one commit',
            '',
            'CRITICAL: When you are ready to provide the commit groupings, you MUST call the "proposeCommitGroups" tool with specific hunks.',
            'Use the exact hunkId from getWorkingChangesAsHunks for each hunk you want to include.',
            'Do not include the groupings in your regular text response - only use the proposeCommitGroups tool for the final result.',
        ].join('\n');
    }

    private createSplittingUserPrompt(locale: string): string {
        return [
            'Please analyze the working directory changes in this git repository and propose logical groupings of hunks for separate commits.',
            `Response language: ${locale}`,
            '',
            'Start by calling getWorkingChangesAsHunks to see all available changes broken down into hunks.',
            'Examine each hunk to understand what it changes and how hunks relate to each other.',
            'Use other available tools as needed to understand the broader context.',
            'Then call the proposeCommitGroups tool with your recommended hunk groupings, using the exact hunkId from getWorkingChangesAsHunks.',
        ].join('\n');
    }

    private extractSplittingFromResult<Tools extends ToolSet, Output>(result: GenerateTextResult<Tools, Output>) {
        const finishStepContent = result.steps
            .at(-1)
            ?.response.messages.find(
                ({ role, content }) => role === 'tool' && content[0].toolName === 'proposeCommitGroups',
            )?.content[0];

        if (
            result.finishReason === 'stop' &&
            typeof finishStepContent === 'object' &&
            finishStepContent.type === 'tool-result' &&
            finishStepContent.output.type === 'json' &&
            finishStepContent.output.value &&
            typeof finishStepContent.output.value === 'object' &&
            'groups' in finishStepContent.output.value &&
            'explanation' in finishStepContent.output.value
        ) {
            const outputValue = finishStepContent.output.value as unknown as {
                groups: CommitGroup[];
                explanation: string;
            };

            const { groups, explanation } = outputValue;

            // Validate that we have at least one group
            if (!Array.isArray(groups) || groups.length === 0) {
                throw new Error('No commit groups were proposed by the agent');
            }

            return {
                groups,
                explanation,
            } as const satisfies SplittingAnalysis;
        }

        throw new Error('Agent did not call proposeCommitGroups tool to provide the final result');
    }
}
