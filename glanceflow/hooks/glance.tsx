import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren, RenderElement, RenderInput, RenderSurface, Timer } from 'claude-code'

import type {
  GlanceFile,
  GlanceChecklist,
  GlanceHelper,
  GlanceHistoryEntry,
  GlanceHistoryView,
  GlancePhase,
  GlanceTask,
  GlanceUpdate,
  GlanceUsage,
} from '../types'
import {
  HISTORY_PREFIX,
  WEEK_DAYS,
  clockTime,
  dayEntries,
  dayFromArgument,
  dayKey,
  entryFiles,
  entryFromChecklist,
  expiredHistoryKeys,
  filesNote,
  historyDay,
  historyKey,
  longDay,
  mergedEntries,
  projectName,
  shiftDay,
  weekSummary,
  paceFromHistory,
  plainDuration,
  sharedDayKeys,
  upsertEntry,
} from './history'
import { findSecrets, maskPrivate } from './privacy'
import { currentLang, setLang, tr } from './words'
import type { Lang } from './words'
import {
  MAX_DETAIL,
  CHECK_WORDS,
  MAX_NAME,
  NATIVE_PLAN,
  NATIVE_WRAP_UP,
  isNativeCall,
  nativeAsk,
  nativePlan,
  PLUGIN,
  QUESTION,
  RESUME_PREFIX,
  WAITING,
  activityOf,
  activityTarget,
  apiErrorSentence,
  applyCheck,
  applyProgress,
  askedMergeSha,
  asksQuestion,
  carryTokens,
  checkResult,
  cleanName,
  currentStepId,
  durationWords,
  formatCost,
  formatDuration,
  formatLeft,
  formatTokens,
  hasUnfinishedWork,
  headerDetails,
  isBusy,
  isContinueWords,
  isFinished,
  isLatinText,
  isMcpMergeAction,
  isNewerVersion,
  isStartWords,
  jobCheck,
  jobCost,
  leftLabel,
  liftButtons,
  localTimes,
  needsCheck,
  needsText,
  noticeBody,
  otherChats,
  otherChatsWords,
  overallProgress,
  ownWords,
  permissionWords,
  prettyModel,
  projectPath,
  questionOf,
  reconcileBackground,
  reportOf,
  resetTime,
  runsCheck,
  sentenceCase,
  sizeOf,
  stampTimes,
  staleResumeKeys,
  stepEstimate,
  timeLeft,
  todosToTasks,
  tokenNote,
  tourNeeds,
  wholePieces,
  widthOf,
  fit,
  settle,
  task,
  toggled,
  runsPowerShellMerge,
  runsPrMerge,
  unsafeMerge,
  unsafePowerShellMerge,
} from './logic'

import type { SavedChecklist } from './logic'
import { kitOf } from './kit'
import { GLYPH } from './look'
import type { IconName } from './look'

export { activityOf, asksQuestion, carryTokens, cleanName, fit, formatCost, formatTokens, headerDetails, isButtonsOnly, isContinueWords, isLatinText, isStartWords, liftButtons, localTimes, ownWords, prettyModel, questionOf, resetTime, sentenceCase, tokenNote, wholePieces } from './logic'
const PLAN_TOOL = `mcp__${PLUGIN}__plan_steps`
const PROGRESS_TOOL = `mcp__${PLUGIN}__report_progress`
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  // Claude Code's own plan approval, in plan mode.
  'ExitPlanMode',
  // Claude Desktop's own task list is a plan too, and its end-of-turn box closes one.
  NATIVE_PLAN,
  NATIVE_WRAP_UP,
  PLAN_TOOL,
  PROGRESS_TOOL,
])
const STORE_KEY = 'glanceEnabled'
const DETAIL_KEY = 'glanceDetail'
const SOUND_KEY = 'glanceSound'
const CALM_KEY = 'glanceCalm'
const LANGUAGE_KEY = 'glanceLanguage'
const GUARD_KEY = 'glanceGuard'
const APPROVE_KEY = 'glanceApprove'
const SHIP_KEY = 'glanceShip'
const NOTICE_KEY = 'glanceNotice'
// Whether the band names the other chats that need the person; on unless turned off.
const OTHERS_KEY = 'glanceOthers'
const TOUR_KEY = 'glanceTour'
/**
 * The welcome, three short cards the first time: what the checklist is, what Needs you means, where the rest lives.
 * Elsewhere than the terminal the words keep the text colour and the yellow is the bell beside them.
 */
const tourCards = (isVector: boolean) => [
  tr('A checklist shows here when you ask Claude for something with a few steps: each step, how far along it is, and about how long is left.'),
  tourNeeds(isVector ? tr('beside a yellow bell') : tr('in yellow')),
  tr('Settings, below, holds every choice. History shows your past jobs and Your week. To see this welcome again, type /glanceflow tour.'),
]
const TOUR_CARDS = 3
const HANDOFF_KEY = 'lastHandoff'
// Below this width the mode button drops the name; below METER_MIN_COLUMNS the bars go, so step names keep their room.
const NARROW = 60
const METER_MIN_COLUMNS = 50
// Longer plans fold finished and later steps into one line each; the Plan panel has them all.
const COMPACT_AFTER = 5
const MAX_SUMMARY = 100
/** The most each of a job's For you and Decided on its own lists keeps. */
const MAX_NOTES = 8
const METER = 10
const LABEL_WIDTH = 7
const TICK_MS = 250
// Calm mode redraws only to keep times current.
const CALM_TICK_MS = 5000
// A job shorter than this finishes without a sound.
const LONG_JOB_MS = 60_000
const COLLAPSE_MS = 5000
const RESEND_WINDOW_MS = 2 * 60 * 1000
const LIMIT_WARN = 80
const LIMIT_ALERT = 95
// How full the chat gets before the band offers to tidy it up, unless the person picks another point.
const TIDY_AT_DEFAULT = 50
const TIDY_CHOICES = [0, 40, 50, 60, 75] as const
const TIDY_KEY = 'glanceTidyAt'
const CHECKPOINT_KEY = 'lastCheckpoint'
// The person's standing goal for a project (/glanceflow goal), under this prefix and the project's folder.
const GOAL_PREFIX = 'goal:'
const MAX_GOAL = 80
// Up to 0.24 every chat's checklist sat under this one key; now each has its own (RESUME_PREFIX).
const OLD_RESUME_KEY = 'glanceResume'
// The recent chats whose checklists are kept, so a resumed chat picks up where it was.
const RESUME_KEEP = 20
const LIMIT_LABEL: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly', spend_limit: 'spending' }

const DENIED = 'you said no to a step, so Claude paused'
const PLAN_MODE_WAIT = `Plan mode: write the plan and hand it over for approval first. Once the person approves it, call ${PLAN_TOOL} with that plan's own steps, then do the work.`
const FAILING = 'a step keeps failing, Claude is trying another way'
const STALLED = 'no news for 3 minutes. Press Esc to stop Claude, or give it a little longer'
// No sign of life from Claude (a piece of its reply, a tool starting or ending) for this long while it works.
const STALL_MS = 3 * 60_000
const PERMISSION = "Answer Claude's request in the chat"
// What a mark beside a state's own bold word says: the word follows, so a screen reader hears it once, not twice.
const STATUS = () => tr('Status')
// What a mark beside a notice says: a usage limit, a full chat, a tidy-up, a panel with nothing in it yet. The words
// beside it say which; a panel's own name is its title's, read just before.
const NOTICE = () => tr('Notice')
const APPROVE = 'Read the plan, then press Start or tell Claude what to change'

const enabledAtom = atom({ plugin: 'glanceflow', key: 'glanceEnabled' } as const, true)
const detailAtom = atom({ plugin: 'glanceflow', key: 'detailLevel' } as const, 'simple')
const checklistAtom = atom({ plugin: 'glanceflow', key: 'checklist' } as const, null)
const tickAtom = atom({ plugin: 'glanceflow', key: 'tick' } as const, 0)
const NO_USAGE: GlanceUsage = { limits: [], limitPercent: null, limitLabel: null, limitResetsAt: null, contextPercent: null, costUsd: null }
const usageAtom = atom({ plugin: 'glanceflow', key: 'usage' } as const, NO_USAGE)
const soundAtom = atom({ plugin: 'glanceflow', key: 'soundMode' } as const, 'off')
const calmAtom = atom({ plugin: 'glanceflow', key: 'isCalm' } as const, false)
/** The language GlanceFlow speaks; every view reads it, so a change shows at once. */
const languageAtom = atom({ plugin: 'glanceflow', key: 'language' } as const, 'en')
const guardAtom = atom({ plugin: 'glanceflow', key: 'isGuarded' } as const, true)
const approveAtom = atom({ plugin: 'glanceflow', key: 'approvePlan' } as const, false)
const shipOnGithubAtom = atom({ plugin: 'glanceflow', key: 'shipsOnGithub' } as const, false)
const hasGithubAtom = atom({ plugin: 'glanceflow', key: 'hasGithub' } as const, false)
const armedAtom = atom({ plugin: 'glanceflow', key: 'armedButton' } as const, null)
const noticeAtom = atom({ plugin: 'glanceflow', key: 'isNoticing' } as const, false)
const tourAtom = atom({ plugin: 'glanceflow', key: 'tourStep' } as const, null)
const tidyAtAtom = atom({ plugin: 'glanceflow', key: 'tidyAt' } as const, TIDY_AT_DEFAULT)
const checkpointAtom = atom({ plugin: 'glanceflow', key: 'checkpointAt' } as const, null)
const recapAtom = atom({ plugin: 'glanceflow', key: 'isRecapShown' } as const, false)
const othersAtom = atom({ plugin: 'glanceflow', key: 'otherChats' } as const, [])
const showsOthersAtom = atom({ plugin: 'glanceflow', key: 'showsOthers' } as const, true)
// shortcut: each read of the store parses its whole file, one per other chat; fine for 20 chats every 20 s, a single
// shared key would read once but brings back the race of two chats saving at once.
const OTHERS_EVERY_MS = 20_000
const historyAtom = atom({ plugin: 'glanceflow', key: 'historyView' } as const, null)
const HISTORY_PANE = 'glanceflow-history'
const PLAN_PANE = 'glanceflow-plan'
const RECAP_PANE = 'glanceflow-recap'
const SETTINGS_PANE = 'glanceflow-settings'
const CHECKLIST_PANE = 'glanceflow-checklist'
const handoffAtom = atom({ plugin: 'glanceflow', key: 'handoffState' } as const, 'idle')
const updateAtom = atom({ plugin: 'glanceflow', key: 'update' } as const, { state: 'idle', latest: null, id: null } as GlanceUpdate)
const HANDOFF_CONFIRM_MS = 8000
// What the Continue button sends, as the person's own words; turn.start knows it and keeps the job going.
const CONTINUE_TEXT = 'Please continue where you left off.'
// What the Start button sends when the person approves the plan.
const START_TEXT = 'The plan looks good. Please start.'
// What Aim higher sends while a plan waits: a deeper job, not a bigger one, from Felix Rieseberg's depth prompt.
// Not start words, so the job stays and the new plan waits for Start again.
const AIM_TEXT =
  'Aim higher: I want a deeper version of this job, not a bigger one. Before you change the plan, say briefly ' +
  '(1) what a top professional in this field would do here that I didn\'t ask for; (2) the rawest material they would ' +
  'start from instead of what has already been digested; (3) the methods and tools they would use; (4) what, other ' +
  'than you or me, would show the result is right. Then lay out the new plan with plan_steps, with done_when naming that check.'
const HANDOFF_PROMPT = `Write a handoff note so a brand-new chat can carry on this work without this conversation.
Cover, briefly: the goal; what is already done; what is left, in order; decisions made and why; the files, commands
or links that matter; and the very next step. Under 300 words, no preamble.
Start with exactly: "Continuing from an earlier chat. Here is where things stand:"`

// What Ship it sends, as the person's own words: the close-out a finished job needs on GitHub, so the chat archives.
const SHIP_PROMPT = `The work is finished. Ship it on GitHub, in order, and stop at the first step that fails:
1. Run \`git status\` and \`gh auth status\`. If this is not a GitHub repo or gh is not signed in, stop and tell me what to do.
   If the branch has no changes against its base branch, committed or not, and no open pull request, say there is
   nothing to ship and stop.
2. Quick cleanup of everything this branch changes against its base branch, committed or not. Use an installed review
   skill (ponytail-review or simplify) if there is one; otherwise look yourself for dead code, needless comments,
   pass-through wrappers and AI-sounding wording. Fix only clear wins, then run the project's tests if it has any.
3. Commit with a Conventional Commits title, type(scope): subject. If on the base branch, make a new branch first.
   Push the branch, never the base branch.
4. Open a ready pull request with gh pr create, or reuse the branch's open one. Body: ## Why, ## What changed,
   ## Verification, readable in under a minute.
5. Wait with gh pr checks --watch. If a check fails or the merge conflicts, do not merge: show what failed and stop.
6. Passing checks, or no checks, are not permission to merge. Read the head commit with gh pr view --json headRefOid,
   then end your turn by showing the pull request link, the checks and the full head SHA, then these two lines:
   Reply exactly: Approve merge <full SHA>
   Anything else leaves the pull request open.
7. Only after I reply exactly "Approve merge <that SHA>", read the head commit again. If it changed, ask again. If it
   matches, run gh pr merge --squash --delete-branch --match-head-commit <full SHA> as a command of its own, with
   nothing chained before or after it. Any other reply: leave the pull request open.
   Never merge with --admin or --auto, or bypass branch protection in any other way; if the merge is blocked, say why and stop.
8. End with the pull request link and one line on the result.`

const CHECKPOINT_PROMPT = `This chat is about to be compacted to free up room. Write a checkpoint so the work carries on
without losing anything that matters. Cover, briefly: the goal; what is already done; what is left, in order; decisions
made and why; what the person asked for or ruled out; the files, commands or links that matter; open questions; and the
very next step. Under 300 words, no preamble. Start with exactly: "Checkpoint:"`

const PROMPT_SECTION = `# GlanceFlow (progress checklist)
The person follows your work on a checklist above the prompt, in plain English.
- A question you can answer straight away, with no tools, needs no plan: just answer.
- Before you use any other tool, call plan_steps (tool ${PLAN_TOOL}) with 2 to 8 steps in order. If it is deferred, load it with ToolSearch first. If this session has TodoWrite or TaskCreate you may use that to-do list as the plan instead. If it has Claude's own task list (tool ${NATIVE_PLAN}), use that as the plan and do not call plan_steps; report_progress still takes its step names.
- In plan mode, skip plan_steps while you look around and write the plan. Once the person approves it, call plan_steps with that plan's own steps, then do the work.
- Give each step a size in plan_steps' sizes list, in the same order: S (a few minutes), M, or L (the biggest pieces of work).
- Then call report_progress (tool ${PROGRESS_TOOL}) as real progress happens, and with percent 100 the moment a step finishes. With percent 100, add a summary: one short plain-English sentence on what the step got done, like "Added a pricing table with three plans".
- Write every step name in plain English a non-technical person understands, under 40 characters, starting with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- When something only the person can do or decide comes up, put it in report_progress' for_you; when you choose something neither the plan nor the person settled, put it in decided. One short line each.
- Fill in plan_steps' done_when: what will be true when the job is done, and what other than you will show it. Make the last step that check. When the job changes code, run the project's tests, build or type check rather than saying it passed. The checklist shows whether changed code was tested.`

const GREEK_SECTION = `# GlanceFlow language
The person reads GlanceFlow in Greek. Write plan_steps' steps and done_when, report_progress' summary, for_you and
decided, and the one-line description of each tool call in plain everyday Greek, not English. Every rule above about
plain words applies to that Greek: short, a verb first in step names, no file names, commands or code.`

const SPINNER = ['◐', '◓', '◑', '◒']
// How many of the day's jobs ended each way, for the History's total line.
const OUTCOME_COUNT: Record<GlanceHistoryEntry['outcome'], (count: number) => string> = {
  done: count => tr('{0} done', count),
  stopped: count => tr('{0} stopped', count),
  stuck: count => tr('{0} stuck', count),
  waiting: count => tr('{0} waiting', count),
  background: count => tr('{0} background', count),
  working: count => tr('{0} working', count),
}
const HELPERS_PER_STEP = 3

// The tools that write files, and the field each names the file in.
const FILE_TOOLS: Record<string, 'file_path' | 'notebook_path'> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
// What a tool call's error says when the person said no at the permission dialog.
const REJECTED = /doesn't want to proceed|user (has )?(rejected|denied|declined)/i

type $ = EngineInterface
/** Where the checklist band draws: above the prompt, or in VS Code its pane. */
type BandEvent = RenderInput<'AbovePrompt' | 'Pane'>

// Module state: a reload starts these over (session.start restarts the ticker).
let ticker: Timer | undefined
let collapse: Timer | undefined
let saveTimer: Timer | undefined
// The save under way, so the chat's end waits for it rather than have it land after.
let saving: Promise<void> = Promise.resolve()
let othersTimer: Timer | undefined
// Set when the chat ends: anything still saved after that (a late job name, say) keeps it marked closed.
let hasEnded = false
let isRefreshing = false
let failuresInARow = 0
// A message held back for a password: memory only, never stored, and only to let the same one through on a resend.
let heldMessage: { text: string; at: number } | null = null
let limitLevel = 0
// The press that armed the button now waiting: a timer left from an earlier press must not disarm a later one.
let armedPress = 0
// Ship it in this chat: the head commit Claude last asked to merge, and the one the person then said yes to.
let isShipping = false
let askedSha: string | null = null
let approvedSha: string | null = null
// Ship it's own prompt is still to start its turn; a merge Ship it allowed failed, so the next try needs a fresh yes;
// the running turn answers a merge request with anything but the exact approval, so Ship it ends with it.
let isShipTurnNext = false
let hasFailedMerge = false
let isDeclining = false
// Plan mode: Claude writes a plan for the person to approve in Claude Code. Once they approve it, that plan is the
// checklist, with no second approval.
let isPlanMode = false
let isPlanApproved = false
// The question Claude Desktop's end-of-turn box asked the person this turn (wrap_up's `ask`): Claude's answer may not repeat it.
let wrapUpAsk: string | null = null

/** Ship it is over in this chat: its merge guard no longer applies. */
const endShipping = () => {
  isShipping = false
  askedSha = null
  approvedSha = null
  isShipTurnNext = false
  hasFailedMerge = false
  isDeclining = false
}

/** After a merge Ship it allowed: a merge that worked ends Ship it; a failed one keeps it guarded. */
const noteMerge = (ran: { deny?: string; isError?: boolean }) => {
  if (ran.deny === undefined && !ran.isError) endShipping()
  else hasFailedMerge = true
}
// The main loop's running turn, for the Pause button; and whether a pause asked for its end.
let runningTurn: string | undefined
let isPausing = false
// Mirrors the calm setting for the ticker, which runs outside any hook.
let isCalmMode = false
/** The computer this runs on, asked when the session starts; null until known, and Claude Code plays the sounds itself. */
let platform: 'mac' | 'windows' | 'linux' | null = null
let tickerEvery = 0
// Signs of life: set as Claude's reply streams or a tool starts or ends, stamped by the ticker, which runs while Claude works.
let hasSign = false
let lastSignAt = 0
let isStalled = false

const now = ($: $) => $.clock.now()

const syncTicker = ($: $, list: GlanceChecklist | null) => {
  const isAnimated = list !== null && (list.phase === 'working' || list.phase === 'needsYou' || list.phase === 'background')
  // Calm mode: nothing moves, so the clock only ticks to keep the times current.
  const every = isCalmMode ? CALM_TICK_MS : TICK_MS
  if (ticker !== undefined && (!isAnimated || tickerEvery !== every)) {
    ticker.cancel()
    ticker = undefined
  }
  if (isAnimated && ticker === undefined) {
    tickerEvery = every
    ticker = $.clock.every(every, () => {
      void update($, tickAtom, tick => (tick ?? 0) + 1)
      // A tick runs 4 times a second: a failure here must not repeat as an unhandled error.
      void checkStall($).catch(() => undefined)
    })
  }
}

/** Claude showed a sign of life; a job that looked stalled is working again. */
const noteSign = ($: $) => {
  hasSign = true
  if (isStalled) {
    isStalled = false
    void setWorking($)
  }
}

/** On each tick: a running turn with no sign of life for 3 minutes may be stuck. */
const checkStall = async ($: $) => {
  const at = await now($)
  if (hasSign || runningTurn === undefined) {
    hasSign = false
    lastSignAt = at
    return
  }
  if (isStalled || at - lastSignAt < STALL_MS || !(await read($, enabledAtom))) return
  if ((await read($, checklistAtom))?.phase !== 'working') return
  isStalled = true
  await setStuck($, STALLED)
}

const ALERTS: Partial<Record<GlancePhase, { asset: string; words: string }>> = {
  needsYou: { asset: 'sounds/needs-you.wav', words: 'Claude needs you' },
  stuck: { asset: 'sounds/stuck.wav', words: 'Claude is stuck' },
  done: { asset: 'sounds/done.wav', words: 'All done' },
}

const findPlatform = async ($: $) => {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows' as const
  const { stdout } = await $.process.run(['uname', '-s']).catch(() => ({ stdout: '' }))
  const name = stdout.trim()

  return name === 'Darwin' ? ('mac' as const) : name ? ('linux' as const) : null
}

/** Runs the first of these commands that this computer has; rejects when it has none. */
const runFirst = async ($: $, commands: readonly (readonly string[])[]) => {
  for (const argv of commands) {
    try {
      const { exitCode } = await $.process.run(argv)
      if (exitCode === 0) return
    } catch {
      // Not installed here: try the next one.
    }
  }
  throw new Error('No sound player on this computer')
}

