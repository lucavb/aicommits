import { Command } from '@commander-js/extra-typings';
import { cancel, intro, note, outro, select, spinner, text } from '@clack/prompts';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';
import { type Config } from '../utils/config';
import { green, red, yellow } from 'kolorist';
import type { LanguageCode } from 'iso-639-1';
import iso6391 from 'iso-639-1';
import OpenAI from 'openai';
import { OllamaProvider } from '../services/ollama-provider';

const isLanguageCode = (value: string): value is LanguageCode => {
    return value.length === 2 && iso6391.validate(value);
};

const detectLocale = (): LanguageCode => {
    // Try to get locale from environment variables in order of preference
    const localeVars = ['LC_ALL', 'LANG', 'LANGUAGE'];
    for (const varName of localeVars) {
        const value = process.env[varName];
        if (value) {
            // Extract the language code (e.g., "en_US.UTF-8" -> "en")
            const langCode = value.split('_')[0].toLowerCase();
            if (isLanguageCode(langCode)) {
                return langCode;
            }
        }
    }
    return 'en'; // Default to English if no locale is detected
};

export const setupCommand = new Command('setup').description('Interactive setup for aicommits').action(async () => {
    intro('Welcome to aicommits setup! 🚀');

    const configService = container.get(ConfigService);
    await configService.readConfig();
    const currentConfig = configService.getConfig();

    // 1. Prompt for Provider
    const provider = await select({
        message: 'Select your AI provider',
        options: [
            { value: 'openai', label: 'OpenAI (compatible)' },
            { value: 'ollama', label: 'Ollama' },
        ],
        initialValue: currentConfig.provider || 'openai',
    });
    if (provider === null) {
        cancel('Setup cancelled');
        process.exit(0);
    }
    if (typeof provider !== 'string') {
        throw new Error('Invalid provider');
    }

    configService.updateConfigInMemory({ provider });

    // 2. Prompt for Base URL
    const baseUrl = await text({
        message: provider === 'openai' ? 'Enter the OpenAI API base URL' : 'Enter the Ollama API base URL',
        placeholder: provider === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434',
        initialValue:
            currentConfig.baseUrl || (provider === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434'),
        validate: (value) => {
            if (!value) {
                return 'Base URL is required';
            }
            try {
                new URL(value);
            } catch {
                return 'Invalid URL';
            }
            return undefined;
        },
    });
    if (baseUrl === null) {
        cancel('Setup cancelled');
        process.exit(0);
    }
    if (typeof baseUrl !== 'string') {
        throw new Error('Base URL is required');
    }

    configService.updateConfigInMemory({ baseUrl: baseUrl.trim() });

    // 3. Prompt for API Key (only for OpenAI)
    let apiKey: string | undefined;
    if (provider === 'ollama') {
        // Ollama doesn't require an API key
        apiKey = undefined;
    } else {
        // OpenAI requires an API key
        const apiKeyInput = await text({
            message: 'Enter your OpenAI API key',
            placeholder: 'Your API key',
            initialValue: currentConfig.apiKey,
            validate: (value) => {
                if (!value) {
                    return 'API key is required';
                }
                return undefined;
            },
        });
        if (apiKeyInput === null) {
            cancel('Setup cancelled');
            process.exit(0);
        }
        if (typeof apiKeyInput !== 'string') {
            throw new Error('API key is required');
        }
        apiKey = apiKeyInput;
    }
    configService.updateConfigInMemory({ apiKey: apiKey?.trim() });

    // 4. Fetch available models
    let modelChoices: { value: string; label: string }[] = [];
    let model: string;
    if (provider === 'ollama') {
        // For Ollama, fetch available models
        const s = spinner();
        s.start('Fetching available models from Ollama...');
        try {
            const ollamaProvider = new OllamaProvider(fetch, configService.getConfig().baseUrl);
            const models = await ollamaProvider.listModels();
            modelChoices = models.map((name: string) => ({
                value: name,
                label: name,
            }));
            if (modelChoices.length === 0) {
                s.stop(red('No models found. Please pull a model first using `ollama pull <model>`'));
                cancel('Setup cancelled');
                process.exit(1);
            }
            s.stop('Models fetched.');
            const selectedModel = await select({
                message: 'Select the Ollama model to use',
                options: modelChoices,
                initialValue:
                    currentConfig.model && modelChoices.some((c) => c.value === currentConfig.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });
            if (typeof selectedModel !== 'string') {
                cancel('Setup cancelled');
                process.exit(0);
            }
            model = selectedModel;
        } catch (err) {
            s.stop(red('Failed to fetch models. Please make sure Ollama is running and accessible.'));
            cancel('Setup cancelled');
            process.exit(1);
        }
    } else {
        // OpenAI: fetch available models
        const s = spinner();
        s.start('Fetching available models from OpenAI...');
        try {
            const openai = new OpenAI({ baseURL: baseUrl.trim(), apiKey });
            const modelsResponse = await openai.models.list();
            modelChoices = modelsResponse.data
                .filter((m) => {
                    const id = m.id.toLowerCase();
                    return baseUrl.trim() === 'https://api.openai.com/v1'
                        ? id.includes('gpt') &&
                              !id.includes('dall-e') &&
                              !id.includes('audio') &&
                              !id.includes('tts') &&
                              !id.includes('transcribe') &&
                              !id.includes('search') &&
                              !id.includes('realtime') &&
                              !id.includes('image') &&
                              !id.includes('preview')
                        : true;
                })
                .map((m) => ({
                    value: m.id,
                    label: m.id,
                }));
            if (modelChoices.length === 0) {
                s.stop(red('No GPT models found for your credentials.'));
                cancel('Setup cancelled');
                process.exit(1);
            }
            s.stop('Models fetched.');
            const selectedModel = await select({
                message: 'Select the OpenAI model to use',
                options: modelChoices,
                initialValue:
                    currentConfig.model && modelChoices.some((c) => c.value === currentConfig.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });
            if (typeof selectedModel !== 'string') {
                cancel('Setup cancelled');
                process.exit(0);
            }
            model = selectedModel;
        } catch (err) {
            s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
            cancel('Setup cancelled');
            process.exit(1);
        }
    }

    // 5. Get commit message type
    const type = await select({
        message: 'Select commit message format',
        options: [
            { value: 'conventional', label: 'Conventional Commits (e.g., feat: add new feature)' },
            { value: 'simple', label: 'Simple (e.g., Add new feature)' },
        ],
        initialValue: currentConfig.type === 'conventional' ? 'conventional' : 'simple',
    });
    if (type === null) {
        cancel('Setup cancelled');
        process.exit(0);
    }
    if (typeof type !== 'string' || (type !== 'conventional' && type !== 'simple')) {
        throw new Error('Invalid commit message type');
    }

    // 6. Get language preference
    const detectedLocale = detectLocale();
    const locale = await text({
        message: 'Enter your preferred language code (e.g., en, es, fr)',
        placeholder: detectedLocale,
        initialValue: currentConfig.locale || detectedLocale,
        validate: (value) => {
            if (!value) {
                return 'Language code is required';
            }
            if (value.length !== 2) {
                return 'Language code must be 2 characters';
            }
            if (!iso6391.validate(value)) {
                return 'Invalid language code. Please use a valid ISO 639-1 code (e.g., en, es, fr)';
            }
            return undefined;
        },
    });
    if (locale === null) {
        cancel('Setup cancelled');
        process.exit(0);
    }
    if (typeof locale !== 'string') {
        throw new Error('Language code is required');
    }

    // Save configuration
    const newConfig: Partial<Config> = {
        ...currentConfig,
        apiKey,
        baseUrl,
        locale: locale as LanguageCode,
        model,
        provider,
        type: type === 'simple' ? '' : 'conventional',
    };

    // Update config in memory first
    configService.updateConfigInMemory(newConfig);

    // Flush the config to disk
    await configService.flush();

    note(
        `Configuration saved to ${yellow(configService.getConfigFilePath())}\n\n` +
            'You can now use aicommits! Try it with:\n' +
            `${green('git add .')}\n` +
            `${green('aicommits')}\n\n` +
            `To modify your settings later, run ${yellow('aicommits config set <key> <value>')}`,
    );

    outro('Setup complete! 🎉');
});
