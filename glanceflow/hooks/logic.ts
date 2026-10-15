import type { GlanceChecklist, GlanceHelper, GlanceHistoryView, GlanceOtherChat, GlanceTask, GlanceTaskSize, GlanceUsage } from '../types'
import { SIZE_WEIGHT, teamReport, weekSummary } from './history'
import { maskPrivate } from './privacy'

export const PLUGIN = 'glanceflow'

export const tourNeeds = (mark: string) =>
  `When Claude needs you, the checklist says Needs you ${mark}, and what to do. Turn on sounds or desktop notices in Settings to hear or see it from another app.`

export const MAX_NAME = 40

export const QUESTION = "Answer Claude's question in the chat"

export const WAITING = 'Reply to Claude in the box below'

// The longest plain sentence Claude's own description of a tool call keeps.
export const MAX_DETAIL = 90

export const CODE_FILE =
  /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kts?|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|bash|json|ya?ml|toml|css|scss|sass|less|html?|md|mdx|sql|vue|svelte|lock|env|xml|ini|cfg|conf|txt|csv|log)\W*$/i

export const pad2 = (value: number) => String(value).padStart(2, '0')

/** "10:01:45 UTC" in the person's own time, "13:01:45" in Athens; a time without UTC, GMT or Z is left as written. */
export function localTimes(text: string, today = new Date()): string {
  return text.replace(/(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s?(?:UTC|GMT|Z)\b/g, (whole, hours, minutes, seconds) => {
    if (Number(hours) > 23 || Number(minutes) > 59) return whole
    const at = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), Number(hours), Number(minutes), Number(seconds ?? 0)))
    return `${pad2(at.getHours())}:${pad2(at.getMinutes())}${seconds === undefined ? '' : `:${pad2(at.getSeconds())}`}`
  })
}

/** When a plan window resets, in the person's own time: "at 18:40", or "on Thu at 09:00" when it is more than a day away. */
export function resetTime(resetsAt: string | null, at: number): string | null {
  const when = resetsAt ? new Date(resetsAt) : null
  if (when === null || Number.isNaN(when.getTime())) return null
  const time = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`
  if (when.getTime() - at <= 24 * 3_600_000) return `at ${time}`
  return `on ${when.toLocaleDateString('en-GB', { weekday: 'short' })} at ${time}`
}

/** Turns any step or job name, or a step's summary, into short plain English. */
export function cleanName(raw: unknown, max = MAX_NAME): string {
  const words = localTimes(maskPrivate(String(raw ?? '')))
    .replace(/`[^`]*`/g, ' ')
    .replace(/`/g, ' ')
    .split(/\s+/)
    .filter(word => word && !word.includes('•') && !/[/\\]/.test(word) && !CODE_FILE.test(word))
  let name = words.join(' ').replace(/\s+/g, ' ').trim()
  if (!name) {
    return 'Working on it'
  }
  name = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.length <= max) {
    return name
  }
  const cut = name.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–]+$/, '')}…`
}

/**
 * A name in Title Case ("Copy Mod With Button Choices") in the sentence case the checklist uses everywhere else. A
 * word with a capital past its first letter (GlanceFlow, PR) keeps its case; a name already in sentence case stays.
 */
export function sentenceCase(name: string): string {
  const words = name.split(' ')
  if (words.length < 3 || words.some(word => /^\p{Ll}/u.test(word))) return name
  return words.map((word, index) => (index === 0 || /\p{Lu}/u.test(word.slice(1)) ? word : word.toLowerCase())).join(' ')
}

export function apiErrorSentence(kind: string, details = ''): string {
  if (/too long|context (window|length|limit)|max(imum)? context/i.test(details)) {
    return 'type /compact and try again'
  }
  if (kind === 'rate_limit' || kind === 'billing_error') {
    return 'you hit your usage limit, try again a little later'
  }
  if (kind === 'overloaded') {
    return "Claude's servers are busy, try again in a minute"
  }
  if (/authentication|oauth|credential/.test(kind)) {
    return 'type /login'
  }
  if (/network|connect|ECONN|ENOTFOUND|socket|fetch failed|offline/i.test(details)) {
    return 'the internet connection dropped'
  }

  return "Claude's servers are busy, try again in a minute"
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** A duration where words flow (the desktop): a whole minute drops its seconds, `1m` rather than `1m 0s`. */
export function durationWords(ms: number): string {
  return formatDuration(ms).replace(/^(\d+m) 0s$/, '$1')
}

/** Terminal cells a character takes: two for CJK and emoji, none for joiners and accents. */
export function cellsOf(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code === 0x200d || (code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f)) return 0
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)

  return isWide ? 2 : 1
}

/** Pads or trims text to exactly `width` terminal cells, so columns line up in any script. */
export function fit(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }
  const chars = Array.from(text)
  const total = chars.reduce((sum, char) => sum + cellsOf(char), 0)
  if (total <= width) {
    return text + ' '.repeat(width - total)
  }
  let kept = ''
  let used = 0
  for (const char of chars) {
    const size = cellsOf(char)
    if (used + size > width - 1) break
    kept += char
    used += size
  }

  return `${kept}…${' '.repeat(width - 1 - used)}`
}

export function task(name: string, status: GlanceTask['status'], id = name, size: GlanceTaskSize = 'M'): GlanceTask {
  return { id, name, status, percent: status === 'done' ? 100 : 0, hasReported: status === 'done', size, summary: null, tokens: 0, cachedTokens: 0, startedAt: null, finishedAt: null }
}

/** Token counts move to the new plan's step of the same name; the rest go to its first step, so the job total holds. */
export function carryTokens(old: GlanceTask[], next: GlanceTask[]): GlanceTask[] {
  const used = new Set<string>()
  const carried = next.map(one => {
    const same = old.find(before => before.name === one.name && !used.has(before.id))
    if (!same) return one
    used.add(same.id)
    return { ...one, tokens: same.tokens, cachedTokens: same.cachedTokens, summary: same.summary, files: same.files }
  })
  const leftover = old.filter(before => !used.has(before.id))
  const [first, ...rest] = carried
  if (!first) return carried

  return [
    {
      ...first,
      tokens: first.tokens + leftover.reduce((sum, one) => sum + one.tokens, 0),
      cachedTokens: first.cachedTokens + leftover.reduce((sum, one) => sum + one.cachedTokens, 0),
    },
    ...rest,
  ]
}

/** 950 → 950, 12_400 → 12.4k, 3_200_000 → 3.2M. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`

  return `${(count / 1_000_000).toFixed(1)}M`
}

/** New tokens first (what really counts), then the cheap ones read back from the cache. */
export function tokenNote(tokens: number, cachedTokens: number): string {
  if (tokens <= 0) return ''
  if (cachedTokens <= 0) return `${formatTokens(tokens)} tokens`

  return `${formatTokens(tokens - cachedTokens)} new · ${formatTokens(cachedTokens)} cached`
}

export function sizeOf(raw: unknown): GlanceTaskSize {
  const size = String(raw ?? '').trim().toUpperCase()

  return size === 'S' || size === 'L' ? size : 'M'
}