/** Plays one of GlanceFlow's sounds: Claude Code's own player on a Mac, the computer's own player on Windows and Linux. */
const playSound = async ($: $, asset: string) => {
  if (platform === 'windows') {
    const file = `${$.plugin.root}\\${asset.replaceAll('/', '\\')}`.replaceAll("'", "''")
    return runFirst($, [['powershell', '-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`]])
  }
  if (platform !== 'linux') return $.audio.play({ asset })
  const file = `${$.plugin.root}/${asset}`
  return runFirst($, [['paplay', file], ['pw-play', file], ['aplay', '-q', file]])
}

/** Says a few words: the platform's own voice, or on Windows and Linux the speech tools they come with. */
const sayWords = async ($: $, words: string) => {
  try {
    await $.audio.speak(words)
  } catch (error) {
    if (platform !== 'windows' && platform !== 'linux') throw error
    const quoted = words.replaceAll("'", "''")
    await runFirst(
      $,
      platform === 'windows'
        ? [['powershell', '-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${quoted}')`]]
        : [['spd-say', '-w', words], ['espeak-ng', words], ['espeak', words]],
    )
  }
}

/** Windows' own toast, shown as Windows PowerShell's; the text comes in through the environment, never as script. */
const WINDOWS_TOAST = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$text = $xml.GetElementsByTagName('text')",
  '$text.Item(0).AppendChild($xml.CreateTextNode($env:GLANCEFLOW_TITLE)) | Out-Null',
  '$text.Item(1).AppendChild($xml.CreateTextNode($env:GLANCEFLOW_BODY)) | Out-Null',
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
].join('; ')

/**
 * A notice, first through Claude Code: the person's own Notification hooks read it (a phone, ntfy, Slack), then their
 * terminal shows it. Where that shows no text (the Desktop app, no channel, only a bell), the computer's own notifications
 * show it: Windows, macOS or Linux. The text goes in as arguments or variables, never as script.
 */
const showNotice = async ($: $, title: string, body: string) => {
  const sent = await $.ui.notify(body, { title }).catch(() => null)
  if (sent?.isSent && sent.channel !== 'terminal_bell') return
  if (platform === 'windows') {
    await $.process
      .run(['powershell', '-NoProfile', '-Command', WINDOWS_TOAST], { env: { GLANCEFLOW_TITLE: title, GLANCEFLOW_BODY: body } })
      .catch(() => undefined)
    return
  }
  const script = ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run']
  try {
    await $.process.run(['osascript', ...script, title, body])
  } catch {
    // No osascript: not a Mac. notify-send is Linux's; elsewhere the band still shows it.
    await $.process.run(['notify-send', '--app-name=Claude Code', title, body]).catch(() => undefined)
  }
}

/** A desktop notice when Claude needs you, gets stuck or finishes a long job, as for the sounds. */
const noticeFor = async ($: $, list: GlanceChecklist) => {
  const alert = ALERTS[list.phase]
  if (!alert || !(await read($, noticeAtom)) || !(await read($, enabledAtom))) return
  if (list.phase === 'done' && (isBusy(list) || (list.finishedAt ?? (await now($))) - list.startedAt < LONG_JOB_MS)) return
  await showNotice($, tr(alert.words), noticeBody(list))
}

/** A short sound (and, in voice mode, a few words) when Claude needs you, gets stuck or finishes a long job. */
const alertFor = async ($: $, list: GlanceChecklist) => {
  const alert = ALERTS[list.phase]
  const mode = await read($, soundAtom)
  if (!alert || mode === 'off' || !(await read($, enabledAtom))) return
  // A quick answer needs no sound, and a job whose helpers still run is not finished yet.
  if (list.phase === 'done' && (isBusy(list) || (list.finishedAt ?? (await now($))) - list.startedAt < LONG_JOB_MS)) return
  try {
    await playSound($, alert.asset)
    if (mode === 'voice') await sayWords($, tr(alert.words))
  } catch {
    // No player or voice on this computer: the band still shows it.
  }
}

/** Keeps this chat's checklist, a second after it changes, for when the chat is resumed. */
const saveSoon = ($: $) => {
  if (saveTimer !== undefined) return
  saveTimer = $.clock.after(1000, () => {
    saveTimer = undefined
    saving = saveChecklist($).catch(() => undefined)
  })
}

/** Saves this chat's checklist under its own key; `isOpen` false once the chat has ended, so the others stop naming it. */
const saveChecklist = async ($: $, isOpen = !hasEnded, id?: string) => {
  const key = `${RESUME_PREFIX}${id ?? (await $.session.id())}`
  const list = await read($, checklistAtom)
  if (list === null) await $.store.delete(key)
  else await $.store.set(key, { at: await now($), list, isOpen } satisfies SavedChecklist)
}

/** Reads what the other chats saved and keeps those worth a word; writes only on a change, so the band redraws then. */
const refreshOthers = async ($: $) => {
  // One read at a time: a slow one that finished after a newer one would bring back what has changed since.
  if (isRefreshing) return
  isRefreshing = true
  try {
    // Off says nothing, and turning back on starts from a fresh read rather than an old list.
    if (!(await read($, enabledAtom)) || !(await read($, showsOthersAtom))) {
      await update($, othersAtom, () => [])
      return
    }
    const mine = `${RESUME_PREFIX}${await $.session.id()}`
    const saved: (SavedChecklist | undefined)[] = []
    for (const key of await $.store.keys()) {
      if (key.startsWith(RESUME_PREFIX) && key !== mine) saved.push((await $.store.get(key)) as SavedChecklist | undefined)
    }
    const others = otherChats(saved, await now($))
    if (JSON.stringify(await read($, othersAtom)) !== JSON.stringify(others)) await update($, othersAtom, () => others)
  } catch {
    // A store that can't be read says nothing, rather than keep naming chats that may have moved on.
    await update($, othersAtom, () => [])
  } finally {
    isRefreshing = false
  }
}

/**
 * Moves the one shared key of older versions to a key per chat, then keeps only the most recent chats, never this one.
 * Moved checklists aren't marked open: those chats are named again only once they save, so a closed one never is.
 */
const tidySavedChecklists = async ($: $) => {
  const mine = `${RESUME_PREFIX}${await $.session.id()}`
  const old = await $.store.get(OLD_RESUME_KEY)
  if (old !== undefined) {
    for (const [id, saved] of Object.entries((old ?? {}) as Record<string, SavedChecklist>)) {
      // shortcut: the store has no write-if-unchanged, so a chat that saves between this check and the set loses that
      // save until its next one; checking right before the set keeps that window as small as it can be.
      if ((await $.store.get(`${RESUME_PREFIX}${id}`)) === undefined) await $.store.set(`${RESUME_PREFIX}${id}`, saved)
    }
    await $.store.delete(OLD_RESUME_KEY)
  }
  const saved: [string, number][] = []
  for (const key of (await $.store.keys()).filter(one => one.startsWith(RESUME_PREFIX) && one !== mine)) {
    saved.push([key, ((await $.store.get(key)) as SavedChecklist | undefined)?.at ?? 0])
  }
  const stale = new Set(staleResumeKeys(saved, RESUME_KEEP - 1))
  for (const [key, at] of saved) {
    // A chat that saved since it was read is in use again: it stays.
    if (stale.has(key) && (at === 0 || ((await $.store.get(key)) as SavedChecklist | undefined)?.at === at)) await $.store.delete(key)
  }
}

/** A resumed chat gets its checklist back; work that was under way shows as paused, with Continue. */
const restoreChecklist = async ($: $) => {
  const id = await $.session.id().catch(() => null)
  const saved = id === null ? undefined : ((await $.store.get(`${RESUME_PREFIX}${id}`)) as SavedChecklist | undefined)
  if (saved === undefined || isFinished(saved.list)) return
  const list = saved.list
  // Still true after a restart: a plan waiting for Start, or Claude waiting for a reply. Anything else was cut off.
  const holds = list.phase === 'stopped' || (list.phase === 'needsYou' && (list.needsYouReason === APPROVE || list.needsYouReason === WAITING))
  const restored: GlanceChecklist = {
    ...list,
    activity: null,
    isCollapsed: false,
    helpers: list.helpers.filter(one => one.status !== 'running'),
    ...(holds ? {} : { phase: 'stopped' as const, stopKind: 'pause' as const, needsYouReason: null, stuckReason: null, finishedAt: saved.at }),
  }
  await update($, checklistAtom, () => restored)
  syncTicker($, restored)
  // Saved again as open, so the other chats see it as it is now.
  saveSoon($)
}

const change = async ($: $, fn: (list: GlanceChecklist) => GlanceChecklist | null) => {
  const at = await now($)
  const before: { phase: GlancePhase | null } = { phase: null }
  const next = await update($, checklistAtom, list => {
    before.phase = list?.phase ?? null
    const changed = list ? fn(list) : list
    return changed ? { ...changed, tasks: stampTimes(changed.tasks, at) } : changed
  })
  syncTicker($, next)
  saveSoon($)
  if (next !== null && next.phase !== before.phase) {
    void alertFor($, next)
    void noticeFor($, next)
  }

  return next
}

/** Every chat's jobs on these days (all kept days when none are named), each once, oldest first. */
const readHistory = async ($: $, days?: readonly string[]): Promise<GlanceHistoryEntry[]> => {
  const stored: unknown[] = []
  for (const key of await $.store.keys()) {
    if (key.startsWith(HISTORY_PREFIX) && (days === undefined || days.includes(historyDay(key)))) stored.push(await $.store.get(key))
  }

  return mergedEntries(stored)
}

// This project's pace, kept between jobs: reading every chat's 30 days of history held up each new job, about 20 ms
// for every 1,000 saved jobs. A job this chat records clears it.
// shortcut: jobs other chats finish count from this chat's next session; refresh it on a timer if that matters.
let pace: { project: string; ms: number | null } | undefined

/** This project's pace from the History of the last 30 days; null when it isn't known yet. */
const learnPace = async ($: $): Promise<number | null> => {
  try {
    const project = await $.session.cwd()
    if (pace?.project !== project) pace = { project, ms: paceFromHistory(await readHistory($), project) }
    return pace.ms
  } catch {
    return null
  }
}

/** The pace already learned for this project, at once; undefined until it is. */
const knownPace = async ($: $): Promise<number | null | undefined> => {
  const project = await $.session.cwd().catch(() => null)
  return pace !== undefined && pace.project === project ? pace.ms : undefined
}

/** The person's standing goal for this project; null when none is set or the store can't be read. */
const readGoal = async ($: $): Promise<string | null> => {
  try {
    const goal = await $.store.get(`${GOAL_PREFIX}${await $.session.cwd()}`)
    return typeof goal === 'string' && goal ? goal : null
  } catch {
    return null
  }
}

const startJob = async ($: $, text: string, jobId: string) => {
  const previous = await read($, checklistAtom)
  const known = await knownPace($)
  const list: GlanceChecklist = {
    // Until Haiku names it, a request in a language GlanceFlow doesn't speak shows a neutral title.
    title:
      isLatinText(text.split('\n')[0] ?? '') || currentLang() === 'el' ? cleanName(text.split('\n')[0]) : tr('Working on your request'),
    phase: 'working',
    tasks: stampTimes([task(tr('Understand your request'), 'active'), task(tr('Plan the steps'), 'upcoming')], await now($)),
    needsYouReason: null,
    stuckReason: null,
    startedAt: await now($),
    finishedAt: null,
    isCollapsed: false,
    hasPlan: false,
    jobId,
    planAt: null,
    plannedCount: 0,
    extraTokens: 0,
    extraCachedTokens: 0,
    stopKind: null,
    activity: null,
    approval: 'none',
    costAtStart: (await read($, usageAtom)).costUsd,
    paceMs: known ?? null,
    doneWhen: null,
    goal: await readGoal($),
    // Work still running from the last job stays in view.
    helpers: (previous?.helpers ?? []).filter(one => one.status === 'running'),
  }
  failuresInARow = 0
  collapse?.cancel()
  await update($, checklistAtom, () => list)
  syncTicker($, list)
  saveSoon($)
  // Not learned yet: the checklist shows now, and gets the pace once History is read.
  if (known === undefined) {
    void learnPace($)
      .then(ms => (ms === null ? null : change($, one => (one.jobId === jobId && one.paceMs === null ? { ...one, paceMs: ms } : one))))
      .catch(() => undefined)
  }
  // Name the job in the background; a newer job wins.
  $.clock.after(0, () => void nameJob($, text, jobId))
}

const nameJob = async ($: $, text: string, jobId: string) => {
  try {
    const answer = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      timeoutMs: 15000,
      prompt:
        (currentLang() === 'el'
          ? 'Name this request in 2 to 6 plain everyday Greek words that start with a verb, ' +
            'like "Φτιάξε τη σελίδα μου", in sentence case: only the first word and names get a capital. ' +
            'Always in Greek, even when the request is in another language. '
          : 'Name this request in 2 to 6 plain English words that start with a verb, ' +
            'like "Build my landing page", in sentence case: only the first word and names get a capital. ' +
            'Always in English, even when the request is in another language. ') +
        'No file names, code, quotes or punctuation. ' +
        // Masked like everything GlanceFlow shows: keys and personal details stay out of the naming request.
        `Reply with the name only.\n\nRequest:\n${maskPrivate(text).slice(0, 2000)}`,
    })
    if (!answer.isAnswered) {
      return
    }
    const title = sentenceCase(cleanName((answer.text.split('\n')[0] ?? '').replace(/["'.]/g, '')))
    await change($, list => (list.jobId === jobId ? { ...list, title } : list))
  } catch {
    // The placeholder title stays.
  }
}

// A plan waiting for Start stays on Needs you while Claude finishes laying it out.
const setWorking = ($: $) =>
  change($, list =>
    list.approval !== 'waiting' && (list.phase === 'needsYou' || list.phase === 'stuck')
      ? { ...list, phase: 'working', needsYouReason: null, question: null, stuckReason: null }
      : list,
  )

const setNeedsYou = ($: $, reason: string) =>
  change($, list =>
    list.phase === 'done' || list.phase === 'stopped' ? list : { ...list, phase: 'needsYou', needsYouReason: reason, question: null },
  )

/** Claude wrote or edited a file: the current step keeps it, created or changed, once. A code change is untested again. */
const noteFile = async ($: $, path: string, isNew: boolean) => {
  const file: GlanceFile = { path: projectPath(path, await $.session.cwd().catch(() => '')), isNew }
  await change($, list => {
    const stepId = currentStepId(list)
    return {
      ...list,
      tasks: list.tasks.map(one => {
        if (one.id !== stepId) return one
        const files = (one.files ?? []).some(known => known.path === file.path) ? one.files : [...(one.files ?? []), file]
        return needsCheck(path) ? { ...one, files, check: 'unchecked' } : { ...one, files }
      }),
    }
  })
}

// A test, build or type check Claude ran: its result marks the steps that changed code. A run the person rejected or
// interrupted says nothing about the code.
const noteCheck = async ($: $, tool: string, input: { command?: unknown }, ran: { deny?: string; isError?: boolean; text?: unknown }) => {
  if ((tool !== 'Bash' && tool !== 'PowerShell') || ran.deny || !runsCheck(String(input.command ?? ''))) return
  const text = String(ran.text ?? '')
  if (ran.isError && (REJECTED.test(text) || /\binterrupted\b/i.test(text))) return
  await change($, list => ({ ...list, tasks: applyCheck(list.tasks, checkResult(ran.isError === true, text)) }))
}

const setStuck = ($: $, reason: string) =>
  change($, list => ({ ...list, phase: 'stuck', stuckReason: reason, needsYouReason: null }))

/** Stops Claude's running turn; Continue picks it up again. */
const pauseJob = async ($: $) => {
  if (runningTurn === undefined) {
    $.ui.toast(tr('Nothing is running right now.'))
    return
  }
  isPausing = true
  try {
    await $.turn.abort({ turnId: runningTurn })
    $.ui.toast(tr('Paused. Press Continue to pick up where Claude stopped.'))
  } catch {
    isPausing = false
    $.ui.toast(tr("Couldn't pause right now. Press Esc to stop instead."))
  }
}

/** Sends words as the person's own message; true when sent, otherwise onFail says what to do instead. */
const sendAsUser = async ($: $, text: string, onFail: () => unknown) => {
  try {
    await $.prompt.submit({ text, asUser: true })
    return true
  } catch {
    await onFail()
    return false
  }
}

/** Sends "continue" for the person: the same job goes on, nothing to type. */
const continueJob = ($: $) => sendAsUser($, CONTINUE_TEXT, () => $.ui.toast(tr("Couldn't continue right now. Type: continue")))

/** Loads one day of this project's history into the pane, and opens the pane when asked. */
const showHistory = async ($: $, day: string, isOpening: boolean) => {
  const project = await $.session.cwd()
  // Entries saved before the report fields existed get empty ones.
  const filled = (one: GlanceHistoryEntry) => ({ ...one, doneSteps: one.doneSteps ?? [], openSteps: one.openSteps ?? [], isQuickAnswer: one.isQuickAnswer ?? false })
  const entries = (await readHistory($, [day]))
    .filter(one => one.project === project)
    .map(filled)
  const today = dayKey(await now($))
  const saved = (await $.store.keys()).filter(key => key.startsWith(HISTORY_PREFIX)).map(historyDay)
  const days = [...new Set([today, day, ...saved])].sort().reverse()
  const myWeek = await readHistory($, Array.from({ length: WEEK_DAYS }, (_, back) => shiftDay(day, -back)))
  await update($, historyAtom, (view): GlanceHistoryView => ({
    day,
    project,
    entries,
    days,
    isReportShown: false,
    reportSpan: view?.reportSpan === 'week' ? 'week' : 'day',
    weekEntries: myWeek.filter(one => one.project === project).map(filled),
    myWeekEntries: myWeek.map(filled),
  }))

  return isOpening ? $.ui.open({ id: HISTORY_PANE, title: tr('History · {0}', projectName(project)), closeOnEscape: true }) : null
}

/** Opens the whole plan in a side panel: every step, what each got done, its time and helpers. */
const showPlan = ($: $) => $.ui.open({ id: PLAN_PANE, title: tr('Plan'), closeOnEscape: true })

/** Where we left off: the checkpoint Claude saved before the chat was tidied up, in a side panel. */
const showRecap = async ($: $) => {
  await update($, recapAtom, () => false)
  return $.ui.open({ id: RECAP_PANE, title: tr('Where we left off'), closeOnEscape: true })
}

/** Shows the team report for the day or the week, or your own week across projects, and copies it. */
const showReportSpan = async ($: $, span: GlanceHistoryView['reportSpan'], surface?: RenderSurface) => {
  await update($, historyAtom, view => (view ? { ...view, reportSpan: span } : view))
  const view = await read($, historyAtom)
  if (view !== null) await showReport($, true, reportOf(view), surface)
}

const showReport = async ($: $, isShown: boolean, text: string, surface?: RenderSurface) => {
  await update($, historyAtom, view => (view ? { ...view, isReportShown: isShown } : view))
  if (!isShown) return
  const copied = await $.ui.copy({ text, surface })
  const isMine = (await read($, historyAtom))?.reportSpan === 'mine'
  $.ui.toast(
    !copied.isCopied
      ? tr('The report is in the panel: select it there to copy it.')
      : isMine
        ? tr('Your week copied: paste it wherever you like.')
        : tr('Team report copied: paste it into Slack, Teams or an email.'),
  )
}

/** First press arms a button that ends or sends something; a second press within 8 seconds runs it. One waits at a time. */
const pressTwice = async ($: $, key: 'handoff' | 'ship', run: () => Promise<unknown>) => {
  if ((await read($, armedAtom)) === key) {
    await update($, armedAtom, () => null)
    await run()
    return
  }
  const press = ++armedPress
  await update($, armedAtom, () => key)
  $.clock.after(HANDOFF_CONFIRM_MS, () => {
    if (press === armedPress) void update($, armedAtom, () => null)
  })
}

/** Fresh chat asks for a second press; while the handoff note is being written, presses wait. */
const pressHandoff = async ($: $) => {
  if ((await read($, handoffAtom)) === 'working') return
  await pressTwice($, 'handoff', () => startFreshChat($))
}

/** Writes a handoff note over this chat, clears it, and sends the note as the fresh chat's first message. */
const startFreshChat = async ($: $) => {
  await update($, handoffAtom, () => 'working')
  try {
    $.ui.toast(tr('Writing a handoff note for the fresh chat…'))
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered || !reply.text.trim()) {
      $.ui.toast(reply.isAnswered ? tr("Couldn't write the handoff note. Nothing was cleared.") : tr("Couldn't write the handoff note ({0}). Nothing was cleared.", reply.reason))
      return
    }
    const note = reply.text.trim()
    // Kept in case anything below fails: /glanceflow handoff note puts it back in the prompt box.
    await $.store.set(HANDOFF_KEY, { at: await now($), note })
    try {
      await $.command.run({ command: 'clear', args: '' })
    } catch {
      $.ui.toast(tr("Couldn't clear the chat. Type /glanceflow handoff note to get the handoff note."))
      return
    }
    const isSent = await sendAsUser($, note, async () => {
      await $.prompt.fill({ text: note })
      $.ui.toast(tr('Chat cleared. The handoff note is in the prompt box: press Enter to send it.'))
    })
    if (isSent) $.ui.toast(tr('Fresh chat started from a handoff note.'))
  } finally {
    await update($, handoffAtom, () => 'idle')
  }
}

/** Saves the job to the day's history (this computer only) and refreshes an open history pane. */
const recordJob = async ($: $) => {
  try {
    const list = await read($, checklistAtom)
    if (list === null) return
    const project = await $.session.cwd()
    const day = dayKey(list.startedAt)
    // This chat's own key only: the store locks one set at a time, so a shared key could lose another chat's job.
    const key = historyKey(day, await $.session.id())
    const entry = entryFromChecklist(list, project, jobCost(list, await read($, usageAtom)))
    await $.store.set(key, upsertEntry(await $.store.get(key), entry))
    // A finished job with timed steps changes the pace: the next job learns it again, in the background.
    if (entry.outcome === 'done' && (entry.doneUnits ?? 0) > 0) pace = undefined
    const view = await read($, historyAtom)
    if (view !== null && view.day === day && view.project === project) {
      const entries = await readHistory($, [day])
      await update($, historyAtom, () => ({ ...view, entries: entries.filter(one => one.project === project) }))
    }
  } catch {
    // The history is a convenience: a failed save never gets in the way of the work.
  }
}

/** Once Claude has answered: done, or still working in the background while helpers run. */
const settleFinished = async ($: $, at: number, isNewAnswer: boolean) => {
  let changed = isNewAnswer
  const list = await change($, current => {
    if (current.phase !== 'done' && current.phase !== 'background') return current
    const phase = isBusy(current) ? ('background' as const) : ('done' as const)
    if (phase === current.phase && !isNewAnswer) return current
    changed = true
    return { ...current, phase, finishedAt: phase === 'done' ? at : null, isCollapsed: false }
  })
  if (!changed || list === null) return
  await recordJob($)
  collapse?.cancel()
  if (list.phase === 'done') {
    const jobId = list.jobId
    collapse = $.clock.after(COLLAPSE_MS, () => {
      void change($, current =>
        current.jobId === jobId && current.phase === 'done' ? { ...current, isCollapsed: true } : current,
      )
    })
  }
}

const addHelper = ($: $, helper: Omit<GlanceHelper, 'stepId'>) =>
  change($, current => ({
    ...current,
    helpers: [...current.helpers.filter(one => one.id !== helper.id), { ...helper, stepId: currentStepId(current) }],
  }))

const noteHelperStep = async ($: $, agentId: string, model: string, effort: unknown) => {
  const list = await read($, checklistAtom)
  const helper = list?.helpers.find(one => one.id === agentId)
  const named = prettyModel(model)
  const level = effort === undefined || effort === null ? null : String(effort)
  if (!helper || (helper.model === named && helper.effort === level)) return
  await change($, current => ({
    ...current,
    helpers: current.helpers.map(one => (one.id === agentId ? { ...one, model: named, effort: level } : one)),
  }))
}

type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** One model request's tokens: to the step it worked for, and to the helper that made it. */
const addTokens = ($: $, agentId: string | undefined, usage: StepUsage) => {
  const total =
    usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (total <= 0) return Promise.resolve(null)

  const cached = usage.cache_read_input_tokens

  return change($, current => {
    const helper = agentId === undefined ? undefined : current.helpers.find(one => one.id === agentId)
    const stepId =
      helper && current.tasks.some(one => one.id === helper.stepId)
        ? helper.stepId
        : current.tasks.find(one => one.status === 'active')?.id
    // No step is running (Claude writing its final answer): the job's total only.
    if (stepId === undefined && !helper) {
      return {
        ...current,
        extraTokens: current.extraTokens + total,
        extraCachedTokens: current.extraCachedTokens + cached,
      }
    }
    return {
      ...current,
      tasks: current.tasks.map(one =>
        one.id === stepId
          ? { ...one, tokens: one.tokens + total, cachedTokens: one.cachedTokens + usage.cache_read_input_tokens }
          : one,
      ),
      helpers: helper
        ? current.helpers.map(one => (one.id === helper.id ? { ...one, tokens: one.tokens + total } : one))
        : current.helpers,
    }
  })
}

/** Shows a helper's own transcript in the main view, as Claude Code's tasks list does. */
const openHelper = async ($: $, agentId: string) => {
  try {
    const shown = await $.ui.view({ agentId })
    if ('deny' in shown && shown.deny) $.ui.toast(tr("Couldn't open that helper: {0}", shown.deny))
  } catch (error) {
    // A Claude Code older than the view has no $.ui.view to call.
    $.ui.toast(tr("Couldn't open that helper: {0}", error instanceof TypeError ? tr('this needs a newer Claude Code') : String(error)))
  }
}

/** Stops one helper or task working in the background, with Claude Code's own TaskStop; Claude carries on. */
const stopHelper = async ($: $, helper: GlanceHelper) => {
  const taskId = helper.kind === 'background' ? helper.id.replace(/^bg:/, '') : helper.id
  // The tool table is too wide for TypeScript to check a call against: typed loosely, as the tests call tools.
  const failed = await ($.tool.call as unknown as (input: unknown) => Promise<{ deny?: string; isError?: boolean; text?: string }>)({
    tool: 'TaskStop',
    task_id: taskId,
  }).catch((error: unknown) => ({ deny: String(error), isError: true, text: '' }))
  if (failed.deny !== undefined || failed.isError) $.ui.toast(tr("Couldn't stop it: {0}", failed.deny ?? failed.text ?? tr('Claude Code said no')))
}

const finishHelper = async ($: $, agentId: string, status: 'done' | 'failed') => {
  const list = await change($, current => ({
    ...current,
    helpers: current.helpers.map(one => (one.id === agentId && one.status === 'running' ? { ...one, status } : one)),
  }))
  if (list?.phase === 'background') await settleFinished($, await now($), false)
}

/**
 * Tidies the chat up without forgetting: Claude first writes a checkpoint of the work, the compaction is told to keep
 * it, and it stays in Claude's instructions for the rest of this chat. Uses /compact itself when the engine refuses.
 */
const tidyUp = async ($: $) => {
  $.ui.toast(tr('Saving a checkpoint, then tidying up the chat…'))
  let note: string | null = null
  try {
    const reply = await $.model.fork({ prompt: CHECKPOINT_PROMPT })
    if (reply.isAnswered && reply.text.trim()) note = reply.text.trim()
  } catch {
    // Tidying up still helps without a checkpoint.
  }
  if (note !== null) {
    const at = await now($)
    await $.store.set(CHECKPOINT_KEY, { sessionId: await $.session.id(), at, note })
    await update($, checkpointAtom, () => at)
  } else {
    $.ui.toast(tr("Couldn't save a checkpoint; tidying up anyway."))
  }
  const instructions = note === null ? '' : `Keep everything in this checkpoint; it is what the work needs to carry on.\n\n${note}`
  try {
    const done = await $.session.compact(note === null ? undefined : { instructions })
    if (done.skip !== undefined) $.ui.toast(tr('The chat was not tidied up: {0}', done.skip))
    else if (note !== null) await update($, recapAtom, () => true)
    return
  } catch (refused) {
    $.ui.log(`glanceflow: compaction refused: ${refused instanceof Error ? refused.message : String(refused)}`, { to: 'debug' })
  }
  try {
    await $.command.run({ command: 'compact', args: instructions })
  } catch (failed) {
    const reason = failed instanceof Error ? failed.message : String(failed)
    $.ui.toast(tr("Couldn't tidy up the chat ({0}). Type /compact to try again.", reason.slice(0, 80)))
  }
}

/** The checkpoint saved before this chat was last tidied up; null in another chat or when there is none. */
const checkpointOf = async ($: $): Promise<string | null> => {
  const saved = (await $.store.get(CHECKPOINT_KEY)) as { sessionId?: string; note?: string } | undefined
  return saved?.note && saved.sessionId === (await $.session.id()) ? saved.note : null
}

const setTidyAt = async ($: $, percent: number) => {
  await update($, tidyAtAtom, () => percent)
  await $.store.set(TIDY_KEY, percent)
}

const holdSecretMessage = async ($: $, text: string, kinds: string[]) => {
  heldMessage = { text, at: await now($) }
  // Put it back in the box so nothing is lost.
  $.clock.after(50, () => void $.prompt.fill({ text }).catch(() => undefined))
  $.ui.toast(
    tr(
      'This message looks like it has {0} in it, so it was not sent. Press Enter again to send it anyway, or take it out first.',
      kinds.map(kind => tr(kind)).reduce((all, kind) => tr('{0} and {1}', all, kind)),
    ),
  )
}

const measureUsage = async ($: $, usage: GlanceUsage) => {
  await update($, usageAtom, () => usage)
  const level = usage.limitPercent === null ? 0 : usage.limitPercent >= LIMIT_ALERT ? 2 : usage.limitPercent >= LIMIT_WARN ? 1 : 0
  if (level > limitLevel && usage.limitPercent !== null) {
    const reset = resetTime(usage.limitResetsAt, await now($))
    const words = tr("You've used {0}% of your {1} limit", Math.round(usage.limitPercent), tr(usage.limitLabel ?? 'plan'))
    const message = reset === null ? words : tr('{0}. It resets {1}.', words, reset)
    $.ui.toast(message)
    if ((await read($, noticeAtom)) && (await read($, enabledAtom))) {
      await showNotice($, tr('Plan limit'), message)
    }
  }
  limitLevel = level
}

const setEnabled = async ($: $, isEnabled: boolean) => {
  await update($, enabledAtom, () => isEnabled)
  await $.store.set(STORE_KEY, isEnabled)
  $.ui.toast(isEnabled ? tr('GlanceFlow is on: tool details are hidden') : tr('GlanceFlow is off: showing everything'))
}

/** Sounds: off, a chime, or a chime and a few words. A chime plays at once so the person hears what they picked. */
const setSound = async ($: $, mode: 'off' | 'chime' | 'voice') => {
  await update($, soundAtom, () => mode)
  await $.store.set(SOUND_KEY, mode)
  if (mode !== 'off') void playSound($, 'sounds/needs-you.wav').catch(() => undefined)
}

/** Picks GlanceFlow's language: its own words, and the words it asks Claude to put on the checklist. */
const setLanguage = async ($: $, next: Lang) => {
  setLang(next)
  await update($, languageAtom, () => next)
  await $.store.set(LANGUAGE_KEY, next)
}

/** Calm mode: nothing moves, statuses in bold; the band redraws only to keep times current. */
const setCalm = async ($: $, isOn: boolean) => {
  isCalmMode = isOn
  await update($, calmAtom, () => isOn)
  await $.store.set(CALM_KEY, isOn)
  syncTicker($, await read($, checklistAtom))
}

/** Moves the welcome on a card, or ends it for good. */
const stepTour = async ($: $, step: number | null) => {
  await update($, tourAtom, () => (step === null || step >= TOUR_CARDS ? null : step))
  if (step === null || step >= TOUR_CARDS) await $.store.set(TOUR_KEY, true)
}

/** Desktop notices: on shows one when Claude needs you, gets stuck or finishes a long job. A sample shows at once. */
const setNotice = async ($: $, isOn: boolean) => {
  await update($, noticeAtom, () => isOn)
  await $.store.set(NOTICE_KEY, isOn)
  if (isOn) void showNotice($, tr('Claude needs you'), tr('This is how GlanceFlow will tell you.'))
}

/** The line naming the other chats that need the person: off before sharing the screen, say. */
const setOthers = async ($: $, isOn: boolean) => {
  await update($, showsOthersAtom, () => isOn)
  await $.store.set(OTHERS_KEY, isOn)
  if (isOn) await refreshOthers($).catch(() => undefined)
}

/** The password guard: on holds back a message that looks like it has a password or key in it. */
const setGuard = async ($: $, isOn: boolean) => {
  await update($, guardAtom, () => isOn)
  await $.store.set(GUARD_KEY, isOn)
}

/** Finish on GitHub: a finished job in a GitHub project offers Ship it. Off also ends a Ship it running in this chat. */
const setShipOnGithub = async ($: $, isOn: boolean) => {
  if (!isOn) endShipping()
  await update($, shipOnGithubAtom, () => isOn)
  await $.store.set(SHIP_KEY, isOn)
}

/** Sends the close-out as the person's own message: cleanup, commit, pull request, merge once the person approves. */
const shipIt = ($: $) => {
  endShipping()
  isShipping = true
  isShipTurnNext = true
  return sendAsUser($, SHIP_PROMPT, async () => {
    await $.prompt.fill({ text: SHIP_PROMPT })
    $.ui.toast(tr('The ship-it steps are in the prompt box: press Enter to send them.'))
  })
}

/** Approve the plan first: Claude lays out its plan, then waits for Start or a change. */
const setApprove = async ($: $, isOn: boolean) => {
  await update($, approveAtom, () => isOn)
  await $.store.set(APPROVE_KEY, isOn)
}

/** With Approve the plan first on, a new plan waits for Start or a change; true when it now waits. */
const holdForApproval = async ($: $): Promise<boolean> => {
  // A plan the person approved in plan mode needs no second approval.
  if (isPlanApproved || !(await read($, approveAtom)) || (await read($, checklistAtom))?.approval === 'approved') {
    return false
  }
  await change($, list => ({ ...list, approval: 'waiting', phase: 'needsYou', needsYouReason: APPROVE }))

  return true
}

/** The person approves the plan: the same job starts. */
const startPlan = ($: $) => sendAsUser($, START_TEXT, () => $.ui.toast(tr("Couldn't start right now. Type: start")))
const aimHigher = ($: $) => sendAsUser($, AIM_TEXT, () => $.ui.toast(tr("Couldn't send that right now. Ask Claude for a deeper plan.")))

/** Picks Simple, Details or Off directly, as the settings panel does. */
const setView = async ($: $, view: 'simple' | 'detailed' | 'off') => {
  await update($, enabledAtom, () => view !== 'off')
  await $.store.set(STORE_KEY, view !== 'off')
  if (view !== 'off') {
    await update($, detailAtom, () => view)
    await $.store.set(DETAIL_KEY, view)
  }
}

/** Plays what the person picked, so they know what they will hear. */
const alertSample = async ($: $, mode: 'off' | 'chime' | 'voice') => {
  if (mode === 'off') return
  await playSound($, 'sounds/needs-you.wav').catch(() => undefined)
  if (mode === 'voice') await sayWords($, tr('Claude needs you')).catch(() => undefined)
}

/** Back to how GlanceFlow starts: Simple, no sounds or notices, calm off, password guard on, no plan approval, tidy up at 50%. */
const resetSettings = async ($: $) => {
  await setView($, 'simple')
  await setSound($, 'off')
  await setNotice($, false)
  await setOthers($, true)
  await setCalm($, false)
  await setGuard($, true)
  await setApprove($, false)
  await setShipOnGithub($, false)
  await setTidyAt($, TIDY_AT_DEFAULT)
  $.ui.toast(tr('Settings are back to their defaults.'))
}

const showSettings = ($: $) => $.ui.open({ id: SETTINGS_PANE, title: tr('GlanceFlow settings'), closeOnEscape: true })
const openChecklist = ($: $) => $.ui.open({ id: CHECKLIST_PANE, title: 'GlanceFlow' })

// This copy's version, from its own plugin.json, read once; null when it can't be read.
let ownVersion: string | null | undefined
const readVersion = async ($: $) => {
  if (ownVersion === undefined) {
    try {
      const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }
      ownVersion = typeof manifest.version === 'string' && manifest.version ? manifest.version : null
    } catch {
      ownVersion = null
    }
  }
  return ownVersion
}

// Claude Code has no update call for a mod, so checking and updating run its own plugin commands, and only when the
// person presses the button: GlanceFlow makes no network request of its own.
// shortcut: needs `claude` on the app's PATH; when it isn't, the Version row gives the command to run instead.
const claudeJson = async ($: $, args: string[]): Promise<unknown> => {
  const { exitCode, stdout } = await $.process.run(['claude', ...args], { timeoutMs: 60_000 })
  if (exitCode !== 0) throw new Error(`claude ${args.join(' ')} failed`)
  return JSON.parse(stdout)
}
const setUpdate = ($: $, next: GlanceUpdate) => update($, updateAtom, () => next)

/** Fetches this install's marketplace and reads the newest GlanceFlow in it. */
const checkForUpdate = async ($: $) => {
  await setUpdate($, { state: 'checking', latest: null, id: null })
  try {
    const installed = (await claudeJson($, ['plugin', 'list', '--json'])) as { id: string; installPath?: string; enabled?: boolean }[]
    const mine =
      installed.find(one => one.installPath === $.plugin.root) ?? installed.find(one => one.id.startsWith(`${PLUGIN}@`) && one.enabled)
    // Loaded from a folder (a checkout, or --plugin-dir): it updates where it lives, not from a marketplace.
    if (!mine || mine.id.endsWith('@inline') || !mine.id.includes('@')) {
      await setUpdate($, { state: 'folder', latest: null, id: null })
      return
    }
    const marketplace = mine.id.slice(mine.id.indexOf('@') + 1)
    const fetched = await $.process.run(['claude', 'plugin', 'marketplace', 'update', marketplace], { timeoutMs: 120_000 })
    if (fetched.exitCode !== 0) throw new Error('marketplace update failed')
    const { available } = (await claudeJson($, ['plugin', 'list', '--available', '--json'])) as {
      available: { pluginId: string; version?: string | null; source?: unknown }[]
    }
    const entry = available.find(one => one.pluginId === mine.id)
    // The catalog names a version only when the marketplace lists one; otherwise the plugin's own manifest in it says.
    let latest = entry?.version ?? null
    if (latest === null && typeof entry?.source === 'string') {
      const markets = (await claudeJson($, ['plugin', 'marketplace', 'list', '--json'])) as { name: string; installLocation?: string }[]
      const location = markets.find(one => one.name === marketplace)?.installLocation
      if (location) latest = (JSON.parse(await $.fs.read(`${location}/${entry.source}/.claude-plugin/plugin.json`)) as { version?: string }).version ?? null
    }
    if (!latest) throw new Error('no version found')
    const current = await readVersion($)
    await setUpdate($, { state: current !== null && isNewerVersion(latest, current) ? 'available' : 'latest', latest, id: mine.id })
  } catch {
    await setUpdate($, { state: 'failed', latest: null, id: null })
  }
}

/** Installs the newer GlanceFlow found; a new chat loads it. */
const installUpdate = async ($: $) => {
  const found = await read($, updateAtom)
  if (found.state !== 'available' || found.id === null) return
  await setUpdate($, { ...found, state: 'updating' })
  try {
    const { exitCode } = await $.process.run(['claude', 'plugin', 'update', found.id], { timeoutMs: 120_000 })
    if (exitCode !== 0) throw new Error('update failed')
    await setUpdate($, { ...found, state: 'updated' })
    $.ui.toast(tr('GlanceFlow {0} is installed. Open a new chat to use it.', found.latest ?? ''))
  } catch {
    await setUpdate($, { ...found, state: 'failed' })
  }
}

/** The one button: Simple → Details → Off → Simple. */
const cycleMode = async ($: $, isEnabled: boolean, isDetailed: boolean) => {
  const nextEnabled = !(isEnabled && isDetailed)
  const nextDetailed = isEnabled && !isDetailed
  await update($, enabledAtom, () => nextEnabled)
  await update($, detailAtom, () => (nextDetailed ? 'detailed' : 'simple'))
  await $.store.set(STORE_KEY, nextEnabled)
  await $.store.set(DETAIL_KEY, nextDetailed ? 'detailed' : 'simple')
  $.ui.toast(
    !nextEnabled
      ? tr('GlanceFlow is off: showing everything')
      : nextDetailed
        ? tr('GlanceFlow details: models, time, tokens, cache and plan usage')
        : tr('GlanceFlow simple: just the steps and progress'),
  )
}

const setDetail = async ($: $, isDetailed: boolean) => {
  await update($, detailAtom, () => (isDetailed ? 'detailed' : 'simple'))
  await $.store.set(DETAIL_KEY, isDetailed ? 'detailed' : 'simple')
  $.ui.toast(
    isDetailed ? tr('Details on: models, tokens, cache and plan usage') : tr('Details off: just the steps and progress'),
  )
}

// GlanceFlow was called Glance until 0.9: once, bring over Glance's settings and history from its own store file.
const ADOPTED_KEY = 'adoptedGlance'
const adoptGlanceStore = async ($: $) => {
  if (await $.store.get(ADOPTED_KEY)) {
    return
  }
  await $.store.set(ADOPTED_KEY, true)
  try {
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    const dir = `${config}/plugins/store`
    const settings = new Set([STORE_KEY, DETAIL_KEY, SOUND_KEY, CALM_KEY, GUARD_KEY, APPROVE_KEY, NOTICE_KEY, LANGUAGE_KEY])
    const mine = new Set(await $.store.keys())
    for (const file of await $.fs.list(dir)) {
      if (!/^glance_.*\.json$/.test(file.name)) {
        continue
      }
      const old = JSON.parse(await $.fs.read(`${dir}/${file.name}`)) as Record<string, unknown>
      for (const [key, value] of Object.entries(old)) {
        if (key.startsWith(HISTORY_PREFIX) && Array.isArray(value)) {
          const own = historyKey(historyDay(key), 'glance')
          let entries = await $.store.get(own)
          // Only Glance's own jobs: another mod may be called glance too.
          for (const entry of value as GlanceHistoryEntry[]) {
            if (typeof entry?.jobId === 'string' && Array.isArray(entry.doneSteps)) {
              entries = upsertEntry(entries, entry)
            }
          }
          await $.store.set(own, entries ?? [])
        } else if (settings.has(key) && !mine.has(key)) {
          await $.store.set(key, value)
        }
      }
    }
  } catch {
    // Nothing to bring over.
  }
}

// Up to 0.24 every chat's jobs of a day shared one key (sharedDayKeys); once, each moves into this chat's own key for its day.
const splitSharedDays = async ($: $) => {
  try {
    const id = await $.session.id()
    for (const key of sharedDayKeys(await $.store.keys())) {
      const own = historyKey(historyDay(key), id)
      await $.store.set(own, mergedEntries([await $.store.get(key), await $.store.get(own)]))
      await $.store.delete(key)
    }
  } catch {
    // Left as it is, the old day still reads; the next chat moves it.
  }
}

export function registerGlance(on: On): void {
  // A chat that ends says so, so the other chats stop mentioning it; its checklist stays for when it is resumed.
  on('session.end', async ($, e, next) => {
    saveTimer?.cancel()
    saveTimer = undefined
    try {
      await saving
      await saveChecklist($, false, e.sessionId)
    } catch {
      // The end goes on: the other chats stop mentioning this one once it falls silent.
    }
    // After /clear or a resume the process goes on as another chat, with no session.start: that one is open, and
    // keeps reading the others.
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      hasEnded = true
      othersTimer?.cancel()
      othersTimer = undefined
    }
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    void findPlatform($)
      .then(found => {
        platform = found
      })
      .catch(() => undefined)
    await adoptGlanceStore($)
    // The welcome shows once, to someone new: anyone with settings or history already knows their way.
    const keys = await $.store.keys()
    if (!keys.includes(TOUR_KEY)) {
      if (keys.every(key => key === ADOPTED_KEY)) await update($, tourAtom, () => 0)
      else await $.store.set(TOUR_KEY, true)
    }
    const stored = await $.store.get(STORE_KEY)
    await update($, enabledAtom, () => stored !== false)
    const detail = await $.store.get(DETAIL_KEY)
    await update($, detailAtom, () => (detail === 'detailed' ? 'detailed' : 'simple'))
    const sound = await $.store.get(SOUND_KEY)
    await update($, soundAtom, () => (sound === 'chime' || sound === 'voice' ? sound : 'off'))
    isCalmMode = (await $.store.get(CALM_KEY)) === true
    const language: Lang = (await $.store.get(LANGUAGE_KEY)) === 'el' ? 'el' : 'en'
    setLang(language)
    await update($, languageAtom, () => language)
    const isGuarded = (await $.store.get(GUARD_KEY)) !== false
    await update($, guardAtom, () => isGuarded)
    const approves = (await $.store.get(APPROVE_KEY)) === true
    await update($, approveAtom, () => approves)
    const ships = (await $.store.get(SHIP_KEY)) === true
    await update($, shipOnGithubAtom, () => ships)
    const origin = await $.process.run(['git', 'remote', 'get-url', 'origin']).catch(() => ({ exitCode: 1, stdout: '' }))
    await update($, hasGithubAtom, () => origin.exitCode === 0 && /github\.com[:/]/.test(origin.stdout))
    const isNoticing = (await $.store.get(NOTICE_KEY)) === true
    await update($, noticeAtom, () => isNoticing)
    const showsOthers = (await $.store.get(OTHERS_KEY)) !== false
    await update($, showsOthersAtom, () => showsOthers)
    const tidyAt = await $.store.get(TIDY_KEY)
    await update($, tidyAtAtom, () => (typeof tidyAt === 'number' ? tidyAt : TIDY_AT_DEFAULT))
    const saved = (await $.store.get(CHECKPOINT_KEY)) as { sessionId?: string; at?: number } | undefined
    const thisSession = await $.session.id().catch(() => null)
    await update($, checkpointAtom, () => (saved?.sessionId === thisSession && typeof saved?.at === 'number' ? saved.at : null))
    await update($, calmAtom, () => isCalmMode)
    hasEnded = false
    endShipping()
    // Tidying is housekeeping: a store that fails at it must not keep the chat from starting. It never prunes this
    // chat's own checklist, so the restore below still finds it.
    await tidySavedChecklists($).catch(() => undefined)
    othersTimer?.cancel()
    othersTimer = $.clock.every(OTHERS_EVERY_MS, () => void refreshOthers($).catch(() => undefined))
    void refreshOthers($).catch(() => undefined)
    // A resumed chat: its checklist comes back. A reload keeps the one it has.
    if ((await read($, checklistAtom)) === null) {
      await restoreChecklist($)
    }
    await splitSharedDays($)
    // The history keeps 30 days.
    for (const key of expiredHistoryKeys(await $.store.keys(), await now($))) {
      await $.store.delete(key)
    }
    // Learned now, so the first job's time left needs no wait.
    void learnPace($)
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, 2 to 8 short plain-English names in order. ' +
        'Call this before using any other tool; a quick answer that needs no tools needs no plan. ' +
        'The first step starts right away.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
          sizes: {
            type: 'array',
            items: { type: 'string', enum: ['S', 'M', 'L'] },
            description: 'One size per step, in order: S small, M medium, L large.',
          },
          done_when: {
            type: 'string',
            description:
              'What will be true when the job is done, and what other than you will show it: tests passing, the page ' +
              'loading on a phone, the person trying it. One plain-English sentence, no file names or code.',
          },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step by its plain-English name. Send percent 100 the moment a step ' +
        'finishes; the next step then starts. A name not in the plan becomes a new step.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
          summary: {
            type: 'string',
            description:
              'With percent 100: one short plain-English sentence on what the step got done, for the person and their team. No file names or code.',
          },
          for_you: {
            type: 'array',
            items: { type: 'string' },
            description:
              'What only the person can do or decide, that came up in this step: a sign-in, a key, a payment, a choice between options, a step you could not run. One short plain-English line each.',
          },
          decided: {
            type: 'array',
            items: { type: 'string' },
            description: 'Choices you made in this step that neither the plan nor the person settled, so they can check them. One short plain-English line each.',
          },
        },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({
      name: 'glanceflow',
      description:
        'GlanceFlow: /glanceflow on|off, details on|off, sound on|voice|off, notify on|off, others on|off, calm on|off, language el|en, guard on|off, approve on|off, ship on|off, goal [text|off], week, tour, pause, continue, plan, show, checkpoint, settings, tidy [at N|off], history [yesterday|YYYY-MM-DD], handoff',
    })
    // A reload drops the module's timers; pick the animation back up.
    syncTicker($, await read($, checklistAtom))
    // VS Code may have attached before GlanceFlow loaded (a reload): open its checklist pane now.
    if ((await $.session.surfaces()).includes('vscode')) await openChecklist($)

    return next(e)
  })

  on('command.run', { command: ['glanceflow'] }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg.startsWith('sound')) {
      const choice = arg.slice('sound'.length).trim()
      const current = await read($, soundAtom)
      const mode = choice === 'voice' ? 'voice' : choice === 'off' ? 'off' : choice === 'on' || current === 'off' ? 'chime' : 'off'
      await setSound($, mode)
      return {
        text:
          mode === 'off'
            ? tr('Sounds are off.')
            : mode === 'voice'
              ? tr('Sounds and voice are on: you will hear when Claude needs you, gets stuck or finishes a long job.')
              : tr('Sounds are on: a chime when Claude needs you, gets stuck or finishes a long job.'),
      }
    }
    if (arg.startsWith('language')) {
      const choice = arg.slice('language'.length).trim()
      const next: Lang | null = /^(el|greek|ελληνικά)$/.test(choice) ? 'el' : /^(en|english)$/.test(choice) ? 'en' : null
      if (next === null) return { text: tr('Try /glanceflow language el or /glanceflow language en.') }
      await setLanguage($, next)
      return { text: tr('GlanceFlow speaks English now.') }
    }
    if (arg.startsWith('calm')) {
      const choice = arg.slice('calm'.length).trim()
      await setCalm($, toggled(choice, await read($, calmAtom)))
      return { text: isCalmMode ? tr('Calm mode is on: nothing moves, statuses are bold.') : tr('Calm mode is off.') }
    }
    if (arg.startsWith('guard')) {
      const choice = arg.slice('guard'.length).trim()
      const isOn = toggled(choice, await read($, guardAtom))
      await setGuard($, isOn)
      return {
        text: isOn
          ? tr('The password guard is on: a message that looks like it has a password or key in it is held back.')
          : tr('The password guard is off: every message is sent as you write it.'),
      }
    }
    if (arg === 'show') {
      const opened = await openChecklist($)
      return { text: opened.isPlaced ? tr('The GlanceFlow checklist is open.') : tr("Couldn't open the checklist: {0}.", opened.reason) }
    }
    if (arg === 'tour') {
      await update($, enabledAtom, () => true)
      await update($, tourAtom, () => 0)
      return { text: tr('The welcome shows above the prompt: press Next to go through it.') }
    }
    if (arg.startsWith('notify')) {
      const choice = arg.slice('notify'.length).trim()
      const isOn = toggled(choice, await read($, noticeAtom))
      await setNotice($, isOn)
      return {
        text: isOn
          ? tr('Desktop notices are on: your computer, and any Notification hooks you set up for Claude Code, tell you when Claude needs you, gets stuck or finishes a long job.')
          : tr('Desktop notices are off.'),
      }
    }
    if (arg.startsWith('others')) {
      const isOn = toggled(arg.slice('others'.length).trim(), await read($, showsOthersAtom))
      await setOthers($, isOn)
      return { text: isOn ? tr('The band names another chat on this computer that needs you.') : tr('The band no longer mentions other chats.') }
    }
    if (arg.startsWith('approve')) {
      const choice = arg.slice('approve'.length).trim()
      const isOn = toggled(choice, await read($, approveAtom))
      await setApprove($, isOn)
      return {
        text: isOn
          ? tr('Claude now shows its plan and waits: press Start, or tell Claude what to change.')
          : tr('Claude starts right after laying out its plan.'),
      }
    }
    if (arg.startsWith('ship')) {
      const choice = arg.slice('ship'.length).trim()
      if (choice === '') {
        void shipIt($)
        return { text: tr('Shipping on GitHub…') }
      }
      const isOn = toggled(choice, await read($, shipOnGithubAtom))
      await setShipOnGithub($, isOn)
      return {
        text: isOn
          ? tr('A finished job now offers Ship it: commit, pull request, and merge once you approve.')
          : tr('Ship it is off. Finished jobs stay on their branch.'),
      }
    }
    if (arg === 'week') {
      const opened = await showHistory($, dayKey(await now($)), true)
      const view = await read($, historyAtom)
      if (view === null) return { text: tr('No history yet.') }
      await showReportSpan($, 'mine')
      const summary = weekSummary(view.myWeekEntries, view.day).split('\n')

      return { text: opened?.isPlaced ? summary[2] ?? summary[0]! : summary.join('\n') }
    }
    if (arg.startsWith('history')) {
      const day = dayFromArgument(arg.slice('history'.length), await now($))
      if (day === null) {
        return { text: tr('Try /glanceflow history, /glanceflow history yesterday or /glanceflow history 2026-10-06.') }
      }
      const opened = await showHistory($, day, true)
      const entries = (await read($, historyAtom))?.entries ?? []
      const count = entries.length === 1 ? tr('1 task') : tr('{0} tasks', entries.length)

      return {
        text: opened?.isPlaced
          ? tr('History for {0}: {1}.', day, count)
          : tr('History for {0}: {1}. Widen the window to see the panel.', day, count),
      }
    }
    if (arg === 'pause') {
      await pauseJob($)
      return { text: tr('Paused.') }
    }
    if (arg.startsWith('tidy')) {
      const choice = arg.slice('tidy'.length).trim().replace(/^at\s+/, '').replace('%', '')
      if (choice === '') {
        void tidyUp($)
        return { text: tr('Saving a checkpoint, then tidying up the chat.') }
      }
      const percent = choice === 'off' ? 0 : Number(choice)
      if (!Number.isInteger(percent) || percent < 0 || percent > 95) {
        return { text: tr('Try /glanceflow tidy, /glanceflow tidy at 50 or /glanceflow tidy off.') }
      }
      await setTidyAt($, percent)
      return { text: percent === 0 ? tr('GlanceFlow will not offer to tidy up.') : tr('GlanceFlow offers to tidy up at {0}% full.', percent) }
    }
    if (arg === 'settings') {
      await showSettings($)
      return { text: tr('Settings are in the side panel.') }
    }
    if (arg === 'checkpoint') {
      if ((await checkpointOf($).catch(() => null)) === null) return { text: tr('No checkpoint in this chat yet. Tidy it up saves one.') }
      await showRecap($)
      return { text: tr('Where we left off is in the side panel.') }
    }
    if (arg === 'plan') {
      await showPlan($)
      return { text: tr('The plan is in the side panel.') }
    }
    if (arg === 'continue') {
      void continueJob($)
      return { text: tr('Continuing…') }
    }
    if (arg === 'handoff note') {
      const saved = (await $.store.get(HANDOFF_KEY)) as { note?: string } | undefined
      if (!saved?.note) return { text: tr('No handoff note saved yet.') }
      await $.prompt.fill({ text: saved.note })
      return { text: tr('The last handoff note is in the prompt box.') }
    }
    if (arg === 'handoff') {
      void startFreshChat($)
      return { text: tr('Starting a fresh chat from a handoff note…') }
    }
    if (arg.startsWith('goal')) {
      // arg is lowercased: the goal keeps the person's own spelling.
      const text = e.args.trim().slice('goal'.length).trim()
      const key = `${GOAL_PREFIX}${await $.session.cwd()}`
      if (text.toLowerCase() === 'off') {
        await $.store.delete(key)
        return { text: tr('The goal for this project is cleared.') }
      }
      const goal = text ? cleanName(text, MAX_GOAL) : ''
      if (!goal) {
        const current = await readGoal($)
        return {
          text: current
            ? tr('The goal for this project: {0}. Claude plans each job toward it. Clear it with /glanceflow goal off.', current)
            : tr('No goal for this project yet. Set one with /glanceflow goal and what you want, like: keep sign-ups working.'),
        }
      }
      await $.store.set(key, goal)
      return { text: tr('The goal for this project: {0}. Claude plans each new job toward it.', goal) }
    }
    if (arg.startsWith('details')) {
      const choice = arg.slice('details'.length).trim()
      const isDetailed = toggled(choice, (await read($, detailAtom)) === 'detailed')
      await setDetail($, isDetailed)

      return { text: isDetailed ? tr('GlanceFlow details are on.') : tr('GlanceFlow details are off.') }
    }
    const isEnabled = toggled(arg, await read($, enabledAtom))
    await setEnabled($, isEnabled)

    return { text: isEnabled ? tr('GlanceFlow is on.') : tr('GlanceFlow is off.') }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabledAtom))) {
      return composed
    }

    const checkpoint = await checkpointOf($).catch(() => null)
    const goal = await readGoal($)

    return {
      sections: [
        ...composed.sections,
        { id: `${PLUGIN}:checklist`, text: PROMPT_SECTION, scope: 'session' as const },
        // The person reads GlanceFlow in Greek: what Claude writes on the checklist is Greek too.
        ...(currentLang() === 'el' ? [{ id: `${PLUGIN}:language`, text: GREEK_SECTION, scope: 'session' as const }] : []),
        // The outcome beyond the task, across jobs: each plan aims at it.
        ...(goal === null
          ? []
          : [
              {
                id: `${PLUGIN}:goal`,
                text: `# The person's standing goal for this project\n${goal}\nPlan each job toward it, and say in done_when how this job moves it forward.`,
                scope: 'session' as const,
              },
            ]),
        // Saved before the chat was tidied up: what the work needs to carry on.
        ...(checkpoint === null
          ? []
          : [{ id: `${PLUGIN}:checkpoint`, text: `# Checkpoint saved before this chat was tidied up\n${checkpoint}`, scope: 'session' as const }]),
      ],
    }
  })

  // Passwords and keys pasted into a message stay on this computer unless sent twice.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' || !(await read($, guardAtom))) {
      return next(e)
    }
    const kinds = findSecrets(e.text)
    if (kinds.length === 0) {
      return next(e)
    }
    const held = heldMessage
    if (held !== null && held.text === e.text && (await now($)) - held.at < RESEND_WINDOW_MS) {
      heldMessage = null
      return next(e)
    }
    await holdSecretMessage($, e.text, kinds)

    return { drop: tr('The message looked like it held a password or key, so GlanceFlow held it back.') }
  })

  on('session.measure', async ($, e, next) => {
    const top = [...e.rateLimits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
    await measureUsage($, {
      limits: e.rateLimits.map(one => ({ label: LIMIT_LABEL[one.kind] ?? one.kind, percent: one.percentUsed })),
      limitPercent: top ? top.percentUsed : null,
      limitLabel: top ? (LIMIT_LABEL[top.kind] ?? top.kind) : null,
      limitResetsAt: top?.resetsAt ?? null,
      contextPercent: e.context.percent ?? null,
      costUsd: e.cost?.usd ?? null,
    })

    return next(e)
  })

  // Personal details and secrets stay off the screen; what Claude reads is unchanged.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const masked = (await read($, enabledAtom)) ? maskPrivate(e.props.text) : e.props.text

    return masked === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: masked } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const masked = (await read($, enabledAtom)) ? maskPrivate(e.props.text) : e.props.text

    return masked === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text: masked } })
  })

  // The footer keeps progress in view even when the checklist is shrunk. Its words are plain text, so only the
  // terminal, whose glyphs are the band's own, gets a mark in front.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = (await read($, enabledAtom)) ? await read($, checklistAtom) : null
    const mark = (glyph: string) => (e.surface === 'terminal' ? `${glyph} ` : '')
    if (list !== null && list.phase === 'background') {
      const running = list.helpers.filter(one => one.status === 'running').length
      return next({ ...e, props: { ...e.props, modes: [`${mark('◷')}${tr('{0} in background', running)}`, ...e.props.modes] } })
    }
    if (list === null || !list.hasPlan || list.phase === 'done' || list.phase === 'stopped') {
      return next(e)
    }
    const at = await now($)
    const active = list.tasks.find(one => one.status === 'active')
    const activePercent = active ? stepEstimate(list, active, at).percent : undefined
    const left = timeLeft(list, at, activePercent)
    const label = `${mark('◎')}${overallProgress(list.tasks, activePercent).percent}%${left === null ? '' : ` · ~${formatLeft(left)}`}`

    return next({ ...e, props: { ...e.props, modes: [label, ...e.props.modes] } })
  })

  // Subagents: what they work on and which model, under the step that started them.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined && e.parentAgentId === undefined) {
      await addHelper($, {
        id: started.agentId,
        kind: 'helper',
        label: cleanName(e.description, MAX_DETAIL),
        type: e.subagentType,
        isBackground: e.background,
        model: prettyModel(started.model),
        effort: null,
        status: 'running',
        tokens: 0,
      })
    }

    return started
  })

  // Each model request of a subagent says its model and effort.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      await noteHelperStep($, e.agentId, e.model, e.effort)
    }
    const stream = next(e)
    for await (const chunk of stream) {
      noteSign($)
      yield chunk
    }
    const result = await stream.result
    if (result.usage) {
      await addTokens($, e.agentId, result.usage)
    }

    return result
  })

  // At the end of each turn the engine lists what still runs in the background.
  on('classic.Stop', async ($, e, next) => {
    const tasks = (e.background_tasks ?? []).filter(one => one.type !== 'subagent')
    await change($, current => {
      const listed = { ...current, helpers: reconcileBackground(current, tasks) }
      // Background work Claude waits for: it is still working, nothing for the person to do.
      return listed.phase === 'needsYou' && listed.needsYouReason === WAITING && isBusy(listed)
        ? { ...listed, phase: 'working', needsYouReason: null }
        : listed
    })
    await settleFinished($, await now($), false)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    runningTurn = e.turnId
    wrapUpAsk = null
    noteSign($)
    const text = ownWords(e.text)
    // Ship it, on a turn the person started (not a continuation or a slash command). Only the exact reply
    // "Approve merge <SHA>" to a pending request approves that head commit. Any other reply declines it: the pull
    // request stays open, the guard holds for that whole turn, and Ship it ends with it. A later turn of the person's
    // own, with nothing pending and no failed merge to retry, means they moved on, and Ship it ends.
    approvedSha = null
    if (isShipping && text && !text.startsWith('/')) {
      const pending = askedSha
      askedSha = null
      if (pending !== null) {
        isDeclining = text !== `Approve merge ${pending}`
        if (!isDeclining) approvedSha = pending
      } else if (isShipTurnNext) {
        isShipTurnNext = false
      } else if (!hasFailedMerge && text !== CONTINUE_TEXT && !isContinueWords(text)) {
        endShipping()
      }
    }
    // The person moved on: the tidy-up note has done its job.
    if (text && (await read($, recapAtom))) {
      await update($, recapAtom, () => false)
    }
    const current = await read($, checklistAtom)
    if (current !== null && current.approval === 'waiting' && (text === START_TEXT || isStartWords(text))) {
      // Start, or "go ahead" typed: the plan is approved and the same job goes on.
      await change($, list => ({ ...list, approval: 'approved', phase: 'working', needsYouReason: null, isCollapsed: false }))
    } else if (current !== null && (text === CONTINUE_TEXT || (isContinueWords(text) && !isFinished(current)))) {
      // The Continue button, or "continue" typed: the same job picks up again.
      await change($, list => ({
        ...list,
        phase: 'working',
        stopKind: null,
        stuckReason: null,
        needsYouReason: null,
        finishedAt: null,
        isCollapsed: false,
      }))
    } else if (text && !text.startsWith('/')) {
      const list = current
      if (list === null || isFinished(list) || list.phase === 'stopped' || list.phase === 'background') {
        await startJob($, text, e.turnId)
      } else {
        await setWorking($)
      }
    } else if (!text && current !== null) {
      // Claude woke up on its own (a helper or background task finished): it is working again.
      await setWorking($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // The MCP tool table makes `e` a union too wide to narrow here; read the envelope plainly.
    const call = e as unknown as {
      tool: string
      tool_use_id: string
      todos?: ReadonlyArray<{ content: string; status: string }>
      subject?: string
      taskId?: string
      status?: string
    }
    const tool = String(call.tool)
    const isMain = e.agentId === undefined
    noteSign($)
    const fileField = FILE_TOOLS[tool]
    const filePath = fileField ? String((e as unknown as Record<string, unknown>)[fileField] ?? '') : ''
    // Only Write can create a file; asked before it runs.
    const isNewFile = filePath !== '' && tool === 'Write' && !(await $.fs.exists(filePath).catch(() => true))

    // In plan mode the plan Claude hands over for approval is the plan: no checklist of the planning itself.
    if (tool === PLAN_TOOL && isPlanMode && (await read($, enabledAtom))) {
      return { deny: PLAN_MODE_WAIT }
    }
    // Claude Desktop's own task list is this job's plan once seen: no second list beside it.
    if (tool === PLAN_TOOL && (await read($, checklistAtom))?.hasNativeList && (await read($, enabledAtom))) {
      return { deny: `Claude's own task list is this job's plan: keep it with ${NATIVE_PLAN}, and report each step with ${PROGRESS_TOOL} by the same name.` }
    }
    if (tool === PLAN_TOOL) {
      const input = e as unknown as { steps?: unknown; sizes?: unknown; done_when?: unknown }
      const steps = (Array.isArray(input.steps) ? input.steps : []).map(one => cleanName(one)).slice(0, 8)
      const doneWhen = String(input.done_when ?? '').trim() ? cleanName(input.done_when, MAX_SUMMARY) : null
      const sizes = Array.isArray(input.sizes) ? input.sizes : []
      if (steps.length === 0) {
        return { deny: 'plan_steps needs 2 to 8 step names.' }
      }
      const tasks = settle(steps.map((name, index) => task(name, 'upcoming', `plan#${index}`, sizeOf(sizes[index]))))
      const started = await now($)
      const known = await read($, checklistAtom)
      const paceMs = known === null ? await learnPace($) : known.paceMs
      const goal = known === null ? await readGoal($) : null
      await update($, checklistAtom, (list): GlanceChecklist => ({
        paceMs: list?.paceMs ?? paceMs,
        planAt: list?.hasPlan ? (list.planAt ?? started) : started,
        plannedCount: list?.hasPlan ? list.plannedCount : steps.length,
        extraTokens: list?.extraTokens ?? 0,
        extraCachedTokens: list?.extraCachedTokens ?? 0,
        stopKind: null,
        activity: null,
        approval: list?.approval ?? 'none',
        costAtStart: list?.costAtStart ?? null,
        title: list?.title ?? tr('Working on it'),
        startedAt: list?.startedAt ?? started,
        jobId: list?.jobId ?? call.tool_use_id,
        finishedAt: null,
        isCollapsed: false,
        needsYouReason: null,
        stuckReason: null,
        phase: 'working',
        hasPlan: true,
        tasks: stampTimes(carryTokens(list?.tasks ?? [], tasks), started),
        helpers: list?.helpers ?? [],
        // A new plan without it keeps the one said before.
        doneWhen: doneWhen ?? list?.doneWhen ?? null,
        goal: list ? (list.goal ?? null) : goal,
      }))
      syncTicker($, await read($, checklistAtom))
      saveSoon($)
      if (await holdForApproval($)) {
        return {
          result:
            `Planned ${steps.length} steps. The person approves plans before work starts: stop now and wait for their reply. ` +
            'Do not use other tools yet. If they ask for changes, lay out the new plan with plan_steps.',
        }
      }

      return { result: `Planned ${steps.length} steps. The first one has started.` }
    }

    if (tool === PROGRESS_TOOL) {
      const input = e as unknown as { task?: unknown; percent?: unknown; summary?: unknown; for_you?: unknown; decided?: unknown }
      const percent = Math.min(100, Math.max(0, Math.round(Number(input.percent) || 0)))
      const name = cleanName(String(input.task ?? ''))
      const summary = percent === 100 && String(input.summary ?? '').trim() ? cleanName(input.summary, MAX_SUMMARY) : null
      // Each line once (in any case), as first said, up to MAX_NOTES.
      const added = (known: string[] | undefined, said: unknown) => {
        const all = [...(known ?? []), ...(Array.isArray(said) ? said : []).filter(one => String(one ?? '').trim()).map(one => cleanName(one, MAX_SUMMARY))]
        return all.filter((one, at) => all.findIndex(other => other.toLowerCase() === one.toLowerCase()) === at).slice(0, MAX_NOTES)
      }
      await change($, list => ({
        ...list,
        tasks: applyProgress(list.tasks, name, percent).map(one =>
          summary !== null && one.name.toLowerCase() === name.toLowerCase() ? { ...one, summary } : one,
        ),
        activity: percent === 100 ? null : list.activity,
        forYou: added(list.forYou, input.for_you),
        decided: added(list.decided, input.decided),
      }))

      return { result: `Progress noted: ${percent}%.` }
    }

    // Ship it merges only the head commit the person approved, never past branch protection; helpers too.
    let isMerging = false
    if (isMcpMergeAction(tool) && isShipping && (await read($, enabledAtom))) {
      return {
        deny:
          'Ship it merges only with gh pr merge --squash --delete-branch --match-head-commit <approved SHA> run on its ' +
          'own, never through an MCP tool. Leave the pull request open.',
      }
    }
    if ((tool === 'Bash' || tool === 'PowerShell') && isShipping && (await read($, enabledAtom))) {
      const command = String((e as unknown as { command?: unknown }).command ?? '')
      // PowerShell quotes, escapes and spells commands unlike Bash, so it has its own stricter rule.
      const isPowerShell = tool === 'PowerShell'
      const denied = isPowerShell ? unsafePowerShellMerge(command, approvedSha) : unsafeMerge(command, approvedSha)
      if (denied !== null) return { deny: denied }
      isMerging = isPowerShell ? runsPowerShellMerge(command) : runsPrMerge(command)
    }

    if (!isMain) {
      // One approval, one merge attempt: used up as the merge runs, so even a failed one needs a fresh approval.
      if (isMerging) approvedSha = null
      const ran = await next(e)
      if (isMerging) noteMerge(ran)
      await noteCheck($, tool, e as unknown as { command?: unknown }, ran)
      if (filePath !== '' && ran.deny === undefined && !ran.isError) {
        await noteFile($, filePath, isNewFile)
      }

      return ran
    }

    const isEnabled = await read($, enabledAtom)
    const list = await read($, checklistAtom)
    if (isEnabled && !ALWAYS_ALLOWED.has(tool) && !list?.hasPlan && !list?.hasNativeList && !isPlanMode) {
      return {
        deny: `Call ${PLAN_TOOL} first to lay out the plan in plain English (load it with ToolSearch if it is deferred), then try again.`,
      }
    }

    if (isEnabled && list?.approval === 'waiting' && !ALWAYS_ALLOWED.has(tool)) {
      return { deny: 'The person has not approved the plan yet. Stop and wait for their reply.' }
    }

    if (tool === 'AskUserQuestion') {
      await setNeedsYou($, QUESTION)
    } else if (list?.phase === 'needsYou') {
      await setWorking($)
    }
    // What Claude is doing right now, in plain words, under the current step.
    const doing = activityOf(tool, e as unknown as { command?: unknown })
    if (doing !== null && list !== null) {
      const input = e as unknown as { description?: unknown; command?: unknown; file_path?: unknown; notebook_path?: unknown; url?: unknown }
      // Claude's own one-line description of the call, when it gave one: a fuller sentence than the label.
      const detail = typeof input.description === 'string' && input.description.trim() ? cleanName(input.description, MAX_DETAIL) : null
      const target = activityTarget(input)
      await change($, current => ({
        ...current,
        activity: {
          label: doing,
          count: current.activity?.label === doing ? current.activity.count + 1 : 1,
          detail,
          target,
        },
      }))
    }

    // Past every check above, so a refusal here never uses up the approval.
    if (isMerging) approvedSha = null
    const ran = await next(e)
    if (isMerging) noteMerge(ran)
    noteSign($)

    if (ran.deny !== undefined) {
      return ran
    }
    // The person said no at the permission dialog.
    if (ran.isError && REJECTED.test(String(ran.text ?? ''))) {
      failuresInARow = 0
      await setStuck($, DENIED)

      return ran
    }
    await noteCheck($, tool, e as unknown as { command?: unknown }, ran)
    if (ran.isError) {
      failuresInARow += 1
      if (failuresInARow >= 3) {
        await setStuck($, FAILING)
      }

      return ran
    }

    failuresInARow = 0
    await setWorking($)
    if (filePath !== '') {
      await noteFile($, filePath, isNewFile)
    }

    if (tool === 'ExitPlanMode') {
      isPlanMode = false
      isPlanApproved = true
    } else if (tool === 'TodoWrite' && call.todos) {
      const todos = call.todos
      const planned = await now($)
      await change($, current => ({
        ...current,
        hasPlan: true,
        planAt: current.planAt ?? planned,
        plannedCount: current.hasPlan ? current.plannedCount : todos.length,
        tasks: todosToTasks(todos, current.tasks),
      }))
      await holdForApproval($)
    } else if (tool === NATIVE_PLAN) {
      // Input it does not recognise changes nothing: GlanceFlow's own plan stays the way to lay one out.
      const isItems = (e as unknown as { items?: unknown }).items !== undefined
      let isAdopted = false
      const planned = await now($)
      await change($, current => {
        const tasks = nativePlan(e, current.tasks, current.isNative === true)
        // A move before any items still means the list is in use: no plan_steps, but no steps to fold yet either.
        if (tasks === null) return isNativeCall(e) ? { ...current, hasNativeList: true } : current
        isAdopted = true
        return {
          ...current,
          hasPlan: true,
          isNative: true,
          hasNativeList: true,
          planAt: current.planAt ?? planned,
          plannedCount: current.hasPlan ? current.plannedCount : tasks.length,
          tasks,
        }
      })
      if (isAdopted && isItems) await holdForApproval($)
    } else if (tool === NATIVE_WRAP_UP) {
      // The turn's close: whatever is left of Claude's own list is done. A question in its box still needs the person.
      wrapUpAsk = nativeAsk(e)
      await change($, current =>
        current.isNative ? { ...current, tasks: current.tasks.map(one => (one.status === 'done' ? one : { ...one, status: 'done' as const, percent: 100, hasReported: true })) } : current,
      )
    } else if (tool === 'TaskCreate') {
      const created = (ran.result as { task?: { id?: string } } | undefined)?.task
      const id = `task#${created?.id ?? call.tool_use_id}`
      const planned = await now($)
      await change($, current => {
        const newTask = task(cleanName(call.subject), 'upcoming', id)
        const tasks = current.hasPlan
          ? settle([...current.tasks, newTask])
          : carryTokens(current.tasks, settle([newTask]))
        // Tasks created before any is finished are the first plan, not growth.
        const isFirstPlan = !tasks.some(one => one.status === 'done')

        return {
          ...current,
          hasPlan: true,
          planAt: current.planAt ?? planned,
          plannedCount: isFirstPlan ? tasks.length : current.plannedCount,
          tasks,
        }
      })
      await holdForApproval($)
    } else if (tool === 'TaskUpdate') {
      const id = `task#${call.taskId}`
      const status = call.status
      await change($, current => ({
        ...current,
        tasks: settle(
          current.tasks.flatMap(one => {
            if (one.id !== id) {
              return [one]
            }
            if (status === 'deleted') {
              return []
            }
            const name = call.subject ? cleanName(call.subject) : one.name
            if (status === 'completed') {
              return [{ ...one, name, status: 'done' as const, percent: 100, hasReported: true }]
            }
            if (status === 'in_progress') {
              return [{ ...one, name, status: 'active' as const }]
            }
            return [{ ...one, name, status: status === 'pending' ? ('upcoming' as const) : one.status }]
          }),
        ),
      }))
    }

    return ran
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    isPlanMode = e.permission_mode === 'plan'
    isPlanApproved = false

    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    const kind = String(e.notification_type ?? '')
    if (/permission/i.test(kind)) {
      // What the waiting call asks, in plain words, beside Claude Code's own dialog with the raw command.
      await setNeedsYou($, permissionWords((await read($, checklistAtom))?.activity ?? null) ?? PERMISSION)
    } else if (/elicitation|question/i.test(kind)) {
      await setNeedsYou($, QUESTION)
    }

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    await setStuck($, apiErrorSentence(String(e.error), e.error_details ?? ''))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await finishHelper($, e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      return next(e)
    }
    const finished = await now($)
    if (isStalled) {
      isStalled = false
      await setWorking($)
    }
    const list = await read($, checklistAtom)
    runningTurn = undefined
    const wrappedAsk = wrapUpAsk
    wrapUpAsk = null
    const wasPaused = isPausing
    isPausing = false
    // Ship it's merge request: the exact head commit asked about stays pending until the person replies, and an
    // approval lasts only for the turn it started. A declining turn ends Ship it, even if Claude asks again in it;
    // Esc ends it too, Pause does not.
    const asked = isShipping && e.reason === 'answer' ? askedMergeSha(e.answer ?? '') : null
    if (asked !== null) askedSha = asked
    approvedSha = null
    if (isDeclining || (e.reason === 'aborted' && !wasPaused)) endShipping()
    isDeclining = false

    if (list !== null) {
      await change($, current => (current.activity === null ? current : { ...current, activity: null }))
      if (wasPaused) {
        await change($, current => ({
          ...current,
          phase: 'stopped',
          stopKind: 'pause',
          needsYouReason: null,
          finishedAt: finished,
        }))
      } else if (e.reason === 'error') {
        // StopFailure may already have named the cause; keep its sentence.
        if (list.phase !== 'stuck') {
          await setStuck($, apiErrorSentence('unknown'))
        }
      } else if (e.reason === 'refusal') {
        await setStuck($, "Claude couldn't help with that request")
      } else if (list.phase === 'stuck' && list.stuckReason === DENIED) {
        // Keep the explanation of why Claude paused.
      } else if (e.reason === 'aborted') {
        await change($, current => ({ ...current, phase: 'stopped', stopKind: 'esc', needsYouReason: null, finishedAt: finished }))
      } else if (list.hasPlan && hasUnfinishedWork(list.tasks)) {
        // A helper still running means Claude waits for it, not for the person.
        const asked = wrappedAsk ?? questionOf(e.answer ?? '')
        await change($, current =>
          isBusy(current)
            ? current
            : { ...current, phase: 'needsYou', needsYouReason: current.approval === 'waiting' ? APPROVE : WAITING, question: asked },
        )
      } else {
        await change($, current => ({
          ...current,
          // A quick answer needed no plan: one plain step instead of the placeholders.
          tasks: current.hasPlan ? current.tasks : carryTokens(current.tasks, [task(tr('Answer your question'), 'done')]),
        }))
        // A finished job whose last message asks something, or asks to approve a merge, still waits for the person.
        const asked = askedSha !== null ? tr('Reply exactly: Approve merge {0}', askedSha) : (wrappedAsk ?? questionOf(e.answer ?? ''))
        const isAsking = askedSha !== null || wrappedAsk !== null || asksQuestion(e.answer ?? '')
        await change($, current => ({
          ...current,
          phase: isAsking ? 'needsYou' : 'done',
          needsYouReason: isAsking ? QUESTION : null,
          question: asked,
          stuckReason: null,
          finishedAt: finished,
          tasks: current.tasks.map(one => ({ ...one, status: 'done' as const, percent: 100, hasReported: true })),
        }))
        // Helpers or background tasks still running keep the job open.
        await settleFinished($, finished, true)
      }
      await recordJob($)
    }

    return next(e)
  })

  // Simple hides the tool rows; Details keeps them, for people who want the code next to the checklist.
  on('ui.render', { component: ['ToolUse', 'ToolResult', 'ToolGroup'] }, async ($, e, next) => {
    if (!(await read($, enabledAtom)) || (await read($, detailAtom)) === 'detailed') {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabledAtom)) && (await read($, detailAtom)) !== 'detailed'
      ? next({ ...e, props: { ...e.props, hint: '' } })
      : next(e),
  )

  // The day's history of this project, for a retro.
  // Every choice in one place. Each group shows what is picked on its right, and a line on what that choice does.
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const kit = kitOf(table, e.surface)
    const vector = kit.isVector
    const isEnabled = await read($, enabledAtom)
    const view = !isEnabled ? 'off' : await read($, detailAtom)
    const sound = await read($, soundAtom)
    const isCalm = await read($, calmAtom)
    const language = await read($, languageAtom)
    const isNoticing = await read($, noticeAtom)
    const showsOthers = await read($, showsOthersAtom)
    const isGuarded = await read($, guardAtom)
    const approves = await read($, approveAtom)
    const ships = await read($, shipOnGithubAtom)
    const tidyAt = await read($, tidyAtAtom)
    const checkpointAt = await read($, checkpointAtom)
    const usage = await read($, usageAtom)
    const version = await readVersion($)
    const found = await read($, updateAtom)
    const columns = Math.max(30, e.props.bodyColumns)
    const rule = '─'.repeat(Math.min(columns, 64))

    // A choice: elsewhere than the terminal the app's own menu, which says what is picked and lists the rest, so no
    // filled button can read as "press me". The terminal draws buttons and marks the picked one ●.
    const Select = vector && 'Select' in table ? table.Select : undefined
    const choice = <T extends string | number>(key: string, options: [T, string][], picked: T, onPick: (value: T) => Promise<void>) =>
      Select ? (
        <Box key={`${key}-choices`} flexDirection="row">
          <Select
            key={`${key}-menu`}
            value={String(picked)}
            options={options.map(([value, label]) => ({ value: String(value), label }))}
            onSelect={value => {
              const found = options.find(([option]) => String(option) === value)
              if (found) void onPick(found[0])
            }}
          />
        </Box>
      ) : (
      <Box key={`${key}-choices`} flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
        {options.map(([value, label]) => (
          <Button
            key={`${key}-${value}`}
            label={vector ? label : value === picked ? `● ${label}` : `○ ${label}`}
            variant={value === picked ? 'primary' : 'secondary'}
            onPress={() => onPick(value)}
          />
        ))}
      </Box>
    )
    // A group: its icon and title, the choice, a line on what the choice does. On the terminal the title row also
    // says what is picked, on its right.
    const group = (key: string, icon: IconName, title: string, picked: string, control: RenderChildren, help: string, extra?: RenderChildren) =>
      vector ? (
        // A settings row as the Mac draws one: the name on the left, its menu on the right, what it does below.
        // Its mark says Setting: the name follows in bold, so a screen reader hears it once.
        <Box key={key} flexDirection="row" gap={1} marginTop={2} width={columns}>
          {kit.icon(icon, 'quiet', tr('Setting'))}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} gap={Select ? 0 : 1}>
            <Box flexDirection={Select ? 'row' : 'column'} alignItems={Select ? 'center' : undefined} justifyContent="space-between" columnGap={2} rowGap={1}>
              <Text bold>{title}</Text>
              {control}
            </Box>
            <Box marginTop={Select ? 1 : 0}>
              <Text dimColor wrap="wrap">
                {help}
              </Text>
            </Box>
            {extra}
          </Box>
        </Box>
      ) : (
        <Box key={key} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" width={Math.min(columns, 64)}>
            <Text bold>{title}</Text>
            <Text color="cyan">{picked}</Text>
          </Box>
          {control}
          <Text dimColor wrap="wrap">
            {help}
          </Text>
          {extra}
        </Box>
      )

    const viewHelp = {
      simple: tr('The steps and progress in plain words, with tool details out of the way. For everyone.'),
      detailed: tr('Also time, models and tokens per step, with the code in view. For engineers.'),
      off: tr('Claude Code as usual: no checklist, every tool row shown. The password guard keeps its own setting.'),
    }[view]
    const soundHelp = {
      off: tr('No sounds. Turn them on to look away while Claude works.'),
      chime: tr('A short chime when Claude needs you, gets stuck, or finishes a job that took over a minute.'),
      voice: tr('The chime, and a few words like "Claude needs you".'),
    }[sound]
    const chatFull = usage.contextPercent === null ? null : Math.round(usage.contextPercent)
    const updateCommand = `claude plugin update ${found.id ?? `${PLUGIN}@claude-mods`}`
    const latest = found.latest ?? ''
    const updateHelp = {
      idle: tr('Checking fetches the newest GlanceFlow from the marketplace you installed it from.'),
      checking: tr('Checking for a newer version…'),
      latest: tr('You have the newest version.'),
      available: tr('GlanceFlow {0} is out. Update installs it; a new chat then uses it.', latest),
      updating: tr('Installing GlanceFlow {0}…', latest),
      updated: tr('GlanceFlow {0} is installed. Open a new chat to use it.', latest),
      folder: tr('This copy runs from a folder, not a marketplace, so it updates where it lives (with git pull, say).'),
      failed: tr("Couldn't check or update from here. In a terminal, run: {0}", updateCommand),
    }[found.state]
    const updateButton =
      found.state === 'available' ? (
        <Button key="update" label={tr('Update to {0}', latest)} variant="primary" onPress={() => installUpdate($)} />
      ) : found.state === 'idle' || found.state === 'latest' || found.state === 'failed' ? (
        <Button key="update" label={found.state === 'idle' ? tr('Check for updates') : tr('Check again')} onPress={() => checkForUpdate($)} />
      ) : null
    const tidyHelp =
      tidyAt === 0
        ? tr('GlanceFlow never offers to tidy up. Claude Code still compacts on its own when the chat is full.')
        : tr('At {0}% full, the checklist offers to tidy up. Claude first saves a checkpoint of the work (goal, what is done and left, decisions, the next step), so nothing important is lost when the chat is compacted.', tidyAt)

    return (
      <Box flexDirection="column" width={columns}>
        {vector ? (
          // The app titles the panel; the body starts with how changes behave.
          <Text dimColor wrap="wrap">
            {tr('Changes apply right away and stay for your next chats.')}
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text bold>{`⚙ ${tr('GlanceFlow settings')}`}</Text>
            <Text dimColor wrap="wrap">
              {tr('Changes apply right away and stay for your next chats.')}
            </Text>
            <Text dimColor>{rule}</Text>
          </Box>
        )}
        {group(
          'view',
          'eye',
          tr('View'),
          view === 'simple' ? tr('Simple') : view === 'detailed' ? (vector ? tr('Detailed') : tr('Details')) : tr('Off'),
          choice('view', vector ? [['detailed', tr('Detailed')], ['simple', tr('Simple')], ['off', tr('Off')]] : [['simple', tr('Simple')], ['detailed', tr('Details')], ['off', tr('Off')]], view, value => setView($, value)),
          viewHelp,
        )}
        {group(
          'sound',
          'sound',
          tr('Sounds'),
          sound === 'off' ? tr('Off') : sound === 'chime' ? tr('Chime') : tr('Chime and voice'),
          choice('sound', [['off', tr('Off')], ['chime', tr('Chime')], ['voice', tr('Chime and voice')]], sound, value => setSound($, value)),
          soundHelp,
          sound === 'off' ? undefined : (
            <Box key="sound-test" marginTop={vector ? 1 : 0}>
              <Button key="sound-test" label={vector ? tr('Play it') : `▶ ${tr('Play it')}`} onPress={() => alertSample($, sound)} />
            </Box>
          ),
        )}
        {group(
          'notice',
          'bell',
          tr('Desktop notices'),
          isNoticing ? tr('On') : tr('Off'),
          choice('notice', [['off', tr('Off')], ['on', tr('On')]], isNoticing ? 'on' : 'off', value => setNotice($, value === 'on')),
          isNoticing
            ? tr('A notice when Claude needs you, gets stuck, or finishes a job that took over a minute: on your computer, and through your Claude Code Notification hooks, such as one that reaches your phone.')
            : tr('Turn on to get a notice on your computer, even while you work in another app, or on your phone through your Claude Code Notification hooks.'),
        )}
        {group(
          'others',
          'eye',
          tr('Other chats'),
          showsOthers ? tr('On') : tr('Off'),
          choice('others', [['off', tr('Off')], ['on', tr('On')]], showsOthers ? 'on' : 'off', value => setOthers($, value === 'on')),
          showsOthers
            ? tr('The band names another chat on this computer that needs you, from any project. Turn off before you share your screen.')
            : tr('Turn on to see when another chat on this computer needs you.'),
        )}
        {group(
          'language',
          'globe',
          tr('Language'),
          language === 'el' ? 'Ελληνικά' : 'English',
          choice('language', [['en', 'English'], ['el', 'Ελληνικά']], language, value => setLanguage($, value as Lang)),
          tr("GlanceFlow's own words, and the steps Claude writes on the checklist."),
        )}
        {group(
          'calm',
          'moon',
          tr('Calm mode'),
          isCalm ? tr('On') : tr('Off'),
          choice('calm', [['off', tr('Off')], ['on', tr('On')]], isCalm ? 'on' : 'off', value => setCalm($, value === 'on')),
          isCalm ? tr('Nothing on screen moves, and statuses read in bold.') : tr('Bars and spinners move while Claude works. Turn on for a still screen.'),
        )}
        {group(
          'approve',
          'approve',
          tr('Approve the plan first'),
          approves ? tr('On') : tr('Off'),
          choice('approve', [['off', tr('Off')], ['on', tr('On')]], approves ? 'on' : 'off', value => setApprove($, value === 'on')),
          approves
            ? tr('Claude shows its plan and waits. Press {0}, or tell Claude what to change.', vector ? tr('Start') : `▶ ${tr('Start')}`)
            : tr('Claude starts right after laying out its plan.'),
        )}
        {group(
          'ship',
          'ship',
          tr('Finish on GitHub'),
          ships ? tr('On') : tr('Off'),
          choice('ship', [['off', tr('Off')], ['on', tr('On')]], ships ? 'on' : 'off', value => setShipOnGithub($, value === 'on')),
          ships
            ? tr('A finished job offers Ship it: Claude tidies the changes, opens a pull request and merges once you approve.')
            : tr('Finished jobs stay on their branch. Turn on for a Ship it button in GitHub projects.'),
        )}
        {group(
          'guard',
          'lock',
          tr('Password guard'),
          isGuarded ? tr('On') : tr('Off'),
          choice('guard', [['off', tr('Off')], ['on', tr('On')]], isGuarded ? 'on' : 'off', value => setGuard($, value === 'on')),
          isGuarded
            ? tr('A message that looks like it has a password or key in it is held back. Press Enter again to send it anyway.')
            : tr('Every message is sent as you write it. Keys and emails are still masked on screen.'),
        )}
        {group(
          'tidy',
          'tidy',
          tr('Tidy up the chat'),
          tidyAt === 0 ? tr('Never') : tr('At {0}% full', tidyAt),
          choice(
            'tidy',
            TIDY_CHOICES.map(value => [value, value === 0 ? tr('Never') : `${value}%`] as [number, string]),
            tidyAt,
            value => setTidyAt($, value),
          ),
          tidyHelp,
          <Box key="tidy-now" flexDirection="column" gap={vector ? 1 : 0} marginTop={vector ? 1 : 0}>
            {(chatFull !== null || checkpointAt !== null) && (
              <Text dimColor wrap="wrap">
                {[
                  chatFull === null ? '' : tr('This chat is {0}% full.', chatFull),
                  checkpointAt === null ? '' : tr('Last checkpoint saved at {0}.', clockTime(checkpointAt)),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Text>
            )}
            <Box flexDirection="row" gap={1}>
              <Button key="tidy-now" label={tr('Tidy up now')} onPress={() => tidyUp($)} />
              {checkpointAt !== null && <Button key="recap" label={tr('Where we left off')} onPress={() => showRecap($)} />}
            </Box>
          </Box>,
        )}
        {group(
          'version',
          'spark',
          tr('Version'),
          version ?? '',
          updateButton ?? <Box key="update-none" />,
          version === null ? updateHelp : `GlanceFlow ${version}. ${updateHelp}`,
        )}
        {!vector && <Text dimColor>{rule}</Text>}
        <Box key="actions" flexDirection="row" gap={1} marginTop={vector ? 2 : 0} justifyContent={vector ? 'flex-end' : undefined} width={vector ? columns : undefined}>
          {/* Changes apply as they are made, and the app draws the panel's close control: no Done needed there. */}
          {!vector && <Button key="close" label={tr('Done')} variant="primary" role="dismiss" onPress={() => $.ui.close({ id: SETTINGS_PANE })} />}
          <Button key="reset" label={tr('Reset to defaults')} onPress={() => resetSettings($)} />
        </Box>
      </Box>
    )
  })

  // The checkpoint Claude saved before the chat was tidied up, in its own words.
  on('ui.render', { component: 'Pane', requestId: RECAP_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    const kit = kitOf(table, e.surface)
    const vector = kit.isVector
    const note = await checkpointOf($).catch(() => null)
    const at = await read($, checkpointAtom)
    const columns = Math.max(30, e.props.bodyColumns)
    // The app draws a panel's own close control; the terminal's panel needs the button.
    const close = vector ? null : <Button key="close" label={tr('Close')} role="dismiss" onPress={() => $.ui.close({ id: RECAP_PANE })} />
    // A line with the checkpoint's mark on vector surfaces; plain dim text on the terminal.
    const lead = (words: string) =>
      vector ? (
        <Box key="lead" flexDirection="row" gap={1} width={columns}>
          {kit.icon('bookmark', 'quiet', NOTICE())}
          <Box flexShrink={1}>
            <Text dimColor wrap="wrap">
              {words}
            </Text>
          </Box>
        </Box>
      ) : (
        <Text key="lead" dimColor wrap="wrap">
          {words}
        </Text>
      )
    if (note === null) {
      return (
        <Box flexDirection="column" width={columns}>
          {lead(tr('No checkpoint in this chat yet. When Claude tidies the chat up, it saves one first, and it shows here.'))}
          {close && (
            <Box key="actions" flexDirection="row">
              {close}
            </Box>
          )}
        </Box>
      )
    }
    // Claude's own words, as it keeps them; personal details masked and times in the person's own time.
    const text = localTimes(maskPrivate(note.replace(/^Checkpoint:\s*/, '')))

    return (
      <Box flexDirection="column" width={columns}>
        {lead(
          at === null
            ? tr('Saved before the chat was tidied up. Claude keeps reading it for the rest of this chat.')
            : tr('Saved at {0}, before the chat was tidied up. Claude keeps reading it for the rest of this chat.', clockTime(at)),
        )}
        <Box key="note" flexDirection="column" marginTop={1}>
          {vector ? (
            // Claude writes the checkpoint in markdown: headings and lists read as they would in a reply.
            <Markdown key="note-text" text={text.slice(0, 10_000)} />
          ) : (
            text.split('\n').map((line, index) => (
              <Text key={`line-${index}`} wrap="wrap">
                {line || ' '}
              </Text>
            ))
          )}
        </Box>
        {close && (
          <Box key="actions" flexDirection="row" marginTop={1}>
            {close}
          </Box>
        )}
      </Box>
    )
  })

  // The whole plan beside the chat, with what the band above the prompt has no room for: when the job started and
  // should end, every step's summary and time (or expected time), all helpers, and in Details the tokens and cost.
  on('ui.render', { component: 'Pane', requestId: PLAN_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const kit = kitOf(table, e.surface)
    const vector = kit.isVector
    const list = await read($, checklistAtom)
    const tick = await read($, tickAtom)
    const isDetailed = (await read($, detailAtom)) === 'detailed'
    const isCalm = await read($, calmAtom)
    const columns = Math.max(40, e.props.bodyColumns)
    const actions = (
      <Box key="actions" flexDirection="row" gap={1} marginTop={vector ? 2 : 1}>
        {/* The app draws a panel's own close control; the terminal's panel needs the button. */}
        {!vector && <Button key="close" label={tr('Close')} role="dismiss" onPress={() => $.ui.close({ id: PLAN_PANE })} />}
        <Button key="history" label={tr('History')} onPress={async () => showHistory($, dayKey(await now($)), true)} />
      </Box>
    )
    if (list === null || !list.hasPlan) {
      const words = tr('No plan yet. Ask Claude for something and its plan shows here.')
      return (
        <Box flexDirection="column">
          {vector ? (
            <Box flexDirection="row" gap={1}>
              {kit.icon('plan', 'quiet', NOTICE())}
              <Text dimColor wrap="wrap">
                {words}
              </Text>
            </Box>
          ) : (
            <Text dimColor>{words}</Text>
          )}
          {actions}
        </Box>
      )
    }

    const at = list.finishedAt ?? (await now($))
    const active = list.tasks.find(one => one.status === 'active')
    // The same percentage as the band in this view: Details fills the current step from its time estimate.
    const activePercent = active ? stepEstimate(list, active, at).percent : undefined
    const { percent, doneCount } = overallProgress(list.tasks, activePercent)
    const left = list.phase === 'done' ? null : timeLeft(list, at, activePercent)
    const when =
      list.phase === 'done'
        ? [tr('Started {0}', clockTime(list.startedAt)), tr('finished {0}', clockTime(at)), tr('took {0}', (vector ? durationWords : formatDuration)(at - list.startedAt))].join(' · ')
        : [
            tr('Started {0}', clockTime(list.startedAt)),
            // Where the band above already counts the time and what is left, the panel says when it should end.
            vector ? '' : tr('{0} so far', formatDuration(at - list.startedAt)),
            left === null ? '' : vector ? tr('done around {0}', clockTime(at + left)) : tr('about {0} left, done around {1}', formatLeft(left), clockTime(at + left)),
          ]
            .filter(Boolean)
            .join(' · ')
    const grew = list.plannedCount > 0 && list.tasks.length > list.plannedCount ? ` · ${tr('plan grew {0} → {1}', list.plannedCount, list.tasks.length)}` : ''
    const status =
      list.phase === 'needsYou'
        ? { color: 'yellow', tone: 'warn' as const, icon: 'bell' as const, lead: 'Needs you', text: needsText(list) ?? tr(WAITING) }
        : list.phase === 'stuck'
          ? { color: 'yellow', tone: 'alert' as const, icon: 'bang' as const, lead: 'Stuck', text: list.stuckReason ? tr(list.stuckReason) : tr("Claude can't go on right now") }
          : list.phase === 'stopped'
            ? list.stopKind === 'pause'
              ? { color: undefined, tone: 'quiet' as const, icon: 'pause' as const, lead: 'Paused', text: tr('press Continue to pick up') }
              : { color: undefined, tone: 'quiet' as const, icon: 'stop' as const, lead: 'Stopped', text: tr('you pressed Esc') }
            : list.phase === 'background'
              ? { color: 'cyan', tone: 'active' as const, icon: 'clock' as const, lead: 'Claude answered', text: tr('helpers still run in the background') }
              : null

    // One row per step: mark, name, then its time. On the terminal the time column lines up by cells; elsewhere the
    // name takes the room and the time keeps to the right edge.
    const nameWidth = Math.max(12, Math.min(MAX_NAME, columns - 24))
    type Mark = { glyph: RenderChildren; icon: RenderChildren }
    // A name or time too long for its column goes on lines of its own, in full, instead of being cut.
    const row = (key: string, mark: Mark, name: string, look: { bold?: boolean; dim?: boolean }, time: string, timeIsDim = true) =>
      vector ? (
        <Box key={key} flexDirection="row" gap={1} width={columns}>
          {mark.icon}
          <Box flexGrow={1} flexShrink={1}>
            <Text bold={look.bold} dimColor={look.dim} wrap="wrap">
              {name}
            </Text>
          </Box>
          {time !== '' && (
            <Box flexShrink={0}>
              <Text dimColor={timeIsDim}>{time}</Text>
            </Box>
          )}
        </Box>
      ) : widthOf(name) <= nameWidth && widthOf(time) < columns - 3 - nameWidth ? (
        <Box key={key} flexDirection="row">
          {mark.glyph}
          <Text bold={look.bold} dimColor={look.dim}>
            {fit(name, nameWidth)}
          </Text>
          <Text dimColor={timeIsDim}>{` ${time}`}</Text>
        </Box>
      ) : (
        <Box key={key} flexDirection="column">
          <Box flexDirection="row">
            {mark.glyph}
            <Box flexShrink={1}>
              <Text bold={look.bold} dimColor={look.dim} wrap="wrap">
                {name}
              </Text>
            </Box>
          </Box>
          {time !== '' && (
            <Text dimColor={timeIsDim} wrap="wrap">
              {`  ${time}`}
            </Text>
          )}
        </Box>
      )
    // A line under a step, in line with its name. A command keeps to one line, cut at the edge.
    const note = (key: string, text: string, icon?: RenderChildren, isOneLine = false) =>
      vector ? (
        <Box key={key} flexDirection="row" gap={1} width={columns}>
          {kit.blank()}
          {icon}
          <Box flexShrink={1} minWidth={0}>
            <Text dimColor wrap={isOneLine ? 'truncate-end' : 'wrap'}>
              {text}
            </Text>
          </Box>
        </Box>
      ) : (
        <Text key={key} dimColor wrap="wrap">
          {`    ${text}`}
        </Text>
      )
    const helperRows = (one: GlanceTask) =>
      list.helpers
        .filter(helper => helper.stepId === one.id)
        .map(helper => {
          const mark = helper.status === 'running' ? '◐' : helper.status === 'failed' ? '✗' : '✓'
          const kind = helper.kind === 'background' ? tr('in the background') : helper.type === 'general-purpose' ? tr('helper') : helper.type
          const details = [kind, helper.model, isDetailed && helper.effort ? tr('{0} effort', helper.effort) : null, isDetailed && helper.tokens > 0 ? tr('{0} tokens', formatTokens(helper.tokens)) : null]
            .filter(Boolean)
            .join(' · ')
          const words = `${helper.label}${details ? ` · ${details}` : ''}`
          const line = vector
            ? note(
                `helper-${helper.id}`,
                words,
                helper.status === 'running'
                  ? kit.ring(null, isCalm ? 0 : tick, tr('Running'), 13)
                  : helper.status === 'failed'
                    ? kit.badge('close', 'alert', tr('Failed'), 13)
                    : kit.badge('check', 'ok', tr('Done'), 13),
              )
            : note(`helper-${helper.id}`, `↳ ${mark} ${words}`)
          // A helper's own transcript opens in the main view; one working in the background can be stopped alone
          // (any other stops with Esc, with Claude).
          const canOpen = helper.kind === 'helper'
          const canStop = helper.status === 'running' && (helper.kind === 'background' || helper.isBackground === true)
          if (!canOpen && !canStop) return line
          return (
            <Box key={`helper-${helper.id}-row`} flexDirection="column">
              {line}
              <Box flexDirection="row" gap={1} marginLeft={vector ? 3 : 4}>
                {canOpen && <Button key={`open-${helper.id}`} label={tr('Open')} onPress={() => openHelper($, helper.id)} />}
                {canStop && <Button key={`stop-${helper.id}`} label={tr('Stop')} onPress={() => stopHelper($, helper)} />}
              </Box>
            </Box>
          )
        })
    const tokensOf = (one: GlanceTask) => (isDetailed ? tokenNote(one.tokens, one.cachedTokens) : '')
    const filesOf = (key: string, one: GlanceTask, isSoFar = false) =>
      one.files?.length
        ? [note(`${key}-files`, isSoFar ? tr('{0} so far', filesNote(one.files)) : filesNote(one.files), vector ? kit.icon('file', 'quiet', tr('Files'), 13) : undefined)]
        : []

    const done: RenderChildren[] = []
    const now_: RenderChildren[] = []
    const next_: RenderChildren[] = []
    list.tasks.forEach((one, index) => {
      const key = `step-${index}`
      if (one.status === 'done') {
        const ms = one.startedAt !== null && one.finishedAt !== null ? one.finishedAt - one.startedAt : null
        // Under the Done heading a time says how long it took; the terminal, with no heading in the column, says so.
        const took = ms === null ? (vector ? '' : tr('done')) : vector ? (ms < 1000 ? '' : durationWords(ms)) : tr('took {0}', formatDuration(ms))
        done.push(
          row(key, { glyph: <Text color="green">✓ </Text>, icon: kit.icon('done', 'ok', tr('Done')) }, one.name, {}, [took, one.check ? tr(CHECK_WORDS[one.check]) : '', tokensOf(one)].filter(Boolean).join(' · ')),
          ...(one.summary ? [note(`${key}-summary`, one.summary)] : []),
          ...filesOf(key, one),
          ...helperRows(one),
        )
      } else if (one.status === 'active') {
        const estimate = stepEstimate(list, one, at)
        const time = [isDetailed && !vector ? `${estimate.percent}%` : '', (vector ? durationWords : formatDuration)(estimate.elapsedMs), leftLabel(estimate.leftMs, vector)]
          .filter(Boolean)
          .join(' · ')
        const waits = status !== null && status.tone !== 'active'
        now_.push(
          row(
            key,
            {
              glyph: <Text color="cyan">▶ </Text>,
              icon: waits ? kit.badge(status.icon, status.tone, tr(status.lead)) : kit.badge('play', 'active', tr('Now')),
            },
            one.name,
            { bold: true },
            time,
            false,
          ),
          // The Plan says more than the band: Claude's own words for what it is doing, and in Details what it runs.
          ...(list.phase === 'working' && list.activity !== null
            ? [
                note(
                  `${key}-activity`,
                  ((doing: string) => (vector ? doing : tr('Now: {0}', doing)))(
                    `${list.activity.detail ?? tr(list.activity.label)}${list.activity.count > 1 ? ` ${tr('({0}, {1} in a row)', tr(list.activity.label).toLowerCase(), list.activity.count)}` : ''}`,
                  ),
                ),
                ...(isDetailed && list.activity.target && !(vector && one.files?.some(file => file.path.split('/').pop() === list.activity!.target))
                  ? [note(`${key}-target`, vector ? list.activity.target : `↳ ${list.activity.target}`, vector ? kit.icon('sub', 'quiet', tr('Runs'), 13) : undefined, true)]
                  : []),
              ]
            : []),
          ...(tokensOf(one) ? [note(`${key}-tokens`, tr('{0} so far', tokensOf(one)))] : []),
          ...filesOf(key, one, true),
          ...helperRows(one),
        )
      } else {
        const { expectedMs: expected } = stepEstimate(list, one, at)
        next_.push(
          row(key, { glyph: <Text dimColor>○ </Text>, icon: kit.open(tr('To do')) }, one.name, { dim: true }, expected < 60_000 ? tr('under a minute') : tr('about {0}', formatLeft(expected))),
          ...helperRows(one),
        )
      }
    })
    const section = (key: string, label: string, rows: RenderChildren[]) =>
      rows.length === 0 ? null : (
        <Box key={key} flexDirection="column" marginTop={1}>
          {/* Elsewhere than the terminal the section heads the rows under it at full strength, as a heading should. */}
          <Text bold dimColor={!vector}>
            {label}
          </Text>
          {rows}
        </Box>
      )

    const footer: string[] = []
    const running = list.helpers.filter(one => one.status === 'running').length
    // Elsewhere than the terminal each helper's own row says it; the count would repeat them.
    if (list.helpers.length > 0 && !vector) {
      const finished = list.helpers.length - running
      footer.push(tr('Helpers: {0}', [running > 0 ? tr('{0} working', running) : '', finished > 0 ? tr('{0} finished', finished) : ''].filter(Boolean).join(', ')))
    }
    if (left !== null && list.paceMs !== null && doneCount < 2) {
      footer.push(tr('Time left is based on how long steps took in this project before.'))
    }
    if (isDetailed) {
      const usage = await read($, usageAtom)
      const tokens = list.tasks.reduce((sum, one) => sum + one.tokens, list.extraTokens)
      const cached = list.tasks.reduce((sum, one) => sum + one.cachedTokens, list.extraCachedTokens)
      const spent = jobCost(list, usage)
      const job = [tokenNote(tokens, cached), spent === null ? '' : formatCost(spent)].filter(Boolean).join(' · ')
      if (job) footer.push(tr('This job: {0}', job))
      const plan = [
        ...usage.limits.map(one => tr('{0} {1}%', tr(one.label), Math.round(one.percent))),
        usage.contextPercent === null ? '' : tr('chat {0}% full', Math.round(usage.contextPercent)),
      ].filter(Boolean)
      // Elsewhere than the terminal "Plan" is a button: the line says Usage, as the band does.
      if (plan.length > 0) footer.push(vector ? tr('Usage: {0}', plan.join(' · ')) : tr('Plan usage: {0}', plan.join(' · ')))
    }

    const isDone = list.phase === 'done'
    // Elsewhere than the terminal the bar shows the percentage, which weighs steps by size: the words just count them.
    const summary = `${vector ? '' : `${percent}% · `}${tr('{0} of {1} steps done', doneCount, list.tasks.length)}${grew}`
    const cells = Math.round(percent / 5)
    return (
      <Box flexDirection="column" width={columns}>
        <Text bold wrap="wrap">
          {list.title}
        </Text>
        <Text dimColor wrap="wrap">
          {when}
        </Text>
        {list.goal && (
          <Text key="goal" wrap="wrap">
            {tr('Goal: {0}', list.goal)}
          </Text>
        )}
        {list.doneWhen && (
          <Text key="done-when" wrap="wrap">
            {tr('Done when: {0}', list.doneWhen)}
          </Text>
        )}
        {(
          [
            ['for-you', tr('For you'), list.forYou ?? []],
            ['decided', tr('Decided on its own'), list.decided ?? []],
          ] as [string, string, string[]][]
        ).map(([key, heading, items]) =>
          items.length === 0 ? null : (
            <Box key={key} flexDirection="column" marginTop={1}>
              <Text bold>{heading}</Text>
              {items.map((one, at) => (
                <Text key={`${key}-${at}`} wrap="wrap">{`• ${one}`}</Text>
              ))}
            </Box>
          ),
        )}
        {vector ? (
          <Box key="progress" flexDirection="row" alignItems="center" gap={1} marginTop={1}>
            <Box flexShrink={0}>{kit.meter(isDone ? 'ok' : 'active', percent, 0, tr('{0}% done', percent), 160)}</Box>
            <Text>{summary}</Text>
          </Box>
        ) : (
          <Box key="progress" flexDirection="row">
            <Text color={isDone ? 'green' : 'cyan'}>{'█'.repeat(cells) + '░'.repeat(20 - cells)}</Text>
            <Text>{` ${summary}`}</Text>
          </Box>
        )}
        {status &&
          (vector ? (
            <Box key="status" flexDirection="row" gap={1} marginTop={1}>
              {status.tone === 'active' ? kit.icon(status.icon, status.tone, STATUS()) : kit.badge(status.icon, status.tone, STATUS())}
              <Box flexShrink={1}>
                <Text wrap="wrap">
                  <Text bold>
                    {tr(status.lead)}
                  </Text>
                  <Text>{` · ${status.text}`}</Text>
                </Text>
              </Box>
            </Box>
          ) : (
            <Text key="status" color={status.color} bold wrap="wrap">
              {status.lead === 'Claude answered' ? `${tr(status.lead)}; ${status.text}` : `${tr(status.lead)}: ${status.text}`}
            </Text>
          ))}
        {section('done', tr('Done'), done)}
        {section('now', tr('Now'), now_)}
        {section('next', tr('Next'), next_)}
        {footer.length > 0 && (
          <Box key="footer" flexDirection="column" marginTop={1}>
            {footer.map((line, index) => (
              <Text key={`footer-${index}`} dimColor wrap="wrap">
                {line}
              </Text>
            ))}
          </Box>
        )}
        {actions}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const kit = kitOf(table, e.surface)
    const vector = kit.isVector
    const view = await read($, historyAtom)
    const columns = Math.max(30, e.props.bodyColumns)
    const today = dayKey(await now($))
    // The app draws a panel's own close control; the terminal's panel needs the button.
    const close = vector ? null : <Button key="close" label={tr('Close')} role="dismiss" onPress={() => $.ui.close({ id: HISTORY_PANE })} />
    if (view === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{tr("Type /glanceflow history to see today's tasks.")}</Text>
          {close}
        </Box>
      )
    }

    // Day picker: earlier, a drop-down of saved days, later, and today.
    const dayLabel = (day: string) => (vector ? (day === today ? tr('Today · {0}', longDay(day)) : longDay(day)) : day === today ? tr('Today, {0}', day) : day)
    const picker = (
      <Box key="picker" flexDirection="column" marginBottom={1}>
        {/* The app titles the panel "History · <folder>"; the terminal's panel shows the day here too. */}
        {!vector && (
          <Text key="heading" bold wrap="truncate-end">
            {`${projectName(view.project)} · ${longDay(view.day)}`}
          </Text>
        )}
        <Box key="controls" flexDirection="row" gap={1} alignItems={vector ? 'center' : undefined}>
          <Button key="earlier" label={vector ? tr('Previous day') : `◀ ${tr('Earlier')}`} onPress={() => showHistory($, shiftDay(view.day, -1), false)} />
          {'Select' in table && table.Select ? (
            <table.Select
              key="day"
              // The terminal's Select draws "label: value" itself, so the label carries no colon. The desktop's value
              // already starts with the day ("Today · …"): a label there would stutter.
              label={vector ? undefined : tr('Day')}
              value={view.day}
              options={view.days.map(day => ({ value: day, label: dayLabel(day) }))}
              onSelect={day => void showHistory($, day, false)}
            />
          ) : (
            <Text bold>{dayLabel(view.day)}</Text>
          )}
          {view.day < today && (
            <Button key="later" label={vector ? tr('Next day') : `${tr('Later')} ▶`} onPress={() => showHistory($, shiftDay(view.day, 1), false)} />
          )}
          {view.day !== today && <Button key="today" label={tr('Today')} onPress={() => showHistory($, today, false)} />}
        </Box>
      </Box>
    )

    const report = reportOf(view)
    if (view.isReportShown) {
      const copy = <Button key="copy" variant="primary" label={tr('Copy report')} onPress={() => showReport($, true, report, e.surface)} />
      return (
        <Box flexDirection="column" width={columns}>
          {picker}
          {vector && (
            <Text key="caption" dimColor>
              {tr("What you'll paste")}
            </Text>
          )}
          <Box
            key="report"
            flexDirection="column"
            borderStyle={vector ? 'round' : undefined}
            borderDimColor={vector || undefined}
            paddingX={vector ? 1 : undefined}
            paddingY={vector ? 1 : undefined}
            marginTop={vector ? 1 : undefined}
          >
            {report.split('\n').map((line, index, lines) => (
              // On vector surfaces a section's label (a line a list starts under) reads bold too.
              <Text key={`report-${index}`} bold={index === 0 || (vector && line !== '' && !/^[\s•]/.test(line) && /^•/.test(lines[index + 1] ?? ''))} wrap="wrap">
                {line || ' '}
              </Text>
            ))}
          </Box>
          <Box key="report-actions" flexDirection="row" gap={1} marginTop={1}>
            {vector && <Button key="back" label={tr('Back to the list')} onPress={() => showReport($, false, report, e.surface)} />}
            {!vector && copy}
            {view.reportSpan === 'mine' ? null : view.reportSpan === 'week' ? (
              <Button key="span" label={vector ? tr('Day report') : tr('This day')} onPress={() => showReportSpan($, 'day', e.surface)} />
            ) : (
              <Button key="span" label={vector ? tr('Week report') : tr('This week')} onPress={() => showReportSpan($, 'week', e.surface)} />
            )}
            {!vector && <Button key="back" label={tr('Back to the list')} onPress={() => showReport($, false, report, e.surface)} />}
            {/* Elsewhere than the terminal the main button comes last, as a dialog's does. */}
            {vector && copy}
            {close}
          </Box>
        </Box>
      )
    }

    if (view.entries.length === 0) {
      const words = tr('No tasks saved for this project on that day yet.')
      return (
        <Box flexDirection="column" width={columns}>
          {picker}
          {vector ? (
            <Box flexDirection="row" gap={1}>
              {kit.icon('plan', 'quiet', NOTICE())}
              <Text dimColor wrap="wrap">
                {words}
              </Text>
            </Box>
          ) : (
            <Text dimColor>{words}</Text>
          )}
          <Box key="actions" flexDirection="row" gap={1} marginTop={1}>
            <Button key="mine" label={vector ? tr('All projects this week') : tr('Your week')} onPress={() => showReportSpan($, 'mine', e.surface)} />
            {close}
          </Box>
        </Box>
      )
    }

    const marks: Record<GlanceHistoryEntry['outcome'], [string, string | undefined]> = {
      done: ['✓', 'green'],
      stopped: ['■', undefined],
      stuck: ['⚠', 'yellow'],
      waiting: ['‖', 'yellow'],
      background: ['◷', 'cyan'],
      working: ['▶', 'cyan'],
    }
    const outcomeMark = (outcome: GlanceHistoryEntry['outcome']) =>
      outcome === 'done'
        ? kit.icon('done', 'ok', tr('Done'))
        : outcome === 'stopped'
          ? kit.badge('stop', 'quiet', tr('Stopped'))
          : outcome === 'stuck'
            ? kit.badge('bang', 'alert', tr('Stuck'))
            : outcome === 'waiting'
              ? kit.badge('bell', 'warn', tr('Waiting'))
              : outcome === 'background'
                ? kit.icon('clock', 'active', tr('In the background'))
                : kit.ring(null, 0, tr('Working'))
    const titleWidth = Math.max(12, Math.min(MAX_NAME, columns - 9 - 36))
    const rows = view.entries.map(one => {
      const [mark, color] = marks[one.outcome]
      // Elsewhere than the terminal times read as the report says them ("13 min"), so one job reads one way.
      const took = one.finishedAt === null ? tr('not finished') : (vector ? plainDuration : formatDuration)(one.finishedAt - one.startedAt)
      const details = [
        `${one.stepsDone}/${one.stepsTotal}`,
        took,
        tokenNote(one.newTokens + one.cachedTokens, one.cachedTokens),
        typeof one.costUsd === 'number' ? formatCost(one.costUsd) : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const files = filesNote(entryFiles(one))
      if (vector) {
        return (
          <Box key={`job-${one.jobId}`} flexDirection="column" marginBottom={1}>
            <Box key="row" flexDirection="row" gap={1} width={columns}>
              {outcomeMark(one.outcome)}
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text bold={one.outcome !== 'stopped'} dimColor={one.outcome === 'stopped'} wrap="truncate-end">
                  {one.title}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text dimColor>{clockTime(one.startedAt)}</Text>
              </Box>
            </Box>
            <Box key="details" flexDirection="row" gap={1} width={columns}>
              {kit.blank()}
              <Box flexShrink={1}>
                <Text dimColor wrap="wrap">
                  {[tr('{0} of {1} steps', one.stepsDone, one.stepsTotal), took, tokenNote(one.newTokens + one.cachedTokens, one.cachedTokens), typeof one.costUsd === 'number' ? formatCost(one.costUsd) : ''].filter(Boolean).join(' · ')}
                </Text>
              </Box>
            </Box>
            {files !== '' && (
              <Box key="files" flexDirection="row" gap={1} width={columns}>
                {kit.blank()}
                {kit.icon('file', 'quiet', tr('Files'), 13)}
                <Box flexShrink={1}>
                  <Text dimColor wrap="wrap">
                    {files}
                  </Text>
                </Box>
              </Box>
            )}
          </Box>
        )
      }
      return (
        <Box key={`job-${one.jobId}`} flexDirection="column">
          <Box key="row" flexDirection="row">
            <Text dimColor>{`${clockTime(one.startedAt)}  `}</Text>
            <Text color={color} dimColor={one.outcome === 'stopped'}>{`${mark} `}</Text>
            <Text bold={one.outcome !== 'stopped'}>{fit(one.title, titleWidth)}</Text>
            <Text dimColor wrap="truncate-end">
              {` ${fit(details, Math.max(0, columns - 9 - titleWidth - 1)).trimEnd()}`}
            </Text>
          </Box>
          {files !== '' && (
            <Text key="files" dimColor wrap="wrap">
              {`         ${files}`}
            </Text>
          )}
        </Box>
      )
    })

    const finished = view.entries.filter(one => one.finishedAt !== null)
    const time = finished.reduce((sum, one) => sum + (one.finishedAt! - one.startedAt), 0)
    const newTokens = view.entries.reduce((sum, one) => sum + one.newTokens, 0)
    const cached = view.entries.reduce((sum, one) => sum + one.cachedTokens, 0)
    const priced = view.entries.filter(one => typeof one.costUsd === 'number')
    const spent = priced.reduce((sum, one) => sum + (one.costUsd ?? 0), 0)
    const counts = (Object.keys(marks) as GlanceHistoryEntry['outcome'][])
      .map(outcome => [outcome, view.entries.filter(one => one.outcome === outcome).length] as const)
      .filter(([, count]) => count > 0)
      .map(([outcome, count]) => OUTCOME_COUNT[outcome](count))
    const total = [
      view.entries.length === 1 ? tr('1 task') : tr('{0} tasks', view.entries.length),
      counts.join(', '),
      (vector ? plainDuration : formatDuration)(time),
      tokenNote(newTokens + cached, cached),
      priced.length > 0 ? formatCost(spent) : '',
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <Box flexDirection="column" width={columns}>
        {picker}
        {rows}
        <Box key="total" marginTop={vector ? 0 : 1}>
          {vector ? (
            <Text dimColor wrap="wrap">{tr('Total: {0}', total)}</Text>
          ) : (
            <Text bold wrap="truncate-end">{tr('Total: {0}', total)}</Text>
          )}
        </Box>
        <Box key="actions" flexDirection="row" gap={1} marginTop={1}>
          <Button
            key="report"
            variant={vector ? 'secondary' : 'primary'}
            label={vector ? (view.reportSpan === 'week' ? tr('Week report') : tr('Day report')) : tr('Team report')}
            onPress={() => showReportSpan($, view.reportSpan === 'week' ? 'week' : 'day', e.surface)}
          />
          {/* Your week covers every project, so on the desktop its name says so beside this project's reports. */}
          <Button key="mine" label={vector ? tr('All projects this week') : tr('Your week')} onPress={() => showReportSpan($, 'mine', e.surface)} />
          {close}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    // Other mods draw in this band too (an approval card, prompt buttons): keep theirs, under ours.
    const beneath = await next(e).catch(() => null)
    return drawBand($, e, e.props.maxRows, beneath)
  })

  // VS Code draws no band above the prompt, but it draws panes: there the checklist opens in one, which a narrow
  // panel seats above the prompt box.
  on('session.attach', { surface: 'vscode' }, async ($, e, next) => {
    await openChecklist($)
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: CHECKLIST_PANE }, async ($, e) => drawBand($, e, e.props.scroll.bodyRows + 1, null))
}

// The checklist band, drawn above the prompt or, in VS Code, in its pane: `maxRows` is the room it has, with the
// `n more` row a band keeps for a taller tree.
async function drawBand($: $, e: BandEvent, maxRows: number, beneath: RenderElement | null) {
  const table = $.ui.resolve(e)
  const { Box, Text, Button } = table
  // The desktop app, VS Code and the phone set text in a proportional font and draw vectors: there the band is
  // flex rows with SVG marks and one slim bar. The terminal lines its columns up by cells, with glyphs.
  const kit = kitOf(table, e.surface)
  const vector = kit.isVector
  const isEnabled = await read($, enabledAtom)
  const list = isEnabled ? await read($, checklistAtom) : null
  // Another mod's buttons (Replay, say) sit with GlanceFlow's own actions at the bottom right, in every state of the
  // band; anything else it draws stays under it.
  const lifted = vector && isEnabled ? liftButtons(beneath) : { buttons: [], rest: beneath }
  const kept = lifted.rest as RenderElement | null
  // What is beneath may be the engine's own node, which can't sit under a Box with a width: wrap, don't nest.
  const withBeneath = (tree: RenderElement): RenderElement =>
    kept ? (
      <Box flexDirection="column">
        {tree}
        {kept}
      </Box>
    ) : (
      tree
    )
  const tick = list ? await read($, tickAtom) : 0
  const usage = isEnabled ? await read($, usageAtom) : NO_USAGE
  const isDetailed = isEnabled && (await read($, detailAtom)) === 'detailed'
  const isCalm = isEnabled && (await read($, calmAtom))
  const handoff = isEnabled ? await read($, handoffAtom) : 'idle'
  const armed = isEnabled ? await read($, armedAtom) : null
  const canShip = isEnabled && (await read($, shipOnGithubAtom)) && (await read($, hasGithubAtom))
  const columns = Math.max(20, e.props.bodyColumns)
  const current = await now($)

  // A line of the band on vector surfaces: a mark, then what it says, then anything kept to the right.
  // A box that holds a cut line needs minWidth 0: in the desktop app's flex rows, it would otherwise push past the edge.
  const line = (key: string, mark: RenderChildren, body: RenderChildren, right?: RenderChildren) => (
    <Box key={key} flexDirection="row" alignItems="center" gap={1} width={columns}>
      {mark}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {body}
      </Box>
      {right !== undefined && <Box flexShrink={0}>{right}</Box>}
    </Box>
  )

  // Plan usage, always in view; it turns yellow, then red, as a window fills.
  const warnings: RenderChildren[] = []
  // The other chats on this computer: one that needs the person, in amber, else how many are at work, quietly.
  const others = isEnabled && (await read($, showsOthersAtom)) ? await read($, othersAtom) : []
  const otherWords = otherChatsWords(others)
  // Who needs the person comes first and is never left out for the shorter count after it: cut to whole words instead.
  const otherLine = (room: number) => wholePieces(widthOf(otherWords[0] ?? '') <= room ? otherWords : otherWords.slice(0, 1), room)
  if (otherWords.length > 0) {
    const needsYou = others.some(one => one.needsYou)
    warnings.push(
      vector
        ? line(
            'others',
            kit.icon(needsYou ? 'bell' : 'eye', needsYou ? 'warn' : 'quiet', NOTICE()),
            <Text wrap="truncate-end" dimColor={!needsYou}>
              {otherLine(Math.floor(columns / 0.8) - 3)}
            </Text>,
          )
        : (
            <Box key="others" width={columns}>
              <Text wrap="truncate-end" color={needsYou ? 'yellow' : undefined} dimColor={!needsYou}>
                {needsYou ? `${GLYPH.bell} ${otherLine(columns - 2)}` : otherLine(columns)}
              </Text>
            </Box>
          ),
    )
  }
  // What only the person can do or decide: the first in full, the rest in the Plan.
  const forYou = list?.forYou ?? []
  if (forYou.length > 0) {
    const words = forYou.length > 1 ? tr('For you: {0} · {1} more in Plan', forYou[0]!, forYou.length - 1) : tr('For you: {0}', forYou[0]!)
    warnings.push(
      vector
        ? line('for-you', kit.icon('bell', 'warn', NOTICE()), <Text wrap="truncate-end">{words}</Text>)
        : (
            <Box key="for-you" width={columns}>
              <Text wrap="truncate-end" color="yellow">{`${GLYPH.bell} ${words}`}</Text>
            </Box>
          ),
    )
  }
  // Last row: open the history, or hand this chat off to a fresh one (a second press confirms).
  const list0 = isEnabled ? await read($, checklistAtom) : null
  const canPause =
    runningTurn !== undefined &&
    list0 !== null &&
    (list0.phase === 'working' || list0.phase === 'needsYou') &&
    list0.needsYouReason !== WAITING &&
    list0.approval !== 'waiting'
  // Claude asked something: elsewhere than the terminal Continue would read as a yes, so only an answer moves on.
  const canContinue =
    list0 !== null &&
    (list0.phase === 'stopped' ||
      list0.phase === 'stuck' ||
      (list0.phase === 'needsYou' && list0.needsYouReason === WAITING && !(vector && list0.question)))
  // An action: on the terminal its glyph leads the label. Elsewhere it is the app's own button, so it reads as one
  // at a glance; the one that matters now (Continue, Start) is the primary one.
  const action = (key: string, icon: IconName, label: string, onPress: () => unknown, short?: string, isMain = false) =>
    vector ? (
      <Button key={key} variant={isMain ? 'primary' : 'secondary'} label={label} onPress={onPress} />
    ) : (
      <Button key={key} plain label={short ?? `${GLYPH[icon]} ${label}`} onPress={onPress} />
    )
  const handoffLabel =
    armed === 'handoff' ? tr('Press again to start a fresh chat') : handoff === 'working' ? tr('Writing a handoff note…') : tr('Fresh chat')
  // What steers the job (Pause, Start, Continue); elsewhere than the terminal it sits beside the job's status.
  // Elsewhere than the terminal a stuck job is tried again, and a usage limit won't lift for a press, so that
  // button stays quiet.
  const isStuck = list0?.phase === 'stuck'
  const pauseLabel = tr('Pause')
  const isLimitStuck = isStuck && /limit/i.test(list0?.stuckReason ?? '')
  // Beside "try again later" a usage limit's button checks whether it has lifted.
  const continueLabel = vector && isStuck ? (isLimitStuck ? tr('Check again') : tr('Try again')) : tr('Continue')
  const controls = isEnabled
    ? [
        canPause && action('pause', 'pause', pauseLabel, () => pauseJob($)),
        list0?.approval === 'waiting' && action('aim', 'spark', tr('Aim higher'), () => aimHigher($)),
        list0?.approval === 'waiting' && action('start', 'play', tr('Start'), () => startPlan($), undefined, true),
        canContinue && action('continue', 'play', continueLabel, () => continueJob($), undefined, !(vector && isLimitStuck)),
      ].filter(Boolean)
    : []
  const tidyAt = isEnabled ? await read($, tidyAtAtom) : 0
  const isChatFull = usage.contextPercent !== null && tidyAt > 0 && usage.contextPercent >= tidyAt
  // A fresh chat ends this one. Elsewhere than the terminal it stands apart from the places to go, and only once the
  // job has stopped or finished (mid-job, Tidy up now is the way to make room), or while a first press waits.
  // While a stopped job's chat is full, Tidy up now is the one way offered to make room.
  // In a narrow band the words of the actions may be longer than the English: the short labels come in that much sooner.
  const wordsWider = Math.max(0, ['Pause', 'Plan', 'History', 'Fresh chat', 'Ship it'].reduce((sum, word) => sum + widthOf(tr(word)) - widthOf(word), 0))
  const handoffItem =
    list0 !== null &&
    (!vector || list0.phase === 'done' || (list0.phase === 'stopped' && !isChatFull) || handoff === 'working' || armed === 'handoff') &&
    action('handoff', 'fresh', handoffLabel, () => pressHandoff($), handoffLabel === tr('Fresh chat') && columns < 40 + wordsWider ? `↻ ${tr('Fresh')}` : undefined)
  // Finish on GitHub: once the job is done, one press closes it out; a merged pull request archives the chat.
  const shipItem =
    canShip &&
    (list0?.phase === 'done' || armed === 'ship') &&
    action('ship', 'ship', armed === 'ship' ? tr('Press again to ship') : tr('Ship it'), () => pressTwice($, 'ship', () => shipIt($)), undefined, armed !== 'ship')
  // Where to go from here: the plan, the history, the settings.
  const places = isEnabled
    ? [
        list0?.hasPlan && action('plan', 'plan', tr('Plan'), () => showPlan($)),
        // ≣, not ☰: Unicode 16 made ☰ two cells wide, and the row shifted in newer terminals.
        action('history', 'history', tr('History'), () => showHistory($, dayKey(current), true)),
        action('settings', 'sliders', tr('Settings'), () => showSettings($), columns < 60 + wordsWider ? '⚙' : undefined),
        !vector && handoffItem,
        !vector && shipItem,
      ].filter(Boolean)
    : []
  const actionItems = isEnabled ? [...controls, ...places] : null
  const chatPart = usage.contextPercent === null ? '' : tr('chat {0}% full', Math.round(usage.contextPercent))
  const usageParts = [
    ...usage.limits.map(one => tr('{0} {1}%', tr(one.label), Math.round(one.percent))),
    // On the terminal the line below says how full the chat is, with the button to tidy it up: not twice.
    isChatFull && !vector ? '' : chatPart,
  ].filter(Boolean)
  const top = usage.limitPercent ?? 0
  const isHigh = top >= LIMIT_WARN
  const reset = isHigh ? resetTime(usage.limitResetsAt, await now($)) : null
  const tidy = <Button key="compact" label={vector ? tr('Tidy up now') : tr('Tidy it up')} onPress={() => tidyUp($)} />
  if (vector) {
    // One quiet row: the details view always shows usage; the simple view only near a limit or with the chat past the
    // tidy-up mark, whose button sits with the other actions. The icon carries the colour, as the app's own notices do.
    if (usageParts.length > 0 && (isDetailed || isHigh || isChatFull)) {
      const words = isHigh
        ? [tr("You've used {0}% of your {1} limit", Math.round(top), tr(usage.limitLabel ?? 'plan')), reset === null ? '' : tr('resets {0}', reset), isChatFull ? chatPart : '']
        : isDetailed
          ? [tr('Usage: {0}', usageParts[0] ?? ''), ...usageParts.slice(1)]
          : [tr('This chat is {0}% full', Math.round(usage.contextPercent ?? 0)), tr('tidying up keeps a checkpoint first')]
      warnings.push(
        line(
          'limit',
          isHigh
            ? kit.icon('alert', top >= LIMIT_ALERT ? 'alert' : 'warn', NOTICE())
            : isChatFull
              ? kit.icon('tidy', 'warn', NOTICE())
              : kit.icon('clock', 'quiet', NOTICE()),
          // Whole pieces, as in the header: about 0.8 of a cell a character, less the mark.
          <Text wrap="truncate-end" dimColor={!isHigh}>
            {wholePieces(words, Math.floor(columns / 0.8) - 3)}
          </Text>,
        ),
      )
    }
  } else if (usageParts.length > 0 && (isDetailed || isHigh)) {
    // The simple view speaks up only near a limit; the detailed view always shows usage.
    const color = top >= LIMIT_ALERT ? 'red' : isHigh ? 'yellow' : undefined
    const words = isHigh
      ? [tr("You've used {0}% of your {1} limit", Math.round(top), tr(usage.limitLabel ?? 'plan')), reset === null ? '' : tr('resets {0}', reset), usageParts.join(' · ')]
          .filter(Boolean)
          .join(' · ')
      : tr('Plan usage: {0}', usageParts.join(' · '))
    warnings.push(
      <Box key="limit" width={columns}>
        <Text wrap="truncate-end" color={color} dimColor={!isHigh}>
          {isHigh ? `⚠ ${words}` : words}
        </Text>
      </Box>,
    )
  }
  if (isChatFull && !vector && usage.contextPercent !== null) {
    const words = tr('This chat is {0}% full. Claude saves a checkpoint before tidying up.', Math.round(usage.contextPercent))
    warnings.push(
      <Box key="long-chat" flexDirection="row" justifyContent="space-between" width={columns}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end" color="yellow">
            {words}
          </Text>
        </Box>
        {tidy}
      </Box>,
    )
  }

  const isRecapShown = isEnabled && (await read($, recapAtom))
  const recapButton = <Button key="recap" label={tr('Where we left off')} onPress={() => showRecap($)} />
  const recapOk = <Button key="recap-ok" plain={vector ? undefined : true} label={tr('OK')} onPress={() => update($, recapAtom, () => false)} />
  if (isRecapShown) {
    const buttons = (
      <Box flexDirection="row" gap={1}>
        {recapButton}
        {recapOk}
      </Box>
    )
    warnings.push(
      vector ? (
        // Its buttons sit with the other actions at the bottom right.
        line(
          'recap',
          kit.badge('check', 'ok', NOTICE()),
          <Text wrap="truncate-end">{tr('Chat tidied up. Claude kept a checkpoint of the work.')}</Text>,
        )
      ) : (
        <Box key="recap" flexDirection="row" justifyContent="space-between" width={columns}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end" color="green">
              {`✓ ${tr('Chat tidied up. Claude kept a checkpoint of the work.')}`}
            </Text>
          </Box>
          {buttons}
        </Box>
      ),
    )
  }

  // The view: on the terminal one button steps through Simple → Details → Off. Elsewhere a menu shows the view and
  // the others, so no press turns GlanceFlow off by surprise; a surface without one (the phone) keeps the button.
  const view = !isEnabled ? 'off' : isDetailed ? 'detailed' : 'simple'
  const button =
    vector && 'Select' in table && table.Select ? (
      <table.Select
        key="view"
        label={tr('View')}
        value={view}
        options={[
          { value: 'detailed', label: tr('Detailed') },
          { value: 'simple', label: tr('Simple') },
          { value: 'off', label: tr('Off') },
        ]}
        onSelect={value => void setView($, value as typeof view)}
      />
    ) : (
    <Button
      key="toggle"
      label={
        vector
          ? tr('View: {0}', view === 'off' ? tr('Off') : view === 'detailed' ? tr('Detailed') : tr('Simple'))
          : columns < NARROW
            ? !isEnabled
              ? `○ ${tr('Off')}`
              : isDetailed
                ? `● ${tr('Details')}`
                : `● ${tr('Simple')}`
            : !isEnabled
              ? `○ GlanceFlow: ${tr('Off')}`
              : isDetailed
                ? `● GlanceFlow: ${tr('Details')}`
                : `● GlanceFlow: ${tr('Simple')}`
      }
      variant={isEnabled && !vector ? 'primary' : 'secondary'}
      onPress={() => cycleMode($, isEnabled, isDetailed)}
    />
    )
  // The row under the checklist. Elsewhere than the terminal: where to go on the left; on the right everything that
  // acts, together: another mod's buttons, Tidy up now, Fresh chat, then Pause, Start or Continue, the main one last,
  // as a dialog's buttons sit. In a narrow band the actions wrap onto a line of their own and still keep to the right.
  const actions =
    actionItems === null ? null : vector ? (
      <Box key="actions" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} rowGap={1} flexWrap="wrap" width={columns} marginTop={1}>
        <Box flexDirection="row" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap" flexShrink={1} minWidth={0}>
          {places}
        </Box>
        <Box flexDirection="row" alignItems="center" justifyContent="flex-end" columnGap={1} rowGap={1} flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0}>
          {isRecapShown && recapButton}
          {isRecapShown && recapOk}
          {lifted.buttons as RenderElement[]}
          {isChatFull && tidy}
          {handoffItem}
          {shipItem}
          {controls}
        </Box>
      </Box>
    ) : (
      <Box key="actions" flexDirection="row" gap={columns < 44 ? 1 : 2}>
        {actionItems}
      </Box>
    )
  // The header's right end holds the view, on every surface: elsewhere than the terminal a menu, as wide as
  // "View Detailed" at about 0.8 of a cell a character, and its arrow and padding.
  const headerRight = button
  const viewWider = Math.max(0, Math.max(...[tr('Details'), tr('Simple'), tr('Off')].map(widthOf)) - widthOf('Details'))
  const rightCells = vector ? Math.ceil(widthOf(`${tr('View')} ${tr('Detailed')}`) * 0.8) + 4 : (columns < NARROW ? 15 : 27) + viewWider
  // In characters. Elsewhere than the terminal the app's font sets about 0.8 of a cell a character, so the header
  // counts that many more before it cuts its words.
  const headerWidth = Math.max(0, vector ? Math.floor((columns - rightCells - 2) / 0.8) : columns - rightCells)
  const row = (header: RenderChildren) => (
    <Box key="header" flexDirection="row" justifyContent="space-between" alignItems={vector ? 'center' : undefined} columnGap={vector ? 2 : undefined} width={columns}>
      <Box flexShrink={1} flexGrow={1} minWidth={0}>
        {header}
      </Box>
      {headerRight !== null && (
        <Box key="header-right" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {headerRight}
        </Box>
      )}
    </Box>
  )
  // The bold words of a header are never cut: the longest of the ways to say it that fits, else the shortest.
  const leadOf = (ways: string[]) => ways.find(one => widthOf(one) <= headerWidth - 3) ?? ways[ways.length - 1] ?? ''
  // The header on vector surfaces: a mark, what is happening in bold, then the rest dim. Given as pieces, the rest
  // keeps whole pieces that fit and leaves the others out, as the Working header does.
  const headline = (mark: RenderChildren, lead: string | string[], rest: string | string[], look: { isRestPlain?: boolean } = {}) => {
    const shownLead = leadOf(Array.isArray(lead) ? lead : [lead])
    const room = Math.max(0, headerWidth - 3 - widthOf(shownLead))
    const shown = Array.isArray(rest) ? wholePieces(rest, room - 3) : fit(rest, room).trimEnd()
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {mark}
        <Text wrap="truncate-end">
          <Text bold>{shownLead}</Text>
          <Text dimColor={!look.isRestPlain}>{Array.isArray(rest) ? (shown === '' ? '' : ` · ${shown}`) : shown}</Text>
        </Text>
      </Box>
    )
  }

  const tourStep = isEnabled && list === null ? await read($, tourAtom) : null
  if (tourStep !== null) {
    const isLast = tourStep === TOUR_CARDS - 1
    if (vector) {
      // The checklist's frame: the view at the top right; under the words the places to go on the left, and on the
      // right the tour's own buttons, Next last.
      return withBeneath(
        <Box flexDirection="column" width={columns}>
          {row(
            <Box flexDirection="row" alignItems="center" gap={1}>
              {kit.icon('spark', 'active', STATUS())}
              <Text bold wrap="truncate-end">
                {leadOf([tr('Welcome to GlanceFlow'), tr('Welcome')])}
              </Text>
            </Box>,
          )}
          {line('tour-text', kit.blank(), <Text wrap="wrap">{tourCards(true)[tourStep]}</Text>)}
          {warnings}
          <Box key="tour" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} rowGap={1} flexWrap="wrap" width={columns} marginTop={1}>
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              {action('history', 'history', tr('History'), () => showHistory($, dayKey(current), true))}
              {action('settings', 'sliders', tr('Settings'), () => showSettings($))}
            </Box>
            <Box flexDirection="row" alignItems="center" justifyContent="flex-end" columnGap={1} flexGrow={1}>
              {lifted.buttons as RenderElement[]}
              <Box alignItems="center" marginLeft={1} marginRight={1}>
                {kit.dots(TOUR_CARDS, tourStep)}
              </Box>
              {!isLast && <Button key="tour-skip" label={tr('Skip')} onPress={() => stepTour($, null)} />}
              <Button key="tour-next" variant="primary" label={isLast ? tr('Got it') : tr('Next')} onPress={() => stepTour($, tourStep + 1)} />
            </Box>
          </Box>
        </Box>,
      )
    }
    return withBeneath(
      <Box flexDirection="column" width={columns}>
        <Text bold wrap="truncate-end">{tr('Welcome to GlanceFlow · {0} of {1}', tourStep + 1, TOUR_CARDS)}</Text>
        <Text wrap="wrap">{tourCards(false)[tourStep]}</Text>
        <Box key="tour" flexDirection="row" gap={2} marginBottom={1}>
          <Button key="tour-next" plain label={isLast ? `✓ ${tr('Got it')}` : `${tr('Next')} ▶`} onPress={() => stepTour($, tourStep + 1)} />
          {!isLast && <Button key="tour-skip" plain label={tr('Skip')} onPress={() => stepTour($, null)} />}
        </Box>
        {warnings}
        {actions}
      </Box>,
    )
  }

  if (list === null) {
    const hint = vector ? tr('Ask Claude for something, and its plan shows here') : tr('Ask Claude for something: its plan shows here')
    // Nothing to show yet. Elsewhere than the terminal it keeps the checklist's frame: the hint and the view on top;
    // below, the places to go on the left and, when the chat is full, Tidy up now on the right.
    return withBeneath(
      <Box flexDirection="column" width={columns}>
        {row(
          !isEnabled ? (
            vector ? (
              <Text dimColor wrap="truncate-end">
                {tr('GlanceFlow is off: Claude Code shows everything as usual')}
              </Text>
            ) : (
              <Text> </Text>
            )
          ) : vector ? (
            <Box flexDirection="row" alignItems="center" gap={1}>
              {kit.icon('plan', 'quiet', tr('No plan yet'))}
              <Text dimColor wrap="truncate-end">
                {wholePieces([hint], headerWidth - 3)}
              </Text>
            </Box>
          ) : (
            <Text dimColor wrap="truncate-end">
              {fit(hint, headerWidth).trimEnd()}
            </Text>
          ),
        )}
        {warnings}
        {actions}
      </Box>,
    )
  }

  const elapsed = (vector ? durationWords : formatDuration)((list.finishedAt ?? current) - list.startedAt)
  // A paused or stopped job's clock stands still at the moment it stopped.
  const stepClock = list.finishedAt ?? current
  const jobTokens = list.tasks.reduce((sum, one) => sum + one.tokens, list.extraTokens)
  const jobCached = list.tasks.reduce((sum, one) => sum + one.cachedTokens, list.extraCachedTokens)
  const spent = jobCost(list, usage)
  const jobTokenNote = isDetailed
    ? [tokenNote(jobTokens, jobCached), spent === null ? '' : formatCost(spent)].filter(Boolean).join(' · ')
    : ''
  const activeStep = list.tasks.find(one => one.status === 'active')
  // Why Claude stopped, when it isn't working: on vector surfaces it sits beside the current step, so the header keeps
  // to the state and the job's name; with no current step it stays in the header.
  const limitResets = list.phase === 'stuck' && /limit/i.test(list.stuckReason ?? '') ? resetTime(usage.limitResetsAt, current) : null
  const reason =
    list.phase === 'stuck'
      ? // Elsewhere than the terminal a usage limit reads as a short fact, with when it lifts where the app has told us.
        vector && /limit/i.test(list.stuckReason ?? '')
        ? `${tr('Usage limit reached')} · ${limitResets === null ? tr('try again later') : tr('resets {0}', limitResets)}`
        : tr(list.stuckReason ?? FAILING)
      : list.phase === 'stopped'
        ? list.stopKind === 'pause'
          ? tr('press Continue to pick up')
          : tr('you pressed Esc')
        : ''
  const isReasonOnStep = vector && activeStep !== undefined
  // Both views fill the current step from its time estimate, so the percentage moves before a step is checked off.
  const activeEstimate = activeStep ? stepEstimate(list, activeStep, stepClock).percent : undefined
  const overall = overallProgress(list.tasks, activeEstimate).percent
  let header: RenderChildren
  // A Needs you reason too long for the header gets a line of its own under it, kept whole: a permission request's
  // risk words come last, and they must never be the part that is cut off.
  let headerNote: RenderChildren = null
  if (list.phase === 'needsYou') {
    const reason = needsText(list) ?? tr(PERMISSION)
    // On the terminal the label takes its words, a space either side, and one more before the reason.
    const fits = widthOf(reason) <= (vector ? headerWidth - 6 - widthOf(tr('Needs you')) : headerWidth - widthOf(tr('Needs you')) - 3)
    const shown = fits ? [reason] : []
    if (!fits) {
      headerNote = vector ? (
        line('needs-you', kit.blank(), <Text wrap="wrap">{reason}</Text>)
      ) : (
        <Box key="needs-you" width={columns}>
          <Text wrap="wrap">{reason}</Text>
        </Box>
      )
    }
    header = vector ? (
      // The amber is in the icon; the words keep the app's text colour, which reads on a light window too.
      headline(kit.badge('bell', 'warn', STATUS()), tr('Needs you'), shown, { isRestPlain: true })
    ) : (
      <Text wrap="truncate-end">
        <Text bold inverse color="yellow">
          {` ${tr('Needs you')} `}
        </Text>
        {fits && <Text> {reason}</Text>}
      </Text>
    )
  } else if (list.phase === 'stuck') {
    header = vector ? (
      headline(kit.badge('bang', 'alert', STATUS()), tr('Stuck'), isReasonOnStep ? [list.title] : [reason, list.title])
    ) : (
      <Text wrap="truncate-end" color="yellow" bold={isCalm}>
        {fit(`⚠ ${tr('Stuck: {0}', tr(list.stuckReason ?? FAILING))}`, headerWidth).trimEnd()}
      </Text>
    )
  } else if (list.phase === 'stopped') {
    const isPause = list.stopKind === 'pause'
    header = vector ? (
      headline(
        kit.badge(isPause ? 'pause' : 'stop', 'quiet', STATUS()),
        isPause ? tr('Paused') : tr('Stopped'),
        isReasonOnStep ? [list.title] : [reason, list.title],
      )
    ) : (
      <Text wrap="truncate-end" dimColor={!isCalm} bold={isCalm}>
        {fit(
          isPause ? `‖ ${tr('Paused')} · ${tr('press Continue to pick up')} · ${list.title}` : `■ ${tr('Stopped')} · ${tr('you pressed Esc')} · ${list.title}`,
          headerWidth,
        ).trimEnd()}
      </Text>
    )
  } else if (list.phase === 'background') {
    const running = list.helpers.filter(one => one.status === 'running').length
    header = vector ? (
      headline(
        kit.icon('clock', 'active', STATUS()),
        [tr('Still working in the background'), tr('In the background'), tr('Background')],
        [tr('{0} left', running), list.title, elapsed],
      )
    ) : (
      <Text wrap="truncate-end" color="cyan" bold={isCalm}>
        {fit(`◷ ${tr('Still working in the background')} · ${tr('{0} left', running)} · ${list.title} · ${elapsed}`, headerWidth).trimEnd()}
      </Text>
    )
  } else if (list.phase === 'done') {
    // Whether the code the job changed was tested: outside proof, not Claude's own word.
    const check = jobCheck(list.tasks)
    const checkWords = check === null ? '' : tr(CHECK_WORDS[check])
    header = vector ? (
      headline(kit.badge('check', 'ok', STATUS()), tr('All done'), [list.title, checkWords, tr('took {0}', elapsed), jobTokenNote])
    ) : (
      <Text wrap="truncate-end" color="green" bold={isCalm}>
        {fit(
          `✓ ${tr('All done')} · ${list.title}${checkWords ? ` · ${checkWords}` : ''} · ${tr('took {0}', elapsed)}${jobTokenNote ? ` · ${jobTokenNote}` : ''}`,
          headerWidth,
        ).trimEnd()}
      </Text>
    )
  } else {
    // Time left follows the percentage shown, so the two never disagree.
    const left = list.hasPlan ? timeLeft(list, current, activeEstimate) : null
    const hasGrown = list.hasPlan && list.plannedCount > 0 && list.tasks.length > list.plannedCount
    // Time left replaces time spent once there is an estimate. Elsewhere than the terminal the ring shows the
    // percentage, so the words count steps, as the Plan does.
    const stepsDone = list.tasks.filter(one => one.status === 'done').length
    const lead = list.approval === 'waiting' ? tr('Plan ready') : tr('Working')
    const pieces = [
      list.hasPlan ? (vector ? tr('{0} of {1} done', stepsDone, list.tasks.length) : `${overall}%`) : '',
      // Elsewhere than the terminal a bare "8s" could read as time left: it says so.
      left === null ? (vector ? tr('{0} so far', elapsed) : elapsed) : tr('about {0} left', formatLeft(left)),
      hasGrown ? tr('plan grew {0} → {1}', list.plannedCount, list.tasks.length) : '',
      jobTokenNote,
    ]
    // Elsewhere than the terminal, where the job's name leaves no room for how far it is, the name gives way: the
    // steps are right below it, and the Plan has it.
    const firstPiece = pieces.find(Boolean) ?? ''
    const roomWithTitle = headerWidth - 6 - widthOf(lead) - widthOf(list.title)
    const keepsTitle = !vector || firstPiece === '' || widthOf(` · ${firstPiece}`) <= roomWithTitle
    const detailRoom = !vector ? headerWidth - Math.min(list.title.length, 20) : keepsTitle ? roomWithTitle : headerWidth - 3 - widthOf(lead)
    // Whole pieces drop off the end when there is no room, never half a word.
    const shownDetails = headerDetails(pieces, detailRoom)
    // Elsewhere than the terminal not even the first piece is cut.
    const details = vector && widthOf(shownDetails) > detailRoom ? '' : shownDetails
    header = vector ? (
      // Every state's header reads the same way: its mark, the state in bold, then the job and how far it is.
      headline(
        list.hasPlan ? kit.ring(overall, 0, tr('{0}% done', overall)) : kit.ring(null, isCalm ? 0 : tick, STATUS()),
        lead,
        keepsTitle ? ` · ${list.title}${details}` : details,
      )
    ) : (
      <Text wrap="truncate-end">
        <Text bold>{fit(list.title, Math.max(8, headerWidth - details.length)).trimEnd()}</Text>
        <Text dimColor>{details}</Text>
      </Text>
    )
  }

  if (list.phase === 'done' && list.isCollapsed) {
    return withBeneath(
      <Box flexDirection="column" width={columns}>
        {row(header)}
        {warnings}
        {actions}
      </Box>,
    )
  }

  // Name column: whatever the row leaves after mark, meter and label, so rows never wrap.
  const hasMeter = columns >= METER_MIN_COLUMNS
  const bar = (cells: string) => (hasMeter ? ` ${cells} ` : ' ')
  // The label column fits the longest state word in the person's language: LABEL_WIDTH in English.
  const labelWidth = Math.max(LABEL_WIDTH, ...[tr('Done'), tr('Working'), tr('Waiting'), tr('Stuck'), tr('Paused'), tr('Stopped')].map(widthOf))
  const nameWidth = Math.max(4, Math.min(MAX_NAME, columns - 2 - 2 - (hasMeter ? METER + 2 : 1) - labelWidth - 1))
  const room = Math.max(1, maxRows - 1 - (headerNote ? 1 : 0) - warnings.length - (actions ? 1 : 0))
  const firstUpcoming = list.tasks.findIndex(one => one.status === 'upcoming')
  // What is left of the row after mark, name, meter and label: the step's tokens, when they fit.
  const usageRoom = columns - 2 - nameWidth - (hasMeter ? METER + 2 : 1) - labelWidth - 1
  const noteOf = (one: GlanceTask) => {
    let timeNote = ''
    if (one.status === 'done' && one.startedAt !== null && one.finishedAt !== null) {
      timeNote = tr('took {0}', (vector ? durationWords : formatDuration)(one.finishedAt - one.startedAt))
    } else if (one.status === 'active') {
      const estimate = stepEstimate(list, one, stepClock)
      // Elsewhere than the terminal the band gives the step's time left alone; the Plan keeps the time spent too.
      timeNote = vector ? leftLabel(estimate.leftMs, true) : `${formatDuration(estimate.elapsedMs)} · ${leftLabel(estimate.leftMs)}`
    }
    return isDetailed ? [timeNote, tokenNote(one.tokens, one.cachedTokens)].filter(Boolean).join(' · ') : ''
  }
  const usageCell = (one: GlanceTask) => {
    const note = noteOf(one)
    return note && usageRoom >= 12 ? <Text dimColor>{` ${fit(note, usageRoom - 1).trimEnd()}`}</Text> : null
  }
  // A step on vector surfaces: its mark and name, then, dim, what it is doing or got done; in Details its time and
  // tokens keep to a column on the right. A step whose mark says it all gets no word of its own.
  // Its time follows it inline, as a finished step's does. When the row runs short the tail gives way first (it
  // shrinks a hundred times faster than the name), and the time is never cut.
  // What follows the name reads as the header does: parts joined by " · " with no wider gap before the dot (the
  // spaces are no-break ones, which the app keeps at the start of a part), the bar standing in for the first.
  const join = (words: string) => `\u00a0·\u00a0${words}`
  // Elsewhere than the terminal a row's words are measured here, at about 0.8 of a cell a character, so the app never
  // cuts one: past the mark (and `cells` more kept beside the name), a name too long for the row keeps whole words, and
  // the tail keeps whole pieces in the room left after the name and the `gap` before the tail.
  const roomFor = (cells: number) => Math.max(0, Math.floor((columns - 3 - cells) / 0.8) - 1)
  const fitted = (name: string, tail: string, room: number, gap = 3) => {
    const shownName = widthOf(name) <= room ? name : wholePieces([name], room)
    return { name: shownName, tail: tail === '' ? '' : wholePieces(tail.split(' · '), room - widthOf(shownName) - gap) }
  }
  const step = (key: string, mark: RenderChildren, name: RenderChildren, tail: string, extra?: RenderChildren, note = '') => (
    <Box key={key} flexDirection="row" alignItems="center" width={columns}>
      {mark}
      <Box flexShrink={1} minWidth={0} marginLeft={1}>
        {name}
      </Box>
      {extra && <Box marginLeft={1}>{extra}</Box>}
      {tail !== '' && (
        <Box key="tail" flexShrink={100} minWidth={0} marginLeft={extra ? 1 : 0}>
          <Text dimColor wrap="truncate-end">
            {extra ? tail : join(tail)}
          </Text>
        </Box>
      )}
      {note !== '' && (
        <Box key="note" flexShrink={0} marginLeft={tail === '' && extra ? 1 : 0}>
          <Text dimColor>{tail === '' && extra ? note : join(note)}</Text>
        </Box>
      )}
    </Box>
  )
  // A line under a step, in line with the step names: what it got done, what Claude is doing, what is out of view.
  const under = (key: string, text: string) =>
    vector ? (
      line(
        key,
        kit.blank(),
        <Text dimColor wrap="truncate-end">
          {wholePieces(text.split(' · '), roomFor(0))}
        </Text>,
      )
    ) : (
      <Box key={key} flexDirection="row">
        <Text dimColor wrap="truncate-end">
          {fit(`    ${text}`, Math.max(0, columns - 1)).trimEnd()}
        </Text>
      </Box>
    )
  const lastStepId = list.tasks[list.tasks.length - 1]?.id
  const stepIds = new Set(list.tasks.map(one => one.id))
  const helpersOf = (stepId: string) =>
    list.helpers
      .filter(one => one.stepId === stepId || (stepId === lastStepId && !stepIds.has(one.stepId)))
      // Running first, then the latest finished.
      .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
      .slice(0, HELPERS_PER_STEP)

  // What the step that just finished got done, until Claude's next activity takes the line.
  // Steps checked off together finish at the same moment: the latest in the plan wins.
  const justDone = list.tasks
    .filter(one => one.status === 'done' && one.finishedAt !== null)
    .reverse()
    .sort((a, b) => b.finishedAt! - a.finishedAt!)[0]
  const showsSummary = (list.phase === 'working' || list.phase === 'done') && list.activity === null && Boolean(justDone?.summary)

  // A long plan folds its finished steps, and the steps after the next one, into a line each. On the desktop, once
  // Claude's own task list shows the steps above, every step still to come folds into one line: Details keeps them.
  const foldsNative = e.surface === 'desktop' && list.isNative === true && !isDetailed
  const isCompact = list.tasks.length > COMPACT_AFTER || foldsNative
  const doneSteps = list.tasks.filter(one => one.status === 'done')
  const foldsDone = isCompact && doneSteps.length >= 2
  const isLater = (one: GlanceTask, index: number) => one.status === 'upcoming' && (foldsNative || index !== firstUpcoming)
  const laterSteps = list.tasks.filter(isLater)
  const foldsLater = isCompact && laterSteps.length >= (foldsNative ? 1 : 2)
  // Where the current step stands: the word says when Claude isn't working on it.
  const standing =
    list.phase === 'needsYou'
      ? { mark: '‖ ', label: tr('Waiting'), icon: 'bell' as const, tone: 'warn' as const }
      : list.phase === 'stuck'
        ? { mark: '⚠ ', label: tr('Stuck'), icon: 'bang' as const, tone: 'alert' as const }
        : list.phase === 'stopped'
          ? list.stopKind === 'pause'
            ? { mark: '‖ ', label: tr('Paused'), icon: 'pause' as const, tone: 'quiet' as const }
            : { mark: '■ ', label: tr('Stopped'), icon: 'stop' as const, tone: 'quiet' as const }
          : null

  // Every line: each step, then the helpers working under it.
  // `steps`: how many plan steps a line stands for (a folded line stands for several).
  const lines: { key: string; isActive: boolean; element: RenderChildren; steps?: number }[] = []
  list.tasks.forEach((one, index) => {
    const key = `task-${index}`
    if (one.status === 'done' && foldsDone) {
      if (one !== doneSteps[0]) return
      const words = tr('{0} steps done', doneSteps.length)
      lines.push({
        key,
        steps: doneSteps.length,
        isActive: false,
        element: vector ? (
          // A summary of steps, not a step: its own quiet mark, so the tick and the ring stay for real steps.
          step(
            key,
            kit.icon('more', 'quiet', tr('Folded')),
            <Text dimColor wrap="truncate-end">
              {fitted(words, '', roomFor(0)).name}
            </Text>,
            '',
          )
        ) : (
          <Box key={key} flexDirection="row">
            <Text color="green">✓ </Text>
            <Text dimColor>{fit(words, nameWidth)}</Text>
            <Text color="green">{bar('█'.repeat(METER))}</Text>
            <Text dimColor>{fit(tr('Done'), labelWidth)}</Text>
          </Box>
        ),
      })
      // A summary under a folded group would hang under the wrong line: the terminal keeps it, elsewhere it goes.
      if (showsSummary && justDone && !vector) {
        lines.push({ key: 'summary', isActive: false, element: under('summary', justDone.summary!) })
      }
      return
    }
    if (foldsLater && isLater(one, index)) {
      if (one !== laterSteps[0]) return
      // Elsewhere than the terminal the row says where the rest are.
      const words = foldsNative
        ? tr("{0} more in Claude's task list", laterSteps.length)
        : vector
          ? tr('{0} more steps in Plan', laterSteps.length)
          : tr('{0} more steps', laterSteps.length)
      lines.push({
        key,
        steps: laterSteps.length,
        isActive: false,
        element: vector ? (
          step(
            key,
            kit.icon('more', 'quiet', tr('Folded')),
            <Text dimColor wrap="truncate-end">
              {fitted(words, '', roomFor(0)).name}
            </Text>,
            '',
          )
        ) : (
          <Box key={key} flexDirection="row">
            <Text dimColor>○ </Text>
            <Text dimColor>{fit(words, nameWidth)}</Text>
            <Text dimColor>{bar('░'.repeat(METER))}</Text>
            <Text dimColor>{tr('Later')}</Text>
          </Box>
        ),
      })
      return
    }
    if (one.status === 'done') {
      // Its time follows it, dim: kept to the far right it read as the time left.
      const done = fitted(one.name, [showsSummary && one === justDone ? one.summary! : '', noteOf(one)].filter(Boolean).join(' · '), roomFor(0))
      lines.push({
        key,
        isActive: false,
        element: vector ? (
          step(
            key,
            kit.icon('done', 'ok', tr('Done')),
            <Text dimColor wrap="truncate-end">
              {done.name}
            </Text>,
            done.tail,
          )
        ) : (
          <Box key={key} flexDirection="row">
            <Text color="green">✓ </Text>
            <Text dimColor>{fit(one.name, nameWidth)}</Text>
            <Text color="green">{bar('█'.repeat(METER))}</Text>
            <Text dimColor>{fit(tr('Done'), labelWidth)}</Text>
            {usageCell(one)}
          </Box>
        ),
      })
      if (showsSummary && one === justDone && !vector) {
        lines.push({ key: 'summary', isActive: false, element: under('summary', one.summary!) })
      }
    } else if (one.status === 'active') {
      // The details view fills the bar gradually from the time estimate; the simple view sweeps until Claude reports.
      const shownPercent = isDetailed ? stepEstimate(list, one, stepClock).percent : one.percent
      // Elsewhere than the terminal a bar shows only while Claude works on the step: a frozen one says nothing.
      const hasPercent = (isDetailed || one.hasReported) && !(vector && standing !== null)
      const label = standing?.label ?? (hasPercent ? `${shownPercent}%` : tr('Working'))
      // Only a step Claude is working on moves; one that waits on you or has stopped stands still.
      const isStill = isCalm || standing !== null
      let element: RenderChildren
      if (vector && list.approval === 'waiting') {
        // Nothing has started while the plan waits for Start: the first step is one more to come, and the amber of
        // the header is the only call on you.
        element = step(key, kit.open(tr('Next')), <Text wrap="truncate-end">{fitted(one.name, '', roomFor(0)).name}</Text>, '')
      } else if (vector) {
        // The bar shows how far the step is, so no number stands beside it; a step that waits on you or has stopped
        // goes grey, the header saying why. With no progress reported yet there is no bar, only what Claude is
        // doing, in its own words when they fit.
        const activity = list.phase === 'working' ? list.activity : null
        const doing =
          activity === null
            ? ''
            : activity.detail !== null && widthOf(activity.detail) <= 48
              ? activity.detail
              : `${tr(activity.label)}${activity.count > 1 ? ` (${activity.count})` : ''}`
        // Before Claude reports how far it is, a short bar travels along the track: the row reads as every working
        // row does, and no word repeats the header. A calm screen keeps still, so it shows no bar then.
        const isSweeping = standing === null && !hasPercent && !isCalm
        const tail = isReasonOnStep && reason !== '' ? reason.charAt(0).toUpperCase() + reason.slice(1) : doing
        const note = noteOf(one)
        // A few letters of what Claude is doing say nothing: it shows only where a dozen or more fit. Why the step
        // stopped always shows; the header no longer says it.
        const tailRoom = columns - 3 - widthOf(one.name) - (hasPercent || isSweeping ? 10 : 0) - (note !== '' ? widthOf(note) + 3 : 0)
        // The bar takes 8 cells and a cell either side; the time beside it is never cut.
        const hasBar = hasPercent || isSweeping
        const shown = fitted(
          one.name,
          tailRoom >= 14 || (isReasonOnStep && reason !== '') ? tail : '',
          roomFor(hasBar ? 10 : 0) - (note !== '' ? widthOf(note) + 3 : 0),
          hasBar ? 0 : 3,
        )
        // The bar says how far the step is, so the mark beside the name says Now, as the Plan's does, not that again.
        element = step(
          key,
          kit.badge(standing?.icon ?? 'play', standing?.tone ?? 'active', standing?.label ?? tr('Now')),
          <Text bold wrap="truncate-end">
            {shown.name}
          </Text>,
          shown.tail,
          hasPercent || isSweeping ? (
            <Box key="state" flexDirection="row" alignItems="center" flexShrink={0}>
              {hasPercent
                ? kit.meter('active', shownPercent, 0, label, 72)
                : kit.meter('active', null, ((tick % 12) + 0.5) / 12, label, 72)}
            </Box>
          ) : undefined,
          note,
        )
      } else {
        const filled = Math.round(shownPercent / 10)
        const sweepAt = tick % (METER + 3)
        const meter = hasPercent
          ? '█'.repeat(filled) + '░'.repeat(METER - filled)
          : isStill
            ? '░'.repeat(METER)
            : Array.from({ length: METER }, (_, cell) => (cell >= sweepAt - 2 && cell <= sweepAt ? '█' : '░')).join('')
        element = (
          <Box key={key} flexDirection="row">
            <Text color={standing?.icon === 'bang' ? 'yellow' : 'cyan'}>{standing?.mark ?? '▶ '}</Text>
            <Text bold>{fit(one.name, nameWidth)}</Text>
            <Text color="cyan">{bar(meter)}</Text>
            <Text>{fit(label, labelWidth)}</Text>
            {usageCell(one)}
          </Box>
        )
      }
      lines.push({ key, isActive: true, element })
      // What Claude is doing right now, in plain words: a line of its own on the terminal; elsewhere it follows the bar.
      if (list.phase === 'working' && list.activity !== null && !vector) {
        const { label: doing, count, detail } = list.activity
        const plain = `${tr(doing)}${count > 1 ? ` (${count})` : ''}`
        // Claude's own sentence when it fits the line whole; otherwise the short plain label, never a cut sentence.
        const sentence = detail !== null && widthOf(`    ${tr('Now: {0}', detail)}`) <= columns - 1 ? tr('Now: {0}', detail) : plain
        lines.push({ key: 'activity', isActive: false, element: under('activity', sentence) })
      }
    } else {
      const label = index === firstUpcoming ? tr('Next') : tr('Later')
      lines.push({
        key,
        isActive: false,
        element: vector ? (
          step(key, kit.open(label), <Text wrap="truncate-end">{fitted(one.name, '', roomFor(0)).name}</Text>, '')
        ) : (
          <Box key={key} flexDirection="row">
            <Text dimColor>○ </Text>
            <Text dimColor>{fit(one.name, nameWidth)}</Text>
            <Text dimColor>{bar('░'.repeat(METER))}</Text>
            <Text dimColor>{label}</Text>
          </Box>
        ),
      })
    }
    for (const helper of helpersOf(one.id).filter(helper => !(foldsDone && one.status === 'done') || helper.status === 'running')) {
      const helperKey = `helper-${helper.id}`
      // Say "in the background" once: not when the task's own name already does.
      const kindLabel =
        helper.kind === 'background'
          ? /background/i.test(helper.label)
            ? null
            : tr('in the background')
          : helper.type === 'general-purpose'
            ? tr('helper')
            : helper.type
      const details = (
        isDetailed
          ? [
              kindLabel,
              helper.model,
              helper.effort ? tr('{0} effort', helper.effort) : null,
              helper.tokens > 0 ? tr('{0} tokens', formatTokens(helper.tokens)) : null,
            ]
          : [kindLabel]
      )
        .filter(Boolean)
        .join(' · ')
      const isRunning = helper.status === 'running'
      if (vector) {
        // Its own small mark and a gap take two cells more.
        const shown = fitted(helper.label, details, roomFor(2))
        lines.push({
          key: helperKey,
          isActive: isRunning,
          element: line(
            helperKey,
            kit.blank(),
            <Box flexDirection="row" alignItems="center" gap={1}>
              {isRunning
                ? kit.ring(null, isCalm ? 0 : tick, tr('Running'), 13)
                : helper.status === 'failed'
                  ? kit.badge('close', 'alert', tr('Failed'), 13)
                  : kit.badge('check', 'ok', tr('Done'), 13)}
              <Text wrap="truncate-end">
                <Text dimColor={!isRunning}>{shown.name}</Text>
                {shown.tail !== '' && <Text dimColor>{` · ${shown.tail}`}</Text>}
              </Text>
            </Box>,
          ),
        })
        continue
      }
      const icon = isRunning ? (isCalm ? '◐' : SPINNER[tick % SPINNER.length]!) : helper.status === 'failed' ? '✗' : '✓'
      // The whole row is the description's: "in the background" and the details go first when it is short of room.
      const room = Math.max(4, columns - 7)
      const hasRoom = details !== '' && widthOf(helper.label) + 1 + widthOf(details) <= room
      lines.push({
        key: helperKey,
        isActive: isRunning,
        element: (
          <Box key={helperKey} flexDirection="row">
            <Text dimColor>{'  ↳ '}</Text>
            <Text color={isRunning ? 'cyan' : helper.status === 'failed' ? 'red' : 'green'}>{`${icon} `}</Text>
            <Text dimColor={!isRunning} wrap="truncate-end">
              {hasRoom ? helper.label : fit(helper.label, room).trimEnd()}
            </Text>
            {hasRoom && <Text dimColor wrap="truncate-end">{` ${details}`}</Text>}
          </Box>
        ),
      })
    }
  })

  // Window the lines so the current step (and what runs under it) stays in view,
  // and say how many steps are out of view.
  const focus = Math.max(0, lines.findIndex(one => one.isActive))
  // One line of context above the current step when there is room for it.
  const windowAt = (size: number) => Math.min(Math.max(0, focus - (size > 2 ? 1 : 0)), Math.max(0, lines.length - size))
  const stepsIn = (from: number, to: number) =>
    lines.slice(from, to).reduce((sum, one) => sum + (one.key.startsWith('task-') ? (one.steps ?? 1) : 0), 0)
  const isCut = stepsIn(0, windowAt(room)) + stepsIn(windowAt(room) + room, lines.length) > 0
  // The "more steps" line needs a row of its own; with a single row the current step wins.
  const shown = isCut && room > 1 ? room - 1 : room
  const first = windowAt(shown)
  const above = stepsIn(0, first)
  const below = stepsIn(first + shown, lines.length)
  const rows = lines.slice(first, first + shown).map(one => one.element)
  if (above + below > 0 && shown < room) {
    const more = [above > 0 ? tr('{0} earlier', above) : '', below > 0 ? (below === 1 ? tr('1 more step') : tr('{0} more steps', below)) : '']
      .filter(Boolean)
      .join(' · ')
    rows.push(
      vector ? (
        under('more', more)
      ) : (
        <Text key="more" dimColor wrap="truncate-end">
          {`  … ${more}`}
        </Text>
      ),
    )
  }

  return withBeneath(
    <Box flexDirection="column" width={columns}>
      {row(header)}
      {headerNote}
      {rows}
      {warnings}
      {actions}
    </Box>,
  )
}
