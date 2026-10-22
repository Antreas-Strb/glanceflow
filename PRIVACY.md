# Privacy

GlanceFlow is a mod for Claude Code. It has no accounts, no analytics and no server of its own, and it makes no network requests of its own.

## What stays on your computer

These are kept in Claude Code's plugin store on your computer and are never sent anywhere by GlanceFlow:

- each chat's checklist, so a resumed chat picks up where it was;
- the history of your jobs (titles, step names, what each step got done, file names, times and whether the code was tested), for 30 days;
- your settings, and the goal you set for a project with `/glanceflow goal`.

## What goes to Claude

GlanceFlow asks Claude, through Claude Code and your own Claude account, for a few short texts:

- a short title for each job, from up to the first 2,000 characters of your request, with emails, phone numbers, keys, passwords and card numbers masked first;
- a handoff note when you start a fresh chat, and a checkpoint when you tidy up the chat. Both are written from the conversation you are already having with Claude.

These requests go under the same terms as the rest of your Claude Code use.

## What your computer shows

- **Desktop notices** (off by default) go through your computer's own notification system. Each holds the status and one line of up to 160 characters, with private details masked. Your computer may keep them in its notification history.
- **Sounds and voice** (off by default) play GlanceFlow's own sound files, or say a few fixed words like "Claude needs you", through your computer's own players.

## What you choose to share

- **Team report** and `/glanceflow week` copy a summary to your clipboard only when you press the button or run the command.
- **Ship it** (off by default) has Claude commit, push and open a pull request on GitHub, and merge only after you approve the exact commit. That uses your own git and GitHub sign-in.

## On screen

GlanceFlow masks emails, phone numbers, keys and card numbers in the conversation and in step names, and holds back a message that looks like it contains a password or key until you send it again. Claude still reads your original text.

## Contact

Ask in [Discussions](https://github.com/Antreas-Strb/glanceflow/discussions), or report a security problem privately as described in [SECURITY.md](SECURITY.md).
