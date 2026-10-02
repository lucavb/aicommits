# Resolve the profile once, at the composition root

The config file is read once per CLI run, inside `buildContainer`, and turned into an immutable **resolved profile** (`ready | missing | invalid`) bound under `RESOLVED_PROFILE`. Handlers inject that union and decide how to report an unusable profile. Services that only make sense with a usable profile (generation, the provider factory) inject `READY_PROFILE`, an accessor that returns the ready profile or throws a `KnownError`.

We chose this over a lazily-loading `ConfigService` that every caller had to remember to `readConfig()` first. That design let callers choose between four overlapping config views, and three of them chose wrong: CLI overrides were dropped, the `prepare-commit-msg` hook never loaded the file, and a diff query wrote the config file. We also rejected passing the profile as an argument through `generate()` and `review()`, because that would widen two interfaces that don't care about configuration (and the generation seam is the one the planned agent service replaces).

## Consequences

- `buildContainer` is async.
- Commands that edit the file (`setup`, `config set`, `ignore`) go through `ProfileStore`, which is separate from the resolved profile.
- Nothing may re-read the config file after startup. A change made while the command runs doesn't affect the rest of that run.