/** Overall progress: finished work out of the plan, S/M/L counting 1/2/3, the current step in part. */
export function overallProgress(
  tasks: GlanceTask[],
  activePercent?: number,
): { percent: number; doneCount: number; work: number } {
  const total = tasks.reduce((sum, one) => sum + SIZE_WEIGHT[one.size], 0)
  const work = tasks.reduce((sum, one) => {
    const weight = SIZE_WEIGHT[one.size]
    if (one.status === 'done') return sum + weight
    if (one.status === 'active' && activePercent !== undefined) return sum + (weight * activePercent) / 100
    if (one.status === 'active' && one.hasReported) return sum + (weight * one.percent) / 100
    return sum
  }, 0)

  return {
    percent: total ? Math.round((100 * work) / total) : 0,
    doneCount: tasks.filter(one => one.status === 'done').length,
    work: total ? work / total : 0,
  }
}

/** Each step's start and end time, stamped as its status changes. */
export function stampTimes(tasks: GlanceTask[], at: number): GlanceTask[] {
  return tasks.map(one => {
    if (one.status === 'upcoming') return one.startedAt === null && one.finishedAt === null ? one : { ...one, startedAt: null, finishedAt: null }
    if (one.status === 'active') return one.startedAt === null || one.finishedAt !== null ? { ...one, startedAt: one.startedAt ?? at, finishedAt: null } : one
    return one.finishedAt === null ? { ...one, startedAt: one.startedAt ?? at, finishedAt: at } : one
  })
}

// A step of size M is expected to take 3 minutes until this job's or this project's pace is known.
export const DEFAULT_UNIT_MS = 90_000

// The project's pace from History counts as much as this many units of this job's own finished steps.
export const PACE_WEIGHT = 2

/**
 * How far along the current step looks: time spent against the time this job's finished steps took per
 * unit of size. It fills gradually, stays below 100 until the step is checked off, and never falls below
 * what Claude reported.
 *
 * Time left is null once the step runs past what it should take: the percentage then sits near the top
 * whatever happens, so time spent against it would keep saying "under a minute". A lower percentage that
 * Claude reported still gives an estimate.
 */
export function stepEstimate(list: GlanceChecklist, one: GlanceTask, at: number) {
  const done = list.tasks.filter(
    step => step.status === 'done' && step.startedAt !== null && step.finishedAt !== null && step.finishedAt > step.startedAt,
  )
  const units = done.reduce((sum, step) => sum + SIZE_WEIGHT[step.size], 0)
  const spent = done.reduce((sum, step) => sum + (step.finishedAt! - step.startedAt!), 0)
  const prior = list.paceMs === null ? 0 : PACE_WEIGHT
  const unitMs = units + prior > 0 ? (spent + (list.paceMs ?? 0) * prior) / (units + prior) : DEFAULT_UNIT_MS
  const expected = Math.max(10_000, unitMs * SIZE_WEIGHT[one.size])
  const elapsedMs = one.startedAt === null ? 0 : Math.max(0, at - one.startedAt)
  const estimate = Math.min(95, Math.round((100 * elapsedMs) / expected))
  const reported = one.hasReported && one.percent > 0 && one.percent < LONG_STEP_REPORT ? one.percent : null
  // Past its expected time, time spent says nothing more: what Claude reported is the better guess.
  const percent = elapsedMs > expected && reported !== null ? reported : Math.min(99, Math.max(one.hasReported ? one.percent : 0, estimate))
  const leftMs =
    elapsedMs <= expected
      ? percent > 0
        ? (elapsedMs * (100 - percent)) / percent
        : expected
      : reported === null
        ? null
        : (elapsedMs * (100 - reported)) / reported

  return { percent, elapsedMs, expectedMs: expected, leftMs }
}

// Past its expected time, a step's own report below this still says how far along it is.
export const LONG_STEP_REPORT = 90

/** A step's time left: short for the terminal's columns (`<1m left`), in words where text flows (`under a minute left`). */
export function leftLabel(ms: number | null, isWords = false): string {
  if (ms === null) return 'taking longer'
  if (isWords) return ms < 60_000 ? 'under a minute left' : `about ${formatLeft(ms)} left`
  return ms < 60_000 ? '<1m left' : `~${formatLeft(ms)} left`
}

/**
 * Time left at this job's own pace since the plan once two steps are done. Before that, the steps left at
 * this project's usual pace from History; nothing when History doesn't know it yet.
 */
export function timeLeft(list: GlanceChecklist, at: number, activePercent?: number): number | null {
  const { doneCount, work } = overallProgress(list.tasks, activePercent)
  if (list.planAt === null || work >= 1) return null
  // A step running long makes any total a guess: say nothing rather than something too short.
  const active = list.tasks.find(one => one.status === 'active')
  if (active && stepEstimate(list, active, at).leftMs === null) return null
  if (doneCount >= 2 && work > 0) return Math.round(((at - list.planAt) / work) * (1 - work))
  if (list.paceMs === null) return null

  return Math.round(
    list.tasks
      .filter(one => one.status !== 'done')
      .reduce((sum, one) => sum + (stepEstimate(list, one, at).leftMs ?? 0), 0),
  )
}

/**
 * Steps still open after Claude answered. The last step alone still open counts as done:
 * Claude finished but forgot to report 100.
 */
export function hasUnfinishedWork(tasks: GlanceTask[]): boolean {
  const open = tasks.filter(one => one.status !== 'done')

  return open.length > 1 || (open.length === 1 && open[0] !== tasks[tasks.length - 1])
}

/** Header details in order of importance; the least important drop first so the title stays readable. */
export function headerDetails(parts: string[], room: number): string {
  const kept = parts.filter(Boolean)
  while (kept.length > 1 && kept.map(one => ` · ${one}`).join('').length > room) {
    kept.pop()
  }

  return kept.map(one => ` · ${one}`).join('')
}

/**
 * The pieces of a line that fit in `room` characters, joined by " · ": whole pieces, in order, leaving out any that
 * don't fit, so no word is ever cut in half. When none fits, the first keeps the whole words it has room for.
 */
export function wholePieces(pieces: string[], room: number): string {
  const all = pieces.filter(Boolean)
  const kept: string[] = []
  let used = 0
  for (const piece of all) {
    const size = widthOf(piece) + (kept.length > 0 ? 3 : 0)
    if (used + size <= room) {
      kept.push(piece)
      used += size
    }
  }
  if (kept.length > 0 || all.length === 0) return kept.join(' · ')
  let cut = ''
  for (const word of (all[0] ?? '').split(' ')) {
    const next = cut === '' ? word : `${cut} ${word}`
    if (widthOf(`${next}…`) > room) break
    cut = next
  }
  return cut === '' ? '' : `${cut.replace(/[\s·,;:]+$/, '')}…`
}

/** A model id as people say it: claude-haiku-4-5-20251001 → Haiku 4.5. */
export function prettyModel(model: string | null | undefined): string | null {
  if (!model) return null
  const match = /(opus|sonnet|haiku|fable)(?:[-_ ](\d+)(?:[-.](\d{1,2})(?!\d))?)?/i.exec(model)
  if (!match) return model
  const name = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1).toLowerCase()

  return [name, [match[2], match[3]].filter(Boolean).join('.')].filter(Boolean).join(' ')
}

/** The step new helpers belong to: the current one, or the last one once all are done. */
export function currentStepId(list: GlanceChecklist): string {
  return (list.tasks.find(one => one.status === 'active') ?? list.tasks[list.tasks.length - 1])?.id ?? ''
}

