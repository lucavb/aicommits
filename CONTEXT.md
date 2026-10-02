# aicommits

A CLI that reads a staged diff and offers an AI-written commit message, with separate configurations per profile.

## Language

**Proposal**:
The subject+body pair aicommits offers the user for one commit. The user accepts, revises, edits, or cancels it.
_Avoid_: suggestion, generation result, output

**Subject**:
The first line of a proposal — the imperative summary line shown in the git log.
_Avoid_: commit message (as a name for the first line), headline, title

**Body**:
The bullet-point detail beneath the subject within a proposal.
_Avoid_: summary, long description

**Commit message**:
What git actually records: the accepted subject and body joined by a blank line.
_Avoid_: full message, complete message

**Profile**:
A named set of settings (provider, model, format, language, excludes) saved in the user's config file. A user can keep several and switch between them.
_Avoid_: account, preset

**Resolved profile**:
The profile in effect for one run: the selected profile with command-line and environment overrides applied and its credential located. It is either ready, missing, or invalid.
_Avoid_: current config, merged config, effective config

**Credential**:
The API key a resolved profile will use, together with where it came from (profile, command line, or a named environment variable).
_Avoid_: token, secret

**Global ignore**:
File patterns excluded from every profile's diff. The built-in defaults are offered in the main flow and only applied and persisted after explicit consent; non-interactive runs (the hook) review whatever was excluded explicitly.
_Avoid_: default excludes, ignore list
