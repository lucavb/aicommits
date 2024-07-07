# @lucavb/aicommits

## Setup

> The minimum supported version of Node.js is the latest v14. Check your Node.js version with `node --version`.

1. Install _aicommits_:

    ```sh
    npm install -g @lucavb/aicommits
    ```

2. Choose your provider:

    For OpenAPI run:

    ```shell
    aic config set baseUrl "https://api.openai.com/v1"
    ```

    For any other provider replace the URL with yours. It needs to be compatible with the OpenAI API.

3. Retrieve your API key from your provider (if necessary)
   For OpenAI you can find your API Key [here](https://platform.openai.com/account/api-keys)

    > Note: If you haven't already, you'll have to create an account and set up billing.

4. Set the key so @lucavb/aicommits can use it:

    ```sh
    aicommits config set apiKey <your token>
    ```

    This will create a `.aicommits` file in your home directory.

### Upgrading

You can upgrade to the latest version by running:

```sh
npm update -g @lucavb/aicommits
```

## Usage

### CLI mode

You can call `aicommits` directly to generate a commit message for your staged changes:

```sh
git add <files...>
aicommits
```

`aicommits` passes down unknown flags to `git commit`, so you can pass in [`commit` flags](https://git-scm.com/docs/git-commit).

For example, you can stage all changes in tracked files with as you commit:

```sh
aicommits --stage-all # or -a
```

> 👉 **Tip:** Use the `aic` alias if `aicommits` is too long for you.

#### Generate multiple recommendations

Sometimes the recommended commit message isn't the best so you want it to generate a few to pick from. You can generate multiple commit messages at once by passing in the `--generate <i>` flag, where 'i' is the number of generated messages:

```sh
aicommits --generate <i> # or -g <i>
```

> Warning: this uses more tokens, meaning it costs more.

#### Generating Conventional Commits

If you'd like to generate [Conventional Commits](https://conventionalcommits.org/), you can use the `--type` flag followed by `conventional`. This will prompt `aicommits` to format the commit message according to the Conventional Commits specification:

```sh
aicommits --type conventional # or -t conventional
```

This feature can be useful if your project follows the Conventional Commits standard or if you're using tools that rely on this commit format.

#### Usage

1. Stage your files and commit:

    ```sh
    git add <files...>
    git commit # Only generates a message when it's not passed in
    ```

    > If you ever want to write your own message instead of generating one, you can simply pass one in: `git commit -m "My message"`

2. Aicommits will generate the commit message for you and pass it back to Git. Git will open it with the [configured editor](https://docs.github.com/en/get-started/getting-started-with-git/associating-text-editors-with-git) for you to review/edit it.

3. Save and close the editor to commit!

## Configuration

### Reading a configuration value

To retrieve a configuration option, use the command:

```sh
aicommits config get <key>
```

For example, to retrieve the API key, you can use:

### Setting a configuration value

To set a configuration option, use the command:

```sh
aicommits config set <key>=<value>
```

For example, to set the API key, you can use:

### Options

#### apiKey

Required

The API key needed for your provider.

#### baseUrl

Required

The base URL for the OpenAI API. You can use this to point to a different API endpoint, such as a local development server.

#### locale

Default: `en`

The locale to use for the generated commit messages. Consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes.

#### generate

Default: `1`

The number of commit messages to generate to pick from.

Note, this will use more tokens as it generates more results.

#### model

The Chat Completions (`/v1/chat/completions`) model to use.

#### max-length

The maximum character length of the generated commit message.

Default: `50`

```sh
aicommits config set maxLength 100
```

#### type

Default: `""` (Empty string)

The type of commit message to generate. Set this to "conventional" to generate commit messages that follow the Conventional Commits specification:

```sh
aicommits config set type conventional
```

You can clear this option by setting it to an empty string:

```sh
aicommits config set type ""
```

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to OpenAI's GPT-3, then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Maintainers

-   **Luca Becker**: [@lucavb](https://github.com/lucavb)

-   **Hassan El Mghari**: [@Nutlope](https://github.com/Nutlope) [<img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/nutlope)

-   **Hiroki Osame**: [@privatenumber](https://github.com/privatenumber) [<img src="https://img.shields.io/twitter/follow/privatenumbr?style=flat&label=privatenumbr&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/privatenumbr)

## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/lucavb/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project
