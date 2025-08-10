import { inject as Inject, injectable as Injectable } from 'inversify';
import { generateText, GenerateTextResult, stepCountIs, tool, ToolSet } from 'ai';
import { z } from 'zod';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { GitToolsService } from './git-tools.service';
import { AIProviderFactory } from './ai-provider.factory';

interface AgentResult {
    commitMessage: string;
    body: string;
    analysis: string;
}

@Injectable()
export class AIAgentService {
    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(PromptService) private readonly promptService: PromptService,
        @Inject(GitToolsService) private readonly gitToolsService: GitToolsService,
    ) {}

    async generateCommitWithAgent({ onToolCall }: { onToolCall?: (msg: string) => void }): Promise<AgentResult> {
        const { locale, maxLength, type } = this.configService.getConfig();

        const tools = this.createAllTools(onToolCall);

        const systemPrompt = this.createAgentSystemPrompt();
        const userPrompt = this.createAgentUserPrompt(locale, maxLength, type ?? '');

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

            return this.extractCommitFromResult(result);
        } catch (error) {
            throw new Error(
                `Agent failed to generate commit message: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    async reviseCommitWithAgent({
        currentBody,
        currentMessage,
        onToolCall,
        userRevisionPrompt,
    }: {
        currentBody: string;
        currentMessage: string;
        onToolCall?: (msg: string) => void;
        userRevisionPrompt: string;
    }): Promise<AgentResult> {
        const { locale, maxLength, type } = this.configService.getConfig();

        const tools = this.createAllTools(onToolCall);

        const systemPrompt = this.createAgentSystemPrompt();
        const userPrompt = this.createAgentRevisionPrompt(
            currentMessage,
            currentBody,
            userRevisionPrompt,
            locale,
            maxLength,
            type ?? '',
        );

        try {
            const result = await generateText({
                model: this.aiProviderFactory.createModel(),
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

            return this.extractCommitFromResult(result);
        } catch (error) {
            throw new Error(
                `Agent failed to revise commit message: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    private createAllTools(onToolCall?: (msg: string) => void) {
        // Provide a no-op function if onToolCall is not provided
        const toolCallFeedback = onToolCall ?? (() => {});
        const gitTools = this.gitToolsService.createTools(toolCallFeedback);

        return {
            ...gitTools,
            finishCommit: tool({
                description:
                    'Call this when you are ready to provide the final commit message and body after analyzing the repository.',
                inputSchema: z.object({
                    commitMessage: z.string().describe('The final commit message in imperative mood'),
                    commitBody: z.string().optional().describe('Optional commit body with additional details'),
                }),
                execute: (x) => x,
            }),
        };
    }

    private createAgentSystemPrompt(): string {
        return [
            'You are an AI agent that helps generate git commit messages by autonomously analyzing a git repository.',
            'You have access to tools that allow you to:',
            '- Check git status and see what files are staged/modified',
            '- View diffs of changes',
            '- List files in the repository',
            '- Read file contents',
            '- View recent commit history',
            '- Stage/unstage files as needed',
            '- Finish with a commit message when ready',
            '',
            'Your goal is to:',
            '1. Analyze the current state of the repository',
            '2. Understand what changes have been made',
            '3. Generate a meaningful commit message and body',
            '',
            'IMPORTANT GUIDELINES:',
            '- Use the tools to explore and understand the changes before generating the commit message',
            '- Focus on the actual changes made (lines with + or - in diffs)',
            '- Generate commit messages that follow best practices',
            '- Use imperative mood (e.g., "Add feature", "Fix bug")',
            '- Be specific about what was changed and why',
            '- If no files are staged, you may suggest staging relevant files first',
            '',
            'CRITICAL: When you are ready to provide the final commit message, you MUST call the "finishCommit" tool with your commit message and optional body.',
            'Do not include the commit message in your regular text response - only use the finishCommit tool for the final result.',
        ].join('\n');
    }

    private createAgentUserPrompt(locale: string, maxLength: number, commitType: string): string {
        const basePrompt = [
            'Please analyze the current git repository and generate an appropriate commit message.',
            `Message language: ${locale}`,
            `Commit message must be a maximum of ${maxLength} characters.`,
            '',
            'Start by checking the current git status and examining any changes.',
            'Use the available tools to understand what has been modified.',
            'Then call the finishCommit tool with your final commit message and optional body.',
        ];

        if (commitType) {
            basePrompt.push(`Follow the ${commitType} commit format.`);
        }

        return basePrompt.join('\n');
    }

    private createAgentRevisionPrompt(
        currentMessage: string,
        currentBody: string,
        userRevisionPrompt: string,
        locale: string,
        maxLength: number,
        commitType: string,
    ): string {
        const basePrompt = [
            'I need you to revise a commit message based on user feedback.',
            '',
            'CURRENT COMMIT MESSAGE:',
            currentMessage,
            '',
            'CURRENT COMMIT BODY:',
            currentBody || '(empty)',
            '',
            'USER REVISION REQUEST:',
            userRevisionPrompt,
            '',
            "Please use your tools to re-examine the repository and generate a revised commit message that addresses the user's feedback.",
            `Message language: ${locale}`,
            `Commit message must be a maximum of ${maxLength} characters.`,
            '',
            'You can use the git tools to:',
            '- Re-examine the staged changes',
            '- Look at additional context in the repository',
            '- Check commit history for patterns',
            '- Understand the broader impact of the changes',
            '',
            'Then call the finishCommit tool with your revised commit message and optional body.',
        ];

        if (commitType) {
            basePrompt.push(`Follow the ${commitType} commit format.`);
        }

        return basePrompt.join('\n');
    }

    private extractCommitFromResult<Tools extends ToolSet, Output>(result: GenerateTextResult<Tools, Output>) {
        const finishStepContent = result.steps
            .at(-1)
            ?.response.messages.find(({ role, content }) => role === 'tool' && content[0].toolName === 'finishCommit')
            ?.content[0];

        if (
            result.finishReason === 'stop' &&
            typeof finishStepContent === 'object' &&
            finishStepContent.type === 'tool-result' &&
            finishStepContent.output.type === 'json' &&
            finishStepContent.output.value &&
            typeof finishStepContent.output.value === 'object' &&
            'commitMessage' in finishStepContent.output.value &&
            typeof finishStepContent.output.value.commitMessage === 'string' &&
            typeof finishStepContent.output.value.commitBody === 'string'
        ) {
            return {
                analysis: '',
                body: finishStepContent.output.value.commitBody,
                commitMessage: finishStepContent.output.value.commitMessage,
            } as const satisfies AgentResult;
        }

        throw new Error('Agent did not call finishCommit tool to provide the final result');
    }
}
