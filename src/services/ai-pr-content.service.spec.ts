import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIPRContentService, type PRContentRequest, type FileChangeAnalysis } from './ai-pr-content.service';
import { AIProviderFactory } from './ai-provider.factory';
import { ConfigService } from './config.service';
import { generateText } from 'ai';

// Mock the ai module
vi.mock('ai', () => ({
    generateText: vi.fn(),
}));

describe('AIPRContentService', () => {
    let service: AIPRContentService;
    let mockAIProviderFactory: AIProviderFactory;
    let mockConfigService: ConfigService;
    let mockModel: any;

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockModel = {
            chat: vi.fn(),
        };

        mockAIProviderFactory = {
            createModel: vi.fn().mockReturnValue(mockModel),
        } as any;

        mockConfigService = {} as any;

        service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
    });

    describe('generatePRContent', () => {
        it('should generate PR content with valid JSON response', async () => {
            const mockRequest: PRContentRequest = {
                diff: `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,6 @@
 export function test() {
+    console.log('new feature');
     return true;
 }`,
                files: ['src/test.ts'],
                baseBranch: 'main',
                headBranch: 'feature/new-feature',
            };

            const mockResponse = {
                text: '{"title": "Add logging to test function", "description": "Added console.log statement to the test function for better debugging visibility."}',
            };

            vi.mocked(generateText).mockResolvedValue(mockResponse);

            const result = await service.generatePRContent(mockRequest);

            expect(result).toEqual({
                title: 'Add logging to test function',
                description: 'Added console.log statement to the test function for better debugging visibility.',
            });

            expect(generateText).toHaveBeenCalledWith({
                model: mockModel,
                messages: [
                    {
                        role: 'system',
                        content: expect.stringContaining('You are an AI assistant that generates GitHub Pull Request'),
                    },
                    {
                        role: 'user',
                        content: expect.stringContaining('Please generate a PR title and description'),
                    },
                ],
            });
        });

        it('should handle malformed JSON response gracefully', async () => {
            const mockRequest: PRContentRequest = {
                diff: 'simple diff',
                files: ['test.js'],
                baseBranch: 'main',
                headBranch: 'feature',
            };

            const mockResponse = {
                text: 'Title: Fix bug\nDescription: Fixed a critical bug in the system',
            };

            vi.mocked(generateText).mockResolvedValue(mockResponse);

            const result = await service.generatePRContent(mockRequest);

            expect(result.title).toBe('Fix bug');
            expect(result.description).toContain('Fixed a critical bug in the system');
        });

        it('should handle AI generation errors', async () => {
            const mockRequest: PRContentRequest = {
                diff: 'test diff',
                files: ['test.js'],
                baseBranch: 'main',
                headBranch: 'feature',
            };

            vi.mocked(generateText).mockRejectedValue(new Error('AI service unavailable'));

            await expect(service.generatePRContent(mockRequest)).rejects.toThrow(
                'Failed to generate PR content: AI service unavailable',
            );
        });

        it('should truncate large diffs', async () => {
            const largeDiff = 'a'.repeat(60000); // Larger than MAX_DIFF_LENGTH (50000)
            const mockRequest: PRContentRequest = {
                diff: largeDiff,
                files: ['large-file.js'],
                baseBranch: 'main',
                headBranch: 'feature',
            };

            const mockResponse = {
                text: '{"title": "Update large file", "description": "Made changes to large file"}',
            };

            vi.mocked(generateText).mockResolvedValue(mockResponse);

            await service.generatePRContent(mockRequest);

            const callArgs = vi.mocked(generateText).mock.calls[0][0];
            const userMessage = callArgs.messages[1].content;
            
            expect(userMessage).toContain('[DIFF TRUNCATED');
            expect(userMessage).toContain('more characters not shown for brevity]');
        });
    });

    describe('file categorization', () => {
        it('should categorize TypeScript/JavaScript files correctly', () => {
            const files = ['src/component.tsx', 'utils/helper.js', 'types/index.ts'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            // Access private method for testing
            const categorizeFiles = (service as any).categorizeFiles.bind(service);
            const categories = categorizeFiles(files);

            expect(categories['TypeScript/JavaScript']).toEqual(files);
        });

        it('should categorize test files correctly', () => {
            const files = ['src/component.test.ts', 'tests/helper.spec.js', '__tests__/utils.js'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const categorizeFiles = (service as any).categorizeFiles.bind(service);
            const categories = categorizeFiles(files);

            expect(categories['Tests']).toEqual(files);
        });

        it('should categorize configuration files correctly', () => {
            const files = ['package.json', 'tsconfig.json', '.env', 'webpack.config.js'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const categorizeFiles = (service as any).categorizeFiles.bind(service);
            const categories = categorizeFiles(files);

            expect(categories['Configuration']).toEqual(files);
        });

        it('should categorize documentation files correctly', () => {
            const files = ['README.md', 'CHANGELOG.md', 'docs/api.md'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const categorizeFiles = (service as any).categorizeFiles.bind(service);
            const categories = categorizeFiles(files);

            expect(categories['Documentation']).toEqual(files);
        });

        it('should handle mixed file types', () => {
            const files = [
                'src/component.ts',
                'src/component.test.ts',
                'README.md',
                'package.json',
                'styles/main.css',
            ];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const categorizeFiles = (service as any).categorizeFiles.bind(service);
            const categories = categorizeFiles(files);

            expect(categories['TypeScript/JavaScript']).toContain('src/component.ts');
            expect(categories['Tests']).toContain('src/component.test.ts');
            expect(categories['Documentation']).toContain('README.md');
            expect(categories['Configuration']).toContain('package.json');
            expect(categories['Styles']).toContain('styles/main.css');
        });
    });

    describe('diff analysis', () => {
        it('should count additions and deletions correctly', () => {
            const diff = `diff --git a/test.js b/test.js
index 1234567..abcdefg 100644
--- a/test.js
+++ b/test.js
@@ -1,5 +1,7 @@
 function test() {
+    console.log('added line 1');
+    console.log('added line 2');
-    console.log('removed line');
     return true;
 }`;

            const files = ['test.js'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const analyzeFileChanges = (service as any).analyzeFileChanges.bind(service);
            const analysis: FileChangeAnalysis = analyzeFileChanges(diff, files);

            expect(analysis.additions).toBe(2);
            expect(analysis.deletions).toBe(1);
            expect(analysis.files).toEqual(files);
        });

        it('should ignore diff headers when counting changes', () => {
            const diff = `diff --git a/test.js b/test.js
index 1234567..abcdefg 100644
--- a/test.js
+++ b/test.js
@@ -1,3 +1,4 @@
 function test() {
+    console.log('new line');
     return true;
 }`;

            const files = ['test.js'];
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const analyzeFileChanges = (service as any).analyzeFileChanges.bind(service);
            const analysis: FileChangeAnalysis = analyzeFileChanges(diff, files);

            expect(analysis.additions).toBe(1);
            expect(analysis.deletions).toBe(0);
        });
    });

    describe('response parsing', () => {
        it('should parse valid JSON response', () => {
            const response = '{"title": "Test Title", "description": "Test Description"}';
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const parsePRResponse = (service as any).parsePRResponse.bind(service);
            const result = parsePRResponse(response);

            expect(result).toEqual({
                title: 'Test Title',
                description: 'Test Description',
            });
        });

        it('should extract JSON from mixed content', () => {
            const response = 'Here is the PR content: {"title": "Fix Bug", "description": "Fixed critical bug"} Hope this helps!';
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const parsePRResponse = (service as any).parsePRResponse.bind(service);
            const result = parsePRResponse(response);

            expect(result).toEqual({
                title: 'Fix Bug',
                description: 'Fixed critical bug',
            });
        });

        it('should handle fallback parsing for non-JSON responses', () => {
            const response = 'Title: Add New Feature\nAdded a new feature to improve user experience';
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const parsePRResponse = (service as any).parsePRResponse.bind(service);
            const result = parsePRResponse(response);

            expect(result.title).toBe('Add New Feature');
            expect(result.description).toContain('Added a new feature to improve user experience');
        });

        it('should provide default values for completely invalid responses', () => {
            const response = 'Invalid response with no useful content';
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const parsePRResponse = (service as any).parsePRResponse.bind(service);
            const result = parsePRResponse(response);

            expect(result.title).toBe('Invalid response with no useful content');
            expect(result.description).toBe('Updated code with various improvements.');
        });

        it('should provide default values for empty responses', () => {
            const response = '';
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            
            const parsePRResponse = (service as any).parsePRResponse.bind(service);
            const result = parsePRResponse(response);

            expect(result.title).toBe('Update code');
            expect(result.description).toBe('Updated code with various improvements.');
        });
    });

    describe('prompt generation', () => {
        it('should create system prompt with proper guidelines', () => {
            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            const createPRSystemPrompt = (service as any).createPRSystemPrompt.bind(service);
            const prompt = createPRSystemPrompt();

            expect(prompt).toContain('You are an AI assistant that generates GitHub Pull Request');
            expect(prompt).toContain('JSON object containing exactly two fields');
            expect(prompt).toContain('title');
            expect(prompt).toContain('description');
        });

        it('should create user prompt with change summary', () => {
            const request: PRContentRequest = {
                diff: 'test diff',
                files: ['test.js', 'config.json'],
                baseBranch: 'main',
                headBranch: 'feature/test',
            };
            
            const analysis: FileChangeAnalysis = {
                files: request.files,
                additions: 5,
                deletions: 2,
                categories: {
                    'TypeScript/JavaScript': ['test.js'],
                    'Configuration': ['config.json'],
                },
            };

            const service = new AIPRContentService(mockAIProviderFactory, mockConfigService);
            const createPRUserPrompt = (service as any).createPRUserPrompt.bind(service);
            const prompt = createPRUserPrompt(request, analysis, 'processed diff');

            expect(prompt).toContain('feature/test');
            expect(prompt).toContain('main');
            expect(prompt).toContain('2 files changed');
            expect(prompt).toContain('5 additions, 2 deletions');
            expect(prompt).toContain('TypeScript/JavaScript: 1 files');
            expect(prompt).toContain('Configuration: 1 files');
            expect(prompt).toContain('processed diff');
        });
    });
});