/** A file's path within the project; outside it, just its name. */
export function projectPath(path: string, project: string): string {
  const root = project.replace(/[\\/]+$/, '')
  if (root !== '' && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))) return path.slice(root.length + 1)

  return path.split(/[\\/]/).pop() ?? path
}

export type BackgroundTask = { id: string; type: string; status: string; description: string }

/** Background tasks as the latest list has them: new ones join, ones no longer listed have finished. */
export function reconcileBackground(list: GlanceChecklist, tasks: readonly BackgroundTask[]): GlanceHelper[] {
  const listed = new Map(tasks.map(one => [`bg:${one.id}`, one]))
  const kept = list.helpers.map(helper => {
    if (helper.kind !== 'background' || helper.status !== 'running') return helper
    const still = listed.get(helper.id)
    return still ? helper : { ...helper, status: 'done' as const }
  })
  const known = new Set(kept.map(one => one.id))
  const added = tasks
    .filter(one => !known.has(`bg:${one.id}`))
    .map(
      (one): GlanceHelper => ({
        id: `bg:${one.id}`,
        stepId: currentStepId(list),
        kind: 'background',
        label: cleanName(one.description, MAX_DETAIL),
        type: one.type,
        model: null,
        effort: null,
        status: 'running',
        tokens: 0,
      }),
    )

  return [...kept, ...added]
}

/** What a tool call is doing, in plain words; null for planning tools and helpers, which show elsewhere. */
export function activityOf(tool: string, input: { command?: unknown }): string | null {
  if (tool === 'Read' || tool === 'NotebookRead') return 'Reading files'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS') return 'Searching the project'
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'Editing files'
  if (tool === 'Write') return 'Writing files'
  if (tool === 'WebFetch') return 'Reading a web page'
  if (tool === 'WebSearch') return 'Searching the web'
  if (tool === 'Skill') return 'Following a skill'
  if (tool.startsWith('mcp__') && !tool.startsWith(`mcp__${PLUGIN}__`)) return 'Using a connected app'
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input.command ?? '')
    if (/\b(test|tests|jest|vitest|pytest|mocha|playwright|rspec)\b/i.test(command)) return 'Running the tests'
    if (/\b(npm|pnpm|yarn|bun|pip3?|brew|cargo|gem)\s+(install|add|i)\b/i.test(command)) return 'Installing packages'
    if (/\bgit\s+\w+/.test(command)) return 'Working with git'
    if (/\b(build|tsc|compile)\b/i.test(command)) return 'Building the project'
    return 'Running a command'
  }
  return null
}

/** A job's cost in plain dollars: "$0.42", or "<$0.01" for less than a cent. */
export function formatCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

/** What the job has cost so far, from the session's spend; null where the host keeps no ledger. */
export function jobCost(list: GlanceChecklist, usage: GlanceUsage): number | null {
  return usage.costUsd === null || list.costAtStart === null ? null : Math.max(0, usage.costUsd - list.costAtStart)
}

export function isBusy(list: GlanceChecklist): boolean {
  return list.helpers.some(one => one.status === 'running')
}

/** A short "carry on" the person typed, in English or Greek: it continues the job instead of starting a new one. */
export function isContinueWords(text: string): boolean {
  const words = text.trim().toLowerCase().replace(/[.!…,;:]+$/g, '').replace(/\s+/g, ' ')
  return (
    /^(please )?(continue|go on|keep going|resume|carry on|proceed|go ahead)( please)?$/.test(words) ||
    /^(σε παρακαλώ |παρακαλώ )?(συνέχισε|συνεχισε|συνέχεια|συνεχεια|προχώρα|προχωρα)( σε παρακαλώ| παρακαλώ| παρακαλω)?$/.test(words)
  )
}

/** A short "go ahead" the person typed: it approves the plan. */
export function isStartWords(text: string): boolean {
  const words = text.trim().toLowerCase().replace(/[.!…,;:]+$/g, '').replace(/\s+/g, ' ')
  return /^(start|go|go ahead|ok|okay|yes|looks good|approved?|ξεκίνα|ξεκινα|ναι|οκ|εντάξει|ενταξει)( please)?$/.test(words)
}

/**
 * Claude's last message ends by asking the person something. Greek writes its question mark as ";", so a ";" counts
 * in Greek text and nowhere else; a code block never does.
 */
