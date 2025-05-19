import { Command, Option } from '@commander-js/extra-typings';
import { cancel, intro, note, outro, select, spinner, text } from '@clack/prompts';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';
import { type ProfileConfig, ProviderName } from '../utils/config';
import { green, red, yellow } from 'kolorist';
import type { LanguageCode } from 'iso-639-1';
import iso6391 from 'iso-639-1';
import OpenAI from 'openai';
import { OllamaProvider } from '../services/ollama-provider';
import Anthropic from '@anthropic-ai/sdk';

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

export const setupCommand = new Command('setup')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .description('Interactive setup for aicommits')
    .action(async ({ profile }) => {
        intro('Welcome to aicommits setup! 🚀');
        note(`You are configuring the "${profile}" profile.`);

        const configService = container.get(ConfigService);
        await configService.readConfig();
        const currentConfig = configService.getProfile(profile);

        // 1. Prompt for Provider
        const provider = await select({
            message: 'Select your AI provider',
            options: [
                { value: 'openai', label: 'OpenAI (compatible)' },
                { value: 'ollama', label: 'Ollama' },
                { value: 'anthropic', label: 'Anthropic' },
            ],
            initialValue: currentConfig?.provider ?? 'openai',
        });
        if (provider === null) {
            cancel('Setup cancelled');
            process.exit(0);
        }
        if (typeof provider !== 'string' || !['openai', 'ollama', 'anthropic'].includes(provider)) {
            throw new Error('Invalid provider');
        }

        configService.updateProfileInMemory(profile, { provider });

        // 2. Prompt for Base URL
        const getBaseUrlMessage = (provider: ProviderName) => {
            if (provider === 'openai') {
                return 'Enter the OpenAI API base URL';
            }
            if (provider === 'ollama') {
                return 'Enter the Ollama API base URL';
            }
            return 'Enter the Anthropic API base URL';
        };

        const getBaseUrlPlaceholder = (provider: ProviderName) => {
            if (provider === 'openai') {
                return 'https://api.openai.com/v1';
            }
            if (provider === 'ollama') {
                return 'http://localhost:11434';
            }
            return 'https://api.anthropic.com';
        };

        const getBaseUrlInitialValue = (provider: ProviderName, currentConfig?: ProfileConfig) => {
            if (currentConfig?.baseUrl) {
                return currentConfig.baseUrl;
            }
            return getBaseUrlPlaceholder(provider);
        };

        const baseUrl = await text({
            message: getBaseUrlMessage(provider),
            placeholder: getBaseUrlPlaceholder(provider),
            initialValue: getBaseUrlInitialValue(provider, currentConfig),
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

        configService.updateProfileInMemory(profile, { baseUrl: baseUrl.trim() });

        // 3. Prompt for API Key (only for OpenAI and Anthropic)
        let apiKey: string | undefined;
        if (provider === 'ollama') {
            // Ollama doesn't require an API key
            apiKey = undefined;
        } else {
            // OpenAI and Anthropic require an API key
            const apiKeyInput = await text({
                message: `Enter your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`,
                placeholder: 'Your API key',
                initialValue: currentConfig?.apiKey,
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
        configService.updateProfileInMemory(profile, { apiKey: apiKey?.trim() });

        // 4. Fetch available models
        let model: string;
        if (provider === 'ollama') {
            // For Ollama, fetch available models
            const s = spinner();
            s.start('Fetching available models from Ollama...');
            try {
                const ollamaProvider = new OllamaProvider(fetch, configService.getConfig().baseUrl);
                const models = await ollamaProvider.listModels();
                const modelChoices = models.map((name: string) => ({
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
                        currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
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
        } else if (provider === 'anthropic') {
            // For Anthropic, use static model list
            const anthropic = new Anthropic({ baseURL: baseUrl.trim(), apiKey });
            const modelsResponse = await anthropic.models.list();
            const modelChoices = modelsResponse.data.map((m) => ({
                value: m.id,
                label: m.id,
            }));
            const selectedModel = await select({
                message: 'Select the Anthropic model to use',
                options: modelChoices,
                initialValue:
                    currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });
            if (typeof selectedModel !== 'string') {
                cancel('Setup cancelled');
                process.exit(0);
            }
            model = selectedModel;
        } else {
            // OpenAI: fetch available models
            const s = spinner();
            s.start('Fetching available models from OpenAI...');
            try {
                const openai = new OpenAI({ baseURL: baseUrl.trim(), apiKey });
                const modelsResponse = await openai.models.list();
                const modelChoices = modelsResponse.data
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
                        currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
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
            initialValue: currentConfig?.type === 'conventional' ? 'conventional' : 'simple',
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
            initialValue: currentConfig?.locale || detectedLocale,
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
        const newConfig: Partial<ProfileConfig> = {
            ...currentConfig,
            apiKey,
            baseUrl,
            locale: locale as LanguageCode,
            model,
            provider: provider as ProviderName,
            type: type === 'simple' ? '' : 'conventional',
        };

        // Update config in memory first
        configService.updateProfileInMemory(profile, newConfig);

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
