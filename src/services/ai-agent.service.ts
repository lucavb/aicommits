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
        const maxToolCalls = 25;
        let currentToolCallCount = 0;
        
        const toolCallWrapper = onToolCall ? (message: string) => {
            currentToolCallCount++;
            const formattedMessage = `${message} (${currentToolCallCount}/${maxToolCalls})`;
            onToolCall(formattedMessage);
        } : undefined;

        const tools = this.createAllTools(toolCallWrapper);

        const systemPrompt = this.promptService.createAgentSystemPrompt();
        const userPrompt = this.promptService.createAgentUserPrompt();

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
                stopWhen: stepCountIs(maxToolCalls),
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
        const maxToolCalls = 25;
        let currentToolCallCount = 0;
        
        const toolCallWrapper = onToolCall ? (message: string) => {
            currentToolCallCount++;
            const formattedMessage = `${message} (${currentToolCallCount}/${maxToolCalls})`;
            onToolCall(formattedMessage);
        } : undefined;

        const tools = this.createAllTools(toolCallWrapper);

        const systemPrompt = this.promptService.createAgentSystemPrompt();
        const userPrompt = this.promptService.createAgentRevisionPrompt(
            currentMessage,
            currentBody,
            userRevisionPrompt,
        );

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
                stopWhen: stepCountIs(maxToolCalls),
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