export function asksQuestion(answer: string): boolean {
  const end = answer.trimEnd().replace(/[*_"'”»)\s]+$/g, '')
  return /[?？؟]$/.test(end) || (end.endsWith(';') && /\p{Script=Greek}/u.test(end))
}

/** The full head SHA Ship it last asked the person to approve ("Reply exactly: Approve merge <SHA>"), or null. */
export function askedMergeSha(answer: string): string | null {
  return [...answer.matchAll(/Reply exactly:\s*`?Approve merge ([0-9a-f]{40})`?/g)].pop()?.[1] ?? null
}

/**
 * A word as Bash passes it on, and whether Bash builds it at run time: from $…, `…`, a glob, {a,b}, ~ or =. `runs`
 * holds the code of an unquoted $(…) or `…` in it, which Bash runs first.
 */
export type ShellWord = { text: string; isRunTime: boolean; runs?: string[] }
/** The words of one command, or of one line of a heredoc's body. */
export type ShellPiece = { words: ShellWord[]; isBody: boolean }

// $'…' escapes every shell spells alike; \u, \U and \c differ between Bash 3.2, newer Bash and zsh.
const ANSI_C: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
// A heredoc's start, <<EOF, <<-EOF, <<'EOF' or <<"EOF"; a delimiter spelled any other way leaves its lines as commands.
const HEREDOC = /^<<(-?)[ \t]*(['"]?)([^\s'"<>;|&()]+)\2(?=[\s;|&<>()]|$)/

/**
 * Reads a Bash command into pieces of words the way Bash spells them before it runs anything: \ and a newline go,
 * \c is c, '…', "…" (with \" \\ \$ \` and \ newline) and $'…' join their neighbours into one word, # starts a
 * comment, a heredoc's lines are its body, ; | & and newlines end a piece, and ( ) < > stand as words of their own.
 * shortcut: a bounded lexer, not a parser; it never runs or expands anything. A word built at run time keeps its text
 * as written and is marked, and $(…) is read to its matching ) past quotes and heredocs only.
 */
export function shellPieces(command: string): ShellPiece[] {
  const pieces: ShellPiece[] = []
  const heredocs: { delimiter: string; isTabbed: boolean }[] = []
  let words: ShellWord[] = []
  let word: ShellWord | null = null
  // The word's unquoted characters, where globs and brace lists count.
  let bare = ''
  const add = (text: string, isQuoted = false): ShellWord => {
    // ~ and zsh's = expand only at the start of a word, unquoted.
    word ??= { text: '', isRunTime: !isQuoted && /^[~=]/.test(text) }
    word.text += text
    if (!isQuoted) bare += text
    return word
  }
  const runTime = (text: string, runs?: string) => {
    const one = add(text, true)
    one.isRunTime = true
    if (runs !== undefined) (one.runs ??= []).push(runs)
  }
  const endWord = () => {
    if (word !== null) {
      if (/[*?]|\[[^\]]+\]|\{.*(?:,|\.\.).*\}/.test(bare)) word.isRunTime = true
      words.push(word)
    }
    word = null
    bare = ''
  }
  const endPiece = () => {
    endWord()
    pieces.push({ words, isBody: false })
    words = []
  }
  // The index of the next unescaped quote, or the end.
  const end = (from: number, quote: string): number => {
    for (let at = from; at < command.length; at++) {
      if (command[at] === '\\' && quote !== "'") at++
      else if (command[at] === quote) return at
    }
    return command.length
  }
  // A heredoc's body lines from `from`, and the index of the newline that ends its delimiter line.
  const body = (from: number, delimiter: string, isTabbed: boolean) => {
    const lines: string[] = []
    for (let at = from; at < command.length; ) {
      const stop = command.indexOf('\n', at) < 0 ? command.length : command.indexOf('\n', at)
      const line = command.slice(at, stop)
      if ((isTabbed ? line.replace(/^\t+/, '') : line) === delimiter) return { lines, next: stop }
      lines.push(line)
      at = stop + 1
    }
    return { lines, next: command.length }
  }
  // The index of the ) of $( or the } of ${, past quotes and heredocs.
  const closing = (from: number, open: string, close: string): number => {
    let depth = 0
    for (let at = from; at < command.length; at++) {
      const char = command[at]
      const heredoc = char === '<' ? HEREDOC.exec(command.slice(at)) : null
      if (char === '\\') at++
      else if (char === "'" || char === '"' || char === '`') at = end(at + 1, char)
      else if (heredoc && command.indexOf('\n', at) >= 0) at = body(command.indexOf('\n', at) + 1, heredoc[3], heredoc[1] === '-').next
      else if (char === open) depth++
      else if (char === close && --depth === 0) return at
    }
    return command.length
  }
  // $'…', decoded; returns the index of its closing quote.
  const ansiC = (from: number): number => {
    let text = ''
    let isShellSpecific = false
    let at = from
    for (; at < command.length && command[at] !== "'"; at++) {
      if (command[at] !== '\\') {
        text += command[at]
        continue
      }
      const code = command[++at] ?? ''
      const hex = code === 'x' ? /^[0-9A-Fa-f]{1,2}/.exec(command.slice(at + 1)) : null
      const octal = /^[0-7]{1,3}/.exec(command.slice(at))
      if (Object.hasOwn(ANSI_C, code)) text += ANSI_C[code]
      else if (hex) {
        text += String.fromCharCode(parseInt(hex[0], 16))
        at += hex[0].length
      } else if (octal) {
        text += String.fromCharCode(parseInt(octal[0], 8))
        at += octal[0].length - 1
      } else {
        isShellSpecific ||= code !== '' && 'uUc'.includes(code)
        text += `\\${code}`
      }
    }
    add(text, true).isRunTime ||= isShellSpecific
    return at
  }
  // $… or `…`: a word built at run time, kept as written; returns the index of its last character.
  const dollar = (at: number, isQuoted: boolean): number => {
    const next = command[at + 1] ?? ''
    if (command[at] === '`') {
      const stop = end(at + 1, '`')
      runTime(command.slice(at, stop + 1), isQuoted ? undefined : command.slice(at + 1, stop))
      return stop
    }
    if (next === "'" && !isQuoted) return ansiC(at + 2)
    // $"…" is translated at run time; the "…" itself is read next.
    if (next === '"' && !isQuoted) {
      runTime('')
      return at
    }
    if (next === '(' || next === '{') {
      const stop = closing(at + 1, next, next === '(' ? ')' : '}')
      // shortcut: the code of "$(…)" in double quotes, like a commit message from a heredoc, is not read.
      const isCode = next === '(' && command[at + 2] !== '(' && !isQuoted
      runTime(command.slice(at, stop + 1), isCode ? command.slice(at + 2, stop) : undefined)
      return stop
    }
    const name = /^(?:[A-Za-z_]\w*|[0-9@*#?$!-])/.exec(command.slice(at + 1))
    if (name === null) {
      add('$', isQuoted)
      return at
    }
    runTime(`$${name[0]}`)
    return at + name[0].length
  }
  // "…", unescaped; returns the index of its closing quote.
  const doubleQuoted = (from: number): number => {
    add('', true)
    for (let at = from; at < command.length; at++) {
      const char = command[at]
      const next = command[at + 1]
      if (char === '"') return at
      if (char === '\\' && next !== undefined && '"\\$`\n'.includes(next)) {
        at++
        if (next !== '\n') add(next, true)
      } else if (char === '$' || char === '`') at = dollar(at, true)
      else add(char, true)
    }
    return command.length
  }

  for (let at = 0; at < command.length; at++) {
    const char = command[at]
    const next = command[at + 1]
    if (char === '\\') {
      at++
      if (next !== '\n') add(next ?? '\\', true)
    } else if (char === "'") {
      const stop = end(at + 1, "'")
      add(command.slice(at + 1, stop), true)
      at = stop
    } else if (char === '"') at = doubleQuoted(at + 1)
    else if (char === '$' || char === '`') at = dollar(at, false)
    else if (char === '#' && word === null) {
      // A comment runs to the end of its line.
      const stop = command.indexOf('\n', at)
      at = (stop < 0 ? command.length : stop) - 1
    } else if (char === ' ' || char === '\t') endWord()
    else if (';|&\n'.includes(char)) {
      endPiece()
      if ((char === '|' || char === '&') && next === char) at++
      // After the line that starts them, heredocs' bodies, in order.
      for (const { delimiter, isTabbed } of char === '\n' ? heredocs.splice(0) : []) {
        const { lines, next: stop } = body(at + 1, delimiter, isTabbed)
        for (const line of lines) pieces.push(...shellPieces(line).map(piece => ({ ...piece, isBody: true })))
        at = stop
      }
    } else if ('()<>'.includes(char)) {
      endWord()
      const heredoc = char === '<' ? HEREDOC.exec(command.slice(at)) : null
      const operator = command.startsWith('<<<', at) ? '<<<' : heredoc ? `<<${heredoc[1]}` : command.startsWith('>>', at) ? '>>' : char
      if (heredoc && operator !== '<<<') heredocs.push({ delimiter: heredoc[3], isTabbed: heredoc[1] === '-' })
      words.push({ text: operator, isRunTime: false })
      at += operator.length - 1
    } else add(char)
  }
  endPiece()
  return pieces
}

/** Splits a shell command at ;, |, ||, &, && and newlines that stand outside single and double quotes. */
function commandPieces(command: string): string[] {
  const pieces: string[] = []
  let piece = ''
  let quote: string | null = null
  for (let at = 0; at < command.length; at++) {
    const char = command[at]
    if (quote === null && ';|&\n'.includes(char)) {
      pieces.push(piece)
      piece = ''
      if ((char === '|' || char === '&') && command[at + 1] === char) at++
      continue
    }
    if (char === '\\' && quote !== "'") {
      piece += char + (command[++at] ?? '')
      continue
    }
    if (quote === null && (char === '"' || char === "'")) quote = char
    else if (char === quote) quote = null
    piece += char
  }
  return [...pieces, piece]
}

// The pieces of a command that run gh: pieces at the top level, and pieces of the quoted command string of
// bash -c, sh -c or zsh -c. Text inside other quotes, like a commit message, is never a piece of its own.
// shortcut: reads the command as text; the word checks below see quoted and escaped spellings, and a heredoc line
// that starts with gh pr merge counts as a merge (refused, never allowed by mistake).
const WRAPPED = /^\s*(?:ba|z)?sh\s+-c\s+(["'])([\s\S]*)\1\s*$/
const ghPieces = (command: string): string[] =>
  commandPieces(command).flatMap(piece => {
    const wrapped = WRAPPED.exec(piece)
    return wrapped ? ghPieces(wrapped[2]) : [piece]
  })
const PR_MERGE = /^\s*gh\s+pr\s+merge\b/
// gh api, curl and wget routes that merge or schedule a merge: REST pull and branch merges, GraphQL merge, auto-merge and merge queue.
const MERGE_ROUTE =
  /pulls\/[^/\s]+\/merge\b|repos\/[^/\s]+\/[^/\s]+\/merges\b|mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch/

// A merge run through a wrapper instead of on its own: (…), { …; }, !, env, command, sudo, exec, time, xargs, VAR=x,
// a path to gh, or eval and sh -c after any of those. Fails closed: gh pr merge outside quotes anywhere in the piece
// counts, and so does the quoted text that eval or sh -c runs. Text inside other quotes, like a commit message, does not.
const QUOTED = /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g
const RUNS_QUOTED = /(?:^|[^\w-])(?:(?:ba|z)?sh\s+-\w*c|eval)\b/
const GH_MERGE = /(?:^|[^\w-])gh\s+pr\s+merge\b/
const GH_API = /(?:^|[^\w-])gh\s+api\b/
// The text of a piece that runs: what stands outside quotes, or all of it when eval or sh -c runs its quoted text.
const runText = (piece: string) => {
  const outside = piece.replace(QUOTED, '""')
  return RUNS_QUOTED.test(outside) ? piece : outside
}
const wrappedMerge = (piece: string) => GH_MERGE.test(runText(piece))
// gh api run in any piece, bare or wrapped; text that only mentions it, like echo "gh api", does not run it.
const runsGhApi = (command: string) => ghPieces(command).some(piece => GH_API.test(runText(piece)))

// curl or wget where a command starts: at the start of a piece, after $( or `, after if, then, else, elif, do, while,
// until or the wrappers above, all outside quotes; the quoted text that eval or sh -c runs is read the same way. Text
// that only mentions them, like echo curl or grep wget, does not run them.
// shortcut: reads the command as text; curl or wget reached through a variable, an alias, a script, an interpreter, "$(…)"
// in double quotes or another wrapper is not detected, and a heredoc line that starts with curl or wget counts as running it.
const HTTP_CLIENT =
  /(?:^|\$\(|`)(?:\s|[({!]|\w+=\S*\s|(?:env|command|sudo|exec|eval|time|xargs|if|then|else|elif|do|while|until)(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s)*(?:\S*\/)?\\?(?:curl|wget)(?![\w.-])/
const runsHttpClient = (command: string): boolean =>
  commandPieces(command.replace(/\\\r?\n/g, ' ')).some(piece => {
    const outside = piece.replace(QUOTED, '""')
    if (HTTP_CLIENT.test(outside)) return true
    return RUNS_QUOTED.test(outside) && [...piece.matchAll(QUOTED)].some(([quoted]) => runsHttpClient(quoted.slice(1, -1)))
  })

/** Whether a shell command runs `gh pr merge`, as the Ship it guard reads it; text that only mentions it does not. */
export const runsPrMerge = (command: string) =>
  ghPieces(command).some(piece => PR_MERGE.test(piece)) || wordFindings(command, command).some(found => 'merge' in found)

// MCP actions that merge a pull request, turn on auto-merge or add it to a merge queue, lowercased without _ and -.
// shortcut: an exact closed list, so a merge tool by another name passes; add names seen in a supported server.
const MCP_MERGE_ACTIONS = new Set(['mergepullrequest', 'enableautomerge', 'enablepullrequestautomerge', 'enqueuepullrequest'])

/** Whether a tool is an MCP action that merges a pull request or schedules its merge; the server's name is never read. */
export function isMcpMergeAction(tool: string): boolean {
  const at = tool.lastIndexOf('__')
  // The action follows the last __; a name with no __ after mcp__ has no action, only a server.
  return tool.startsWith('mcp__') && at > 3 && MCP_MERGE_ACTIONS.has(tool.slice(at + 2).toLowerCase().replace(/[_-]/g, ''))
}

const APPROVED_ONLY =
  'Ship it merges only the head commit the person approved. End your turn by showing the pull request link, the ' +
  'checks and the full head SHA, then "Reply exactly: Approve merge <full SHA>", and wait for exactly that reply. ' +
  'Then run gh pr merge --squash --delete-branch --match-head-commit <that full SHA>.'

// The Ship it guard's refusals, shared by the text checks and the word checks.
const NEVER_ADMIN = 'Ship it never merges with --admin or --auto. Leave the pull request open and tell the person why it cannot merge.'
const DIRECT_ONLY =
  'Ship it merges only with gh pr merge run directly, never through (…), !, env, command, sudo, exec, eval, ' +
  'a path or another wrapper. Run gh pr merge --squash --delete-branch --match-head-commit <approved SHA> on its own.'
const ON_ITS_OWN = 'Run the approved gh pr merge on its own, with nothing before or after it, so its exit code shows whether it merged.'
const NO_HTTP = 'Ship it merges only with gh pr merge --match-head-commit, never through curl or wget. Leave the pull request open.'
const NO_API = 'Ship it merges only with gh pr merge --match-head-commit, never through gh api. Leave the pull request open.'
const RUN_TIME =
  'While Ship it runs, a command and the first words of gh are never built at run time ($…, `…`, a glob, {a,b}, ~ or =). ' +
  'Spell them out.'
const GH_ALIAS = 'While Ship it runs, gh runs only its own commands, never an alias or extension, which could hide a merge. Spell the gh command out.'
const MERGE_WORDS =
  'Ship it merges only with gh pr merge, its own flags and at most one pull request. ' +
  'Run gh pr merge --squash --delete-branch --match-head-commit <approved SHA> on its own.'

// gh's own top-level commands, their built-in aliases and its help topics (gh 2.100, `gh help`). Any other first word
// is an alias or extension, which could run a merge the guard cannot read; so is gh extension exec.
// shortcut: a fixed list; a gh command added later is refused during Ship it until it is listed here.
const GH_COMMANDS = new Set(
  (
    'agent-task agent-tasks agent agents alias api attestation at auth browse cache codespace cs completion config copilot ' +
    'discussion extension extensions ext gist gpg-key help issue label licenses org pr preview project release repo ruleset ' +
    'rs run search secret skill skills ssh-key status variable version workflow ' +
    'accessibility actions environment exit-codes formatting mintty reference telemetry'
  ).split(' '),
)
const GH_EXTENSION = new Set(['extension', 'extensions', 'ext'])
// gh pr merge's own flags (gh 2.100), with the inherited --repo and --help, and whether each takes a value.
const MERGE_FLAGS = new Map(
  Object.entries({
    admin: false, auto: false, 'author-email': true, body: true, 'body-file': true, 'delete-branch': false, 'disable-auto': false,
    help: false, 'match-head-commit': true, merge: false, rebase: false, repo: true, squash: false, subject: true,
  }),
)
const MERGE_SHORT = new Map(Object.entries({ A: 'author-email', b: 'body', F: 'body-file', d: 'delete-branch', m: 'merge', r: 'rebase', R: 'repo', s: 'squash', t: 'subject' }))

// Words before a command: ( { ! and keywords (P), VAR=x (A), wrappers that run the words after them (W), their
// options (O) and anything else (X). A command stands first, after P and A, or anywhere after a wrapper.
const PREFIXES = new Set(['(', '{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])
const WRAPPERS = new Set(['env', 'command', 'builtin', 'sudo', 'doas', 'exec', 'time', 'xargs', 'nohup', 'nice', 'timeout', 'watch'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const AT_COMMAND = /^(?:[PA]|W[WOX]*)*$/
const baseName = (text: string) => text.slice(text.lastIndexOf('/') + 1)
const wordClass = ({ text, isRunTime }: ShellWord) =>
  /^[A-Za-z_]\w*=/.test(text) ? 'A' : isRunTime ? 'X' : PREFIXES.has(text) ? 'P' : WRAPPERS.has(baseName(text)) ? 'W' : text.startsWith('-') ? 'O' : 'X'

// The first two words gh reads as its command, past -R / --repo and other flags; null when one is built at run time.
function ghCommand(args: ShellWord[]): string[] | null {
  const found: string[] = []
  let isPastFlags = false
  for (let at = 0; at < args.length && found.length < 2; at++) {
    const { text, isRunTime } = args[at]
    if (isRunTime) return null
    if (isPastFlags || !text.startsWith('-') || text === '-') found.push(text)
    else if (text === '--') isPastFlags = true
    else if (text === '-R' || text === '--repo') at++
  }
  return found
}

type WordFinding = { refusal: string } | { merge: ShellWord[]; isAlone: boolean }

/**
 * What a command runs, read as the words Bash passes on: gh merges, gh api and curl or wget merge routes, gh aliases
 * and extensions, and command words built at run time, in the command itself and in the code bash -c or eval runs.
 * A gh merge is direct only as the first word of the command, or of a plain bash -c "…"; anywhere else it is wrapped.
 * Merge routes are looked for in the whole command as written, the way the text checks look for them.
 */
function wordFindings(code: string, command: string, isWrapped = false, isAlone = true, found: WordFinding[] = []): WordFinding[] {
  // Blank space around the command runs nothing; a \ and newline at its end is a continued line, kept.
  const pieces = shellPieces(code.replace(/^\s+|(?<!\\)\s+$/g, ''))
  const alone = isAlone && pieces.length === 1
  for (const { words, isBody } of pieces) {
    const classes = words.map(wordClass).join('')
    // A heredoc's line may start with anything; only the commands it names count.
    if (words[classes.search(/[^PA]/)]?.isRunTime && !isBody) found.push({ refusal: RUN_TIME })
    words.forEach((word, at) => {
      for (const code of word.runs ?? []) wordFindings(code, command, true, false, found)
      const name = baseName(word.text)
      const rest = words.slice(at + 1)
      const isCommand = AT_COMMAND.test(classes.slice(0, at))
      if (word.isRunTime) return
      if (name === 'gh') {
        const gh = ghCommand(rest)
        if (gh === null) {
          if (isCommand) found.push({ refusal: RUN_TIME })
        } else if (gh[0] === 'pr' && gh[1] === 'merge') {
          // Fails closed: gh pr merge anywhere else in a piece, even after echo, is read as a wrapped merge.
          found.push(!isWrapped && !isBody && at === 0 && word.text === 'gh' ? { merge: rest, isAlone: alone } : { refusal: DIRECT_ONLY })
        } else if (gh[0] === 'api' && MERGE_ROUTE.test(command)) found.push({ refusal: NO_API })
        else if (isCommand && gh.length > 0 && (!GH_COMMANDS.has(gh[0]) || (GH_EXTENSION.has(gh[0]) && gh[1] === 'exec'))) {
          found.push({ refusal: GH_ALIAS })
        }
      } else if (!isCommand) {
        return
      } else if (WRAPPERS.has(name)) {
        // The command a wrapper runs: its first word that is not an option or VAR=x.
        if (rest.find(one => !/[OA]/.test(wordClass(one)))?.isRunTime && !isBody) found.push({ refusal: RUN_TIME })
      } else if (SHELLS.has(name)) {
        const isPlain = !isWrapped && !isBody && at === 0 && word.text === name && words.length === 3 && rest[0].text === '-c'
        const flag = rest.findIndex(one => /^-\w*c/.test(one.text))
        if (isPlain) wordFindings(rest[1].text, command, false, alone, found)
        else if (flag >= 0) for (const one of rest.slice(flag + 1)) wordFindings(one.text, command, true, false, found)
      } else if (name === 'eval') {
        wordFindings(rest.map(one => one.text).join(' '), command, true, false, found)
      } else if ((name === 'curl' || name === 'wget') && MERGE_ROUTE.test(command)) {
        found.push({ refusal: NO_HTTP })
      }
    })
  }
  return found
}

/**
 * Why a direct gh pr merge may not run, read the way gh's flag parser reads its words, or null when it is the
 * approved merge: no word built at run time, no --admin or --auto in any word, only gh pr merge's own flags and at most
 * one pull request, every --match-head-commit (gh keeps the last) the approved head commit, and nothing else run.
 */
function mergeRefusal(args: ShellWord[], approvedSha: string | null, isAlone: boolean): string | null {
  if (args.some(word => word.isRunTime)) return RUN_TIME
  if (args.some(word => /^--(admin|auto)(=|$)/.test(word.text))) return NEVER_ADMIN
  const positionals: string[] = []
  const shas: string[] = []
  for (let at = 0; at < args.length; at++) {
    const text = args[at].text
    if (text === '--') {
      positionals.push(...args.slice(at + 1).map(word => word.text))
      break
    }
    if (!text.startsWith('-') || text === '-') {
      positionals.push(text)
      continue
    }
    let flag: string | undefined
    let value: string | undefined
    if (text.startsWith('--')) {
      const equals = text.indexOf('=')
      flag = text.slice(2, equals < 0 ? undefined : equals)
      value = equals < 0 ? undefined : text.slice(equals + 1)
      if (!MERGE_FLAGS.has(flag)) return MERGE_WORDS
    } else {
      // Short flags run together (-sd); one that takes a value takes the rest of the word (past a =) or the next word.
      for (let one = 1; one < text.length && flag === undefined; one++) {
        const name = MERGE_SHORT.get(text[one])
        const after = text.slice(one + 1)
        if (name === undefined) return MERGE_WORDS
        if (MERGE_FLAGS.get(name)) {
          flag = name
          value = after.length > 1 && after[0] === '=' ? after.slice(1) : after || undefined
        } else if (after[0] === '=') break
      }
    }
    if (flag !== undefined && MERGE_FLAGS.get(flag) && value === undefined) value = args[++at]?.text
    if (flag === 'match-head-commit') shas.push(value ?? '')
  }
  if (positionals[0] !== 'pr' || positionals[1] !== 'merge' || positionals.length > 3) return MERGE_WORDS
  if (approvedSha === null || shas.length === 0 || shas.some(sha => sha !== approvedSha)) return APPROVED_ONLY
  return isAlone ? null : ON_ITS_OWN
}

/**
 * Why a shell command may not run during Ship it, or null when it may. Every `gh pr merge` it runs, wrapped in
 * `bash -c` or not, names only the approved head commit with --match-head-commit and never --admin or --auto, and is
 * the whole command, so a failed merge is never read as a success; merging through `gh api`, curl or wget is never allowed.
 * The command is read twice: as text, and as the words Bash rebuilds from it (see shellPieces), so a quoted or escaped
 * word, a continued line, -R before pr merge, a gh alias or extension, or gh words built at run time hide no merge.
 */
export function unsafeMerge(command: string, approvedSha: string | null): string | null {
  // The route may sit anywhere in the written command: a heredoc body, a continued line or a literal variable.
  if (MERGE_ROUTE.test(command) && runsHttpClient(command)) {
    return NO_HTTP
  }
  // Likewise for gh api, so a body it reads from stdin, like gh api graphql --input - <<EOF, is seen.
  // shortcut: reads the command as text; a body in a file (--input body.json) or made at run time is not seen, and any
  // gh api run beside a merge route in the text, like a heredoc that only writes one, is refused (never allowed by mistake).
  if (MERGE_ROUTE.test(command) && runsGhApi(command)) {
    return NO_API
  }
  for (const part of ghPieces(command)) {
    if (!PR_MERGE.test(part)) {
      if (wrappedMerge(part)) return DIRECT_ONLY
      continue
    }
    if (/(?<![\w-])--(admin|auto)\b/.test(part)) return NEVER_ADMIN
    const shas = [...part.matchAll(/(?<![\w-])--match-head-commit[=\s]+["']?([0-9a-f]{40})\b/g)].map(found => found[1])
    if (approvedSha === null || shas.length === 0 || shas.some(sha => sha !== approvedSha)) return APPROVED_ONLY
    // The tool's exit code is the merge's own only when nothing else runs: `; true`, `|| true` or `| cat` hide a failure.
    if (ghPieces(command.trim()).length > 1) return ON_ITS_OWN
  }
  // The same command read as the words Bash passes on.
  for (const found of wordFindings(command, command)) {
    const refusal = 'refusal' in found ? found.refusal : mergeRefusal(found.merge, approvedSha, found.isAlone)
    if (refusal !== null) return refusal
  }
  return null
}

// PowerShell's only merge: the whole command, one line, words apart by spaces, and a PR argument with no PowerShell
// metacharacter (# starts a comment); none of --admin, --auto, chaining, a wrapper or a backtick fits it.
const PS_SANCTIONED = /^gh[ \t]+pr[ \t]+merge(?:[ \t]+[\w./:][\w./:-]*)?[ \t]+--squash[ \t]+--delete-branch[ \t]+--match-head-commit[ \t]+([0-9a-f]{40})$/
// Fail-closed PowerShell rule, no parser: read with backticks gone and case ignored, merge text (or a merge route) beside
// gh, the GitHub API or GraphQL, or an HTTP cmdlet or client is refused.
// Accepted false positive: during Ship it, merge in harmless argument text, like gh pr create --title "…merge…", is
// refused too, with no gh pr create exception. Bash keeps its own reading.
// shortcut: reads the command as text; a command built at run time (string joins, variables, -EncodedCommand, a script
// file) is not seen, and branch protection stays the backstop.
const PS_MERGE = new RegExp(`merge|${MERGE_ROUTE.source}`, 'i')
const PS_RUNNER = /(?<![\w-])(?:gh|invoke-restmethod|irm|invoke-webrequest|iwr|curl|wget)(?:\.exe)?(?![\w-])|api\.github\.com|graphql/i

/** Whether a PowerShell command is the sanctioned Ship it merge, as the guard reads it. */
export const runsPowerShellMerge = (command: string) => PS_SANCTIONED.test(command.trim())

/**
 * Why a PowerShell command may not run during Ship it, or null when it may: the only merge is the sanctioned
 * gh pr merge at the approved head commit, and any other command with a merge route is refused.
 */
export function unsafePowerShellMerge(command: string, approvedSha: string | null): string | null {
  const sanctioned = PS_SANCTIONED.exec(command.trim())
  if (sanctioned) return approvedSha !== null && sanctioned[1] === approvedSha ? null : APPROVED_ONLY
  const text = command.replace(/`/g, '')
  if (PS_MERGE.test(text) && PS_RUNNER.test(text)) {
    return (
      'In Ship it, PowerShell may merge only with gh pr merge --squash --delete-branch --match-head-commit <approved SHA> ' +
      'as the whole command; anything else that names a merge beside gh, the GitHub API or an HTTP client is refused, ' +
      'even in a title. Leave the pull request open.'
    )
  }
  return null
}

export const MAX_QUESTION = 160

/** The question Claude ended on, as one plain line: its last sentence, or the whole last paragraph when that sentence is a few words. */
export function questionOf(answer: string): string | null {
  if (!asksQuestion(answer)) return null
  const paragraph = (answer.trim().split(/\n\s*\n/).pop() ?? '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  const last = paragraph.split(/(?<=[.!?;？؟])\s+/).pop() ?? ''
  const line = maskPrivate(last.length >= 12 ? last : paragraph)

  return line === '' ? null : line.length > MAX_QUESTION ? `${line.slice(0, MAX_QUESTION - 1)}…` : line
}

/** True when the text has no letters outside the Latin alphabet, so it can stand as an English title. */
export function isLatinText(text: string): boolean {
  return !/(?!\p{Script=Latin})\p{L}/u.test(text)
}

/** What a tool call works on, for the Plan in Details: the command, a file's name or a site. */
export function activityTarget(input: { command?: unknown; file_path?: unknown; notebook_path?: unknown; url?: unknown }): string | null {
  if (typeof input.command === 'string' && input.command.trim()) {
    return maskPrivate(input.command.trim().split('\n')[0]!).slice(0, 160)
  }
  const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
  if (file) return file.split(/[\\/]/).pop() ?? null
  if (typeof input.url === 'string') {
    const host = /^[a-z]+:\/\/([^/]+)/i.exec(input.url)
    return host ? host[1]! : null
  }
  return null
}

export const widthOf = (text: string) => Array.from(text).reduce((sum, char) => sum + cellsOf(char), 0)

export const childrenOf = (children: unknown) =>
  (Array.isArray(children) ? children : [children]).filter(kid => kid !== null && kid !== undefined && kid !== false)

/** A drawing of nothing but buttons: a Button, or Boxes that hold only buttons. */
export function isButtonsOnly(tree: unknown): boolean {
  if (tree === null || typeof tree !== 'object') return false
  const { type, children } = tree as { type?: unknown; children?: unknown }
  if (type === 'Button') return true
  if (type !== 'Box') return false
  const kids = childrenOf(children)
  return kids.length > 0 && kids.every(isButtonsOnly)
}

/** The buttons in a drawing of nothing but buttons, in order, to line up in a row of their own. */
export const buttonsIn = (tree: unknown): unknown[] =>
  (tree as { type?: unknown }).type === 'Button' ? [tree] : childrenOf((tree as { children?: unknown }).children).flatMap(buttonsIn)

/**
 * What other mods draw beneath, split: their lone buttons (Replay, say), which join GlanceFlow's actions, and the
 * rest, which stays under the band. A drawing of nothing but buttons comes up whole; inside a stack (a column) only a
 * button standing on its own does, so a mod's own group of buttons (the next-steps suggestions) stays with its words.
 */
export function liftButtons(tree: unknown, isWhole = true): { buttons: unknown[]; rest: unknown } {
  if (tree === null || typeof tree !== 'object') return { buttons: [], rest: tree }
  const { type, props, children } = tree as { type?: unknown; props?: { flexDirection?: unknown }; children?: unknown }
  if (type === 'Button' || (isWhole && isButtonsOnly(tree))) return { buttons: buttonsIn(tree), rest: null }
  if (type !== 'Box' || props?.flexDirection !== 'column') return { buttons: [], rest: tree }
  const parts = childrenOf(children).map(kid => liftButtons(kid, false))
  const buttons = parts.flatMap(part => part.buttons)
  if (buttons.length === 0) return { buttons: [], rest: tree }
  const kept = parts.map(part => part.rest).filter(one => one !== null && one !== undefined)
  return { buttons, rest: kept.length === 0 ? null : { ...(tree as object), children: kept } }
}

/** The person's own words: notes an app adds around a prompt (<system-reminder>…) are not the request. */
export function ownWords(text: string): string {
  return text.replace(/<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').trim()
}

export function formatLeft(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))

  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Keeps exactly one active step while any step is unfinished. */
export function settle(tasks: GlanceTask[]): GlanceTask[] {
  const lastActive = tasks.map(one => one.status).lastIndexOf('active')
  const fixed = tasks.map((one, index) =>
    one.status === 'active' && index !== lastActive ? { ...one, status: 'upcoming' as const } : one,
  )
  if (lastActive !== -1) {
    return fixed
  }
  const next = fixed.findIndex(one => one.status === 'upcoming')

  return fixed.map((one, index) => (index === next ? { ...one, status: 'active' as const } : one))
}

/** Applies a progress report: earlier steps check off, 100 moves to the next. */
export function applyProgress(tasks: GlanceTask[], rawName: string, rawPercent: number): GlanceTask[] {
  const name = cleanName(rawName)
  const percent = Math.min(100, Math.max(0, Math.round(Number(rawPercent) || 0)))
  let list = [...tasks]
  let index = list.findIndex(one => one.name.toLowerCase() === name.toLowerCase())
  if (index === -1) {
    const active = list.findIndex(one => one.status === 'active')
    index = active === -1 ? list.length : active
    list.splice(index, 0, task(name, 'upcoming', `${name}#${list.length}`))
  }
  list = list.map((one, at) => {
    if (at < index) {
      return { ...one, status: 'done', percent: 100, hasReported: true }
    }
    if (at === index) {
      return { ...one, status: percent >= 100 ? 'done' : 'active', percent, hasReported: true }
    }
    return one.status === 'active' ? { ...one, status: 'upcoming' } : one
  })

  return settle(list)
}

export function todosToTasks(
  todos: ReadonlyArray<{ content: string; status: string }>,
  previous: GlanceTask[],
): GlanceTask[] {
  return carryTokens(previous, settle(
    todos.map((todo, index) => {
      const name = cleanName(todo.content)
      const before = previous.find(one => one.name === name)
      const status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'upcoming'
      const kept = before && before.status === status ? before : task(name, status, `todo#${index}`)

      return { ...kept, name, status }
    }),
  ))
}

/** What the notice says under its title: why Claude waits or is stuck, or the job's name. */
export const noticeBody = (list: GlanceChecklist) =>
  (list.phase === 'needsYou' ? needsText(list) : list.phase === 'stuck' ? list.stuckReason : null) ?? list.title

/** A job that ended: All done, or finished with a question for the person (Needs you, with a finish time). */
export const isFinished = (list: GlanceChecklist) => list.phase === 'done' || (list.phase === 'needsYou' && list.finishedAt !== null)

/** Why the person is needed: what Claude asked, when it ended on a question, else the general reason. */
export const needsText = (list: GlanceChecklist) =>
  (list.question && (list.needsYouReason === WAITING || list.needsYouReason === QUESTION) ? list.question : list.needsYouReason) ?? null

export const reportOf = (view: GlanceHistoryView) =>
  view.reportSpan === 'mine'
    ? weekSummary(view.myWeekEntries, view.day)
    : view.reportSpan === 'week'
      ? teamReport({ ...view, entries: view.weekEntries }, 'week')
      : teamReport(view)

/** The value that `/glanceflow <setting> on` or `off` asks for. With neither word, the opposite of the current value. */
export const toggled = (choice: string, current: boolean) => (choice === 'on' ? true : choice === 'off' ? false : !current)

/** A chat's checklist as kept for when the chat is resumed, and for the other chats to see; `isOpen` until it ends. */
export type SavedChecklist = { at: number; list: GlanceChecklist; isOpen?: boolean }

// Each chat's checklist sits under a key of its own: two chats saving at once never drop each other's.
export const RESUME_PREFIX = 'resume:'

/** The keys of saved checklists, `[key, at]`, beyond the `keep` most recent. */
export function staleResumeKeys(saved: readonly (readonly [string, number])[], keep: number): string[] {
  return [...saved].sort((a, b) => b[1] - a[1]).slice(keep).map(([key]) => key)
}

// A chat at work saves its checklist with every step and tool it runs; one silent this long has most likely closed.
export const OTHER_WORKING_MS = 10 * 60_000
// shortcut: a chat that closed without ending (a crash, a closed terminal tab) shows as waiting this long; a live
// heartbeat would know sooner. By then its own sound or notice has long told the person.
export const OTHER_WAITING_MS = 2 * 60 * 60_000

/** The other chats worth a word: those that need the person, then those still at work, most recent first. */
export function otherChats(saved: readonly (SavedChecklist | undefined)[], at: number): GlanceOtherChat[] {
  const isNeeding = (one: SavedChecklist) => one.list.phase === 'needsYou' || one.list.phase === 'stuck'
  return saved
    .filter((one): one is SavedChecklist => {
      // Only a chat that said it is open: one that ended, or saved before 0.25, is never named.
      if (!one?.list || one.isOpen !== true || typeof one.at !== 'number') return false
      const isWorking = one.list.phase === 'working' || one.list.phase === 'background'
      return isNeeding(one) ? at - one.at <= OTHER_WAITING_MS : isWorking && at - one.at <= OTHER_WORKING_MS
    })
    .sort((a, b) => Number(isNeeding(b)) - Number(isNeeding(a)) || b.at - a.at)
    .map(one => ({ title: one.list.title, needsYou: isNeeding(one) }))
}

/** What the band says of the other chats, in whole pieces: who needs the person first, then how many are at work. */
export function otherChatsWords(others: readonly GlanceOtherChat[]): string[] {
  const waiting = others.filter(one => one.needsYou)
  const working = others.length - waiting.length
  if (waiting.length === 0) return working === 0 ? [] : [`${working === 1 ? '1 other chat' : `${working} other chats`} at work`]
  const first =
    waiting.length === 1
      ? `Another chat needs you: ${waiting[0]?.title ?? ''}`
      : `${waiting.length} other chats need you: ${waiting.map(one => one.title).join(', ')}`
  return [first, ...(working === 0 ? [] : [`${working} more at work`])]
}
