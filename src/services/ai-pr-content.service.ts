import { inject as Inject, injectable as Injectable } from 'inversify';
import { generateText } from 'ai';
import { AIProviderFactory } from './ai-provider.factory';
import { ConfigService } from './config.service';

export interface FileChangeAnalysis {
    files: string[];
    additions: number;
    deletions: number;
    categories: {
        [category: string]: string[];
    };
}

export interface PRContentRequest {
    diff: string;
    files: string[];
    baseBranch: string;
    headBranch: string;
}

export interface PRContentResponse {
    title: string;
    description: string;
}

@Injectable()
export class AIPRContentService {
    private static readonly MAX_DIFF_LENGTH = 50000; // Maximum diff length to send to AI
    private static readonly MAX_FILES_TO_ANALYZE = 50; // Maximum number of files to analyze in detail

    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(ConfigService) private readonly configService: ConfigService,
    ) {}

    async generatePRContent(request: PRContentRequest): Promise<PRContentResponse> {
        const analysis = this.analyzeFileChanges(request.diff, request.files);
        const processedDiff = this.processDiffForAI(request.diff);
        
        const model = this.aiProviderFactory.createModel();
        
        try {
            const result = await generateText({
                model,
                messages: [
                    {
                        role: 'system',
                        content: this.createPRSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.createPRUserPrompt(request, analysis, processedDiff),
                    },
                ],
            });

            return this.parsePRResponse(result.text);
        } catch (error) {
            throw new Error(
                `Failed to generate PR content: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    private analyzeFileChanges(diff: string, files: string[]): FileChangeAnalysis {
        const lines = diff.split('\n');
        let additions = 0;
        let deletions = 0;

        // Count additions and deletions
        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                deletions++;
            }
        }

        // Categorize files by type/purpose
        const categories = this.categorizeFiles(files);

        return {
            files,
            additions,
            deletions,
            categories,
        };
    }

    private categorizeFiles(files: string[]): { [category: string]: string[] } {
        const categories: { [category: string]: string[] } = {};

        for (const file of files) {
            const category = this.getFileCategory(file);
            if (!categories[category]) {
                categories[category] = [];
            }
            categories[category].push(file);
        }

        return categories;
    }

    private getFileCategory(file: string): string {
        const path = file.toLowerCase();
        
        // Configuration files
        if (path.includes('config') || path.includes('.json') || path.includes('.yml') || path.includes('.yaml') || 
            path.includes('.env') || path.includes('package.json') || path.includes('tsconfig') ||
            path.includes('.rc') || path.includes('dockerfile') || path.includes('makefile')) {
            return 'Configuration';
        }
        
        // Test files
        if (path.includes('test') || path.includes('spec') || path.includes('__tests__') || 
            path.includes('.test.') || path.includes('.spec.')) {
            return 'Tests';
        }
        
        // Documentation
        if (path.includes('readme') || path.includes('.md') || path.includes('doc') || 
            path.includes('changelog') || path.includes('license')) {
            return 'Documentation';
        }
        
        // Build/CI files
        if (path.includes('.github') || path.includes('ci') || path.includes('build') || 
            path.includes('webpack') || path.includes('rollup') || path.includes('vite') ||
            path.includes('.yml') || path.includes('.yaml')) {
            return 'Build/CI';
        }
        
        // Source code by extension
        if (path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.tsx') || path.endsWith('.jsx')) {
            return 'TypeScript/JavaScript';
        }
        
        if (path.endsWith('.py')) {
            return 'Python';
        }
        
        if (path.endsWith('.java') || path.endsWith('.kt')) {
            return 'Java/Kotlin';
        }
        
        if (path.endsWith('.go')) {
            return 'Go';
        }
        
        if (path.endsWith('.rs')) {
            return 'Rust';
        }
        
        if (path.endsWith('.css') || path.endsWith('.scss') || path.endsWith('.less')) {
            return 'Styles';
        }
        
        if (path.endsWith('.html') || path.endsWith('.htm')) {
            return 'HTML';
        }
        
        return 'Other';
    }

    private processDiffForAI(diff: string): string {
        if (diff.length <= AIPRContentService.MAX_DIFF_LENGTH) {
            return diff;
        }

        // If diff is too large, truncate and add summary
        const truncated = diff.substring(0, AIPRContentService.MAX_DIFF_LENGTH);
        const remainingLength = diff.length - AIPRContentService.MAX_DIFF_LENGTH;
        
        return `${truncated}\n\n[DIFF TRUNCATED - ${remainingLength} more characters not shown for brevity]`;
    }

    private createPRSystemPrompt(): string {
        return [
            'You are an AI assistant that generates GitHub Pull Request titles and descriptions.',
            'Your task is to analyze code changes and create clear, informative PR content.',
            '',
            'GUIDELINES:',
            '- Generate a concise, descriptive PR title that summarizes the main change',
            '- Create a detailed description that explains what was changed and why',
            '- Focus on the business value and impact of the changes',
            '- Use clear, professional language',
            '- Organize information logically with proper formatting',
            '- Highlight important changes like breaking changes or new features',
            '',
            'RESPONSE FORMAT:',
            'You must respond with a JSON object containing exactly two fields:',
            '{"title": "PR title here", "description": "PR description here"}',
            '',
            'The description should use markdown formatting and include:',
            '- A brief summary of what was changed',
            '- Key changes organized by category when applicable',
            '- Any important notes about the implementation',
            '- Impact on users or other developers if relevant',
        ].join('\n');
    }

    private createPRUserPrompt(request: PRContentRequest, analysis: FileChangeAnalysis, processedDiff: string): string {
        const { files, baseBranch, headBranch } = request;
        const { additions, deletions, categories } = analysis;

        const filesByCategory = Object.entries(categories)
            .map(([category, categoryFiles]) => `- ${category}: ${categoryFiles.length} files`)
            .join('\n');

        return [
            `Please generate a PR title and description for changes from branch "${headBranch}" to "${baseBranch}".`,
            '',
            'CHANGE SUMMARY:',
            `- ${files.length} files changed`,
            `- ${additions} additions, ${deletions} deletions`,
            '',
            'FILES BY CATEGORY:',
            filesByCategory,
            '',
            'DETAILED DIFF:',
            processedDiff,
            '',
            'Please analyze these changes and generate an appropriate PR title and description.',
            'Focus on the main purpose and impact of these changes.',
        ].join('\n');
    }

    private parsePRResponse(response: string): PRContentResponse {
        try {
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);
            
            if (!parsed.title || !parsed.description) {
                throw new Error('Response missing required fields');
            }

            return {
                title: parsed.title.trim(),
                description: parsed.description.trim(),
            };
        } catch (error) {
            // Fallback: try to parse a simpler format or generate basic content
            const lines = response.split('\n').filter(line => line.trim());
            
            return {
                title: lines[0]?.replace(/^(title|Title):\s*/i, '').trim() || 'Update code',
                description: lines.slice(1).join('\n').trim() || 'Updated code with various improvements.',
            };
        }
    }
}