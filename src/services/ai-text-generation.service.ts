import { injectable as Injectable } from 'inversify';
import { generateText, streamText } from 'ai';

@Injectable()
export class AITextGenerationService {
    readonly generateText = generateText;
    readonly streamText = streamText;
}
