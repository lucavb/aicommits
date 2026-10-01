export const REVIEW_PROMPT = Symbol.for('REVIEW_PROMPT');

export type ReviewChoice = 'accept' | 'revise' | 'edit' | 'cancel';

export interface ReviewPrompt {
    askChoice(subject: string, body: string): Promise<ReviewChoice>;
    askRevisionPrompt(): Promise<string | null>;
    startProgress(message: string): void;
    updateProgress(message: string): void;
    stopProgress(message: string): void;
    showProposal(subjectTitle: string, bodyTitle: string, subject: string, body: string): void;
    announce(message: string): void;
    editInEditor(initialContent: string): string | null;
}
