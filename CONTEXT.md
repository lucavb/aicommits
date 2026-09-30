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
