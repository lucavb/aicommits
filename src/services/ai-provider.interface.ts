import { type LanguageModel } from 'ai';

export const AIModelSymbol = Symbol.for('AIModel');

// Re-export LanguageModel type for dependency injection
export type { LanguageModel };
