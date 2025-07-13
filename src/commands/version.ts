import { Command } from '@commander-js/extra-typings';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const contributorSchema = z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
});

const packageJsonSchema = z.object({
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    contributors: z.array(z.union([contributorSchema, z.string()])).optional(),
});

function loadAndParsePackageJson() {
    const pkgPath = resolve(dirname(new URL(import.meta.url).pathname), '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return packageJsonSchema.parse(parsed);
}

export const versionCommand = new Command('version')
    .description('Print the current version, documentation, and authors of aicommits')
    .action(() => {
        const { version, contributors } = loadAndParsePackageJson();

        // Format contributors from package.json
        let authors = '';
        if (Array.isArray(contributors)) {
            authors = contributors
                .map((c) => {
                    if (typeof c === 'string') {
                        return `  - ${c}`;
                    }
                    let str = `  - ${c.name}`;
                    if (c.url) {
                        str += ` (${c.url})`;
                    }
                    if (c.email) {
                        str += ` <${c.email}>`;
                    }
                    return str;
                })
                .join('\n');
        } else {
            authors = '  - aicommits contributors (https://github.com/lucavb/aicommits/graphs/contributors)';
        }

        const doc = `
aicommits - AI-powered Conventional Commit Messages for your git workflow

Version: ${version}

aicommits generates clear, conventional commit messages using AI, helping you maintain a readable and consistent git history.

Usage:
  aicommits [options]
  aicommits version

Options:
  --api-key <apiKey>         Set your OpenAI API key
  --base-url <baseUrl>       Set the OpenAI API base URL
  --context-lines <n>        Number of context lines for diffs
  --exclude <pattern>        Exclude files from commit analysis
  --max-length <n>           Maximum commit message length
  --model <model>            OpenAI model to use
  --stage-all                Stage all files before committing
  --type <type>              Commit type (feat, fix, chore, etc.)

Authors:
${authors}

For more information, visit:
  https://github.com/lucavb/aicommits
        `.trim();
        console.log(doc);
    });
