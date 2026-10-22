import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { GlanceHistoryEntry, GlanceOutcome } from '../types'

import { activityOf, asksQuestion, carryTokens, questionOf, isButtonsOnly, isContinueWords, liftButtons, isLatinText, isStartWords, cleanName, sentenceCase, localTimes, resetTime, fit, formatCost, formatTokens, headerDetails, ownWords, wholePieces, prettyModel, tokenNote } from '../hooks/glance'
import { findSecrets, maskPrivate } from '../hooks/privacy'
import { OTHER_WAITING_MS, OTHER_WORKING_MS, applyCheck, isNewerVersion, askedMergeSha, checkResult, jobCheck, needsCheck, runsCheck, isMcpMergeAction, otherChats, otherChatsWords, runsPowerShellMerge, runsPrMerge, shellPieces, staleResumeKeys, toggled, unsafeMerge, unsafePowerShellMerge } from '../hooks/logic'
import { dayEntries, dayFromArgument, dayKey, expiredHistoryKeys, filesNote, historyDay, historyKey, longDay, mergedEntries, paceFromHistory, sharedDayKeys, shiftDay, teamReport, weekSummary } from '../hooks/history'

const PLAN = 'mcp__glanceflow__plan_steps'
const PROGRESS = 'mcp__glanceflow__report_progress'
const SURFACES = ['terminal', 'desktop'] as const
const BAND = {
  plugin: 'glanceflow',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

/** Calls a tool as the engine does; typed loosely, since the full tool table is too wide to check here. */
function callTool($: Engine, input: unknown): Promise<{ deny?: string; result?: unknown }> {
  return ($.tool.call as unknown as (input: unknown) => Promise<{ deny?: string; result?: unknown }>)(input)
}

/** The world beneath the plugin: clock, store, Haiku and every tool answer from memory; `toolAnswer` replaces the last. */
function world(on: On, toolAnswer: () => unknown = () => ({ result: {} })) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Build my landing page', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', toolAnswer as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  return clock
}

/** Turns on the detailed view: models, tokens, cache and plan usage. */
async function detailsOn($: Engine) {
  await $.command.run({ command: 'glanceflow', args: 'details on' } as never)
}

async function texts($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 80): Promise<string[]> {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
  const found = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const buttons = (await ui.findAll({ type: 'Button' })).map(one => one.text)
  // A menu reads as its label and the option picked, as the desktop draws it.
  const menus = (await ui.findAll({ type: 'Select' })).map(one => {
    const props = one.props as { label?: string; value?: string; options?: { value: string; label: string }[] }
    return `${props.label}: ${props.options?.find(option => option.value === props.value)?.label ?? ''}`
  })
  // Vector surfaces draw marks as SVG: their alt text, bracketed, stands for them.
  const marks = surface === 'terminal' ? [] : (await ui.findAll({ type: 'Svg' })).map(one => `[${String(one.props.alt)}]`)
  await ui.unmount()

  return [...found, ...buttons, ...menus, ...marks]
}

type Drawn = { type: string; props: Record<string, unknown>; children?: (Drawn | string)[] }

/** Marks a screen reader would say twice: an alt its row's words hold, or one another mark in the row has. */
function echoes(boxes: unknown[]): string[] {
  // Each element's words apart, as they are drawn: a name and the line under it are two runs of words, not one.
  const textOf = (node: Drawn | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('\n'))
  const altsOf = (node: Drawn | string): string[] =>
    typeof node === 'string' ? [] : node.type === 'Svg' ? [String(node.props.alt)] : (node.children ?? []).flatMap(altsOf)
  const found = (boxes as Drawn[])
    .filter(one => one.props.flexDirection === 'row')
    .flatMap(row => {
      const alts = altsOf(row)
      const words = textOf(row)
      const says = (alt: string) => new RegExp(`(^|\\W)${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\W)`, 'i').test(words)
      return alts.filter((alt, at) => alts.indexOf(alt) !== at || says(alt)).map(alt => `${alt} ⟶ ${words}`)
    })
  return [...new Set(found)]
}

describe('clean names', () => {
  test('backtick code is stripped', () => {
    expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  })

  test('a path disappears from the middle of a sentence', () => {
    expect(cleanName('update the src/app/page.tsx header text')).toBe('Update the header text')
    expect(cleanName('Fix styles.css and the menu')).toBe('Fix and the menu')
  })

  test('an 80-character name trims to 40 or less at a word boundary', () => {
    const long = 'Rewrite the welcome message so that it sounds warmer and friendlier to new visitors'
    const name = cleanName(long)
    expect(name.length <= 40).toBe(true)
    expect(name.endsWith('…')).toBe(true)
    expect(long.startsWith(name.slice(0, -1))).toBe(true)
  })

  test('nothing left becomes a friendly placeholder', () => {
    expect(cleanName('`npm run build`')).toBe('Working on it')
  })

  test('a job named in Title Case reads in sentence case, names like GlanceFlow keep theirs', () => {
    expect(sentenceCase('Copy Mod With Button Choices')).toBe('Copy mod with button choices')
    expect(sentenceCase('Release GlanceFlow Update')).toBe('Release GlanceFlow update')
    expect(sentenceCase('Build my landing page')).toBe('Build my landing page')
    expect(sentenceCase('Fix PR')).toBe('Fix PR')
  })
})

test('a to-do list plus a 60% report draws done, current, next and up next rows', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, {
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  } as never)
  await callTool($, { tool: PROGRESS, task: 'Build the pricing section', percent: 60 } as never)

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    const isTerminal = surface === 'terminal'
    expect(shown).toContain(isTerminal ? '✓' : '[Done]')
    expect(shown).toContain('Read your brand notes')
    expect(shown).toContain(isTerminal ? '▶' : '[60%]')
    if (isTerminal) expect(shown).toContain('██████░░░░')
    expect(shown).toContain('60%')
    expect(shown).toContain('Next')
    expect(shown).toContain('Later')
    expect(shown).toContain(isTerminal ? 'GlanceFlow: Simple' : 'View: Simple')
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).toContain('Needs you')
    expect(shown).toContain("Answer Claude's request in the chat")
    expect(shown).toContain(surface === 'terminal' ? '‖' : '[Waiting]')
  }
})

test('/glanceflow off hides the band but keeps the button', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.command.run({ command: 'glanceflow', args: 'off' } as never)

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).not.toContain('Understand your request')
    expect(shown).toContain(surface === 'terminal' ? 'GlanceFlow: Off' : 'View: Off')
  }
})

test('another mod drawing above the prompt still shows, under the checklist', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'X post waiting for your OK') as never
  })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })

  for (const surface of SURFACES) {
    const shown = await texts($, surface)
    expect(shown.join('\n')).toContain('Build my landing page')
    expect(shown).toContain('X post waiting for your OK')
  }
  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  expect(await texts($, 'terminal')).toContain('X post waiting for your OK')
})

test('plan_steps then report_progress at 100 checks off step one and starts step two', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const planned = await callTool($, { tool: PLAN, steps: ['Read your notes', 'Write the page', 'Check it'] } as never)
  expect(planned.result).toBe('Planned 3 steps. The first one has started.')
  const reported = await callTool($, { tool: PROGRESS, task: 'Read your notes', percent: 100 } as never)
  expect(reported.result).toBe('Progress noted: 100%.')

  const shown = await texts($, 'terminal')
  const at = (text: string) => shown.findIndex(one => one.includes(text))
  // Row order: mark, name, meter, label.
  expect(shown[at('Read your notes') - 1]).toContain('✓')
  expect(shown[at('Read your notes') + 2]?.trim()).toBe('Done')
  expect(shown[at('Write the page') - 1]).toContain('▶')
  expect(shown[at('Check it') + 2]?.trim()).toBe('Next')
})

test('any tool is denied before a plan exists and allowed after', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const before = await callTool($, { tool: 'Bash', command: 'ls' })
  expect(before.deny).toContain('plan_steps')

  const allowed = await callTool($, { tool: 'ToolSearch', query: 'select:x', max_results: 1 })
  expect(allowed.deny).toBe(undefined)

  await callTool($, { tool: PLAN, steps: ['Look around', 'Answer you'] } as never)
  const after = await callTool($, { tool: 'Bash', command: 'ls' })
  expect(after.deny).toBe(undefined)
})

test('a finished job says All done and collapses after 5 seconds', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Do it', 'Check it'] } as never)
  await clock.advance(134_000)
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 } as never)
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('✓ All done')
  expect(shown).toContain('took 2m 14s')
  await clock.advance(5000)
  const collapsed = (await texts($, 'terminal')).join('\n')
  expect(collapsed).toContain('✓ All done')
  expect(collapsed).not.toContain('Do it')
})

// Sample secrets are built at run time, so no key-shaped text sits in the repository
// (where secret scanners would flag it).
const fakeKey = (length: number) => ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz123456'.slice(0, length)].join('-')
const SAMPLE_PASSWORD = ['hunter', '22'].join('')
const SAMPLE_CARD = Array(4).fill('4242').join(' ')
const SAMPLE_ASSIGNMENT = `${['API', 'KEY'].join('_')}=${['abcd', '1234', 'efgh'].join('')}`

describe('privacy', () => {
  test('passwords, keys and card numbers are found', () => {
    expect(findSecrets(`my password is ${SAMPLE_PASSWORD}`)).toContain('a password')
    expect(findSecrets('ο κωδικός μου είναι gata1234')).toContain('a password')
    expect(findSecrets(`use ${fakeKey(32)}`)).toContain('a key or token')
    expect(findSecrets(SAMPLE_ASSIGNMENT)).toContain('a password or key')
    expect(findSecrets(`card ${SAMPLE_CARD} please`)).toContain('a card number')
  })

  test('ordinary messages are left alone', () => {
    expect(findSecrets('Build my landing page with a pricing section')).toEqual([])
    expect(findSecrets('Order 1234 5678 is late')).toEqual([])
  })

  test('everyday words that sound like credentials are not held back', () => {
    for (const text of [
      'Author: Antreas Stirmpou',
      'OAuth: enabled for the login page',
      'tokens: 128kcached in Details',
      'auth: required for /api routes',
      'PIN: optional for now',
      'set GLANCE_AUTH_MODE: simple',
      'Δες το authentication: fallback',
      'Ο κωδικός: γράψε τον καθαρά',
    ]) {
      expect(findSecrets(text)).toEqual([])
      expect(maskPrivate(text)).toBe(text)
    }
    expect(findSecrets(`${['DB', 'PASSWORD'].join('_')}=letmein`)).toContain('a password or key')
    expect(findSecrets(`${['AUTH', 'TOKEN'].join('_')}: ${['abc', '123', 'def'].join('')}`)).toContain('a password or key')
    expect(findSecrets('pin: 4821')).toContain('a password')
  })

  test('the screen hides emails, phones and keys; names drop them', () => {
    const masked = maskPrivate(`mail jane@example.com or call 555-123-4567, key ${fakeKey(22)}`)
    expect(masked).not.toContain('jane@example.com')
    expect(masked).not.toContain('555-123-4567')
    expect(masked).not.toContain(fakeKey(22))
    expect(cleanName('Email jane@example.com the invoice')).toBe('Email the invoice')
  })
})

test('a message with a password is held back once, then sent when sent again', async ($, on) => {
  world(on)
  let entered = 0
  on('prompt.submit', (_, e) => {
    entered += 1
    return { text: e.text }
  })
  const prompt = { text: `log in with password: ${SAMPLE_PASSWORD}`, wait: false, origin: { kind: 'composer' } } as never

  const first = await $.prompt.submit(prompt)
  expect((first as { drop?: string }).drop).toContain('password')
  expect(entered).toBe(0)

  await $.prompt.submit(prompt)
  expect(entered).toBe(1)

  await $.prompt.submit({ text: 'Build my landing page', wait: false, origin: { kind: 'composer' } } as never)
  expect(entered).toBe(2)
})

test('with the password guard off, a message with a password is sent straight away', async ($, on) => {
  world(on)
  let entered = 0
  on('prompt.submit', (_, e) => {
    entered += 1
    return { text: e.text }
  })
  const off = await $.command.run({ command: 'glanceflow', args: 'guard off' } as never)
  expect(off.text).toContain('password guard is off')
  const prompt = { text: `log in with password: ${SAMPLE_PASSWORD}`, wait: false, origin: { kind: 'composer' } } as never

  const sent = await $.prompt.submit(prompt)
  expect((sent as { drop?: string }).drop).toBeUndefined()
  expect(entered).toBe(1)

  const on_ = await $.command.run({ command: 'glanceflow', args: 'guard on' } as never)
  expect(on_.text).toContain('password guard is on')
  const held = await $.prompt.submit(prompt)
  expect((held as { drop?: string }).drop).toContain('password')
  expect(entered).toBe(1)
})

test('overall progress, time left and a grown plan show in the header and footer', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.render', { component: 'SessionMode' }, (t$, e) => {
    const { Text } = t$.ui.resolve(e)
    return Text({ children: [e.props.modes.join(' & ')] })
  })

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  // Sizes 1 + 2 + 2 + 3 = 8 units of work.
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy', 'Add form', 'Polish it'], sizes: ['S', 'M', 'M', 'L'] })
  await clock.advance(3 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Read notes', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Write copy', percent: 100 })

  // 3 of 8 units in 3 minutes: 38%, about 5 minutes left.
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('38%')
  expect(shown).toContain('about 5m left')

  const footer = await $.ui.mount({ plugin: 'glanceflow', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ type: 'Text' }))?.text).toContain('◎ 38% · ~5m')
  await footer.unmount()

  await callTool($, { tool: PROGRESS, task: 'Fix the menu', percent: 10 })
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('plan grew 4 → 5')
  // Narrower: the note drops before the title is squeezed.
  const narrow = (await texts($, 'terminal', 80)).join('\n')
  expect(narrow).not.toContain('plan grew')
  expect(narrow).toContain('Build my landing page')
})

test('a nearly used-up limit and a long chat show gentle warnings', async ($, on) => {
  world(on)
  let compacted = false
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', () => {
    compacted = true
    return { skip: 'nothing to compact in a test' }
  })
  await $.session.measure({
    context: { window: 200_000, tokens: 160_000, percent: 80 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 85 }],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).toContain("You've used 85% of your 5-hour limit")
    // The desktop keeps it to one quiet row: the limit, then how full the chat is, then the button.
    expect(shown).toContain(surface === 'terminal' ? 'This chat is 80% full' : "You've used 85% of your 5-hour limit · chat 80% full")
    expect(shown).toContain(surface === 'terminal' ? 'Tidy it up' : 'Tidy up now')
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  await ui.unmount()
  expect(compacted).toBe(true)
})

test('Claude forgetting 100 on the last step still ends in All done', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Do it', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 80 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('✓ All done')
  expect(shown).not.toContain('Needs you')
})

test('two open steps after an answer still say Needs you', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Do it', 'Check it', 'Ship it'] })
  await $.turn.complete({ answer: 'Which colour?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect((await texts($, 'terminal')).join('\n')).toContain('Needs you')
})

test('a last message that asks something is a question, in English or Greek', () => {
  expect(asksQuestion('The page is ready. Do you want me to deploy it?')).toBe(true)
  expect(asksQuestion('Έτοιμο. Να το ανεβάσω στο Vercel;')).toBe(true)
  expect(asksQuestion('Which one do you prefer? **Reply with a number?**')).toBe(true)
  expect(asksQuestion('Want me to go on?\n\n')).toBe(true)
  expect(asksQuestion('The page is ready.')).toBe(false)
  expect(asksQuestion('Τελείωσε. Δεν χρειάζεται κάτι άλλο.')).toBe(false)
  expect(asksQuestion('Added the line:\n```js\nconst a = 1;\n```')).toBe(false)
  expect(asksQuestion('')).toBe(false)
  expect(asksQuestion('Kept the old value for now;')).toBe(false)
})

test('a finished job that ends with a question says Needs you and chimes, not All done', async ($, on) => {
  const { heard } = soundWorld(on)
  await $.command.run({ command: 'glanceflow', args: 'sound on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  heard.length = 0
  await $.turn.complete({ answer: 'The page is ready. Do you want me to deploy it?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Needs you')
  expect(shown).toContain('Do you want me to deploy it?')
  expect(shown).not.toContain('All done')
  expect(shown).not.toContain('‖ Pause')
  expect(heard).toEqual(['sounds/needs-you.wav'])
})

test('a quick answer that ends with a question also says Needs you', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Which database?', turnId: 't1' })
  await $.turn.complete({ answer: 'Postgres or SQLite, which do you prefer?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect((await texts($, 'terminal')).join('\n')).toContain('Needs you')
})

test('the reply to that question starts a new job, and the History keeps the first one as done', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it'] })
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100 })
  await $.turn.complete({ answer: 'Ready. Shall I deploy it?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: 'Yes, deploy it to Vercel', turnId: 't2' })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Needs you')
  expect(shown).toContain('Yes, deploy it to Vercel')
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const pane = (await paneTexts($)).join('\n')
  expect(pane).toContain('Build my landing page')
  expect(pane).toContain('Total: 1 task · 1 done')
})

test('the question shown is Claude\'s last sentence, plain and short, with secrets masked', () => {
  expect(questionOf('The page is ready. Do you want me to deploy it?')).toBe('Do you want me to deploy it?')
  expect(questionOf('Έτοιμο. Να το ανεβάσω στο Vercel;')).toBe('Να το ανεβάσω στο Vercel;')
  expect(questionOf('Two options:\n\n1. Postgres\n2. SQLite\n\n**Which do you prefer?**')).toBe('Which do you prefer?')
  // A last sentence of a few words keeps its paragraph, so it still makes sense alone.
  expect(questionOf('Both pass locally and in CI. Merge? ')).toBe('Both pass locally and in CI. Merge?')
  expect(questionOf(`Should I use the key ${fakeKey(32)} for this call?`)).not.toContain('abcdefghijkl')
  expect(questionOf(`Do you want ${'a very long thing '.repeat(20)}done?`)?.length).toBeLessThanOrEqual(160)
  expect(questionOf('The page is ready.')).toBeNull()
  expect(questionOf('')).toBeNull()
})

test('Needs you says what Claude asked, and the general reason comes back when it did not ask', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Do it', 'Check it', 'Ship it'] })
  await $.turn.complete({ answer: 'Two colours fit. Which colour should the buttons be?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Which colour should the buttons be?')
  expect(shown).not.toContain('Reply to Claude in the box below')
  expect(shown).toContain('▶ Continue')

  // Claude asks for a permission next: the question does not stay on the line.
  await $.turn.start({ text: 'Blue', turnId: 't2' })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain("Answer Claude's request in the chat")
  expect(shown).not.toContain('Which colour')

  // A turn that ends with steps left and no question keeps the general words.
  await callTool($, { tool: 'Bash', command: 'ls' })
  await $.turn.complete({ answer: 'Paused here for now.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Reply to Claude in the box below')
})

test('a question prompt from the app replaces an earlier question on the line', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Do it', 'Check it'] })
  await $.turn.complete({ answer: 'Which colour should the buttons be?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Notification({ message: 'Claude has a question', notification_type: 'elicitation_dialog' } as never)
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain("Answer Claude's question in the chat")
  expect(shown).not.toContain('Which colour')
})

test('the desktop notice carries the question too', async ($, on) => {
  const { clock } = soundWorld(on)
  const shown: string[][] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    if (argv[0] === 'osascript') throw new Error('osascript: not found')
    shown.push([...argv.slice(-2)])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  await clock.advance(1)
  shown.length = 0
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.turn.complete({ answer: 'Postgres or SQLite, which do you prefer?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(shown).toEqual([['Claude needs you', 'Postgres or SQLite, which do you prefer?']])
})

test('while a plan waits for Start, the row offers Start and no Pause', async ($, on) => {
  world(on)
  await $.command.run({ command: 'glanceflow', args: 'approve on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('▶ Start')
  expect(shown).not.toContain('‖ Pause')
})

test('narrow headers drop the least important details first', () => {
  const parts = ['38%', 'about 5m left', 'plan grew 4 → 5']
  expect(headerDetails(parts, 80)).toBe(' · 38% · about 5m left · plan grew 4 → 5')
  expect(headerDetails(parts, 25)).toBe(' · 38% · about 5m left')
  expect(headerDetails(parts, 5)).toBe(' · 38%')
  expect(headerDetails(['', '1m 12s', ''], 40)).toBe(' · 1m 12s')
})

test('time left replaces time spent in the header', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four'] })
  await clock.advance(4 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Two', percent: 100 })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('about 4m left')
  expect(shown).not.toContain('4m 0s')
})

test("notes an app adds before the prompt don't name the job", async ($, on) => {
  world(on)
  expect(ownWords('<system-reminder>\nThe user started this session without a folder.\n</system-reminder>\nWrite a sea poem')).toBe('Write a sea poem')
  await $.turn.start({
    text: '<system-reminder>\nThe user started this session without choosing a project folder.\n</system-reminder>\nWrite a sea poem',
    turnId: 't1',
  })
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('session without')
  expect(shown).toContain('Write a sea poem')
})

test('model ids read the way people say them', () => {
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('haiku')).toBe('Haiku')
  expect(prettyModel(null)).toBe(null)
})

test('a subagent shows under its step with its model and effort, then checks off', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  await detailsOn($)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Look around the project', 'Write the page'] })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'Find the pricing data',
    description: 'Find the pricing data',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as never)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-4-5-20251001', effort: 'low', messageCount: 1, agentId: 'a1' } as never)) {
    // drain the step
  }

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).toContain(surface === 'terminal' ? '↳' : '[Running]')
    expect(shown).toContain('Find the pricing data')
    expect(shown).toContain('Explore · Haiku 4.5 · low effort')
  }

  await $.turn.complete({ answer: 'found it', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  const after = await texts($, 'terminal')
  const at = after.findIndex(one => one.includes('Find the pricing data'))
  expect(after[at - 1]).toContain('✓')
})

test('background work keeps the job open until it finishes', async ($, on) => {
  world(on)
  on('classic.Stop', () => ({}) as never)
  await $.turn.start({ text: 'Merge the pull request', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Watch the checks'] })
  await callTool($, { tool: PROGRESS, task: 'Watch the checks', percent: 100 })
  await $.turn.complete({ answer: 'Merged. Watching CI.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Wait for main CI and Vercel status to settle' }],
  } as never)

  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Still working in the background')
  expect(shown).toContain('1 left')
  expect(shown).toContain('Wait for main CI and Vercel status')
  expect(shown).toContain('in the background')
  expect(shown).not.toContain('All done')

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('✓ All done')
})

test('Claude waiting for its own helper is not Needs you; it is when Claude waits for the person', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }) as never)
  await $.turn.start({ text: 'Ship the engine change', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Make the change', 'Get an independent review', 'Report results'] })
  await callTool($, { tool: PROGRESS, task: 'Make the change', percent: 100 })
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'Review it', description: 'Review the change', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  } as never)
  // Claude ends its turn to wait for the review.
  await $.turn.complete({ answer: 'Waiting for the review.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Needs you')
  expect(shown).toContain('Review the change')
  expect(shown).not.toContain('‖ Pause')

  // The review ends; Claude wakes up on its own and carries on.
  await $.turn.complete({ answer: 'Looks good.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)
  await $.turn.start({ text: '<task-notification>Review the change finished</task-notification>', turnId: 't3' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Needs you')
  expect(shown).toContain('‖ Pause')

  // Claude stops with steps left and nothing running: now it waits for the person, and says where to answer.
  await $.turn.complete({ answer: 'Shall I file the follow-ups?', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Needs you')
  expect(shown).toContain('Shall I file the follow-ups?')
  expect(shown).toContain('▶ Continue')
})

test('a background shell Claude waits for is not Needs you either', async ($, on) => {
  world(on)
  on('classic.Stop', () => ({}) as never)
  await $.turn.start({ text: 'Run the end-to-end test', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Start the test', 'Read the results', 'Report back'] })
  await callTool($, { tool: PROGRESS, task: 'Start the test', percent: 100 })
  await $.turn.complete({ answer: 'Started; waiting.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Run the live test' }],
  } as never)

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Needs you')
  expect(shown).toContain('Run the live test')
})

test('a background task whose name already says background is not labelled twice', async ($, on) => {
  world(on)
  on('classic.Stop', () => ({}) as never)
  await $.turn.start({ text: 'Run a timer', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Start the timer', 'Report back'] })
  await callTool($, { tool: PROGRESS, task: 'Report back', percent: 100 })
  await $.turn.complete({ answer: 'Started.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Wait 60 seconds in background' }],
  } as never)

  const rows = (await texts($, 'terminal')).filter(one => !one.startsWith('◷'))
  expect(rows.join('\n')).toContain('Wait 60 seconds in background')
  expect(rows.join('\n')).not.toContain('in the background')
})

test('a background task shows its whole description; "in the background" goes first when the row is short', async ($, on) => {
  world(on)
  on('classic.Stop', () => ({}) as never)
  await $.turn.start({ text: 'Run preflight checks', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read the scheduled run', 'Report the final status'] })
  await $.turn.complete({ answer: 'Waiting on the run.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const description = "Wait until the 10:30 run's logs show the preflight result"
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description }],
  } as never)

  const wide = (await texts($, 'terminal', 120)).join('\n')
  expect(wide).toContain(description)
  expect(wide).toContain('in the background')

  const narrow = (await texts($, 'terminal', 64)).join('\n')
  expect(narrow).toContain(description)
  expect(narrow).not.toContain('in the background')
})

const USAGE = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 400 }

test('token counts read short', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12.4k')
  expect(formatTokens(11_000)).toBe('11k')
  expect(formatTokens(212_000)).toBe('212k')
  expect(formatTokens(3_200_000)).toBe('3.2M')
})

test('a new plan keeps the tokens already counted', () => {
  const old = [
    { id: 'a', name: 'Understand your request', status: 'active', percent: 0, hasReported: false, size: 'M', summary: null, tokens: 500, cachedTokens: 100, startedAt: null, finishedAt: null },
  ] as const
  const next = [
    { id: 'p0', name: 'Write the page', status: 'active', percent: 0, hasReported: false, size: 'M', summary: null, tokens: 0, cachedTokens: 0, startedAt: null, finishedAt: null },
    { id: 'p1', name: 'Check it', status: 'upcoming', percent: 0, hasReported: false, size: 'M', summary: null, tokens: 0, cachedTokens: 0, startedAt: null, finishedAt: null },
  ] as const
  const carried = carryTokens([...old], [...next])
  expect(carried[0]?.tokens).toBe(500)
  expect(carried.reduce((sum, one) => sum + one.tokens, 0)).toBe(500)
})

test('each step shows its tokens and how much came from the cache', async ($, on) => {
  world(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: { ...USAGE, model: 'claude-opus-5-5' } } as never
  })
  await detailsOn($)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy'] })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) {
    // drain
  }

  for (const surface of SURFACES) {
    const shown = (await texts($, surface, 120)).join('\n')
    // 1,000 + 1,000 + 10,000 + 400 = 12.4k: 2.4k new, 10k read back from the cache.
    expect(shown).toContain('2.4k new · 10k cached')
  }

  await callTool($, { tool: PROGRESS, task: 'Write copy', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await texts($, 'terminal', 120)).join('\n')).toMatch(/All done .* · 2\.4k new · 10k cached/)
})

test('plan usage shows all the time, not only near the limit', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await detailsOn($)
  await $.session.measure({
    context: { window: 200_000, tokens: 68_000, percent: 34 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42 },
      { kind: 'seven_day', percentUsed: 18 },
    ],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    // "Plan" is a button on the desktop; its usage line says "Usage" so the two don't read as one.
    expect(shown).toContain(`${surface === 'terminal' ? 'Plan usage' : 'Usage'}: 5-hour 42% · weekly 18% · chat 34% full`)
    expect(shown).not.toContain('⚠')
  }
})

test('the simple view hides models, tokens and low plan usage; the Details button shows them', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: { ...USAGE, model: 'claude-opus-5-5' } } as never
  })
  await $.session.measure({
    context: { window: 200_000, tokens: 68_000, percent: 34 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
    changed: ['context', 'rateLimits'],
  })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Look around', 'Write the page'] })
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'Find the prices', description: 'Find the prices', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
  } as never)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) {
    // drain
  }

  for (const surface of SURFACES) {
    const simple = (await texts($, surface, 120)).join('\n')
    expect(simple).toContain('Find the prices')
    expect(simple).toContain(surface === 'terminal' ? 'GlanceFlow: Simple' : 'View: Simple')
    expect(simple).not.toContain('Haiku 4.5')
    expect(simple).not.toContain('tokens')
    expect(simple).not.toContain('cached')
    expect(simple).not.toContain('Plan usage')
  }

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 120 }, surface: 'terminal' })
  await ui.press({ key: 'toggle' })
  await ui.unmount()
  const detailed = (await texts($, 'terminal', 120)).join('\n')
  expect(detailed).toContain('GlanceFlow: Details')
  expect(detailed).toContain('Explore · Haiku 4.5')
  expect(detailed).toContain('2.4k new · 10k cached')
  expect(detailed).toContain('Plan usage: 5-hour 42%')
})

test('the simple view still warns near a plan limit', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000, tokens: 68_000, percent: 34 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 85 }],
    changed: ['context', 'rateLimits'],
  })
  expect((await texts($, 'terminal')).join('\n')).toContain("You've used 85% of your 5-hour limit")
})

test('a quick answer with no plan ends as one plain step', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'What time zone is Athens in?', turnId: 't1' })
  await $.turn.complete({ answer: 'Eastern European Time.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('✓ All done')
  expect(shown).toContain('Answer your question')
  expect(shown).not.toContain('Plan the steps')
})

test('one button cycles Simple, Details and Off', async ($, on) => {
  world(on)
  const press = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Simple')
  await press()
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Details')
  await press()
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Off')
  await press()
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Simple')
})

test('in details, the current step fills gradually and shows its time; done steps show how long they took', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await detailsOn($)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy'], sizes: ['M', 'M'] })

  // No pace yet: a medium step is expected to take 3 minutes, so after 90 seconds it is about half done.
  await clock.advance(90_000)
  let shown = (await texts($, 'terminal', 120)).join('\n')
  expect(shown).toContain('█████░░░░░')
  expect(shown).toContain('50%')
  expect(shown).toContain('1m 30s · ~2m left')
  expect(shown).not.toContain('Working')

  // The first step took 2 minutes; the second, the same size, is expected to take 2 minutes too.
  await clock.advance(30_000)
  await callTool($, { tool: PROGRESS, task: 'Read notes', percent: 100 })
  await clock.advance(60_000)
  shown = (await texts($, 'terminal', 120)).join('\n')
  expect(shown).toContain('took 2m 0s')
  expect(shown).toContain('50%')
  expect(shown).toContain('1m 0s · ~1m left')
})

test('a step running past its expected time says it is taking longer, not under a minute left', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await detailsOn($)
  await $.turn.start({ text: 'Ship the site', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Merge and ship', 'Check the pages'], sizes: ['L', 'M'] })

  // Claude says 95% after a minute: a large step is expected to take about 4.5 minutes, so that is believable.
  await clock.advance(60_000)
  await callTool($, { tool: PROGRESS, task: 'Merge and ship', percent: 95 })
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('1m 0s · <1m left')

  // 17 minutes later it still sits at 95%: no more "under a minute", and no total that would be a guess.
  await clock.advance(17 * 60_000)
  const shown = (await texts($, 'terminal', 120)).join('\n')
  expect(shown).toContain('18m 0s · taking longer')
  expect(shown).not.toContain('<1m left')
  expect(shown).not.toContain('about')
  const pane = await planPaneTexts($)
  expect(pane).toContain('taking longer')
  expect(pane).not.toContain('<1m left')
  expect(pane).not.toContain('done around')
  // The next step still says how long it usually takes.
  expect(pane).toContain('about 3m')

  // A lower report from Claude past that point still gives an honest estimate.
  await callTool($, { tool: PROGRESS, task: 'Merge and ship', percent: 50 })
  const later = (await texts($, 'terminal', 120)).join('\n')
  expect(later).toContain('50%')
  expect(later).toContain('18m 0s · ~18m left')
})

test('the simple view keeps the sweep until Claude reports', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy'] })
  const shown = (await texts($, 'terminal', 120)).join('\n')
  expect(shown).toContain('Working')
  expect(shown).not.toContain('took')
})

test('token notes put new tokens first and cached ones after', () => {
  expect(tokenNote(228_000, 225_000)).toBe('3k new · 225k cached')
  expect(tokenNote(5_000, 0)).toBe('5k tokens')
  expect(tokenNote(0, 0)).toBe('')
})

test("Claude's final answer counts in the job's total, not in the last step", async ($, on) => {
  world(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: 'claude-opus-5-5' } } as never
  })
  await detailsOn($)
  await $.turn.start({ text: 'Remove the files', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Move them away', 'Check they are gone'] })
  await callTool($, { tool: PROGRESS, task: 'Check they are gone', percent: 100 })
  // Every step is done; this request is the final answer.
  for await (const _ of $.turn.step({ turnId: 't1', index: 3, model: 'claude-opus-5-5', effort: 'high', messageCount: 5 } as never)) {
    // drain
  }
  await $.turn.complete({ answer: 'Removed.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = await texts($, 'terminal', 120)
  expect(shown.join('\n')).toMatch(/All done .* · 2\.4k new · 10k cached/)
  expect(shown.some(line => line.includes('new ·') && !line.includes('All done'))).toBe(false)
})

const PANE = {
  plugin: 'glanceflow',
  component: 'Pane',
  requestId: 'glanceflow-history',
  props: { title: 'History', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

/** A project folder, and a pane that opens. */
function historyWorld(on: On, project: { cwd: string }) {
  on('session.cwd', () => ({ value: project.cwd }) as never)
  on('session.id', () => ({ value: 'chat-1' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
}

async function paneTexts($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = [
    ...(await ui.findAll({ type: 'Text' })),
    ...(await ui.findAll({ type: 'Select' })),
    ...(await ui.findAll({ type: 'Button' })),
  ].map(one => one.text)
  await ui.unmount()

  return found
}

describe('history days', () => {
  test('today, yesterday and a date are understood', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    expect(dayFromArgument('', now)).toBe('2026-10-06')
    expect(dayFromArgument(' yesterday', now)).toBe('2026-10-05')
    expect(dayFromArgument(' 2026-09-30', now)).toBe('2026-09-30')
    expect(dayFromArgument(' last week', now)).toBe(null)
  })

  test('days older than 30 are cleaned away', () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    expect(expiredHistoryKeys(['history:2026-08-01', 'history:2026-09-20', 'glanceEnabled'], now)).toEqual([
      'history:2026-08-01',
    ])
  })

  test('a stored day reads as its entries, and anything else as none', () => {
    const day = [pastJob('a', '/p', 1, 60_000), pastJob('b', '/p', 2, 120_000)]
    expect(dayEntries(day)).toEqual(day)
    expect(dayEntries(undefined)).toEqual([])
    expect(dayEntries(null)).toEqual([])
    expect(dayEntries({ jobId: 'a' })).toEqual([])
  })

  test("each chat keeps its own key for a day; the day's old shared key is told apart", () => {
    const now = new Date(2026, 9, 6, 12).getTime()
    expect(historyKey('2026-10-06', 'chat-1')).toBe('history:2026-10-06:chat-1')
    expect(historyDay('history:2026-10-06:chat-1')).toBe('2026-10-06')
    expect(historyDay('history:2026-10-06')).toBe('2026-10-06')
    expect(sharedDayKeys(['history:2026-10-06', 'history:2026-10-06:chat-1', 'glanceEnabled'])).toEqual(['history:2026-10-06'])
    expect(expiredHistoryKeys(['history:2026-08-01:chat-1', 'history:2026-09-06:chat-1', 'history:2026-09-20:chat-2'], now)).toEqual([
      'history:2026-08-01:chat-1',
    ])
  })

  test('jobs from several keys read once each, the later copy winning, oldest first', () => {
    const early = { ...pastJob('a', '/p', 1, 60_000), startedAt: 5 }
    const late = { ...pastJob('b', '/p', 1, 60_000), startedAt: 9 }
    const redone = { ...early, title: 'Picked up again' }
    expect(mergedEntries([[late, early], undefined, [redone]])).toEqual([redone, late])
  })
})

test('only the most recent saved checklists stay', () => {
  expect(staleResumeKeys([['a', 3], ['b', 1], ['c', 2]], 2)).toEqual(['b'])
  expect(staleResumeKeys([['a', 3]], 2)).toEqual([])
})

test('/glanceflow on and off set a setting, and anything else flips it', () => {
  expect(toggled('on', false)).toBe(true)
  expect(toggled('on', true)).toBe(true)
  expect(toggled('off', true)).toBe(false)
  expect(toggled('off', false)).toBe(false)
  expect(toggled('', true)).toBe(false)
  expect(toggled('', false)).toBe(true)
})

test("each finished job is saved, and /glanceflow history shows the day's jobs for this project", async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 6, 9, 42).getTime() })
  mock.store(on)
  const project = { cwd: '/work/landing-site' }
  historyWorld(on, project)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}) as never)

  // A finished job.
  await $.turn.start({ text: 'Build the pricing section', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await clock.advance(12 * 60_000 + 30_000)
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  // A stopped job.
  await clock.advance(60_000)
  await $.turn.start({ text: 'Fix the menu', turnId: 't2' })
  await callTool($, { tool: PLAN, steps: ['Find the menu', 'Fix it', 'Check it'] })
  await clock.advance(2 * 60_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })

  // A job in another project stays out of this one's history.
  project.cwd = '/work/other-project'
  await $.turn.start({ text: 'Rename the files', turnId: 't3' })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
  project.cwd = '/work/landing-site'

  const result = await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  expect(result.text).toBe(`History for ${dayKey(clock.now())}: 2 tasks.`)

  const shown = (await paneTexts($)).join('\n')
  expect(shown).toContain('09:42')
  expect(shown).toContain('Build the pricing section')
  expect(shown).toContain('2/2 · 12m 30s')
  expect(shown).toContain('Fix the menu')
  expect(shown).toContain('■')
  expect(shown).toContain('0/3 · 2m 0s')
  expect(shown).not.toContain('Rename the files')
  expect(shown).toContain('Total: 2 tasks · 1 done, 1 stopped · 14m 30s')
})

test('a day with nothing saved says so', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  await $.command.run({ command: 'glanceflow', args: 'history 2026-01-01' } as never)
  expect((await paneTexts($)).join('\n')).toContain('No tasks saved for this project on that day yet.')
})

const ENTRY = {
  project: '/work/landing-site',
  newTokens: 3000,
  cachedTokens: 225_000,
  isQuickAnswer: false,
} as const

test('the team report is plain: done, in progress, stuck and time, without tokens or quick questions', () => {
  const at = new Date(2026, 9, 6, 9, 0).getTime()
  const report = teamReport({
    day: '2026-10-06',
    project: '/work/landing-site',
    entries: [
      { ...ENTRY, jobId: 'a', startedAt: at, finishedAt: at + 12 * 60_000, title: 'Build the pricing section', outcome: 'done', stepsDone: 2, stepsTotal: 2, doneSteps: ['Write the prices', 'Check the layout'], openSteps: [] },
      { ...ENTRY, jobId: 'b', startedAt: at + 20 * 60_000, finishedAt: at + 22 * 60_000, title: 'Fix the menu', outcome: 'stopped', stepsDone: 1, stepsTotal: 3, doneSteps: ['Find the menu'], openSteps: ['Fix the links', 'Check it'] },
      { ...ENTRY, jobId: 'c', startedAt: at + 30 * 60_000, finishedAt: at + 31 * 60_000, title: 'Update the footer', outcome: 'stuck', stepsDone: 0, stepsTotal: 2, doneSteps: [], openSteps: ['Edit it', 'Check it'] },
      { ...ENTRY, jobId: 'd', startedAt: at + 40 * 60_000, finishedAt: at + 40 * 60_000, title: 'Answer your question', outcome: 'done', stepsDone: 1, stepsTotal: 1, doneSteps: [], openSteps: [], isQuickAnswer: true },
    ],
  })
  expect(report).toContain('Daily update · landing-site ·')
  expect(report).toContain('Done\n• Build the pricing section (12 min)\n  Write the prices · Check the layout')
  expect(report).toContain('Still open\n• Fix the menu: 1 of 3 steps done; next: fix the links')
  expect(report).toContain('Needs attention\n• Update the footer: it got stuck and needs a decision')
  expect(report).toContain('1 of 3 tasks finished · 15 min of work')
  expect(report).not.toContain('Answer your question')
  expect(report).not.toContain('token')
  expect(report).not.toContain('cached')
})

test('before any work the band says where the plan will show, without a Fresh chat button', async ($, on) => {
  world(on)
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain("Ask Claude for something: its plan shows here")
  expect(shown).toContain('≣ History')
  expect(shown).not.toContain('Fresh chat')
})

test('Details keeps the tool rows in view; Simple hides them', async ($, on) => {
  world(on)
  const PROGRESS_ROW = {
    plugin: 'glanceflow',
    component: 'ToolProgress',
    props: { tool_use_id: 'tu1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  } as const
  let drawn = ''
  on('ui.render', { component: 'ToolProgress' }, (_, e) => {
    drawn = (e.props as { hint: string }).hint
    return { type: 'Text', props: {}, children: [drawn] } as never
  })
  const hint = async () => {
    const ui = await $.ui.mount({ ...PROGRESS_ROW, surface: 'terminal' } as never)
    await ui.unmount()
    return drawn
  }
  expect(await hint()).not.toContain('ctrl+b')
  await detailsOn($)
  expect(await hint()).toContain('ctrl+b')
})

test('a long plan says how many steps are out of view', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'] })
  await callTool($, { tool: PROGRESS, task: 'Three', percent: 100 })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 4 }, surface: 'terminal' })
  const shown = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await ui.unmount()
  expect(shown).toContain('… 3 earlier · 4 more steps')
  expect(shown).toContain('Four')
})

test('a long plan folds its finished steps and the ones after next, so the band stays short', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'] })
  await callTool($, { tool: PROGRESS, task: 'Three', percent: 100, summary: 'Wrote the three sections' })
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('3 steps done')
  expect(shown).toContain('    Wrote the three sections')
  expect(shown).toContain('Four')
  expect(shown).toContain('Five')
  expect(shown).toContain('3 more steps')
  for (const hidden of ['One', 'Two', 'Six', 'Seven', 'Eight']) expect(shown).not.toMatch(new RegExp(`^${hidden}\\b`, 'm'))

  // Five steps or fewer stay as they are.
  await $.turn.start({ text: 'Fix the menu', turnId: 't2' })
  await callTool($, { tool: PLAN, steps: ['A1', 'B2', 'C3', 'D4', 'E5'] })
  await callTool($, { tool: PROGRESS, task: 'B2', percent: 100 })
  const short = (await texts($, 'terminal')).join('\n')
  for (const name of ['A1', 'B2', 'C3', 'D4', 'E5']) expect(short).toContain(name)
})

test('names in any script line up: CJK and emoji take two cells', () => {
  expect(fit('Read notes', 12)).toBe('Read notes  ')
  expect(fit('设计页面', 10)).toBe('设计页面  ')
  expect(fit('设计页面设计', 9)).toBe('设计页面…')
  expect(fit('设计页面设计', 8)).toBe('设计页… ')
  expect(fit('Ship it 🚀', 10)).toBe('Ship it 🚀')
  expect(fit('Διάβασε τις σημειώσεις', 10)).toBe('Διάβασε τ…')
})

test('with room for one row, the current step is the one shown', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four'] })
  await callTool($, { tool: PROGRESS, task: 'One', percent: 100 })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 3 }, surface: 'terminal' })
  const shown = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await ui.unmount()
  expect(shown).toContain('Two')
  expect(shown).not.toContain('One ')
})

test('the band has History and Fresh chat buttons while GlanceFlow is on', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).toContain(surface === 'terminal' ? '≣ History' : 'History')
    // The desktop offers a fresh chat once it helps: not mid-job, when it would end the work in hand.
    if (surface === 'terminal') expect(shown).toContain('↻ Fresh chat')
    else expect(shown).not.toContain('Fresh chat')
  }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect((await texts($, 'desktop')).join('\n')).toContain('Fresh chat')
  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  const off = (await texts($, 'terminal')).join('\n')
  expect(off).not.toContain('≣ History')
})

test('in the Desktop app the view is a menu at the top right, and everything that acts sits together at the bottom right', async ($, on) => {
  world(on)
  // Another mod's card, with words, stays under the band. (A test can't hold another mod's button; isButtonsOnly
  // below is what lets one, Replay say, join the actions.)
  let beneath: unknown = null
  // Claude Code 2.1.295 takes only a tree from a ui.render hook: with no card, the engine's part is an empty Box.
  on('ui.render', { component: 'AbovePrompt' }, () => (beneath ?? { type: 'Box', props: {}, children: [] }) as never)
  const drawn = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const boxes = await ui.findAll({ type: 'Box' })
    const part = (key: string) => JSON.stringify(boxes.find(one => one.props.key === key) ?? null)
    const menus = (await ui.findAll({ type: 'Select' })).map(one => (one.props.options as { label: string }[]).map(option => option.label).join(' / '))
    const all = JSON.stringify(boxes[0] ?? null)
    await ui.unmount()
    return { top: part('header-right'), bottom: part('actions'), menus, all }
  }

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  const working = await drawn()
  expect(working.menus).toEqual(['Detailed / Simple / Off'])
  expect(working.top).toContain('"type":"Select"')
  expect(working.top).not.toContain('Pause')
  expect(working.bottom).toContain('Pause')
  expect(working.bottom.indexOf('Pause')).toBeGreaterThan(working.bottom.indexOf('Settings'))
  expect(working.bottom).not.toContain('"type":"Select"')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  const stopped = await drawn()
  expect(stopped.bottom.indexOf('Fresh chat')).toBeGreaterThan(stopped.bottom.indexOf('Settings'))
  expect(stopped.bottom.indexOf('Continue')).toBeGreaterThan(stopped.bottom.indexOf('Fresh chat'))
  expect(stopped.top).not.toContain('Continue')

  beneath = { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['A card from another mod'] }] }
  const card = await drawn()
  expect(card.bottom).not.toContain('A card from another mod')
  expect(card.all).toContain('A card from another mod')
})

test('in the Desktop app the welcome cards and the empty band keep that frame: the view on top, places left, actions right', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'desktop' } as never)
  const drawn = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const boxes = await ui.findAll({ type: 'Box' })
    const part = (key: string) => JSON.stringify(boxes.find(one => one.props.key === key) ?? null)
    await ui.unmount()
    return { top: part('header-right'), bottom: part('actions'), tour: part('tour') }
  }

  const welcome = await drawn()
  expect(welcome.top).toContain('"type":"Select"')
  expect(welcome.tour.indexOf('Settings')).toBeGreaterThan(welcome.tour.indexOf('History'))
  expect(welcome.tour.indexOf('Skip')).toBeGreaterThan(welcome.tour.indexOf('Settings'))
  expect(welcome.tour.indexOf('Next')).toBeGreaterThan(welcome.tour.indexOf('Skip'))

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tour-skip' })
  await band.unmount()
  const empty = await drawn()
  expect(empty.top).toContain('"type":"Select"')
  expect(empty.top).not.toContain('History')
  expect(empty.bottom).toContain('History')
})

test('in the Desktop app a job that stops on a question offers no Continue, which would read as yes', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it', 'Ship it'] })
  await $.turn.complete({ answer: 'I stopped before the check.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await texts($, 'desktop')).join('\n')).toContain('Continue')

  await $.turn.start({ text: 'continue', turnId: 't2' })
  await $.turn.complete({ answer: 'Should I deploy it now?', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const asked = (await texts($, 'desktop')).join('\n')
  expect(asked).toContain('Should I deploy it now?')
  expect(asked).not.toContain('Continue')
})

test('the second welcome card says where the yellow is: in the words on the terminal, a bell beside them in the Desktop app', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'desktop' } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tour-next' })
  await band.unmount()
  expect((await texts($, 'desktop', 120)).join('\n')).toContain('Needs you beside a yellow bell')
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('Needs you in yellow')
})

test('in the Desktop app a step row keeps whole words: in a narrow band the name stays and what follows keeps whole words', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read your brand notes', 'Polish the footer'] })
  await callTool($, { tool: PROGRESS, task: 'Read your brand notes', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Polish the footer', percent: 100, summary: 'Tidied the footer links' })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // 30 cells leave about 32 characters past the mark: the name, " · ", then as many whole words as fit.
  const narrow = await texts($, 'desktop', 30)
  expect(narrow).toContain('Polish the footer')
  expect(narrow.some(one => one.endsWith(' · Tidied the…'))).toBe(true)
  expect((await texts($, 'desktop', 80)).some(one => one.endsWith('Tidied the footer links'))).toBe(true)
})

test('in the Desktop app the Plan panel says Usage, as the band does, so it does not read as the Plan button', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.command.run({ command: 'glanceflow', args: 'details on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await $.session.measure({ context: { window: 200_000, tokens: 68_000, percent: 34 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }], changed: ['context', 'rateLimits'] } as never)
  const ui = await $.ui.mount({ ...PLAN_PANE, surface: 'desktop' })
  const words = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await ui.unmount()
  expect(words).toContain('Usage: 5-hour 42%')
  expect(words).not.toContain('Plan usage')
})

test('in the Desktop app History reads every time one way, as the report does, and the report puts Copy report last', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 6, 18, 0).getTime() })
  mock.store(on, {
    'history:2026-10-06': [
      { ...ENTRY, jobId: 'a', startedAt: new Date(2026, 9, 6, 9, 0).getTime(), finishedAt: new Date(2026, 9, 6, 9, 12, 30).getTime(), title: 'Build the pricing section', outcome: 'done', stepsDone: 2, stepsTotal: 2, doneSteps: ['Write it', 'Check it'], openSteps: [] },
    ],
  })
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.copy', () => ({ value: { isCopied: true } }) as never)
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const list = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = (await list.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  // A job's details sit in empty room under its name: nothing there for a screen reader to say.
  expect((await list.findAll({ type: 'Svg' })).map(one => String(one.props.alt))).not.toContain('Detail')
  await list.press({ key: 'report' })
  await list.unmount()
  expect(shown).toContain('13 min')
  expect(shown).not.toContain('12m 30s')

  const report = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const boxes = await report.findAll({ type: 'Box' })
  await report.unmount()
  const actions = JSON.stringify(boxes.find(one => one.props.key === 'report-actions') ?? null)
  expect(actions.indexOf('Copy report')).toBeGreaterThan(actions.indexOf('Back to the list'))
  expect(actions.indexOf('Copy report')).toBeGreaterThan(actions.indexOf('Week report'))
})

test('in the Desktop app the mark beside a state says Status, so a screen reader hears the state once', async ($, on) => {
  world(on)
  const alts = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const found = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
    await ui.unmount()
    return found
  }
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(await alts()).toContain('Status')
  expect(await alts()).not.toContain('Needs you')
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await alts()).toContain('Status')
  expect(await alts()).not.toContain('All done')
})

test('in the Desktop app the bold words of a header are never cut: a narrow band says them in fewer whole words', async ($, on) => {
  world(on)
  on('classic.Stop', () => ({}) as never)
  await $.turn.start({ text: 'Merge the pull request', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Watch the checks'] })
  await callTool($, { tool: PROGRESS, task: 'Watch the checks', percent: 100 })
  await $.turn.complete({ answer: 'Merged. Watching CI.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Wait for the checks' }],
  } as never)
  for (const [width, lead] of [[30, 'Background'], [40, 'In the background'], [60, 'Still working in the background']] as const) {
    const shown = await texts($, 'desktop', width)
    expect(shown).toContain(lead)
    expect(shown.join('\n')).not.toMatch(/(Still|In the|Backgr)\w*…/)
  }
})

test('in the Desktop app the welcome card says Welcome whole in a narrow band and once to a screen reader, and its words sit in empty room', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'desktop' } as never)
  expect(await texts($, 'desktop', 80)).toContain('Welcome to GlanceFlow')
  const narrow = await texts($, 'desktop', 30)
  expect(narrow).toContain('Welcome')
  expect(narrow).not.toContain('Welcome to GlanceFlow')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const words = (await ui.findAll({ type: 'Box' })).find(one => one.props.key === 'tour-text')
  const alts = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
  await ui.unmount()
  expect(JSON.stringify(words ?? null)).not.toContain('"type":"Svg"')
  // The mark beside "Welcome to GlanceFlow" says Status, as every header's does, so Welcome is heard once.
  expect(alts).toContain('Status')
  expect(alts).not.toContain('Welcome')
})

test('in the Desktop app a line under a step starts in empty room as wide as a mark, so a screen reader hears no blank', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Check the page', 'Fix the links'] })
  await callTool($, { tool: 'Bash', command: 'npx playwright test', description: 'Check the page on a phone screen' })
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'Review it', description: 'Review the page', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const boxes = await band.findAll({ type: 'Box' })
  const alts = (await band.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
  await band.unmount()
  type Drawn = { type: string; props: Record<string, unknown>; children?: Drawn[] }
  const first = (key: string) => (boxes.find(one => one.props.key === key) as unknown as Drawn | undefined)?.children?.[0]
  expect(first('helper-a1')).toEqual({ type: 'Box', props: { width: 2, flexShrink: 0 } })
  expect(first('task-0')?.props).toEqual({ width: 2, flexShrink: 0 })
  expect(alts).not.toContain('Detail')
  expect(alts).not.toContain('Helper')

  await detailsOn($)
  const plan = await $.ui.mount({ ...PLAN_PANE, surface: 'desktop' })
  const planAlts = (await plan.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
  await plan.unmount()
  expect(planAlts).not.toContain('Detail')
})

test('in the Desktop app no mark says again what the words beside it say, in the band, the Plan or History', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const drawn = async (mount: Parameters<Engine['ui']['mount']>[0]) => {
    const ui = await $.ui.mount(mount)
    const boxes = await ui.findAll({ type: 'Box' })
    await ui.unmount()
    return boxes
  }
  const noticeOf = (boxes: unknown[]) => (boxes as Drawn[]).find(one => one.props.key === 'limit')?.children?.[0]
  const measure = (context: number, limit: number) =>
    $.session.measure({
      context: { window: 200_000, tokens: context * 2000, percent: context },
      rateLimits: [{ kind: 'five_hour', percentUsed: limit }],
      changed: ['context', 'rateLimits'],
    } as never)

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write the page', percent: 40 })
  // The bar says 40%; the mark beside the step's name says Now.
  expect(echoes(await drawn({ ...BAND, surface: 'desktop' }))).toEqual([])
  expect(echoes(await drawn({ ...PLAN_PANE, surface: 'desktop' }))).toEqual([])

  // A notice's words say what it is: its mark says Notice.
  await measure(60, 10)
  let band = await drawn({ ...BAND, surface: 'desktop' })
  expect(echoes(band)).toEqual([])
  expect(JSON.stringify(noticeOf(band))).toContain('"alt":"Notice"')
  await measure(10, 85)
  band = await drawn({ ...BAND, surface: 'desktop' })
  expect(echoes(band)).toEqual([])
  expect(JSON.stringify(noticeOf(band))).toContain('"alt":"Notice"')
  await detailsOn($)
  await measure(10, 20)
  band = await drawn({ ...BAND, surface: 'desktop' })
  expect(echoes(band)).toEqual([])
  expect(JSON.stringify(noticeOf(band))).toContain('"alt":"Notice"')

  // History with nothing saved says so in words; its mark says Notice, History being the panel's title, read just before.
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const history = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await history.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
  const words = (await history.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await history.unmount()
  expect(words).toContain('No tasks saved')
  expect(alts).toEqual(['Notice'])
})

test("in the Desktop app a panel's marks say neither its title nor the words beside them: Settings, Where we left off, an empty Plan", async ($, on) => {
  world(on)
  const read = async (requestId: string, title: string) => {
    const ui = await $.ui.mount({ ...PANE, requestId, props: { ...PANE.props, title }, surface: 'desktop' } as never)
    const boxes = await ui.findAll({ type: 'Box' })
    const alts = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
    await ui.unmount()
    return { echoes: echoes(boxes), alts, titled: alts.filter(alt => title.toLowerCase().includes(alt.toLowerCase())) }
  }

  // Each setting's mark says Setting; its name follows once, in bold.
  const settings = await read('glanceflow-settings', 'GlanceFlow settings')
  expect(settings.echoes).toEqual([])
  expect(settings.alts.length > 0 && settings.alts.every(alt => alt === 'Setting')).toBe(true)

  // With no checkpoint yet the words say so; the mark says Notice, not Checkpoint again.
  const recap = await read('glanceflow-recap', 'Where we left off')
  expect(recap.echoes).toEqual([])
  expect(recap.titled).toEqual([])
  expect(recap.alts).toEqual(['Notice'])

  // An empty Plan: the panel's title says Plan, the words say there is none yet.
  const plan = await read('glanceflow-plan', 'Plan')
  expect(plan.echoes).toEqual([])
  expect(plan.titled).toEqual([])
  expect(plan.alts).toEqual(['Notice'])
})

test('in the Desktop app a header keeps whole pieces: what has no room is left out, never cut mid-word', async ($, on) => {
  expect(wholePieces(['Build my landing page', 'took 3m 46s'], 30)).toBe('Build my landing page')
  expect(wholePieces(['Build my landing page', 'took 3m 46s'], 20)).toBe('took 3m 46s')
  expect(wholePieces(['Should I release 0.24.0 now?'], 18)).toBe('Should I release…')
  expect(wholePieces(['Build my landing page'], 5)).toBe('')

  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const width of [30, 44, 60]) {
    const header = (await texts($, 'desktop', width)).find(one => one.startsWith('All done')) ?? ''
    expect(header).not.toContain('…')
  }
})

test('in the Desktop app a usage limit offers Check again, and a stopped job with a full chat offers Tidy up now alone', async ($, on) => {
  world(on)
  on('classic.StopFailure', () => ({}) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await $.classic.StopFailure({ error: 'rate_limit', error_details: '' } as never)
  const stuck = (await texts($, 'desktop')).join('\n')
  expect(stuck).toContain('Check again')
  expect(stuck).not.toContain('Try again')

  await $.turn.start({ text: 'continue', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  expect((await texts($, 'desktop')).join('\n')).toContain('Fresh chat')
  await $.session.measure({ context: { window: 200_000, tokens: 120_000, percent: 60 }, rateLimits: [], changed: ['context'] } as never)
  const full = (await texts($, 'desktop')).join('\n')
  expect(full).toContain('Tidy up now')
  expect(full).not.toContain('Fresh chat')
  expect(full).toContain('Continue')
})

test('another mod that draws only buttons joins the actions; anything with words, or nothing, does not', () => {
  const button = (label: string) => ({ type: 'Button', props: { key: label, label } })
  expect(isButtonsOnly(button('Replay 1 edit'))).toBe(true)
  expect(isButtonsOnly({ type: 'Box', props: {}, children: [button('One'), { type: 'Box', props: {}, children: [button('Two')] }] })).toBe(true)
  expect(isButtonsOnly({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['▶ Replay: 1 edit (press r)'] }, button('Replay')] })).toBe(false)
  expect(isButtonsOnly({ type: 'Box', props: {}, children: [] })).toBe(false)
  expect(isButtonsOnly(null)).toBe(false)

  // Stacked under another mod's row (the next-steps suggestions, say), Replay still comes out; the row stays.
  const row = { type: 'Box', props: { flexDirection: 'row' }, children: [{ type: 'Text', props: {}, children: ['Try asking'] }, button('Run the tests')] }
  expect(liftButtons({ type: 'Box', props: { flexDirection: 'column' }, children: [button('Replay 1 edit'), row] })).toEqual({
    buttons: [button('Replay 1 edit')],
    rest: { type: 'Box', props: { flexDirection: 'column' }, children: [row] },
  })
  expect(liftButtons(row)).toEqual({ buttons: [], rest: row })

  // In a narrow band next-steps puts its lead on a line of its own over a column of button rows: those rows are its
  // own group and stay with "Try asking"; only Replay, a button on its own, comes up.
  const stacked = {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [
      { type: 'Box', props: { flexShrink: 0 }, children: [{ type: 'Text', props: {}, children: ['Try asking'] }] },
      { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Box', props: { flexDirection: 'row' }, children: [button('Run the tests')] }, { type: 'Box', props: { flexDirection: 'row' }, children: [button('Review it'), button('Hide')] }] },
    ],
  }
  expect(liftButtons({ type: 'Box', props: { flexDirection: 'column' }, children: [button('Replay 1 edit'), stacked] })).toEqual({
    buttons: [button('Replay 1 edit')],
    rest: { type: 'Box', props: { flexDirection: 'column' }, children: [stacked] },
  })
  expect(liftButtons({ type: 'Box', props: { flexDirection: 'column' }, children: [button('One'), button('Two')] }).buttons).toHaveLength(2)
  expect(liftButtons(null)).toEqual({ buttons: [], rest: null })
})

/** Symbols Unicode 16 draws two cells wide (East Asian Width W) while Claude Code counts one, so a row holding one shifts. */
const WIDE_SYMBOLS =
  /[⌚-⌛〈-〉⏩-⏬⏰⏳◽-◾☔-☕☰-☷♈-♓♿⚊-⚏⚓⚡⚪-⚫⚽-⚾⛄-⛅⛎⛔⛪⛲-⛳⛵⛺⛽✅✊-✋✨❌❎❓-❕❗➕-➗➰➿⬛-⬜⭐⭕]/

test('the band and History draw only symbols every terminal counts as one cell', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const shown = [...(await texts($, 'terminal')), ...(await paneTexts($))]
  expect(shown.filter(text => WIDE_SYMBOLS.test(text))).toEqual([])

  // The day picker's label has no colon of its own; the terminal draws "Day: Today, …".
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const [day] = await ui.findAll({ type: 'Select' })
  await ui.unmount()
  expect((day?.props as { label?: string } | undefined)?.label).toBe('Day')
})

/** The terminal's glyph marks and meters, which the desktop draws as SVG instead. */
const GLYPH_MARKS = /[✓✗▶◀‖■◷◐◑◒◓○●◎≣⚙↻▤⚠↳█░]/

test('on the desktop every mark is an SVG icon, and no text or button carries a glyph', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100, summary: 'Wrote the page' })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const SETTINGS = { ...PANE, requestId: 'glanceflow-settings' } as const
  for (const target of [BAND, PLAN_PANE, PANE, SETTINGS]) {
    const ui = await $.ui.mount({ ...target, surface: 'desktop' } as never)
    const svgs = await ui.findAll({ type: 'Svg' })
    const buttons = await ui.findAll({ type: 'Button' })
    const words = [...(await ui.findAll({ type: 'Text' })), ...buttons].map(one => one.text)
    await ui.unmount()
    expect(svgs.length > 0).toBe(true)
    // A plain button reads as text in the desktop app: every one there is the app's own button.
    expect(buttons.filter(one => (one.props as { plain?: boolean }).plain).map(one => one.text)).toEqual([])
    expect(svgs.every(one => String(one.props.source).startsWith('<svg '))).toBe(true)
    expect(words.filter(text => GLYPH_MARKS.test(text))).toEqual([])
  }
})

// A fixed amber or red can't follow the app's theme: on a light window those words fall under 4.5:1 contrast.
test('on the desktop Needs you and Stuck read in the text colour, with the colour in their icon', async ($, on) => {
  world(on)
  on('classic.StopFailure', () => ({}) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  const leadColor = async (lead: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
    const found = (await ui.findAll({ type: 'Text' })).filter(one => one.text === lead)
    await ui.unmount()
    expect(found.length).toBe(1)
    return found[0]?.props.color
  }
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(await leadColor('Needs you')).toBeUndefined()
  await $.classic.StopFailure({ error: 'rate_limit', error_details: '' } as never)
  expect(await leadColor('Stuck')).toBeUndefined()
})

// The desktop app draws nothing for an Svg whose alt is empty: a mark without words would just be missing.
test('on the desktop every drawing says what it is, in every state of the checklist and in every panel', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  const SETTINGS = { ...PANE, requestId: 'glanceflow-settings' } as const
  const nameless = async (...targets: object[]) => {
    const found: string[] = []
    for (const target of targets) {
      const ui = await $.ui.mount({ ...target, surface: 'desktop' } as never)
      const svgs = await ui.findAll({ type: 'Svg' })
      await ui.unmount()
      found.push(...svgs.filter(one => String(one.props.alt ?? '').trim() === '').map(one => String(one.props.source).slice(0, 80)))
    }
    return found
  }
  expect(await nameless(BAND)).toEqual([])
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100, summary: 'Wrote the page' })
  await callTool($, { tool: 'Bash', command: 'npm run build' })
  await $.command.run({ command: 'glanceflow', args: 'details on' } as never)
  expect(await nameless(BAND, PLAN_PANE, SETTINGS)).toEqual([])
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(await nameless(BAND, PLAN_PANE)).toEqual([])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(await nameless(BAND, PLAN_PANE)).toEqual([])
  await $.turn.start({ text: 'continue', turnId: 't2' })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  expect(await nameless(BAND, PLAN_PANE, PANE)).toEqual([])
})

test('the History button opens the panel; the day picker moves between days', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 6, 10, 0).getTime() })
  mock.store(on, {
    'history:2026-10-05': [
      { ...ENTRY, jobId: 'y', startedAt: new Date(2026, 9, 5, 15, 0).getTime(), finishedAt: new Date(2026, 9, 5, 15, 5).getTime(), title: 'Write the welcome email', outcome: 'done', stepsDone: 2, stepsTotal: 2, doneSteps: ['Draft it', 'Check it'], openSteps: [] },
    ],
  })
  let opened = 0
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'history' })
  await band.unmount()
  expect(opened).toBe(1)

  let pane = (await paneTexts($)).join('\n')
  expect(pane).toContain(`landing-site · ${longDay(dayKey(clock.now()))}`)
  expect(pane).toContain('No tasks saved for this project on that day yet.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'earlier' })
  await ui.unmount()
  pane = (await paneTexts($)).join('\n')
  expect(pane).toContain('Write the welcome email')
  expect(pane).toContain(longDay('2026-10-05'))
  expect(pane).toContain('Later ▶')

  const picker = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.ui.select({ plugin: 'glanceflow', key: 'day', value: dayKey(clock.now()) })
  await picker.unmount()
  expect((await paneTexts($)).join('\n')).toContain('No tasks saved')
  expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30')
})

test('Team report shows the report and copies it', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 6, 18, 0).getTime() })
  mock.store(on, {
    'history:2026-10-06': [
      { ...ENTRY, jobId: 'a', startedAt: new Date(2026, 9, 6, 9, 0).getTime(), finishedAt: new Date(2026, 9, 6, 9, 12).getTime(), title: 'Build the pricing section', outcome: 'done', stepsDone: 2, stepsTotal: 2, doneSteps: ['Write it', 'Check it'], openSteps: [] },
    ],
  })
  let copied = ''
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } } as never
  })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await ui.unmount()
  expect(copied).toContain('Daily update · landing-site')
  expect(copied).toContain('• Build the pricing section (12 min)')
  expect((await paneTexts($)).join('\n')).toContain('Daily update · landing-site')
})

test('Fresh chat asks for a second press, then clears the chat and sends a handoff note', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  let cleared = false
  let sent = ''
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Continuing from an earlier chat. Here is where things stand: the menu is fixed.', usage: {} } }) as never)
  on('command.run', (_, e) => {
    cleared = cleared || e.command === 'clear'
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    sent = e.text
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  // Fresh chat shows once the chat has some work in it.
  await $.turn.start({ text: 'Fix the menu', turnId: 't1' })

  const press = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'handoff' })
    await ui.unmount()
  }

  // One press only arms it, and it calms down again after 8 seconds.
  await press()
  expect((await texts($, 'terminal')).join('\n')).toContain('Press again to start a fresh chat')
  expect(cleared).toBe(false)
  await clock.advance(8000)
  expect((await texts($, 'terminal')).join('\n')).toContain('↻ Fresh chat')

  // Two presses hand off.
  await press()
  await press()
  expect(cleared).toBe(true)
  expect(sent).toContain('Continuing from an earlier chat')
  expect((await texts($, 'terminal')).join('\n')).toContain('↻ Fresh chat')
})

/** A finished job in a folder whose origin is `remote`, with what Ship it sends kept in `sent`. */
async function shipWorld($: Engine, on: On, remote: string, toolAnswer?: () => unknown) {
  const clock = world(on, toolAnswer)
  const sent: string[] = []
  on('process.run', () => ({ value: { exitCode: remote ? 0 : 2, stdout: remote, stderr: '' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await $.turn.start({ text: 'Fix the menu', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Fix it', 'Check it'] })
  return { sent, clock }
}

const finish = async ($: Engine) => {
  await callTool($, { tool: PROGRESS, task: 'Fix it', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'The menu is fixed.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
}

test('Ship it shows on a finished job in a GitHub project once Finish on GitHub is on, and ships on a second press', async ($, on) => {
  const { sent } = await shipWorld($, on, 'git@github.com:me/site.git\n')
  // Mid-job, and with the setting off, there is no Ship it.
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  expect((await texts($, 'terminal')).join('\n')).not.toContain('Ship it')
  await $.command.run({ command: 'glanceflow', args: 'ship off' } as never)
  await finish($)
  for (const surface of SURFACES) expect((await texts($, surface)).join('\n')).not.toContain('Ship it')

  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  expect((await texts($, 'terminal')).join('\n')).toContain('⇡ Ship it')
  expect(await texts($, 'desktop')).toContain('Ship it')

  const press = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'ship' })
    await ui.unmount()
  }
  await press()
  expect((await texts($, 'terminal')).join('\n')).toContain('Press again to ship')
  expect(sent).toEqual([])
  await press()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('gh pr checks --watch')
  expect(sent[0]).toContain('nothing to ship and stop')
  expect(sent[0]).toContain('Never merge with --admin or --auto')
  expect(sent[0]).toContain('are not permission to merge')
  expect(sent[0]).toContain('Reply exactly: Approve merge <full SHA>')
  expect(sent[0]).toContain('Anything else leaves the pull request open.')
  expect(sent[0]).toContain('gh pr merge --squash --delete-branch --match-head-commit <full SHA>')
  expect(sent[0]).not.toContain('Merge it?')
})

const SHA = 'd'.repeat(40)
const OTHER_SHA = 'e'.repeat(40)
const mergeAt = (sha: string) => `gh pr merge 12 --squash --delete-branch --match-head-commit ${sha}`

test('unsafeMerge lets a merge through only at the approved head commit, never with --admin, --auto or gh api', () => {
  expect(unsafeMerge(mergeAt(SHA), SHA)).toBeNull()
  expect(unsafeMerge(`${mergeAt(SHA)} --disable-auto`, SHA)).toBeNull()
  expect(unsafeMerge(`bash -c "${mergeAt(SHA)}"`, SHA)).toBeNull()
  expect(unsafeMerge('gh pr view 12 --json headRefOid', null)).toBeNull()
  expect(unsafeMerge('git status && gh pr checks 12 --watch', null)).toBeNull()

  for (const command of [
    mergeAt(SHA).replace(SHA, SHA.slice(0, 7)),
    'gh pr merge 12 --squash',
    'gh pr merge 12 --disable-auto',
    'cd site && gh pr merge 12',
    "bash -c 'gh pr merge 12 --squash'",
    `${mergeAt(SHA)} --match-head-commit ${OTHER_SHA}`,
  ]) {
    expect(unsafeMerge(command, SHA)).toContain('Approve merge')
  }
  expect(unsafeMerge(mergeAt(SHA), null)).toContain('Approve merge')
  expect(unsafeMerge(mergeAt(SHA), OTHER_SHA)).toContain('Approve merge')
  expect(unsafeMerge(`${mergeAt(SHA)} --admin`, SHA)).toContain('--admin or --auto')
  expect(unsafeMerge(`${mergeAt(SHA)} --auto`, SHA)).toContain('--admin or --auto')
  expect(unsafeMerge('gh api -X PUT repos/me/site/pulls/12/merge', SHA)).toContain('gh api')
  expect(unsafeMerge("gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'", SHA)).toContain('gh api')

  for (const command of [
    'gh pr merge 12',
    'cd site && gh pr merge 12',
    'git status; gh pr merge 12',
    'bash -c "gh pr merge 12"',
    "sh -c 'gh pr merge 12'",
    'zsh -c "gh pr merge 12"',
    'bash -c "cd site && gh pr merge 12"',
  ]) {
    expect(runsPrMerge(command)).toBe(true)
    expect(unsafeMerge(command, SHA)).toContain('Approve merge')
  }
  for (const command of [
    'git commit -m "docs | gh pr merge later"',
    'git commit -m "docs; gh pr merge later"',
    "git commit -m 'docs && gh pr merge later'",
    'echo "gh pr merge later"',
    'grep "gh pr merge" README.md',
    'gh pr view 12 --json headRefOid',
    'git commit -m "run sudo gh pr merge later"',
    "echo 'env gh pr merge'",
    'git commit -m "wrap it in bash -c gh pr merge"',
  ]) {
    expect(runsPrMerge(command)).toBe(false)
    expect(unsafeMerge(command, null)).toBeNull()
  }
  expect(runsPrMerge(`bash -c "${mergeAt(SHA)}"`)).toBe(true)
  expect(unsafeMerge(`bash -c "${mergeAt(SHA)}"`, SHA)).toBeNull()
})

// gh api calls that merge, or schedule a merge, without gh pr merge: auto-merge, the merge queue and branch merges.
const API_MERGES = [
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
  "gh api graphql -f query='mutation { enqueuePullRequest(input: {}) { clientMutationId } }'",
  "gh api graphql -f query='mutation { mergeBranch(input: {}) { clientMutationId } }'",
  'gh api -X POST repos/me/site/merges -f base=master -f head=fix',
  'gh api --method POST /repos/{owner}/{repo}/merges -f base=master -f head=fix',
]

test('unsafeMerge refuses gh api auto-merge, merge-queue and branch-merge routes, bare or wrapped, approved or not', () => {
  for (const command of API_MERGES) {
    for (const wrapped of [
      command,
      `(${command})`,
      `env ${command}`,
      `command ${command}`,
      `sudo ${command}`,
      `exec ${command}`,
      `time ${command}`,
      `GH_REPO=me/site ${command}`,
      `{ ${command}; }`,
      `/usr/local/bin/${command}`,
      `eval "${command}"`,
      `bash -c "${command}"`,
      `sudo bash -c "${command}"`,
    ]) {
      expect(runsPrMerge(wrapped)).toBe(false)
      expect(unsafeMerge(wrapped, null)).not.toBeNull()
      expect(unsafeMerge(wrapped, SHA)).not.toBeNull()
    }
    expect(unsafeMerge(command, SHA)).toContain('never through gh api')
  }

  for (const command of [
    "gh api graphql -f query='mutation { disablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
    "gh api graphql -f query='query { repository(owner: \"me\", name: \"site\") { pullRequest(number: 12) { mergeable autoMergeRequest { enabledAt } } } }'",
    'gh api repos/me/site/pulls/12',
    'gh api repos/me/site/contents/docs/merges.md',
    'git commit -m "refuse enablePullRequestAutoMerge and repos/o/r/merges"',
  ]) {
    expect(unsafeMerge(command, null)).toBeNull()
    expect(unsafeMerge(command, SHA)).toBeNull()
  }
})

// gh pr merge, or a gh api merge route, run through a shell wrapper instead of on its own.
const WRAPPED_MERGES = [
  `(${mergeAt(SHA)})`,
  `! ${mergeAt(SHA)}`,
  `env ${mergeAt(SHA)}`,
  `env GH_TOKEN=x ${mergeAt(SHA)}`,
  `command ${mergeAt(SHA)}`,
  `sudo ${mergeAt(SHA)}`,
  `sudo -u me ${mergeAt(SHA)}`,
  `exec ${mergeAt(SHA)}`,
  `time ${mergeAt(SHA)}`,
  `GH_REPO=me/site ${mergeAt(SHA)}`,
  `{ ${mergeAt(SHA)}; }`,
  `/usr/local/bin/${mergeAt(SHA)}`,
  `\\${mergeAt(SHA)}`,
  `sudo bash -c "${mergeAt(SHA)}"`,
  `bash -lc "${mergeAt(SHA)}"`,
  `eval "${mergeAt(SHA)}"`,
  `bash -c "env ${mergeAt(SHA)}"`,
  'echo 12 | xargs gh pr merge --squash',
  '(gh api -X PUT repos/me/site/pulls/12/merge)',
  'env gh api -X PUT repos/me/site/pulls/12/merge',
  'command gh api -X PUT repos/me/site/pulls/12/merge',
  "sudo gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  'eval "gh api -X PUT repos/me/site/pulls/12/merge"',
]

test('unsafeMerge refuses gh pr merge and gh api merges run through a shell wrapper, approved or not', () => {
  for (const command of WRAPPED_MERGES) {
    expect(unsafeMerge(command, null)).not.toBeNull()
    expect(unsafeMerge(command, SHA)).not.toBeNull()
  }
  expect(unsafeMerge(`env ${mergeAt(SHA)}`, SHA)).toContain('directly')
})

test('unsafeMerge refuses an approved merge that shares its command with anything that could hide its exit code', () => {
  expect(unsafeMerge(`  ${mergeAt(SHA)}\n`, SHA)).toBeNull()
  for (const command of [
    `${mergeAt(SHA)}; echo "exit=$?"`,
    `${mergeAt(SHA)}; true`,
    `${mergeAt(SHA)} || true`,
    `${mergeAt(SHA)} | cat`,
    `${mergeAt(SHA)} && echo ok`,
    `${mergeAt(SHA)} &`,
    `${mergeAt(SHA)};`,
    `git status; ${mergeAt(SHA)}`,
    `bash -c "${mergeAt(SHA)}; true"`,
    `bash -c "${mergeAt(SHA)}"; echo done`,
  ]) {
    expect(runsPrMerge(command)).toBe(true)
    expect(unsafeMerge(command, SHA)).toContain('on its own')
  }
  // Without the approval, the approval comes first.
  expect(unsafeMerge(`${mergeAt(SHA)}; true`, null)).toContain('Approve merge')
})

// curl and wget calls to the REST pull and branch merges and the four GraphQL merge mutations.
const HTTP_MERGES = [
  'curl -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  'wget --method=PUT -O- https://api.github.com/repos/me/site/pulls/12/merge',
  `curl -X POST https://api.github.com/repos/me/site/merges -d '{"base":"master","head":"fix"}'`,
  `wget --method=POST --body-data='{"base":"master","head":"fix"}' https://api.github.com/repos/me/site/merges`,
  ...['mergePullRequest', 'enablePullRequestAutoMerge', 'enqueuePullRequest', 'mergeBranch'].flatMap(mutation => [
    `curl -X POST -d '{"query":"mutation { ${mutation}(input: {}) { clientMutationId } }"}' https://api.github.com/graphql`,
    `wget --post-data='{"query":"mutation { ${mutation}(input: {}) { clientMutationId } }"}' https://api.github.com/graphql`,
  ]),
]
const HTTP_REFUSAL = 'Ship it merges only with gh pr merge --match-head-commit, never through curl or wget. Leave the pull request open.'

test('unsafeMerge refuses curl and wget merge calls, bare, wrapped, continued, in a heredoc or through a literal variable', () => {
  for (const command of HTTP_MERGES) {
    for (const wrapped of [
      command,
      `(${command})`,
      `{ ${command}; }`,
      `! ${command}`,
      `env ${command}`,
      `env -i ${command}`,
      `command ${command}`,
      `sudo ${command}`,
      `sudo -u me ${command}`,
      `exec ${command}`,
      `time ${command}`,
      `GH_TOKEN=x ${command}`,
      `/usr/bin/${command}`,
      `\\${command}`,
      `cd site && ${command}`,
      `git status; ${command}`,
      `echo ok | xargs ${command}`,
      `if ${command}; then echo ok; fi`,
      `for i in 1; do ${command}; done`,
      `R=$(${command})`,
      `R=\`${command}\``,
      `eval ${command}`,
      `eval ${JSON.stringify(command)}`,
      `bash -c ${JSON.stringify(command)}`,
      `bash -lc ${JSON.stringify(command)}`,
      `sh -c ${JSON.stringify(command)}`,
      `zsh -c ${JSON.stringify(command)}`,
      `sudo bash -c ${JSON.stringify(command)}`,
    ]) {
      expect(runsPrMerge(wrapped)).toBe(false)
      expect(unsafeMerge(wrapped, null)).toBe(HTTP_REFUSAL)
      expect(unsafeMerge(wrapped, SHA)).toBe(HTTP_REFUSAL)
    }
  }
  expect(unsafeMerge("bash -c 'curl -X PUT https://api.github.com/repos/me/site/pulls/12/merge'", SHA)).toBe(HTTP_REFUSAL)

  for (const command of [
    // Continued lines and several lines.
    'curl -X PUT \\\n  https://api.github.com/repos/me/site/pulls/12/merge',
    'curl \\\n  -X PUT \\\n  https://api.github.com/repos/me/site/pulls/12/merge',
    'wget \\\n  --method=PUT https://api.github.com/repos/me/site/pulls/12/merge',
    'GH_TOKEN=x \\\n  curl -X POST https://api.github.com/repos/me/site/merges',
    'git fetch\ncurl -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
    // A heredoc body in the same command.
    `curl -X POST https://api.github.com/graphql --data-binary @- <<'EOF'\n{"query":"mutation { mergePullRequest(input: {}) { clientMutationId } }"}\nEOF`,
    `wget --post-file=/dev/stdin -O- https://api.github.com/graphql <<EOF\n{"query":"mutation { enqueuePullRequest(input: {}) { clientMutationId } }"}\nEOF`,
    // A literal route kept in a variable.
    'URL=https://api.github.com/repos/me/site/pulls/12/merge; curl -X PUT "$URL"',
    'URL=https://api.github.com/repos/me/site/merges curl -X POST "$URL"',
    'export URL=https://api.github.com/repos/me/site/pulls/12/merge && wget --method=PUT "$URL"',
    `Q='mutation { mergeBranch(input: {}) { clientMutationId } }'\ncurl -d "{\\"query\\":\\"$Q\\"}" https://api.github.com/graphql`,
  ]) {
    expect(unsafeMerge(command, null)).toBe(HTTP_REFUSAL)
    expect(unsafeMerge(command, SHA)).toBe(HTTP_REFUSAL)
  }

  for (const command of [
    'curl -s https://api.github.com/repos/me/site/pulls/12',
    'wget -qO- https://api.github.com/repos/me/site/pulls/12',
    'curl -s https://api.github.com/repos/me/site/pulls/12/merged',
    'curl -s https://api.github.com/repos/me/site/contents/docs/merges.md',
    'wget -qO- https://api.github.com/repos/me/site/contents/docs/merges.md',
    `curl -d '{"query":"query { repository(owner: \\"me\\", name: \\"site\\") { pullRequest(number: 12) { mergeable autoMergeRequest { enabledAt } } } }"}' https://api.github.com/graphql`,
    `curl -d '{"query":"mutation { disablePullRequestAutoMerge(input: {}) { clientMutationId } }"}' https://api.github.com/graphql`,
    'curlie -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
    'echo curl https://api.github.com/repos/o/r/pulls/12/merge',
    'echo wget --method=PUT https://api.github.com/repos/o/r/merges',
    'echo eval curl https://api.github.com/repos/o/r/pulls/12/merge',
    'grep mergePullRequest file.txt',
    'grep -rn "curl -X PUT https://api.github.com/repos/o/r/pulls/12/merge" docs',
    'echo "curl -X PUT https://api.github.com/repos/o/r/pulls/12/merge"',
    "echo 'wget --post-data=mergePullRequest https://api.github.com/graphql'",
    'git commit -m "Refuse curl -X PUT https://api.github.com/repos/o/r/pulls/12/merge"',
    "git commit -m 'block wget calls to repos/o/r/merges'",
    'bash -c "echo curl https://api.github.com/repos/o/r/pulls/12/merge"',
  ]) {
    expect(unsafeMerge(command, null)).toBeNull()
    expect(unsafeMerge(command, SHA)).toBeNull()
  }
})

const API_REFUSAL = 'Ship it merges only with gh pr merge --match-head-commit, never through gh api. Leave the pull request open.'

// gh api GraphQL merge mutations whose body gh api reads from stdin: a heredoc, a pipe, or -F query=@-.
const STDIN_MERGES = ['mergePullRequest', 'enablePullRequestAutoMerge', 'enqueuePullRequest', 'mergeBranch'].flatMap(mutation => {
  const query = `mutation { ${mutation}(input: {}) { clientMutationId } }`
  const body = `{"query":"${query}"}`
  return [
    `gh api graphql --input - <<EOF\n${body}\nEOF`,
    `gh api graphql --input - <<'EOF'\n${body}\nEOF`,
    `echo '${body}' | gh api graphql --input -`,
    `cat <<EOF | gh api graphql --input -\n${body}\nEOF`,
    `gh api graphql -F query=@- <<'EOF'\n${query}\nEOF`,
    `env gh api graphql --input - <<EOF\n${body}\nEOF`,
  ]
})
const STDIN_QUERY = `gh api graphql --input - <<'EOF'\n{"query":"query { viewer { login } }"}\nEOF`

test('unsafeMerge refuses gh api GraphQL merge mutations sent through stdin, approved or not, and leaves harmless ones alone', () => {
  for (const command of STDIN_MERGES) {
    expect(runsPrMerge(command)).toBe(false)
    expect(unsafeMerge(command, null)).toBe(API_REFUSAL)
    expect(unsafeMerge(command, SHA)).toBe(API_REFUSAL)
  }

  for (const command of [
    STDIN_QUERY,
    `gh api graphql -F query=@- <<'EOF'\nquery { repository(owner: "me", name: "site") { pullRequest(number: 12) { mergeable mergeStateStatus autoMergeRequest { enabledAt } } } }\nEOF`,
    `gh api graphql --input - <<'EOF'\n{"query":"mutation { addComment(input: {subjectId: \\"x\\", body: \\"hi\\"}) { clientMutationId } }"}\nEOF`,
    `gh api graphql --input - <<'EOF'\n{"query":"mutation { disablePullRequestAutoMerge(input: {}) { clientMutationId } }"}\nEOF`,
    `echo '{"title":"New title"}' | gh api -X PATCH repos/me/site/pulls/12 --input -`,
    'gh api repos/me/site/pulls/12 --jq .mergeable',
    'git commit -m "guard gh api graphql --input - with mergePullRequest"',
    'echo "gh api graphql --input - mergePullRequest"',
    'grep -rn "gh api graphql --input -" docs | grep mergePullRequest',
    `cat > notes.md <<'EOF'\nmergePullRequest\nEOF`,
  ]) {
    expect(unsafeMerge(command, null)).toBeNull()
    expect(unsafeMerge(command, SHA)).toBeNull()
  }
})

// shellPieces reads a command into the words Bash passes on: [command, words of each piece, run-time words].
const SHELL_WORDS: [string, string[][], string[]][] = [
  ['gh pr merge 12', [['gh', 'pr', 'merge', '12']], []],
  ['"gh" pr merge', [['gh', 'pr', 'merge']], []],
  [`g''h p"r" mer'g'e`, [['gh', 'pr', 'merge']], []],
  ['gh \\\npr \\\nmerge', [['gh', 'pr', 'merge']], []],
  ['g\\\nh pr', [['gh', 'pr']], []],
  ['\\gh pr \\merge', [['gh', 'pr', 'merge']], []],
  [`gh pr $'\\x6d'erge`, [['gh', 'pr', 'merge']], []],
  [`gh pr $'\\155'erge`, [['gh', 'pr', 'merge']], []],
  [`$'a\\tb' $'it\\'s' $'\\\\'`, [['a\tb', "it's", '\\']], []],
  ['"a\\"b\\\\c\\$d\\`e\\x"', [['a"b\\c$d`e\\x']], []],
  [`'a\\b' 'it'"'"'s'`, [['a\\b', "it's"]], []],
  [`--ad''min --match-head-commit=b"bb"`, [['--admin', '--match-head-commit=bbb']], []],
  ['"a b"c d""e "" \'\'', [['a bc', 'de', '', '']], []],
  ['gh api repos/{owner}/{repo}/pulls x=$ \\$X \'$X\'', [['gh', 'api', 'repos/{owner}/{repo}/pulls', 'x=$', '$X', '$X']], []],
  ['a;b && c|d || e & f\ng', [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']], []],
  ['"a;b" \'c|d\' e\\;f', [['a;b', 'c|d', 'e;f']], []],
  ['(gh pr) >out <in', [['(', 'gh', 'pr', ')', '>', 'out', '<', 'in']], []],
  ['echo "$(cat <<\'EOF\'\nx; y\nEOF\n)"', [['echo', '$(cat <<\'EOF\'\nx; y\nEOF\n)']], ['$(cat <<\'EOF\'\nx; y\nEOF\n)']],
  ['$X "$X" ${X} `x` $(x) mer$()ge', [['$X', '$X', '${X}', '`x`', '$(x)', 'mer$()ge']], ['$X', '$X', '${X}', '`x`', '$(x)', 'mer$()ge']],
  ['{merge,} {1..3} mer*e m?rge [m]erge ~/gh =gh', [['{merge,}', '{1..3}', 'mer*e', 'm?rge', '[m]erge', '~/gh', '=gh']], ['{merge,}', '{1..3}', 'mer*e', 'm?rge', '[m]erge', '~/gh', '=gh']],
  [`$"x" $'\\u006d' [ [[ ] { }`, [['x', '\\u006d', '[', '[[', ']', '{', '}']], ['x', '\\u006d']],
  ["gh pr view # it's a#b\ngh mm a#b", [['gh', 'pr', 'view'], ['gh', 'mm', 'a#b']], []],
]

test('shellPieces rebuilds Bash words from quotes, escapes, continued lines and $\'…\', and marks words built at run time', () => {
  for (const [command, words, runTime] of SHELL_WORDS) {
    const pieces = shellPieces(command)
    expect([command, pieces.map(piece => piece.words.map(word => word.text))]).toEqual([command, words])
    expect([command, pieces.flatMap(piece => piece.words.filter(word => word.isRunTime).map(word => word.text))]).toEqual([command, runTime])
  }
  // A heredoc's lines are its body, not commands of their own, and its own quoting does not carry past them.
  const heredoc = shellPieces(`cat <<'EOF'\nit's {a,b}\nEOF\necho ok`)
  expect(heredoc.map(piece => [piece.isBody, piece.words.map(word => word.text)])).toEqual([
    [false, ['cat', '<<', 'EOF']],
    [true, ['its {a,b}']],
    [false, ['echo', 'ok']],
  ])
  expect(shellPieces('cat <<-EOF\n\tbody\n\tEOF\necho ok').map(piece => piece.isBody)).toEqual([false, true, false])
})

// gh pr merge spelled the way Bash rebuilds it: quoted or escaped words, continued lines, $'…' and -R / --repo first.
const SPELLED_MERGES = [
  '"gh" pr merge 12 --squash',
  `g''h pr merge 12 --squash`,
  'gh "pr" merge 12 --squash',
  `gh pr mer''ge 12 --squash`,
  'gh pr mer"ge" 12 --squash',
  'gh pr \\merge 12 --squash',
  `gh pr $'\\x6d'erge 12 --squash`,
  'gh \\\npr merge 12 --squash',
  'gh pr \\\nmerge 12 --squash',
  'gh -R me/site pr merge 12 --squash',
  'gh --repo me/site pr merge 12 --squash',
  'gh --repo=me/site pr merge 12 --squash',
]
// The sanctioned merge with something hidden in it: --admin or --auto, another head commit, a word gh pr merge does
// not take, or a word built at run time. Refused even at the approved head commit.
const HIDDEN_MERGES = [
  `${mergeAt(SHA)} --ad''min`,
  `${mergeAt(SHA)} --a"uto"`,
  `${mergeAt(SHA)} --\\admin`,
  `${mergeAt(SHA)} $'--\\x61dmin'`,
  `${mergeAt(SHA)} \\\n--admin`,
  `${mergeAt(SHA)} --admin=false`,
  `${mergeAt(SHA)} --match-head-commit e"${OTHER_SHA.slice(1)}"`,
  `${mergeAt(SHA)} --match-head-commit $'\\x65'${OTHER_SHA.slice(1)}`,
  `${mergeAt(SHA)} --mat''ch-head-commit ${OTHER_SHA}`,
  `${mergeAt(SHA)} --match-head-commit=${OTHER_SHA}`,
  `${mergeAt(SHA)} --match-head-commit`,
  `${mergeAt(SHA)} --match-head-commit "$HEAD"`,
  `${mergeAt(SHA)} $EXTRA`,
  `${mergeAt(SHA)} --unknown`,
  `${mergeAt(SHA)} -h`,
  `${mergeAt(SHA)} 13`,
  `bash -c "${mergeAt(SHA)} --ad\\\\min"`,
  `bash -c '${mergeAt(SHA)} --ad\\min'`,
  `bash -c "${mergeAt(SHA)} --match-head-commit e${OTHER_SHA.slice(1)}"`,
  `gh pr merge --match-head-commit ${SHA} -b= --match-head-commit ${OTHER_SHA}`,
  `gh pr merge 12 --body --admin --match-head-commit ${SHA}`,
  `gh pr merge 12 --match_head_commit ${OTHER_SHA} --match-head-commit ${SHA}`,
  `${mergeAt(SHA)} >merged.txt`,
]
// gh, or its first two words, built at run time: Bash could spell anything there, so Ship it refuses them.
const RUN_TIME_GH = [
  'gh pr {merge,} 12 --admin',
  'gh pr mer$()ge 12 --admin',
  'gh pr mer*e 12 --admin',
  'gh pr m?rge 12 --admin',
  'gh pr [m]erge 12 --admin',
  'gh pr $SUB 12',
  'gh "$PR" merge 12',
  'gh pr `echo merge` 12',
  'gh $(echo pr) merge 12',
  `gh pr $'\\u006d'erge 12`,
  '$GH pr merge 12',
  '"$GH" pr merge 12',
  'g$()h pr merge 12',
  '~/bin/gh mm 12',
  '=gh mm 12',
  'env $GH pr merge 12',
]
// gh with a first word that is not one of gh's own commands: an alias or extension could run a merge.
const UNKNOWN_GH = [
  'gh mm 12 --admin',
  'gh co 12',
  'gh my-ext merge 12',
  '"gh" mm 12',
  'gh -R me/site mm 12',
  'env gh mm 12',
  'sudo -u me gh mm 12',
  'bash -c "gh mm 12"',
  'eval "gh mm 12"',
  'gh \\\nmm 12',
  'gh extension exec mm 12',
  "git status # don't\ngh mm 12",
  'echo $("gh" mm 12)',
  'X=`g\'\'h mm 12`',
]
// gh pr with a flag before its subcommand: the guard does not guess how many words the flag takes, so gh could read
// the next one as merge. Refused, approved or not, -R and --repo included; before pr they stay allowed.
const PR_FLAG_FIRST = [
  'gh pr --body x merge 12 --admin',
  'gh pr -b x merge 12 --admin',
  'gh pr --subject x merge 12 --auto --squash',
  `gh pr --body x merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `gh pr -b x merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `"gh" pr --b''ody x merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `gh pr -R me/site merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `gh pr --repo=me/site merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `gh pr -- merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `bash -c "gh pr -b x merge 12 --squash --delete-branch --match-head-commit ${SHA}"`,
  'env gh pr -b x merge 12',
]
const MERGE_BODY = '{"query":"mutation{mergePullRequest(input:{pullRequestId:\\"X\\"}){clientMutationId}}"}'
// gh api and curl or wget merges whose command word Bash rebuilds: quoted, escaped, continued or after -R.
const SPELLED_API = [
  `"gh" api graphql --input - <<EOF\n${MERGE_BODY}\nEOF`,
  `gh \\\napi graphql --input - <<EOF\n${MERGE_BODY}\nEOF`,
  `g''h api -X PUT repos/me/site/pulls/12/merge`,
  'gh "api" -X PUT repos/me/site/pulls/12/merge',
  'gh -R me/site api -X PUT repos/{owner}/{repo}/pulls/12/merge',
  '"/usr/bin/gh" api -X PUT repos/me/site/pulls/12/merge',
]
const SPELLED_HTTP = [
  '"curl" -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  `cu''rl -X PUT https://api.github.com/repos/me/site/pulls/12/merge`,
  'cu\\\nrl -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  '"wget" --method=PUT https://api.github.com/repos/me/site/pulls/12/merge',
]
// Ordinary commands during Ship it that stay allowed: they read, mention or create, and never merge.
const WORD_HARMLESS = [
  'gh pr view 12 --json headRefOid,mergeable',
  'gh pr checks 12 --watch',
  'gh pr checks --watch',
  'gh -R me/site pr view 12',
  'gh api repos/{owner}/{repo}/pulls/12',
  'gh --version',
  'gh',
  `gh alias set mm 'pr merge'`,
  'gh pr create --title "Read gh pr merge as words" --body "Refuses gh pr merge --admin"',
  `git commit -m "$(cat <<'EOF'\nfix(ship): read gh pr merge as shell words\n\nNo --admin, no --auto.\nEOF\n)"`,
  `gh pr create --body-file - <<'EOF'\n## Why\n* gh is used; $5 a month\n{"a":1,"b":2}\nEOF`,
  'echo "gh pr merge 12 --admin"',
  `grep -rn 'gh pr merge' README.md`,
  'git status && git log --oneline -5',
  'for f in *.ts; do echo "$f"; done',
  'cd "$HOME/site" && npm test',
  'if [ -n "$CI" ]; then echo ci; fi',
  'ls ~/site *.md',
  `git commit -m "$(cat <<'EOF'\nIt's fine (really\nEOF\n)"`,
  'HEAD=$(gh pr view 12 --json headRefOid -q .headRefOid) && echo "$HEAD"',
]

test('unsafeMerge reads gh pr merge as shell words: spelled merges need the approval, and allowed ones count as merges', () => {
  for (const command of SPELLED_MERGES) {
    expect([command, runsPrMerge(command)]).toEqual([command, true])
    expect(unsafeMerge(command, null)).toContain('Approve merge')
    expect(unsafeMerge(command, SHA)).toContain('Approve merge')
    expect(unsafeMerge(`${command} --admin`, SHA)).toContain('--admin or --auto')
    // The sanctioned merge, however Bash spells it, runs at the approved head commit and uses the approval.
    const sanctioned = `${command} --delete-branch --match-head-commit ${SHA}`
    expect([sanctioned, unsafeMerge(sanctioned, SHA)]).toEqual([sanctioned, null])
    expect(runsPrMerge(sanctioned)).toBe(true)
    expect(unsafeMerge(sanctioned, OTHER_SHA)).toContain('Approve merge')
    expect(unsafeMerge(`${sanctioned}; true`, SHA)).toContain('on its own')
  }
  for (const command of [
    `"bash" -c "${mergeAt(SHA)}"`,
    `${mergeAt(SHA)} --match-head-commit=${SHA}`,
    `gh pr merge 12 -sd --match-head-commit "${SHA}"`,
    `${mergeAt(SHA)} \\\n`,
    `${mergeAt(SHA)} # a note`,
  ]) {
    expect([command, unsafeMerge(command, SHA)]).toEqual([command, null])
    expect(runsPrMerge(command)).toBe(true)
  }
})

test('unsafeMerge never lets an approval carry --admin, --auto, another head commit or a hidden word', () => {
  for (const command of HIDDEN_MERGES) {
    expect([command, unsafeMerge(command, SHA)]).not.toEqual([command, null])
    expect(unsafeMerge(command, null)).not.toBeNull()
  }
  for (const command of HIDDEN_MERGES.slice(0, 6)) expect(unsafeMerge(command, SHA)).toContain('--admin or --auto')
  for (const command of HIDDEN_MERGES.slice(6, 11)) expect(unsafeMerge(command, SHA)).toContain('Approve merge')
  // A merge gh is reached through by a path, quoted or not, or after a wrapper, is a wrapper.
  for (const command of [`"/opt/homebrew/bin/gh" pr merge 12 --delete-branch --match-head-commit ${SHA}`, `env "gh" pr merge 12 --match-head-commit ${SHA}`, `watch "gh" pr merge 12`, 'X=$("gh" pr merge 12 --admin)']) {
    expect(unsafeMerge(command, SHA)).toContain('directly')
  }
})

test('unsafeMerge refuses gh words built at run time and gh aliases or extensions, approved or not', () => {
  for (const command of RUN_TIME_GH) {
    expect([command, unsafeMerge(command, null)]).not.toEqual([command, null])
    expect(unsafeMerge(command, SHA)).not.toBeNull()
  }
  for (const command of RUN_TIME_GH) expect(unsafeMerge(command, SHA)).toContain('built at run time')
  for (const command of UNKNOWN_GH) {
    expect([command, unsafeMerge(command, null)]).not.toEqual([command, null])
    expect(unsafeMerge(command, SHA)).toContain('alias or extension')
  }
})

test('unsafeMerge refuses gh pr with a flag before its subcommand, approved or not, and keeps -R or --repo before pr', () => {
  for (const command of PR_FLAG_FIRST) {
    expect([command, unsafeMerge(command, null)]).not.toEqual([command, null])
    expect([command, unsafeMerge(command, SHA)]).toEqual([command, expect.stringContaining('right after pr')])
  }
  for (const command of [
    mergeAt(SHA),
    `gh -R me/site pr merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
    `gh --repo me/site pr merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  ]) {
    expect([command, unsafeMerge(command, SHA)]).toEqual([command, null])
    expect(runsPrMerge(command)).toBe(true)
  }
  expect(unsafeMerge('gh pr view 29 --json state', null)).toBeNull()
  expect(unsafeMerge('gh pr view 29 --json state', SHA)).toBeNull()
  expect(runsPrMerge('gh pr view 29 --json state')).toBe(false)
})

test('unsafeMerge refuses gh api, curl and wget merges whose command word is quoted, escaped or continued', () => {
  for (const command of SPELLED_API) {
    expect([command, runsPrMerge(command)]).toEqual([command, false])
    expect(unsafeMerge(command, null)).toBe(API_REFUSAL)
    expect(unsafeMerge(command, SHA)).toBe(API_REFUSAL)
  }
  for (const command of SPELLED_HTTP) {
    expect([command, unsafeMerge(command, null)]).toEqual([command, HTTP_REFUSAL])
    expect(unsafeMerge(command, SHA)).toBe(HTTP_REFUSAL)
  }
})

test('unsafeMerge leaves ordinary gh, git and shell commands alone while it reads words', () => {
  for (const command of WORD_HARMLESS) {
    expect([command, unsafeMerge(command, null)]).toEqual([command, null])
    expect(unsafeMerge(command, SHA)).toBeNull()
    expect(runsPrMerge(command)).toBe(false)
  }
})

test('askedMergeSha reads the full head commit from the approval line', () => {
  expect(askedMergeSha(`Checks passed.\nReply exactly: Approve merge ${SHA}\nAnything else leaves the pull request open.`)).toBe(SHA)
  expect(askedMergeSha(`Reply exactly: \`Approve merge ${SHA}\``)).toBe(SHA)
  expect(askedMergeSha(`Reply exactly: Approve merge ${OTHER_SHA}\nReply exactly: Approve merge ${SHA}`)).toBe(SHA)
  expect(askedMergeSha(`Reply exactly: Approve merge ${SHA.slice(0, 7)}`)).toBeNull()
  expect(askedMergeSha('All checks passed. Merge it?')).toBeNull()
})

/** Presses ⇡ Ship it twice on the terminal band, the way the person ships. */
async function pressShip($: Engine) {
  for (let press = 0; press < 2; press++) {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'ship' })
    await ui.unmount()
  }
}

/** Ship it sent in a GitHub project, Claude's turn for it planned and done, ready to ask about a head commit. */
async function shipping($: Engine, on: On) {
  // While failing, a tool call fails the way Bash reports a command that exits non-zero.
  let isFailing = false
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n', () =>
    isFailing ? { isError: true, result: 'merge failed', text: 'merge failed' } : { result: {} },
  )
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  await $.turn.start({ text: shipped.sent[0], turnId: 't2' })
  await callTool($, { tool: PLAN, steps: ['Open the pull request', 'Wait for checks'] })
  await callTool($, { tool: PROGRESS, task: 'Open the pull request', percent: 100 })
  await callTool($, { tool: PROGRESS, task: 'Wait for checks', percent: 100 })
  const ask = (sha: string, turnId: string) =>
    $.turn.complete({
      answer: `https://github.com/me/site/pull/12\nChecks: 3 passed.\nReply exactly: Approve merge ${sha}\nAnything else leaves the pull request open.`,
      durationMs: 1,
      isAborted: false,
      turnId,
      reason: 'answer',
    } as never)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'Bash', command, ...extra })).deny
  const failMerges = (isOn: boolean) => {
    isFailing = isOn
  }
  const ends = (turnId: string, answer = 'Done.') =>
    $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' } as never)
  return { ask, tries, failMerges, ends }
}

test('Ship it merges once at the exact approved head commit, and a merge that works ends Ship it', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')

  await ask(SHA, 't2')
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Needs you')
  expect(shown).toContain('Reply exactly: Approve merge')
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')

  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  // The reply starts a new job: GlanceFlow first asks for a plan, and that refusal leaves the approval unused.
  expect(await tries(mergeAt(SHA))).toContain('plan_steps')
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  expect(await tries(mergeAt(OTHER_SHA))).toContain('Approve merge')
  expect(await tries(`${mergeAt(SHA)} --admin`)).toContain('--admin or --auto')
  // Text that only mentions the command runs and leaves the approval unused.
  expect(await tries('git commit -m "docs | gh pr merge later"')).toBeUndefined()
  expect(await tries(mergeAt(SHA))).toBeUndefined()

  // The merge worked: Ship it is over, and gh pr merge is back to normal.
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
})

test('a failed merge keeps Ship it guarded until a fresh exact approval; one approval is one attempt, wrapped or not', async ($, on) => {
  const { ask, tries, failMerges, ends } = await shipping($, on)
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  failMerges(true)
  expect(await tries(`bash -c "${mergeAt(SHA)}"`)).toBeUndefined()
  // One approval, one merge attempt.
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  await ends('t3', 'The merge failed: the branch is out of date.')

  // The person's next turn does not end Ship it while the failed merge waits for a retry.
  await $.turn.start({ text: 'Update the branch and try again', turnId: 't4' })
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  await ask(SHA, 't4')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't5' })
  failMerges(false)
  expect(await tries(mergeAt(SHA))).toBeUndefined()
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
})

test('a merge whose exit code the rest of its command could hide is refused, so it neither ends Ship it nor uses the approval', async ($, on) => {
  const { ask, tries, failMerges } = await shipping($, on)
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  // Bash reports these as successes even when gh pr merge fails, since the last command decides the exit code.
  for (const command of [`${mergeAt(SHA)}; echo "exit=$?"`, `${mergeAt(SHA)}; true`, `${mergeAt(SHA)} || true`]) {
    expect(await tries(command)).toContain('on its own')
  }
  // Still guarded, and the approval is unused: the merge on its own runs once, and after it fails
  // the next try, compound or not, needs a fresh approval.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  failMerges(true)
  expect(await tries(mergeAt(SHA))).toBeUndefined()
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  expect(await tries(`${mergeAt(SHA)}; true`)).toContain('Approve merge')
})

test('a merge through a shell wrapper is refused before and after approval, and never uses the approval', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  for (const command of WRAPPED_MERGES) expect(await tries(command)).toBeDefined()
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const command of WRAPPED_MERGES) expect(await tries(command)).toBeDefined()
  // Still guarded, and the approval is unused: the plain merge runs, works, and ends Ship it.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  expect(await tries(mergeAt(SHA))).toBeUndefined()
  expect(await tries('env gh pr merge 12 --squash')).toBeUndefined()
})

test('a new merge request for a moved head replaces the pending one, and an approval lasts only for its turn', async ($, on) => {
  const { ask, tries, ends } = await shipping($, on)
  await ask(SHA, 't2')
  await ask(OTHER_SHA, 't2')
  await $.turn.start({ text: `Approve merge ${OTHER_SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  await ends('t3', 'Stopped before merging.')
  expect(await tries(mergeAt(OTHER_SHA))).toContain('Approve merge')
})

for (const reply of ['yes', 'ok', 'go ahead', 'no', 'cancel', `Approve merge ${OTHER_SHA}`, `Approve merge ${SHA.slice(0, 7)}`, `Approve merge ${SHA} please`, `ok Approve merge ${SHA}`, `approve merge ${SHA}`]) {
  test(`a reply of "${reply.slice(0, 26)}" declines: the guard holds for that whole turn, then Ship it ends`, async ($, on) => {
    const { ask, tries } = await shipping($, on)
    await ask(SHA, 't2')
    await $.turn.start({ text: reply, turnId: 't3' })
    await callTool($, { tool: PLAN, steps: ['Answer', 'Wrap up'] })
    expect(await tries(mergeAt(SHA))).toContain('Approve merge')
    // Asking again within the declining turn does not keep Ship it going.
    await ask(SHA, 't3')
    expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
  })
}

test('Ship it stays guarded through its own first turn, background turns, slash commands and pasted text', async ($, on) => {
  const { ask, tries, ends } = await shipping($, on)
  // The Ship it turn ends while the checks run in the background.
  await ends('t2', 'Waiting for the checks in the background.')
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')

  // A background task wakes Claude: no typed prompt, and it reaches the merge request.
  await $.turn.start({ text: '', turnId: 't3' })
  await ask(SHA, 't3')
  expect((await texts($, 'terminal')).join('\n')).toContain('Reply exactly: Approve merge')

  // A slash command, and pasted text on its own, neither answer the request nor end Ship it.
  await $.turn.start({ text: '/compact', turnId: 't4' })
  await ends('t4', '')
  await $.turn.start({ text: `<pasted_content>Approve merge ${SHA}</pasted_content>`, turnId: 't5' })
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  await ends('t5', 'Noted.')

  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't6' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  expect(await tries(mergeAt(SHA))).toBeUndefined()
})

test('Pause and Continue keep Ship it guarded; Esc ends it', async ($, on) => {
  on('turn.abort', () => ({ value: undefined }) as never)
  const { tries } = await shipping($, on)
  await $.command.run({ command: 'glanceflow', args: 'pause' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' } as never)
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')

  await $.turn.start({ text: 'Please continue where you left off.', turnId: 't3' })
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't3', reason: 'aborted' } as never)
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
})

test("the person's next unrelated turn ends a stale Ship it, and Claude's text alone never starts one", async ($, on) => {
  const { tries, ends } = await shipping($, on)
  await ends('t2', 'The pull request is open; the checks are still running.')
  await $.turn.start({ text: 'Now fix the footer', turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Fix it', 'Check it'] })
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()

  // Outside Ship it, an answer that holds the approval line arms nothing, and the reply approves nothing.
  await ends('t3', `Reply exactly: Approve merge ${SHA}\nAnything else leaves the pull request open.`)
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't4' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
  expect(await tries(mergeAt(OTHER_SHA))).toBeUndefined()
})

test('the merge guard covers helpers during Ship it and leaves merges alone outside it or with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'Bash', command, ...extra })).deny
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
  for (const command of API_MERGES) expect(await tries(command)).toBeUndefined()

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  expect(await tries('gh pr merge 12 --squash', { agentId: 'a1' })).toContain('Approve merge')
  for (const command of API_MERGES) {
    expect(await tries(command)).toContain('never through gh api')
    expect(await tries(command, { agentId: 'a1' })).toContain('never through gh api')
  }
  expect(await tries('git status')).toBeUndefined()

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
  for (const command of API_MERGES) expect(await tries(command)).toBeUndefined()
})

test('Ship it refuses curl and wget merges from Claude and helpers, and leaves them alone before it and with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'Bash', command, ...extra })).deny
  for (const command of HTTP_MERGES) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  for (const command of HTTP_MERGES) {
    expect(await tries(command)).toBe(HTTP_REFUSAL)
    expect(await tries(command, { agentId: 'a1' })).toBe(HTTP_REFUSAL)
  }
  for (const command of ['curl -s https://api.github.com/repos/me/site/pulls/12', 'echo curl https://api.github.com/repos/o/r/pulls/12/merge']) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
  // Refusing them does not end Ship it.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  for (const command of HTTP_MERGES) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
})

test('a refused curl or wget merge leaves the approval and Ship it as they were, so the approved gh pr merge still runs', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const command of HTTP_MERGES) {
    expect(await tries(command)).toBe(HTTP_REFUSAL)
    expect(await tries(command, { agentId: 'a1' })).toBe(HTTP_REFUSAL)
  }
  // Still guarded, nothing recorded as merged, and the approval is unused.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  expect(await tries(mergeAt(OTHER_SHA))).toContain('Approve merge')
  expect(await tries(`gh pr merge --squash --delete-branch --match-head-commit ${SHA}`)).toBeUndefined()
  // That merge worked and ended Ship it.
  expect(await tries(HTTP_MERGES[0])).toBeUndefined()
})

test('Ship it refuses gh api merges sent through stdin from Claude and helpers, and leaves them alone before it and with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'Bash', command, ...extra })).deny
  for (const command of STDIN_MERGES) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  for (const command of STDIN_MERGES) {
    expect(await tries(command)).toBe(API_REFUSAL)
    expect(await tries(command, { agentId: 'a1' })).toBe(API_REFUSAL)
  }
  expect(await tries(STDIN_QUERY)).toBeUndefined()
  expect(await tries(STDIN_QUERY, { agentId: 'a1' })).toBeUndefined()
  // Refusing them does not end Ship it.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  for (const command of STDIN_MERGES) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
})

test('a refused gh api stdin merge leaves the approval and Ship it as they were, so the approved gh pr merge still runs', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const command of STDIN_MERGES) {
    expect(await tries(command)).toBe(API_REFUSAL)
    expect(await tries(command, { agentId: 'a1' })).toBe(API_REFUSAL)
  }
  // Still guarded, nothing recorded as merged, and the approval is unused.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  expect(await tries(mergeAt(OTHER_SHA))).toContain('Approve merge')
  expect(await tries(`gh pr merge --squash --delete-branch --match-head-commit ${SHA}`)).toBeUndefined()
  // That merge worked and ended Ship it.
  expect(await tries(STDIN_MERGES[0])).toBeUndefined()
})

// Every spelling Ship it refuses at the approved head commit or without it, as Claude or a helper would send it.
const WORD_REFUSED = [...HIDDEN_MERGES, ...RUN_TIME_GH, ...UNKNOWN_GH, ...PR_FLAG_FIRST, ...SPELLED_API, ...SPELLED_HTTP]

test('Ship it refuses merges Bash spells in other words from Claude and helpers, and leaves them alone before it and with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'Bash', command, ...extra })).deny
  for (const command of [...SPELLED_MERGES, ...WORD_REFUSED]) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  for (const command of [...SPELLED_MERGES, ...WORD_REFUSED]) {
    expect([command, await tries(command)]).not.toEqual([command, undefined])
    expect(await tries(command, { agentId: 'a1' })).toBeDefined()
  }
  for (const command of WORD_HARMLESS) {
    expect([command, await tries(command)]).toEqual([command, undefined])
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
  // Refusing them does not end Ship it.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  for (const command of [...SPELLED_MERGES, ...WORD_REFUSED]) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
})

test('a refused spelled merge leaves the approval; a spelled sanctioned merge uses it once, and a failed one needs a fresh approval', async ($, on) => {
  const { ask, tries, failMerges, ends } = await shipping($, on)
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const command of WORD_REFUSED) {
    expect([command, await tries(command)]).not.toEqual([command, undefined])
    expect(await tries(command, { agentId: 'a1' })).toBeDefined()
  }
  // Still guarded, nothing recorded as merged, and the approval is unused: the quoted sanctioned merge runs once.
  expect(await tries('"gh" pr merge 12 --squash')).toContain('Approve merge')
  failMerges(true)
  const spelled = `"gh" pr mer''ge 12 --squash --delete-branch --match-head-commit ${SHA}`
  expect(await tries(spelled, { agentId: 'a1' })).toBeUndefined()
  // One approval, one attempt: the next one, spelled or plain, from Claude or a helper, needs a fresh approval.
  expect(await tries(spelled)).toContain('Approve merge')
  expect(await tries(mergeAt(SHA), { agentId: 'a1' })).toContain('Approve merge')
  await ends('t3', 'The merge failed: the branch is out of date.')
  await $.turn.start({ text: 'Update the branch and try again', turnId: 't4' })
  await ask(SHA, 't4')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't5' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  failMerges(false)
  expect(await tries(`gh -R me/site pr merge 12 --squash --delete-branch --match-head-commit ${SHA}`)).toBeUndefined()
  // That merge worked and ended Ship it.
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
})

// MCP tools that merge a pull request, turn on auto-merge or add it to a merge queue, under two server prefixes.
const MCP_MERGES = ['mcp__github__', 'mcp__plugin_engineering_github__'].flatMap(server =>
  [
    'merge_pull_request',
    'mergePullRequest',
    'merge-pull-request',
    'enable_auto_merge',
    'enable_pull_request_auto_merge',
    'enqueue_pull_request',
  ].map(action => server + action),
)
// Read-only or unrelated MCP tools, some with "merge" in the name, and a server named like a merge action.
const MCP_OTHERS = [
  'mcp__github__get_pull_request',
  'mcp__github__list_pull_requests',
  'mcp__github__pull_request_read',
  'mcp__github__get_merge_status',
  'mcp__github__disable_auto_merge',
  'mcp__mnemo__mem_merge_tags',
  'mcp__claude_ai_Supabase__merge_branch',
  'mcp__merge_pull_request__get_pull_request',
]

test('isMcpMergeAction matches only the exact merge, auto-merge and merge-queue actions of an MCP tool', () => {
  for (const tool of MCP_MERGES) expect(isMcpMergeAction(tool)).toBe(true)
  for (const tool of [...MCP_OTHERS, PLAN, PROGRESS, 'merge_pull_request', 'Bash', 'mcp__merge_pull_request']) {
    expect(isMcpMergeAction(tool)).toBe(false)
  }
})

test('Ship it refuses MCP merge actions from Claude and helpers alike, and lets other MCP tools run', async ($, on) => {
  const { tries } = await shipping($, on)
  const calls = async (tool: string, extra: object = {}) => (await callTool($, { tool, ...extra })).deny
  for (const tool of MCP_MERGES) {
    expect(await calls(tool)).toContain('never through an MCP tool')
    expect(await calls(tool, { agentId: 'a1' })).toContain('never through an MCP tool')
  }
  for (const tool of MCP_OTHERS) {
    expect(await calls(tool)).toBeUndefined()
    expect(await calls(tool, { agentId: 'a1' })).toBeUndefined()
  }
  expect(await calls(PROGRESS, { task: 'Wait for checks', percent: 100 })).toBeUndefined()
  expect(await calls(PLAN, { steps: ['Merge it', 'Report back'] })).toBeUndefined()
  // Refusing them does not end Ship it.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
})

test('a refused MCP merge leaves the approval for the gh pr merge it names, and once that merge ends Ship it MCP merges are left alone', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  const calls = async (tool: string, extra: object = {}) => (await callTool($, { tool, ...extra })).deny
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const tool of MCP_MERGES) expect(await calls(tool)).toContain('never through an MCP tool')
  expect(await tries(mergeAt(SHA))).toBeUndefined()

  for (const tool of MCP_MERGES) {
    expect(await calls(tool)).toBeUndefined()
    expect(await calls(tool, { agentId: 'a1' })).toBeUndefined()
  }
})

test('MCP merge actions are left alone before Ship it and with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const calls = async (tool: string, extra: object = {}) => (await callTool($, { tool, ...extra })).deny
  for (const tool of MCP_MERGES) {
    expect(await calls(tool)).toBeUndefined()
    expect(await calls(tool, { agentId: 'a1' })).toBeUndefined()
  }

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  for (const tool of MCP_MERGES) expect(await calls(tool)).toContain('never through an MCP tool')

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  for (const tool of MCP_MERGES) {
    expect(await calls(tool)).toBeUndefined()
    expect(await calls(tool, { agentId: 'a1' })).toBeUndefined()
  }
})

const PS_REFUSAL = 'PowerShell may merge only with gh pr merge'
// PowerShell commands Ship it refuses, approved or not: gh merges in any case, path or wrapper, backtick-escaped,
// and merge routes through gh api, the HTTP cmdlets and their aliases, curl.exe or wget.exe.
const PS_MERGES = [
  'gh pr merge 12 --squash',
  'GH PR MERGE 12 --squash',
  'Gh Pr Merge 12 --squash',
  'gh.exe pr merge 12 --squash',
  "& 'C:\\Program Files\\GitHub CLI\\gh.exe' pr merge 12 --squash",
  'g`h pr me`rge 12 --squash',
  'gh api -X PUT repos/me/site/pulls/12/merge',
  'GH API -X PUT repos/me/site/pulls/12/merge',
  "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  "gh api graphql -f query='mutation { enqueuePullRequest(input: {}) { clientMutationId } }'",
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
  'Invoke-RestMethod -Method Put -Uri https://api.github.com/repos/me/site/pulls/12/merge',
  'INVOKE-RESTMETHOD -Method Put -Uri https://api.github.com/repos/me/site/pulls/12/merge',
  'irm -Method Put https://api.github.com/repos/me/site/pulls/12/merge',
  'Invoke-WebRequest -Method Put -Uri https://api.github.com/repos/me/site/pulls/12/merge',
  'iwr -Method Put https://api.github.com/repos/me/site/pulls/12/merge',
  'Invoke-`RestMethod -Method Put https://api.github.com/repos/me/site/pulls/12/mer`ge',
  'curl -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  'curl.exe -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  'CURL.EXE -X PUT https://api.github.com/repos/me/site/pulls/12/merge',
  'wget.exe --method=PUT https://api.github.com/repos/me/site/pulls/12/merge',
  "Invoke-RestMethod -Method Post https://api.github.com/graphql -Body '{\"query\":\"mutation { mergePullRequest }\"}'",
  "$u = 'https://api.github.com/repos/me/site/pulls/12/merge'; irm -Method Put $u",
  'pwsh -Command "gh pr merge 12 --squash"',
  "Start-Process gh -ArgumentList 'pr merge 12 --squash'",
  'cmd /c gh pr merge 12 --squash',
  "Invoke-Expression 'gh pr merge 12 --squash'",
  'Write-Output ok; gh pr merge 12 --squash',
]
// The sanctioned form gone wrong: refused even at the approved head commit.
const PS_ALMOST = [
  `${mergeAt(SHA)} --admin`,
  `${mergeAt(SHA)} --auto`,
  `gh pr merge 12 --admin --squash --delete-branch --match-head-commit ${SHA}`,
  `gh pr merge --auto --squash --delete-branch --match-head-commit ${SHA}`,
  `${mergeAt(SHA)}; Write-Output done`,
  `${mergeAt(SHA)} | Out-Null`,
  `${mergeAt(SHA)} && Write-Output done`,
  `${mergeAt(SHA)} || Write-Output failed`,
  `${mergeAt(SHA)}\nWrite-Output done`,
  `Write-Output start\n${mergeAt(SHA)}`,
  `gh pr merge\n12 --squash --delete-branch --match-head-commit ${SHA}`,
  `(${mergeAt(SHA)})`,
  `& ${mergeAt(SHA)}`,
  `$(${mergeAt(SHA)})`,
  `gh pr merge #12 --squash --delete-branch --match-head-commit ${SHA}`,
  `${mergeAt(SHA)} # done`,
  `gh pr merge 12 --squash --delete-branch --match-head-commit \`${SHA}`,
  'g`h pr merge 12 --squash --delete-branch --match-head-commit ' + SHA,
  `GH pr merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `gh.exe pr merge 12 --squash --delete-branch --match-head-commit ${SHA}`,
  `pwsh -Command "${mergeAt(SHA)}"`,
  `gh pr merge 12 --squash --delete-branch --match-head-commit ${SHA.toUpperCase()}`,
]
// PowerShell commands Ship it itself runs, and others with no merge route: left alone during Ship it.
const PS_HARMLESS = [
  'gh pr view 12 --json headRefOid',
  'gh pr checks 12 --watch',
  'gh pr create --fill',
  'gh pr create --title "Fix the footer" --body "Adds the missing links"',
  'git merge --ff-only origin/master',
  'Write-Output "merge"',
  'irm https://api.github.com/repos/me/site/pulls/12',
  'curl.exe -s https://api.github.com/repos/me/site/pulls/12',
  'Get-Content README.md',
]
// Accepted false positive: during Ship it, merge in harmless argument text next to gh is refused in PowerShell, with no
// gh pr create exception; Bash reads the same command as it always has.
const PS_FALSE_POSITIVE = 'gh pr create --title "Guard merge routes" --body "Docs only"'

test('unsafePowerShellMerge allows only the exact sanctioned merge at the approved head commit', () => {
  for (const command of [
    mergeAt(SHA),
    `  ${mergeAt(SHA)}\n`,
    `gh pr merge --squash --delete-branch --match-head-commit ${SHA}`,
    `gh pr merge https://github.com/me/site/pull/12 --squash --delete-branch --match-head-commit ${SHA}`,
  ]) {
    expect(unsafePowerShellMerge(command, SHA)).toBeNull()
    expect(runsPowerShellMerge(command)).toBe(true)
    expect(unsafePowerShellMerge(command, null)).toContain('Approve merge')
    expect(unsafePowerShellMerge(command, OTHER_SHA)).toContain('Approve merge')
  }
  for (const command of [...PS_ALMOST, ...PS_MERGES]) {
    expect(runsPowerShellMerge(command)).toBe(false)
    expect(unsafePowerShellMerge(command, SHA)).toContain(PS_REFUSAL)
    expect(unsafePowerShellMerge(command, null)).not.toBeNull()
  }
  for (const command of PS_HARMLESS) {
    expect(unsafePowerShellMerge(command, null)).toBeNull()
    expect(unsafePowerShellMerge(command, SHA)).toBeNull()
    expect(runsPowerShellMerge(command)).toBe(false)
  }
  // The accepted false positive is refused in PowerShell, and Bash still lets it run.
  expect(unsafePowerShellMerge(PS_FALSE_POSITIVE, SHA)).toContain(PS_REFUSAL)
  expect(unsafePowerShellMerge(PS_FALSE_POSITIVE, null)).toContain(PS_REFUSAL)
  expect(unsafeMerge(PS_FALSE_POSITIVE, SHA)).toBeNull()
  expect(unsafeMerge(PS_FALSE_POSITIVE, null)).toBeNull()
})

test('Ship it refuses PowerShell merges from Claude and helpers, and leaves PowerShell alone before it and with GlanceFlow off', async ($, on) => {
  const shipped = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const tries = async (command: string, extra: object = {}) => (await callTool($, { tool: 'PowerShell', command, ...extra })).deny
  for (const command of [...PS_MERGES, PS_FALSE_POSITIVE, mergeAt(SHA)]) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }

  await pressShip($)
  expect(shipped.sent).toHaveLength(1)
  for (const command of [...PS_MERGES, ...PS_ALMOST, PS_FALSE_POSITIVE]) {
    expect(await tries(command)).toContain(PS_REFUSAL)
    expect(await tries(command, { agentId: 'a1' })).toContain(PS_REFUSAL)
  }
  // Not approved yet: the sanctioned merge asks for the approval, from Claude and helpers alike.
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  expect(await tries(mergeAt(SHA), { agentId: 'a1' })).toContain('Approve merge')
  for (const command of PS_HARMLESS) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
  // Refusing them does not end Ship it, for PowerShell or Bash.
  expect(await tries('gh pr merge 12 --squash')).toContain(PS_REFUSAL)
  expect((await callTool($, { tool: 'Bash', command: 'gh pr merge 12 --squash' })).deny).toContain('Approve merge')
  // Bash keeps its own reading: the PowerShell false positive runs there.
  expect((await callTool($, { tool: 'Bash', command: PS_FALSE_POSITIVE })).deny).toBeUndefined()

  await $.command.run({ command: 'glanceflow', args: 'off' } as never)
  for (const command of [...PS_MERGES, PS_FALSE_POSITIVE]) {
    expect(await tries(command)).toBeUndefined()
    expect(await tries(command, { agentId: 'a1' })).toBeUndefined()
  }
})

test('a refused PowerShell merge leaves the approval; the sanctioned PowerShell merge uses it once and ends Ship it', async ($, on) => {
  const { ask, tries } = await shipping($, on)
  const ps = async (command: string, extra: object = {}) => tries(command, { tool: 'PowerShell', ...extra })
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  for (const command of [...PS_MERGES, ...PS_ALMOST, PS_FALSE_POSITIVE]) {
    expect(await ps(command)).toContain(PS_REFUSAL)
    expect(await ps(command, { agentId: 'a1' })).toContain(PS_REFUSAL)
  }
  expect(await ps(mergeAt(OTHER_SHA))).toContain('Approve merge')
  expect(await ps(mergeAt(OTHER_SHA), { agentId: 'a1' })).toContain('Approve merge')
  for (const command of PS_HARMLESS) expect(await ps(command)).toBeUndefined()
  // Still guarded, and the approval is unused.
  expect(await tries('gh pr merge 12 --squash')).toContain('Approve merge')
  expect(await ps(mergeAt(SHA))).toBeUndefined()

  // That merge worked and ended Ship it: PowerShell is back to normal.
  for (const command of [...PS_MERGES, PS_FALSE_POSITIVE]) {
    expect(await ps(command)).toBeUndefined()
    expect(await ps(command, { agentId: 'a1' })).toBeUndefined()
  }
  expect(await tries('gh pr merge 12 --squash')).toBeUndefined()
})

test('a helper PowerShell merge uses the approval once, like Claude: a failed one needs a fresh approval', async ($, on) => {
  const { ask, tries, failMerges } = await shipping($, on)
  const ps = async (command: string, extra: object = {}) => tries(command, { tool: 'PowerShell', ...extra })
  await ask(SHA, 't2')
  await $.turn.start({ text: `Approve merge ${SHA}`, turnId: 't3' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Report back'] })
  failMerges(true)
  expect(await ps(mergeAt(SHA), { agentId: 'a1' })).toBeUndefined()
  // One approval, one merge attempt, whichever tool or caller tries next.
  expect(await ps(mergeAt(SHA), { agentId: 'a1' })).toContain('Approve merge')
  expect(await ps(mergeAt(SHA))).toContain('Approve merge')
  expect(await tries(mergeAt(SHA))).toContain('Approve merge')
  expect(await ps('gh pr merge 12 --squash')).toContain(PS_REFUSAL)
})

test("a timer left from an earlier press never cancels a later one, and only one button waits for its second press", async ($, on) => {
  const { sent, clock } = await shipWorld($, on, 'https://github.com/me/site.git\n')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  const press = async (key: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key })
    await ui.unmount()
  }
  const shown = async () => (await texts($, 'terminal')).join('\n')

  // Arm, ship 7 seconds later, arm again: the first press's timer, due a second later, leaves the new one waiting.
  await press('ship')
  await clock.advance(7000)
  await press('ship')
  expect(sent).toHaveLength(1)
  await press('ship')
  await clock.advance(1500)
  expect(await shown()).toContain('Press again to ship')

  // Arming Fresh chat disarms Ship it.
  await press('handoff')
  const both = await shown()
  expect(both).toContain('Press again to start a fresh chat')
  expect(both).not.toContain('Press again to ship')
  expect(both).toContain('⇡ Ship it')
})

test('Ship it stays hidden in a folder that does not push to GitHub', async ($, on) => {
  await shipWorld($, on, '')
  await $.command.run({ command: 'glanceflow', args: 'ship on' } as never)
  await finish($)
  for (const surface of SURFACES) expect((await texts($, surface)).join('\n')).not.toContain('Ship it')
})

test('Pause stops the running turn; Continue picks the same job up without typing', async ($, on) => {
  world(on)
  let aborted = ''
  let sent = ''
  on('turn.abort', (_, e) => {
    aborted = e.turnId
    return { value: undefined } as never
  })
  on('prompt.submit', (_, e) => {
    sent = e.text
    return { text: e.text }
  })
  const press = async (key: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key })
    await ui.unmount()
  }

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('‖ Pause')
  expect(shown).not.toContain('▶ Continue')

  await press('pause')
  expect(aborted).toBe('t1')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('‖ Paused · ')
  expect(shown).toContain('▶ Continue')
  expect(shown).not.toContain('‖ Pause\n')
  // The step itself says it is paused, not working.
  expect(shown).toContain('\nPaused ')
  expect(shown).not.toContain('\nWorking')

  await press('continue')
  expect(sent).toBe('Please continue where you left off.')
  await $.turn.start({ text: sent, turnId: 't2' })
  shown = (await texts($, 'terminal')).join('\n')
  // The same job and plan, working again.
  expect(shown).toContain('Write the page')
  expect(shown).toContain('▶ ')
  expect(shown).not.toContain('Paused')
  expect(shown).not.toContain('Understand your request')
  expect(shown).toContain('‖ Pause')
})

test('after Esc the header says Stopped, and Continue is offered', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('■ Stopped')
  expect(shown).toContain('you pressed Esc')
  expect(shown).toContain('▶ Continue')
})

test("a paused step's time stands still", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', () => ({ value: undefined }) as never)
  await detailsOn($)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  await clock.advance(30_000)
  await $.command.run({ command: 'glanceflow', args: 'pause' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })

  const before = (await texts($, 'terminal', 120)).join('\n')
  expect(before).toContain('30s · ')
  await clock.advance(5 * 60_000)
  const after = (await texts($, 'terminal', 120)).join('\n')
  expect(after).toContain('30s · ')
  expect(after).not.toContain('5m 30s')
})


/** A world with a clock to move, and the sounds and words GlanceFlow plays. */
function soundWorld(on: On, canSpeak = true) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  on('classic.Stop', () => ({}) as never)
  const heard: string[] = []
  on('audio.play', (_, e) => {
    heard.push(String((e.clip as { asset?: string }).asset))
    return { value: undefined } as never
  })
  on('audio.speak', (_, e) => {
    if (!canSpeak) throw new Error('No synthesizer')
    heard.push(`say: ${(e as { text: string }).text}`)
    return { value: { via: 'system' } } as never
  })
  return { clock, heard }
}

test('sounds are off until turned on; then a chime when Claude needs you, gets stuck or finishes a long job', async ($, on) => {
  const { clock, heard } = soundWorld(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it', 'Ship it'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  expect(heard).toEqual([])

  const result = await $.command.run({ command: 'glanceflow', args: 'sound on' } as never)
  expect(result.text).toContain('Sounds are on')
  heard.length = 0
  await callTool($, { tool: 'Bash', command: 'ls' })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  expect(heard).toEqual(['sounds/needs-you.wav'])

  // A quick job ends quietly; a long one chimes.
  await clock.advance(2 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Ship it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(heard).toEqual(['sounds/needs-you.wav', 'sounds/done.wav'])

  await $.turn.start({ text: 'What time is it?', turnId: 't2' })
  await $.turn.complete({ answer: 'Noon', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(heard).toEqual(['sounds/needs-you.wav', 'sounds/done.wav'])
})

test('voice mode also says it in a few words', async ($, on) => {
  const { clock, heard } = soundWorld(on)
  await $.command.run({ command: 'glanceflow', args: 'sound voice' } as never)
  heard.length = 0
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  // The words follow the chime.
  await clock.advance(1)
  expect(heard).toEqual(['sounds/needs-you.wav', 'say: Claude needs you'])
})

test('desktop notices are off until turned on; then the computer says why Claude needs you', async ($, on) => {
  const { clock, heard } = soundWorld(on)
  const shown: string[][] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    // Not a Mac here: osascript cannot start, so Linux's notify-send shows it.
    if (argv[0] === 'osascript') throw new Error('osascript: not found')
    shown.push([...argv.slice(-2)])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it', 'Ship it'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  await clock.advance(1)
  expect(shown).toEqual([])

  const result = await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  expect(result.text).toContain('Desktop notices are on')
  await clock.advance(1)
  expect(shown).toEqual([['Claude needs you', 'This is how GlanceFlow will tell you.']])
  shown.length = 0

  await callTool($, { tool: 'Bash', command: 'ls' })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  await clock.advance(1)
  expect(shown).toHaveLength(1)
  expect(shown[0]?.[0]).toBe('Claude needs you')
  expect(shown[0]?.[1]).toBeTruthy()
  // Sounds stay off: a notice alone.
  expect(heard).toEqual([])

  await clock.advance(2 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Ship it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(shown.at(-1)?.[0]).toBe('All done')

  await $.command.run({ command: 'glanceflow', args: 'notify off' } as never)
  shown.length = 0
  await $.turn.start({ text: 'Fix the footer', turnId: 't2' })
  await callTool($, { tool: PLAN, steps: ['Fix it', 'Check it'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  await clock.advance(1)
  expect(shown).toEqual([])
})

test('on Linux and Windows the chime and the words play through the computer\'s own player and voice', async ($, on) => {
  const { clock, heard } = soundWorld(on, false)
  const world = { system: 'Linux' }
  const ran: string[] = []
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'OS' && world.system === 'Windows_NT' ? 'Windows_NT' : undefined }) as never)
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    if (argv[0] === 'uname') return { value: { exitCode: 0, stdout: `${world.system}\n`, stderr: '' } } as never
    // This Linux has no PulseAudio: the next player is tried.
    if (argv[0] === 'paplay') throw new Error('paplay: not found')
    ran.push(argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.command.run({ command: 'glanceflow', args: 'sound voice' } as never)

  const alertOn = async (system: string, turnId: string) => {
    world.system = system
    await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
    await clock.advance(1)
    ran.length = 0
    heard.length = 0
    await $.turn.start({ text: 'Build my landing page', turnId })
    await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
    await clock.advance(1)
  }

  await alertOn('Linux', 't1')
  expect(heard).toEqual([])
  expect(ran).toHaveLength(2)
  expect(ran[0]).toMatch(/^pw-play \/.*\/sounds\/needs-you\.wav$/)
  expect(ran[1]).toBe('spd-say -w Claude needs you')

  await alertOn('Windows_NT', 't2')
  expect(heard).toEqual([])
  expect(ran[0]).toContain("sounds\\needs-you.wav').PlaySync()")
  expect(ran[1]).toContain(".Speak('Claude needs you')")
})

test('no news from Claude for 3 minutes says it may be stuck, with a notice; news clears it', async ($, on) => {
  const { clock } = soundWorld(on)
  const shown: string[][] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    if (argv[0] === 'osascript') throw new Error('osascript: not found')
    shown.push([...argv.slice(-2)])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await clock.advance(2 * 60_000)
  expect((await texts($, 'terminal')).join('\n')).not.toContain('no news')

  shown.length = 0
  await clock.advance(70_000)
  const quiet = (await texts($, 'terminal')).join('\n')
  expect(quiet).toContain('no news for 3 minutes')
  expect(quiet).toContain('Esc')
  expect(shown.at(-1)?.[0]).toBe('Claude is stuck')

  await callTool($, { tool: 'Bash', command: 'ls' })
  expect((await texts($, 'terminal')).join('\n')).not.toContain('no news')

  // Between turns, nothing is running, so nothing is stuck.
  await $.turn.complete({ answer: 'Which colour?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(5 * 60_000)
  expect((await texts($, 'terminal')).join('\n')).not.toContain('no news')
})

test('near a plan limit the warning says when it resets, and a notice says so too', async ($, on) => {
  const { clock } = soundWorld(on)
  const shown: string[][] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    if (argv[0] === 'osascript') throw new Error('osascript: not found')
    shown.push([...argv.slice(-2)])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  await clock.advance(1)
  shown.length = 0
  const resetsAt = new Date(1_000_000 + 2 * 3_600_000)
  const at = `${String(resetsAt.getHours()).padStart(2, '0')}:${String(resetsAt.getMinutes()).padStart(2, '0')}`
  await $.session.measure({
    context: { window: 200_000, tokens: 20_000, percent: 10 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: resetsAt.toISOString() }],
    changed: ['context', 'rateLimits'],
  })
  await clock.advance(1)

  expect((await texts($, 'terminal')).join('\n')).toContain(`You've used 82% of your 5-hour limit · resets at ${at}`)
  expect(shown).toEqual([['Plan limit', `You've used 82% of your 5-hour limit. It resets at ${at}.`]])

  const later = new Date(2026, 9, 6, 12, 0).getTime()
  expect(resetTime(new Date(2026, 9, 6, 18, 40).toISOString(), later)).toBe('at 18:40')
  expect(resetTime(new Date(2026, 9, 8, 9, 0).toISOString(), later)).toBe('on Thu at 09:00')
  expect(resetTime(null, later)).toBe(null)
})

test('on Windows the desktop notice is a Windows toast, with the words passed as variables, not as script', async ($, on) => {
  const { clock } = soundWorld(on)
  const ran: { argv: readonly string[]; env?: Record<string, string> }[] = []
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'OS' ? 'Windows_NT' : undefined }) as never)
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: readonly string[]; init?: { env?: Record<string, string> } }
    ran.push({ argv, env: init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await clock.advance(1)
  await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  await clock.advance(1)
  ran.length = 0

  await $.turn.start({ text: "Fix Ana's 'pricing' page", turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Fix it', 'Check it'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  await clock.advance(1)
  const toast = ran.find(one => one.argv[0] === 'powershell')
  expect(toast?.argv.at(-1)).toContain('ToastNotificationManager')
  expect(toast?.argv.at(-1)).not.toContain('pricing')
  expect(toast?.env?.GLANCEFLOW_TITLE).toBe('Claude needs you')
  expect(toast?.env?.GLANCEFLOW_BODY).not.toBe('')
  expect(ran.some(one => one.argv[0] === 'osascript' || one.argv[0] === 'notify-send')).toBe(false)
})

test('a finished job with helpers still running chimes only when they finish', async ($, on) => {
  const { clock, heard } = soundWorld(on)
  await $.command.run({ command: 'glanceflow', args: 'sound on' } as never)
  heard.length = 0
  await $.turn.start({ text: 'Merge the pull request', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Merge it', 'Watch the checks'] })
  await clock.advance(2 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Watch the checks', percent: 100 })
  await $.turn.complete({ answer: 'Merged.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Watch CI' }],
  } as never)
  expect(heard.filter(one => one === 'sounds/done.wav').length).toBeLessThanOrEqual(1)
  const before = heard.length
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  expect(heard.slice(before)).toEqual(['sounds/done.wav'])
})

test('tool calls read as plain words', () => {
  expect(activityOf('Read', {})).toBe('Reading files')
  expect(activityOf('Grep', {})).toBe('Searching the project')
  expect(activityOf('Edit', {})).toBe('Editing files')
  expect(activityOf('Bash', { command: 'npm test -- --watch=false' })).toBe('Running the tests')
  expect(activityOf('Bash', { command: 'pnpm add zod' })).toBe('Installing packages')
  expect(activityOf('Bash', { command: 'git status' })).toBe('Working with git')
  expect(activityOf('Bash', { command: 'ls -la' })).toBe('Running a command')
  expect(activityOf('mcp__slack__post', {})).toBe('Using a connected app')
  expect(activityOf(PROGRESS, {})).toBe(null)
  expect(activityOf('TodoWrite', {})).toBe(null)
})

test('under the current step, what Claude is doing right now, in plain words', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy'] })
  await callTool($, { tool: 'Read', file_path: '/work/a.md' })
  await callTool($, { tool: 'Read', file_path: '/work/b.md' })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Reading files (2)')
  expect(shown).not.toContain('a.md')

  await callTool($, { tool: 'Bash', command: 'npm test' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Running the tests')
  expect(shown).not.toContain('Reading files')

  // A finished step starts the next one with a clean line.
  await callTool($, { tool: PROGRESS, task: 'Read notes', percent: 100 })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Running the tests')
})

test('calm mode: nothing moves, and statuses read in bold', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const result = await $.command.run({ command: 'glanceflow', args: 'calm on' } as never)
  expect(result.text).toContain('Calm mode is on')
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy'] })
  // Only the clock text may change between frames; the bars and marks stay still.
  const still = (lines: string[]) => lines.join('\n').replace(/\d+s/g, '')
  const first = still(await texts($, 'terminal'))
  await clock.advance(750)
  const later = still(await texts($, 'terminal'))
  expect(later).toBe(first)
  expect(first).toContain('░░░░░░░░░░')

  await callTool($, { tool: PROGRESS, task: 'Write copy', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const done = (await ui.findAll({ type: 'Text' })).find(one => one.text.includes('All done'))
  await ui.unmount()
  expect((done?.props as { bold?: boolean } | undefined)?.bold).toBe(true)
})

test('costs read in plain dollars', () => {
  expect(formatCost(0.004)).toBe('<$0.01')
  expect(formatCost(0.4199)).toBe('$0.42')
  expect(formatCost(3)).toBe('$3.00')
})

test("in details, a job shows what it cost, and the history keeps it", async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const measure = (usd: number) =>
    $.session.measure({ context: { window: 200_000, tokens: 1000, percent: 1 }, rateLimits: [], cost: { usd }, changed: ['cost'] } as never)
  await measure(1)
  await detailsOn($)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await measure(1.42)
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('$0.42')
  // Simple keeps money out of view.
  await $.command.run({ command: 'glanceflow', args: 'details off' } as never)
  expect((await texts($, 'terminal', 120)).join('\n')).not.toContain('$0.42')

  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const pane = (await paneTexts($)).join('\n')
  expect(pane).toContain('$0.42')
})

/** A long chat, so the band offers Tidy it up; the test says what compaction and /compact do. */
async function tidyWorld($: Engine, on: On, compactCommand: () => void) {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined } as never
  })
  on('ui.log', () => ({ value: undefined }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', () => {
    throw new Error('not now')
  })
  const commands: string[] = []
  on('command.run', (_, e) => {
    commands.push(e.command)
    if (e.command === 'compact') compactCommand()
    return { text: '' }
  })
  await $.session.measure({ context: { window: 200_000, tokens: 160_000, percent: 80 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  await ui.unmount()
  return { toasts, commands }
}

test('Tidy it up falls back to /compact when the engine refuses to compact', async ($, on) => {
  const { toasts, commands } = await tidyWorld($, on, () => undefined)
  expect(commands).toContain('compact')
  expect(toasts.join('\n')).not.toContain("Couldn't tidy up")
})

test('when /compact fails too, Tidy it up says why', async ($, on) => {
  const { toasts } = await tidyWorld($, on, () => {
    throw new Error('a turn is running')
  })
  // The engine's reason shows in brackets, so the next report says what went wrong.
  expect(toasts.join('\n')).toMatch(/Couldn't tidy up the chat \(.+\)\. Type \/compact to try again\./)
})

test("once, GlanceFlow brings over Glance's settings and history; another mod's store is left alone", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  mock.env(on, { HOME: '/home/me' })
  const job = { jobId: 'j1', project: '/work', startedAt: 1, finishedAt: 2, title: 'Build the page', outcome: 'done', stepsDone: 1, stepsTotal: 1, newTokens: 0, cachedTokens: 0, doneSteps: ['Build the page'], openSteps: [], isQuickAnswer: false }
  const files: Record<string, unknown> = {
    'glance_claude-mods-1a2b.json': { 'history:2026-10-06': [job], glanceDetail: 'detailed', glanceSound: 'chime' },
    'glance_other-3c4d.json': { 'history:2026-10-06': [{ id: 'not ours' }], enabled: false },
    'notes_x-5e6f.json': { glanceCalm: true },
  }
  const reads: string[] = []
  on('fs.list', (_, e) => {
    expect(e.path).toBe('/home/me/.claude/plugins/store')
    return { value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) } as never
  })
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: JSON.stringify(files[e.path.split('/').pop()!]) } as never
  })
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)

  expect(store.get('history:2026-10-06:glance')).toEqual([job])
  expect(store.get('glanceDetail')).toBe('detailed')
  expect(store.get('glanceSound')).toBe('chime')
  expect(store.get('glanceEnabled')).toBeUndefined()
  expect(store.get('glanceCalm')).toBeUndefined()
  expect(reads).toHaveLength(2)
})

/** A finished job in History: `units` of step size that took `ms` in all. */
function pastJob(jobId: string, project: string, units: number, ms: number, outcome: GlanceOutcome = 'done'): GlanceHistoryEntry {
  return { jobId, project, startedAt: 1, finishedAt: 2, title: 'Earlier job', outcome, stepsDone: 2, stepsTotal: 2, newTokens: 0, cachedTokens: 0, doneSteps: [], openSteps: [], isQuickAnswer: false, doneUnits: units, doneMs: ms }
}

test("a project's pace comes from its finished jobs, once there is enough to go on", () => {
  const site = '/work/landing-site'
  expect(paceFromHistory([pastJob('a', site, 4, 240_000)], site)).toBeNull()
  expect(
    paceFromHistory(
      [
        pastJob('a', site, 4, 240_000),
        pastJob('b', site, 4, 240_000),
        pastJob('c', '/work/other', 8, 10),
        pastJob('d', site, 8, 10, 'stopped'),
      ],
      site,
    ),
  ).toBe(60_000)
})

test("with this project's pace known, time left shows from the first step and leans toward this job's own pace", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { 'history:2026-10-05': [pastJob('a', '/work/landing-site', 4, 240_000), pastJob('b', '/work/landing-site', 4, 240_000)] })
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  // 1 + 2 + 2 + 3 = 8 units at this project's 1 minute a unit.
  await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy', 'Add form', 'Polish it'], sizes: ['S', 'M', 'M', 'L'] })
  expect((await texts($, 'terminal')).join('\n')).toContain('about 8m left')

  // This job's first unit took 30s: (30s + 2 × 60s) / 3 = 50s a unit, × 7 units left ≈ 6m.
  await clock.advance(30_000)
  await callTool($, { tool: PROGRESS, task: 'Read notes', percent: 100 })
  expect((await texts($, 'terminal')).join('\n')).toContain('about 6m left')
})

test('a finished job keeps the size and time of its steps, so the next job learns from it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('session.id', () => ({ value: 'chat-1' }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write copy', 'Polish it'], sizes: ['M', 'L'] })
  await clock.advance(2 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Write copy', percent: 100 })
  await clock.advance(3 * 60_000)
  await callTool($, { tool: PROGRESS, task: 'Polish it', percent: 100 })
  await $.turn.complete({ turnId: 't1' } as never)

  const saved = [...store.entries()].find(([key]) => key.startsWith('history:'))?.[1] as { doneUnits: number; doneMs: number }[]
  expect(saved[0]?.doneUnits).toBe(5)
  expect(saved[0]?.doneMs).toBe(5 * 60_000)
})

test("a new job starts without reading History: the project's pace is learned once and again only after a job that changes it", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>([['history:2026-10-05', [pastJob('a', '/work/landing-site', 4, 240_000), pastJob('b', '/work/landing-site', 4, 240_000)]]])
  let historyReads = 0
  on('store.get', (_, e) => {
    if (e.key.startsWith('history:')) historyReads += 1
    return { value: store.get(e.key) } as never
  })
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('session.id', () => ({ value: 'chat-1' }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  // A planned job that finishes with timed steps, a quick answer with no plan, or a planned job left open.
  const job = async (turnId: string, kind: 'finished' | 'quick' | 'open') => {
    await $.turn.start({ text: `Build my landing page ${turnId}`, turnId })
    let shown = ''
    if (kind !== 'quick') {
      await callTool($, { tool: PLAN, steps: ['Read notes', 'Write copy', 'Add form', 'Polish it'], sizes: ['S', 'M', 'M', 'L'] })
      shown = (await texts($, 'terminal')).join('\n')
    }
    if (kind === 'finished') {
      for (const task of ['Read notes', 'Write copy', 'Add form', 'Polish it']) {
        await clock.advance(60_000)
        await callTool($, { tool: PROGRESS, task, percent: 100 })
      }
    }
    await $.turn.complete({ turnId } as never)
    return shown
  }

  // The first job shows at once and gets the pace as soon as History is read: 8 units at 1 minute a unit.
  expect(await job('t1', 'finished')).toContain('about 8m left')
  expect(historyReads).toBeGreaterThan(0)
  // t1 finished with timed steps, so t2 learns the pace again. t2, a quick answer, doesn't change it, so t3 reads
  // only its own day, to record itself.
  historyReads = 0
  await job('t2', 'quick')
  expect(historyReads).toBeGreaterThan(1)
  historyReads = 0
  expect(await job('t3', 'open')).toMatch(/about \d+m left/)
  expect(historyReads).toBe(1)
})

test('the request Haiku names a job from is masked first', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  let asked = ''
  on('model.complete', (_, e) => {
    asked = String((e as { prompt?: string }).prompt ?? '')
    return { value: { isAnswered: true, text: 'Email the invoice', usage: {} } } as never
  })
  await $.turn.start({ text: `Email jane@example.com the invoice, the password is ${SAMPLE_PASSWORD}`, turnId: 't1' })
  // The job is named in the background.
  await clock.advance(1)
  expect(asked).toContain('the invoice')
  expect(asked).not.toContain('jane@example.com')
  expect(asked).not.toContain(SAMPLE_PASSWORD)
})

test("a finished step's summary shows under it until Claude moves on, and code stays out of it", async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Add pricing', 'Check it'] })
  await callTool($, {
    tool: PROGRESS,
    task: 'Add pricing',
    percent: 100,
    summary: 'Added a pricing table with three plans in `src/Pricing.tsx`',
  })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('    Added a pricing table with three plans in')
  expect(shown).not.toContain('Pricing.tsx')

  await callTool($, { tool: 'Read', file_path: '/work/a.md' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Reading files')
  expect(shown).not.toContain('Added a pricing table')
})

test("the team report says what each step got done, in Claude's words where it gave them", () => {
  const report = teamReport({
    day: '2026-10-06',
    project: '/work/landing-site',
    entries: [
      { ...ENTRY, jobId: 'a', startedAt: 0, finishedAt: 12 * 60_000, title: 'Build the pricing section', outcome: 'done', stepsDone: 2, stepsTotal: 2, doneSteps: ['Write it', 'Check it'], doneNotes: ['Added three plans with monthly and yearly prices', ''], openSteps: [] },
    ],
  })
  expect(report).toContain('  ✓ Added three plans with monthly and yearly prices\n  ✓ Check it')
})

test('the weekly team report covers the 7 days up to the day picked, and This week switches to it', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 6, 18, 0).getTime() })
  const job = (jobId: string, day: number, title: string) => ({
    ...ENTRY,
    jobId,
    startedAt: new Date(2026, 9, day, 9, 0).getTime(),
    finishedAt: new Date(2026, 9, day, 9, 30).getTime(),
    title,
    outcome: 'done',
    stepsDone: 1,
    stepsTotal: 1,
    doneSteps: [title],
    openSteps: [],
  })
  mock.store(on, {
    'history:2026-10-06': [job('a', 6, 'Build the pricing section')],
    'history:2026-10-02': [job('b', 2, 'Fix the contact form')],
    'history:2026-09-29': [job('c', 29 - 30, 'Too old for this week')],
  })
  let copied = ''
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } } as never
  })
  await $.command.run({ command: 'glanceflow', args: 'history' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await ui.unmount()
  const report = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await report.press({ key: 'span' })
  await report.unmount()
  expect(copied).toMatch(/Weekly update · landing-site · 30 Sept? 2026 to 6 Oct 2026/)
  expect(copied).toContain('• Build the pricing section (30 min)')
  expect(copied).toContain('• Fix the contact form (30 min)')
  expect(copied).not.toContain('Too old')
  expect(copied).toContain('2 of 2 tasks finished · 1 h of work')
  expect((await paneTexts($)).join('\n')).toContain('This day')
})

test('your week sums up every project: steps, tasks, time, the busiest day and the biggest tasks', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 6, 18, 0).getTime() })
  const job = (jobId: string, day: number, title: string, steps: number, project = '/work/landing-site') => ({
    ...ENTRY,
    jobId,
    project,
    startedAt: new Date(2026, 9, day, 9, 0).getTime(),
    finishedAt: new Date(2026, 9, day, 9, 30).getTime(),
    title,
    outcome: 'done',
    stepsDone: steps,
    stepsTotal: steps,
    doneSteps: Array.from({ length: steps }, (_, at) => `Step ${at + 1}`),
    openSteps: [],
  })
  mock.store(on, {
    'history:2026-10-06': [job('a', 6, 'Build the pricing section', 4), job('b', 6, 'Write the newsletter', 2, '/work/newsletter')],
    'history:2026-10-02': [job('c', 2, 'Fix the contact form', 1), { ...job('q', 2, 'What time is it?', 0), isQuickAnswer: true }],
    'history:2026-09-29': [job('d', 29 - 30, 'Too old for this week', 5)],
  })
  let copied = ''
  on('session.cwd', () => ({ value: '/work/landing-site' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } } as never
  })
  const result = await $.command.run({ command: 'glanceflow', args: 'week' } as never)
  expect(result.text).toBe('Claude checked off 7 steps in 3 tasks, and finished 3 of them.')
  expect(copied).toMatch(/Your week with Claude · 30 Sept? 2026 to 6 Oct 2026/)
  expect(copied).toContain('Time at work: 1 h 30 min, across 2 projects.')
  expect(copied).toContain('Busiest day: Tuesday, with 2 tasks.')
  expect(copied).toContain('• Build the pricing section (4 steps)')
  expect(copied).toContain('• Write the newsletter (2 steps)')
  expect(copied).not.toContain('Too old')
  expect(copied).not.toContain('What time is it')
  const shown = (await paneTexts($)).join('\n')
  expect(shown).toContain('Your week with Claude')
  expect(shown).not.toContain('This week')

  // From the list, Your week shows it again.
  const back = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await back.press({ key: 'back' })
  await back.unmount()
  copied = ''
  const list = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await list.press({ key: 'mine' })
  await list.unmount()
  expect(copied).toContain('Claude checked off 7 steps in 3 tasks')
})

test('a week with no planned work says so plainly', () => {
  expect(weekSummary([], '2026-10-06')).toContain('No planned work was recorded this week.')
})

test("the band says in one whole sentence what Claude is doing; the Plan says more", async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Check the page', 'Fix the links'] })
  await callTool($, { tool: 'Bash', command: 'npx playwright test --project=mobile', description: 'Check the page on a phone screen' })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Now: Check the page on a phone screen')
  expect(shown).not.toContain('playwright')
  expect(shown).not.toContain('…')

  // Too long for a narrow band: the short label instead of a cut sentence.
  shown = (await texts($, 'terminal', 34)).join('\n')
  expect(shown).toContain('Running the tests')
  expect(shown).not.toContain('Now: Check')

  // The Plan, in Details, adds what Claude runs.
  await detailsOn($)
  const pane = await planPaneTexts($)
  expect(pane).toContain('Now: Check the page on a phone screen')
  expect(pane).toContain('↳ npx playwright test --project=mobile')
})

test('the Plan shows long step names whole in a narrow panel', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Keep the product profile private', 'Load the social media guide'] })
  const ui = await $.ui.mount({ ...PLAN_PANE, props: { ...PLAN_PANE.props, bodyColumns: 40 }, surface: 'terminal' })
  const pane = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await ui.unmount()
  expect(pane).toContain('Keep the product profile private')
  expect(pane).toContain('Load the social media guide')
  expect(pane).not.toContain('priva…')
})

test('someone new gets a three-card welcome once; /glanceflow tour shows it again', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)

  const shown = (await texts($, 'terminal', 120)).join('\n')
  expect(shown).toContain('Welcome to GlanceFlow · 1 of 3')
  expect(shown).toContain('A checklist shows here when you ask Claude')
  expect(shown).toContain('≣ History')
  for (const card of ['2 of 3', '3 of 3']) {
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'tour-next' })
    await band.unmount()
    expect((await texts($, 'terminal', 120)).join('\n')).toContain(card)
  }
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('✓ Got it')
  const last = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await last.press({ key: 'tour-next' })
  await last.unmount()
  expect((await texts($, 'terminal', 120)).join('\n')).not.toContain('Welcome to GlanceFlow')

  // The next chat does not show it again.
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  expect((await texts($, 'terminal', 120)).join('\n')).not.toContain('Welcome to GlanceFlow')

  await $.command.run({ command: 'glanceflow', args: 'tour' } as never)
  expect((await texts($, 'terminal', 120)).join('\n')).toContain('Welcome to GlanceFlow · 1 of 3')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'tour-skip' })
  await band.unmount()
  expect((await texts($, 'terminal', 120)).join('\n')).not.toContain('Welcome to GlanceFlow')
})

test('someone who already uses GlanceFlow is not welcomed again', async ($, on) => {
  mock.store(on, { glanceSound: 'chime' })
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  expect((await texts($, 'terminal', 120)).join('\n')).not.toContain('Welcome to GlanceFlow')
})

test('a time Claude writes in UTC shows in the person\'s own time', () => {
  const today = new Date(Date.UTC(2026, 9, 6, 9, 0))
  const local = (hours: number, minutes: number, seconds?: number) => {
    const at = new Date(Date.UTC(2026, 9, 6, hours, minutes, seconds ?? 0))
    const two = (value: number) => String(value).padStart(2, '0')
    return `${two(at.getHours())}:${two(at.getMinutes())}${seconds === undefined ? '' : `:${two(at.getSeconds())}`}`
  }
  expect(localTimes('Wait until 10:01:45 UTC to start the deploy', today)).toBe(`Wait until ${local(10, 1, 45)} to start the deploy`)
  expect(localTimes('Check again at 9:30 GMT and 23:05Z', today)).toBe(`Check again at ${local(9, 30)} and ${local(23, 5)}`)
  // Without UTC, GMT or Z the time could be anyone's: it stays as Claude wrote it.
  expect(localTimes('Wait for the 10:15 cron run to finish', today)).toBe('Wait for the 10:15 cron run to finish')
  expect(cleanName('Wait until 10:01:45 UTC to start the checks')).not.toContain('UTC')
})

test('a request in another language gets an English title', () => {
  expect(isLatinText('Build my landing page')).toBe(true)
  expect(isLatinText('Φτιάξε τη σελίδα μου')).toBe(false)
  expect(isStartWords('Go ahead')).toBe(true)
  expect(isStartWords('ξεκίνα')).toBe(true)
  expect(isStartWords('change step two')).toBe(false)
})

test('with Approve the plan first on, Claude waits for Start before it works', async ($, on) => {
  world(on)
  const on_ = await $.command.run({ command: 'glanceflow', args: 'approve on' } as never)
  expect(on_.text).toContain('waits')
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const planned = await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  expect(String(planned.result)).toContain('wait for their reply')
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Read the plan, then press Start')
  expect(shown).toContain('▶ Start')
  const denied = await callTool($, { tool: 'Bash', command: 'ls' })
  expect(denied.deny).toContain('not approved')

  await $.turn.start({ text: 'The plan looks good. Please start.', turnId: 't2' })
  const ran = await callTool($, { tool: 'Bash', command: 'ls' })
  expect(ran.deny).toBeUndefined()
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('▶ Start')
  expect(shown).toContain('Write the page')
})

test('Aim higher asks Claude for a deeper plan, and the new plan still waits for Start', async ($, on) => {
  world(on)
  let sent = ''
  on('prompt.submit', (_, e) => {
    sent = e.text
    return { text: e.text }
  })
  await $.command.run({ command: 'glanceflow', args: 'approve on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('✦ Aim higher')
  // Start stays the main button, and last.
  const buttons = (await texts($, 'desktop')).filter(one => one === 'Aim higher' || one === 'Start')
  expect(buttons).toEqual(['Aim higher', 'Start'])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'aim' })
  await ui.unmount()
  expect(sent).toStartWith('Aim higher: I want a deeper version of this job, not a bigger one.')
  expect(sent).toContain('done_when')

  // The same job goes on; Claude's new plan waits for Start again.
  await $.turn.start({ text: sent, turnId: 't2' })
  const replanned = await callTool($, { tool: PLAN, steps: ['Read the raw analytics', 'Write the page', 'Test it on a phone'] })
  expect(String(replanned.result)).toContain('wait for their reply')
  expect((await callTool($, { tool: 'Bash', command: 'ls' })).deny).toContain('not approved')
  expect((await texts($, 'terminal')).join('\n')).toContain('▶ Start')
  // Same job: the plan grew rather than started over.
  expect(await planPaneTexts($)).toContain('plan grew 2 → 3')
})

test('with Approve the plan first on, a plan Claude makes with its own task list also waits for Start', async ($, on) => {
  world(on)
  await $.command.run({ command: 'glanceflow', args: 'approve on' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: 'TaskCreate', subject: 'Write the page' } as never)
  await callTool($, { tool: 'TaskCreate', subject: 'Check it' } as never)
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Read the plan, then press Start')
  expect(shown).toContain('Check it')
  expect((await callTool($, { tool: 'Bash', command: 'ls' })).deny).toContain('not approved')

  await $.turn.start({ text: 'start', turnId: 't2' })
  expect((await callTool($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  await callTool($, { tool: 'TodoWrite', todos: [{ content: 'Write the page', status: 'in_progress' }] } as never)
  expect((await callTool($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('each step shows the files Claude added or changed, in the Plan and in History', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  const existing = new Set(['/work/landing-site/styles.css', '/work/landing-site/index.html'])
  on('fs.exists', (_, e) => ({ value: existing.has((e as { path: string }).path) }) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Add the contact form', 'Check it'] })
  await callTool($, { tool: 'Write', file_path: '/work/landing-site/contact.html', content: '<form>' })
  await callTool($, { tool: 'Edit', file_path: '/work/landing-site/styles.css', old_string: 'a', new_string: 'b' })
  await callTool($, { tool: 'Edit', file_path: '/work/landing-site/contact.html', old_string: 'a', new_string: 'b' })
  // A helper's edit counts for the step it works under.
  await callTool($, { tool: 'Edit', file_path: '/work/landing-site/index.html', old_string: 'a', new_string: 'b', agentId: 'a1' })
  expect(await planPaneTexts($)).toContain('Added contact.html · changed styles.css and index.html so far')

  await callTool($, { tool: PROGRESS, task: 'Add the contact form', percent: 100, summary: 'Added a contact form' })
  await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const plan = await planPaneTexts($)
  expect(plan).toContain('    Added contact.html · changed styles.css and index.html')
  expect(plan).not.toContain('so far')

  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  expect((await paneTexts($)).join('\n')).toContain('Added contact.html · changed styles.css and index.html')

  // Names only; the folder where two share a name, and a long list cut short.
  expect(
    filesNote([
      { path: 'app/page.tsx', isNew: false },
      { path: 'app/pricing/page.tsx', isNew: false },
      { path: 'a.css', isNew: false },
      { path: 'b.css', isNew: false },
      { path: 'c.css', isNew: false },
    ]),
  ).toBe('Changed app/page.tsx, pricing/page.tsx, a.css, b.css and 1 more')
  expect(filesNote([{ path: 'notes.md', isNew: true }])).toBe('Added notes.md')
  expect(filesNote([])).toBe('')
})

test('a check command is a test, build or type check that runs, not one that is only mentioned', () => {
  for (const command of ['npm test', 'cd x && pnpm run build', 'CI=1 npx vitest run', 'go test ./...', 'npm test 2>&1 | tail -5', 'claude plugin test glanceflow'])
    expect(runsCheck(command)).toBe(true)
  for (const command of ['git commit -m "fix test"', 'cat tests/a.ts', 'npm install jest', 'echo npm test', 'ls'])
    expect(runsCheck(command)).toBe(false)

  expect(checkResult(true, '')).toBe('failed')
  // Piped through tail, the exit code is tail's: the output tells.
  expect(checkResult(false, 'Tests: 3 failed, 12 passed')).toBe('failed')
  expect(checkResult(false, 'src/a.ts(3,1): error TS2304: Cannot find name')).toBe('failed')
  expect(checkResult(false, ' 203 pass\n 0 fail')).toBe('passed')
  expect(needsCheck('README.md')).toBe(false)
  expect(needsCheck('src/a.ts')).toBe(true)

  const step = (check?: 'passed' | 'failed' | 'unchecked') => ({ ...carryTokens([], [])[0], id: String(check), check }) as never
  const checked = applyCheck([step(), step('passed'), step('unchecked')], 'failed')
  expect(checked.map(one => one.check)).toEqual([undefined, 'passed', 'failed'])
  expect(jobCheck(checked)).toBe('failed')
  expect(jobCheck([step(), step('passed')])).toBe('passed')
  expect(jobCheck([step()])).toBeNull()
})

test('a finished job says whether the code it changed was tested, by the tests run, not by Claude', async ($, on) => {
  // What the shell answers; every other tool succeeds.
  let answer: unknown = { result: {}, text: ' 203 pass\n 0 fail' }
  world(on, ((_: unknown, e: { tool: string }) => (e.tool === 'Bash' ? answer : { result: {} })) as never)
  let turn = 0
  const job = async (work: () => Promise<unknown>) => {
    turn += 1
    await $.turn.start({ text: `Fix the sign-up bug ${turn}`, turnId: `t${turn}` })
    await callTool($, { tool: PLAN, steps: ['Fix the bug', 'Check it'] })
    await work()
    await callTool($, { tool: PROGRESS, task: 'Fix the bug', percent: 100 })
    await callTool($, { tool: PROGRESS, task: 'Check it', percent: 100 })
    await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: `t${turn}`, reason: 'answer' })
    return (await texts($, 'terminal')).find(line => line.startsWith('✓ All done')) ?? ''
  }
  const edit = (path: string) => callTool($, { tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
  const bash = (command: string) => callTool($, { tool: 'Bash', command })

  expect(await job(async () => (await edit('/work/src/a.ts'), await bash('npm test')))).toMatch(/ · tested · took /)
  expect((await texts($, 'desktop')).join('\n')).toMatch(/Fix the sign-up bug 1 · tested · took /)
  // An edit after the tests passed is untested again.
  expect(await job(async () => (await edit('/work/src/a.ts'), await bash('npm test'), await edit('/work/src/a.ts')))).toContain(' · not tested · ')
  // A command that only mentions tests checks nothing.
  expect(await job(async () => (await edit('/work/src/a.ts'), await bash('git commit -m "fix test"')))).toContain(' · not tested · ')
  answer = { isError: true, result: 'x', text: '1 failed' }
  expect(await job(async () => (await edit('/work/src/a.ts'), await bash('npm test')))).toContain(' · tests failed · ')
  // Prose needs no test.
  answer = { result: {}, text: '' }
  const prose = await job(() => edit('/work/README.md'))
  expect(prose).toContain('✓ All done')
  expect(prose).not.toMatch(/tested|tests failed/)
  // The person saying no at the permission dialog says nothing about the code; the Plan shows each step's check.
  answer = { isError: true, result: 'x', text: "The user doesn't want to proceed with this tool use." }
  await $.turn.start({ text: 'Fix the login bug', turnId: 'tn' })
  await callTool($, { tool: PLAN, steps: ['Fix the bug', 'Check it'] })
  await edit('/work/src/a.ts')
  await bash('npm test')
  await callTool($, { tool: PROGRESS, task: 'Fix the bug', percent: 100 })
  expect(await planPaneTexts($)).toContain(' took 0s · not tested')
})

test('a plan says what done looks like, in the Plan and in the Team report, beside whether it was tested', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  let copied = ''
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } } as never
  })
  await $.turn.start({ text: 'Fix the sign-up form', turnId: 't1' })
  const doneWhen = 'The sign-up tests pass and the form works on a phone'
  await callTool($, { tool: PLAN, steps: ['Fix the form', 'Run the tests'], done_when: doneWhen })
  expect(await planPaneTexts($)).toContain(`Done when: ${doneWhen}`)
  // A new plan that leaves it out keeps it.
  await callTool($, { tool: PLAN, steps: ['Fix the form', 'Run the tests', 'Try it on a phone'] })
  expect(await planPaneTexts($)).toContain(`Done when: ${doneWhen}`)

  await callTool($, { tool: 'Edit', file_path: '/work/landing-site/src/form.ts', old_string: 'a', new_string: 'b' })
  await callTool($, { tool: 'Bash', command: 'npm test' })
  for (const task of ['Fix the form', 'Run the tests', 'Try it on a phone']) await callTool($, { tool: PROGRESS, task, percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await ui.unmount()
  expect(copied).toMatch(/• Fix the sign-up form \(.*\) · tested\n  Done when: The sign-up tests pass and the form works on a phone\n/)
})

test('/glanceflow goal sets a standing goal for the project: Claude plans toward it, and the Plan and Team report show it', async ($, on) => {
  world(on)
  historyWorld(on, { cwd: '/work/landing-site' })
  let copied = ''
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } } as never
  })
  on('prompt.compose', () => ({ sections: [] }) as never)
  const goalSection = async () => {
    const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [], sections: [] } as never)
    return (composed as unknown as { sections: { id: string; text: string }[] }).sections.find(one => one.id === 'glanceflow:goal')?.text
  }
  const goal = (args: string) => $.command.run({ command: 'glanceflow', args } as never).then(one => String(one.text))

  expect(await goal('goal')).toContain('No goal for this project yet')
  expect(await goalSection()).toBeUndefined()
  // The goal keeps the person's own capitals.
  expect(await goal('goal Keep sign-ups working on every phone')).toContain('Keep sign-ups working on every phone')
  expect(await goal('goal')).toContain('The goal for this project: Keep sign-ups working on every phone')
  expect(await goalSection()).toContain("# The person's standing goal for this project\nKeep sign-ups working on every phone\nPlan each job toward it")

  await $.turn.start({ text: 'Fix the sign-up form', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Fix the form', 'Run the tests'] })
  expect(await planPaneTexts($)).toContain('Goal: Keep sign-ups working on every phone')
  await callTool($, { tool: 'Edit', file_path: '/work/landing-site/src/form.ts', old_string: 'a', new_string: 'b' })
  await callTool($, { tool: 'Bash', command: 'npm test' })
  for (const task of ['Fix the form', 'Run the tests']) await callTool($, { tool: PROGRESS, task, percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await ui.unmount()
  expect(copied).toMatch(/^Daily update · landing-site · .*\nGoal: Keep sign-ups working on every phone · 1 task, 1 finished, 1 tested\n\nDone\n/)

  expect(await goal('goal off')).toContain('cleared')
  expect(await goalSection()).toBeUndefined()
})

test('Settings shows the version, checks for a newer one when asked, and installs it', async ($, on) => {
  world(on)
  const SETTINGS = { ...PANE, requestId: 'glanceflow-settings', props: { ...PANE.props, title: 'GlanceFlow settings' } } as const
  // The install as Claude Code reports it, and the newest GlanceFlow in its marketplace.
  const install = { id: 'glanceflow@claude-mods', scope: 'user', enabled: true, installPath: '/cache/claude-mods/glanceflow/0.26.0' }
  const newest = '0.27.0'
  const ran: string[] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    ran.push(argv.join(' '))
    const out = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout), stderr: '' } }) as never
    if (argv.join(' ') === 'claude plugin list --json') return out([install])
    if (argv.join(' ') === 'claude plugin list --available --json') return out({ installed: [install], available: [{ pluginId: install.id, source: './glanceflow' }] })
    if (argv.join(' ') === 'claude plugin marketplace list --json') return out([{ name: 'claude-mods', installLocation: '/markets/claude-mods' }])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.read', (_, e) => ({ value: JSON.stringify({ version: e.path.startsWith('/markets/') ? newest : '0.26.0' }) }) as never)
  const shown = async () => {
    const ui = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    const words = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(one => one.text).join('\n')
    await ui.unmount()
    return words
  }
  const press = async (key: string) => {
    const ui = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    await ui.press({ key })
    await ui.unmount()
  }

  // Nothing runs until the person asks.
  let words = await shown()
  expect(words).toContain('GlanceFlow 0.26.0.')
  expect(words).toContain('Check for updates')
  expect(ran).toEqual([])

  await press('update')
  expect(ran).toContain('claude plugin marketplace update claude-mods')
  words = await shown()
  expect(words).toContain('GlanceFlow 0.27.0 is out.')
  expect(words).toContain('Update to 0.27.0')

  await press('update')
  expect(ran).toContain('claude plugin update glanceflow@claude-mods')
  words = await shown()
  expect(words).toContain('GlanceFlow 0.27.0 is installed. Open a new chat to use it.')
  expect(words).not.toContain('Update to')
})

test('Version: the newest is said plainly, a copy run from a folder is not updated from a marketplace, and a failure gives the command', async ($, on) => {
  world(on)
  const SETTINGS = { ...PANE, requestId: 'glanceflow-settings', props: { ...PANE.props, title: 'GlanceFlow settings' } } as const
  let id = 'glanceflow@claude-mods'
  let isBroken = false
  const ran: string[] = []
  on('process.run', (_, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    ran.push(argv.join(' '))
    if (isBroken) throw new Error('claude: not found')
    const out = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout), stderr: '' } }) as never
    if (argv.join(' ') === 'claude plugin list --json') return out([{ id, scope: 'user', enabled: true, installPath: '/somewhere' }])
    if (argv.join(' ') === 'claude plugin list --available --json') return out({ installed: [], available: [{ pluginId: id, version: '0.26.0' }] })
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.read', () => ({ value: JSON.stringify({ version: '0.26.0' }) }) as never)
  const check = async () => {
    const ui = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    await ui.press({ key: 'update' })
    await ui.unmount()
    const again = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    const words = [...(await again.findAll({ type: 'Text' })), ...(await again.findAll({ type: 'Button' }))].map(one => one.text).join('\n')
    await again.unmount()
    return words
  }

  let words = await check()
  expect(words).toContain('You have the newest version.')
  expect(words).not.toContain('Update to')

  isBroken = true
  words = await check()
  expect(words).toContain("Couldn't check or update from here. In a terminal, run: claude plugin update glanceflow@claude-mods")
  expect(words).toContain('Check again')

  // A copy loaded from a folder updates where it lives: no marketplace fetch, and no button to press again.
  isBroken = false
  id = 'glanceflow@inline'
  ran.length = 0
  words = await check()
  expect(words).toContain('runs from a folder')
  expect(words).not.toContain('Check again')
  expect(ran.some(one => one.includes('marketplace update'))).toBe(false)

  expect(isNewerVersion('0.27.0', '0.26.0')).toBe(true)
  expect(isNewerVersion('0.26.10', '0.26.9')).toBe(true)
  expect(isNewerVersion('1.0.0', '0.99.9')).toBe(true)
  expect(isNewerVersion('0.26.0', '0.26.0')).toBe(false)
  expect(isNewerVersion('0.25.3', '0.26.0')).toBe(false)
})

/** The same world as `world`, with the clock and a store the test can read, starting with `entries`. */
function resumeWorld(on: On, entries: Record<string, unknown> = {}, failsToDelete = false) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map(Object.entries(entries))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    if (failsToDelete) throw new Error('locked')
    store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Build my landing page', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}) as never)
  // This chat's id; a test changes it to stand for /clear, after which the process goes on as another chat.
  const session = { id: 'chat-1' }
  on('session.id', () => ({ value: session.id }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  const registered: string[] = []
  on('tool.register', (_, e) => {
    registered.push((e as { name: string }).name)
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  return { clock, store, registered, session }
}

test("a chat's checklist is kept as it changes, for when the chat is resumed", async ($, on) => {
  const { clock, store } = resumeWorld(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  await callTool($, { tool: PROGRESS, task: 'Write the page', percent: 100, summary: 'Wrote the page' })
  await clock.advance(1500)
  const kept = store.get('resume:chat-1') as { list: { phase: string; tasks: { name: string; status: string }[] } } | undefined
  expect(kept?.list.phase).toBe('working')
  expect(kept?.list.tasks.map(one => `${one.name}:${one.status}`)).toEqual(['Write the page:done', 'Check it:active'])
})

test('a resumed chat gets its checklist back, paused, and Continue picks it up', async ($, on) => {
  const task = (name: string, status: string) => ({
    id: name, name, status, percent: status === 'done' ? 100 : 40, hasReported: true, size: 'M', summary: status === 'done' ? 'Wrote the page' : null,
    tokens: 0, cachedTokens: 0, startedAt: 1_000_000, finishedAt: status === 'done' ? 1_060_000 : null,
  })
  const list = {
    title: 'Build my landing page', phase: 'working', tasks: [task('Write the page', 'done'), task('Check it', 'active')],
    needsYouReason: null, stuckReason: null, startedAt: 1_000_000, finishedAt: null, isCollapsed: false, hasPlan: true, jobId: 'job-1',
    planAt: 1_000_000, plannedCount: 2, extraTokens: 0, extraCachedTokens: 0, stopKind: null, approval: 'none', costAtStart: null, paceMs: null,
    activity: { label: 'Running a command', count: 1, detail: null, target: null },
    helpers: [{ id: 'h1', stepId: 'Check it', kind: 'helper', label: 'Check phones', type: 'Explore', model: null, effort: null, status: 'running', tokens: 0 }],
  }
  resumeWorld(on, {
    glanceResume: { 'chat-1': { at: 1_100_000, list }, 'chat-2': { at: 1_100_000, list: { ...list, title: 'Another chat' } } },
  })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)

  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('‖ Paused')
  expect(shown).toContain('Check it')
  expect(shown).toContain('▶ Continue')
  expect(shown).not.toContain('Another chat')
  // A helper that was running died with the old process.
  expect(shown).not.toContain('Check phones')

  await $.turn.start({ text: 'continue', turnId: 't2' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Paused')
  expect(shown).toContain('Check it')
  expect((await callTool($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test("each chat keeps its checklist under its own key; the old shared key moves over and only the 20 most recent stay", async ($, on) => {
  const saved = (at: number, title: string) => ({ at, list: { title, phase: 'done', tasks: [], helpers: [], startedAt: at, finishedAt: at } })
  const recent = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`resume:chat-${i + 10}`, saved(2_000_000 + i, `Chat ${i + 10}`)]))
  const { store } = resumeWorld(on, {
    ...recent,
    glanceResume: { 'chat-2': saved(900_000, 'Old chat'), 'chat-3': saved(950_000, 'Older chat kept'), 'chat-10': saved(1, 'Stale copy') },
  })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)

  expect(store.has('glanceResume')).toBe(false)
  // A chat that already has its own key keeps it over the old shared copy.
  expect((store.get('resume:chat-10') as { list: { title: string } }).list.title).toBe('Chat 10')
  expect((store.get('resume:chat-3') as { list: { title: string } }).list.title).toBe('Older chat kept')
  // 20 other chats, 19 kept beside this one: the oldest goes.
  expect(store.has('resume:chat-2')).toBe(false)
  expect([...store.keys()].filter(key => key.startsWith('resume:'))).toHaveLength(19)
})

test('a store that fails while tidying saved checklists does not keep the chat from starting', async ($, on) => {
  const { registered } = resumeWorld(on, { glanceResume: { 'chat-2': { at: 1, list: { title: 'Old', phase: 'done' } } } }, true)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  expect(registered).toContain('plan_steps')
})

test('saving one chat never touches another chat\'s key', async ($, on) => {
  const other = { at: 5, list: { title: 'Another chat', phase: 'working' } }
  const { clock, store } = resumeWorld(on, { 'resume:chat-2': other })
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page'] })
  await clock.advance(1500)
  expect(store.get('resume:chat-2')).toEqual(other)
  expect((store.get('resume:chat-1') as { list: { title: string } }).list.title).toBe('Build my landing page')
})

test('the other chats worth a word: those that need you first, then those at work; ended, finished or silent ones are left out', () => {
  const at = 10 * OTHER_WAITING_MS
  const chat = (title: string, phase: string, ago: number, isOpen = true) => ({ at: at - ago, list: { title, phase }, isOpen }) as never
  const others = otherChats(
    [
      chat('Write the email', 'working', 1000),
      chat('Build the pricing page', 'needsYou', 5000),
      chat('Fix the form', 'stuck', 2000),
      chat('Closed one', 'needsYou', 10, false),
      { at: at - 10, list: { title: 'Saved before 0.25', phase: 'needsYou' } } as never,
      chat('Finished', 'done', 10),
      chat('Paused', 'stopped', 10),
      chat('Went silent', 'working', OTHER_WORKING_MS + 1),
      chat('Left for days', 'needsYou', OTHER_WAITING_MS + 1),
      undefined,
    ],
    at,
  )
  expect(others.map(one => one.title)).toEqual(['Fix the form', 'Build the pricing page', 'Write the email'])
  expect(otherChatsWords(others)).toEqual(['2 other chats need you: Fix the form, Build the pricing page', '1 more at work'])
  expect(otherChatsWords(others.slice(1, 2))).toEqual(['Another chat needs you: Build the pricing page'])
  expect(otherChatsWords(others.slice(2))).toEqual(['1 other chat at work'])
  expect(otherChatsWords([])).toEqual([])
})

test('the band names another chat that needs you, on every surface, and keeps up as the other chats change', async ($, on) => {
  const saved = (title: string, phase: string) => ({
    at: 1_000_000, isOpen: true, list: { title, phase, tasks: [], helpers: [], startedAt: 1_000_000, finishedAt: null },
  })
  const { clock, store } = resumeWorld(on, { 'resume:chat-2': saved('Write the email', 'working') })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  for (const surface of SURFACES) {
    expect((await texts($, surface)).join('\n')).toContain('1 other chat at work')
  }

  store.set('resume:chat-3', saved('Build the pricing page', 'needsYou'))
  await clock.advance(20_000)
  for (const surface of SURFACES) {
    const shown = (await texts($, surface)).join('\n')
    expect(shown).toContain('Another chat needs you: Build the pricing page')
    expect(shown).toContain('1 more at work')
  }

  // A chat that ended is no longer mentioned, and this chat never mentions itself.
  store.set('resume:chat-3', { ...saved('Build the pricing page', 'needsYou'), isOpen: false })
  store.set('resume:chat-1', saved('This chat', 'needsYou'))
  await clock.advance(20_000)
  const shown = (await texts($, 'desktop')).join('\n')
  expect(shown).not.toContain('needs you')
  expect(shown).toContain('1 other chat at work')
})

test('a chat that ends marks its checklist closed and keeps it for when it is resumed', async ($, on) => {
  const { clock, store } = resumeWorld(on)
  on('session.end', () => ({ sessionId: 'chat-1' }) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page'] })
  await clock.advance(1500)
  await $.session.end({ reason: 'exit' } as never)
  const kept = store.get('resume:chat-1') as { isOpen?: boolean; list: { title: string } }
  expect(kept.isOpen).toBe(false)
  expect(kept.list.title).toBe('Build my landing page')
})

test('a chat that ends right after a change stays marked closed', async ($, on) => {
  const { clock, store } = resumeWorld(on)
  on('session.end', () => ({ sessionId: 'chat-1' }) as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page'] })
  await $.session.end({ reason: 'exit' } as never)
  await clock.advance(1500)
  expect((store.get('resume:chat-1') as { isOpen?: boolean }).isOpen).toBe(false)
})

test('after /clear the chat goes on as a new one: the old one is closed, the new one is open and still reads the others', async ($, on) => {
  const saved = { at: 1_000_000, isOpen: true, list: { title: 'Build the pricing page', phase: 'needsYou', tasks: [], helpers: [], startedAt: 1_000_000, finishedAt: null } }
  const { clock, store, session } = resumeWorld(on, { 'resume:chat-2': saved })
  on('session.end', () => ({ sessionId: 'chat-1' }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page'] })
  await clock.advance(1500)
  await $.session.end({ reason: 'clear', sessionId: 'chat-1' } as never)
  session.id = 'chat-3'
  expect((store.get('resume:chat-1') as { isOpen?: boolean }).isOpen).toBe(false)

  await $.turn.start({ text: 'Fix the footer', turnId: 't2' })
  await callTool($, { tool: PLAN, steps: ['Fix it'] })
  await clock.advance(1500)
  expect((store.get('resume:chat-3') as { isOpen?: boolean }).isOpen).toBe(true)
  store.set('resume:chat-2', { ...saved, list: { ...saved.list, phase: 'done' } })
  await clock.advance(20_000)
  expect((await texts($, 'desktop')).join('\n')).not.toContain('Another chat needs you')
})

test('a resumed chat that still waits on the person is saved as open again, so the other chats name it', async ($, on) => {
  const list = {
    title: 'Build my landing page', phase: 'needsYou', needsYouReason: 'Reply to Claude in the box below', stuckReason: null, tasks: [], helpers: [],
    startedAt: 1_000_000, finishedAt: null, isCollapsed: false,
  }
  const { clock, store } = resumeWorld(on, { 'resume:chat-1': { at: 1_000_000, list, isOpen: false } })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await clock.advance(1500)
  const kept = store.get('resume:chat-1') as { isOpen?: boolean; list: { phase: string } }
  expect(kept.isOpen).toBe(true)
  expect(kept.list.phase).toBe('needsYou')
})

test('the other chats line can be turned off in Settings or with /glanceflow others off', async ($, on) => {
  const saved = { at: 1_000_000, isOpen: true, list: { title: 'Build the pricing page', phase: 'needsYou', tasks: [], helpers: [], startedAt: 1_000_000, finishedAt: null } }
  const { clock, store } = resumeWorld(on, { 'resume:chat-2': saved })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await clock.advance(20_000)
  expect((await texts($, 'desktop')).join('\n')).toContain('Another chat needs you')
  const result = await $.command.run({ command: 'glanceflow', args: 'others off' } as never)
  expect(result.text).toContain('no longer mentions other chats')
  expect(store.get('glanceOthers')).toBe(false)
  for (const surface of SURFACES) {
    expect((await texts($, surface)).join('\n')).not.toContain('Another chat')
  }
  await $.command.run({ command: 'glanceflow', args: 'others on' } as never)
  expect((await texts($, 'desktop')).join('\n')).toContain('Another chat needs you')
})

test('in a narrow band the chat that needs you is named, never left out for the count of chats at work', async ($, on) => {
  const saved = (title: string, phase: string) => ({
    at: 1_000_000, isOpen: true, list: { title, phase, tasks: [], helpers: [], startedAt: 1_000_000, finishedAt: null },
  })
  const { clock } = resumeWorld(on, {
    'resume:chat-2': saved('Write the welcome email for the launch', 'working'),
    'resume:chat-3': saved('Build the pricing page with three plans', 'needsYou'),
  })
  await $.session.start({ cwd: '/work', surface: 'terminal' } as never)
  await clock.advance(20_000)
  for (const surface of SURFACES) {
    const shown = (await texts($, surface, 50)).join('\n')
    expect(shown).toContain('Another chat needs you')
    expect(shown).not.toContain('more at work')
  }
})

const PLAN_PANE = {
  plugin: 'glanceflow',
  component: 'Pane',
  requestId: 'glanceflow-plan',
  props: { title: 'Plan', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

async function planPaneTexts($: Engine): Promise<string> {
  const ui = await $.ui.mount({ ...PLAN_PANE, surface: 'terminal' })
  const found = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(one => one.text)
  await ui.unmount()

  return found.join('\n')
}

test('▤ Plan opens the whole plan beside the chat: every step, what it got done, its time and what Claude is doing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.Notification', () => ({}) as never)

  expect(await planPaneTexts($)).toContain('No plan yet')
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const steps = ['Read notes', 'Write copy', 'Add pricing', 'Add form', 'Add footer', 'Add menu', 'Check phones', 'Ship it']
  await callTool($, { tool: PLAN, steps })
  await clock.advance(90_000)
  await callTool($, { tool: PROGRESS, task: 'Read notes', percent: 100, summary: 'Found your colors and tone of voice' })
  await callTool($, { tool: 'Read', file_path: '/work/copy.md' })

  // The band keeps to its rows; the panel has room for every step.
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 6 }, surface: 'terminal' })
  await band.press({ key: 'plan' })
  await band.unmount()
  expect(opened).toEqual(['glanceflow-plan'])

  const pane = await planPaneTexts($)
  for (const name of steps) expect(pane).toContain(name)
  expect(pane).toContain(' took 1m 30s')
  expect(pane).toContain('    Found your colors and tone of voice')
  expect(pane).toContain('    Now: Reading files')
  expect(pane).toContain('1 of 8 steps done')
  // More than the band: when it started, the steps grouped, and how long each step still to come should take.
  expect(pane).toMatch(/Started \d\d:\d\d · 1m 30s so far/)
  expect(pane).toContain('Done\n')
  expect(pane).toContain('Now\n')
  expect(pane).toContain('Next\n')
  expect(pane).toContain(' about 2m')

  // In Details, the same percentage as the band, tokens per step, and what Claude needs from you.
  await $.command.run({ command: 'glanceflow', args: 'details on' } as never)
  await clock.advance(60_000)
  await callTool($, { tool: 'mcp__glanceflow__report_progress', task: 'Write copy', percent: 100 })
  await clock.advance(30_000)
  await callTool($, { tool: 'mcp__glanceflow__report_progress', task: 'Add pricing', percent: 40 })
  const band40 = (await texts($, 'terminal')).join('\n')
  const percent = /· (\d+)% ·/.exec(band40)?.[1]
  const details = await planPaneTexts($)
  expect(details).toContain(` ${percent}% · 2 of 8 steps done`)
  // Time left follows the percentage shown, so band and panel agree.
  const bandLeft = /about (\S+) left/.exec(band40)?.[1]
  expect(bandLeft).toBeDefined()
  expect(details).toContain(`about ${bandLeft} left`)
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  expect(await planPaneTexts($)).toContain("Needs you: Answer Claude's request in the chat")
  const desktop = await $.ui.mount({ ...PLAN_PANE, surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Text' })).map(one => one.text).join('\n')).toContain('Ship it')
  await desktop.unmount()

  const result = await $.command.run({ command: 'glanceflow', args: 'plan' } as never)
  expect(result.text).toBe('The plan is in the side panel.')
  expect(opened).toHaveLength(2)
})

test('"continue" typed after Esc picks the same job up; a new request starts a new one', async ($, on) => {
  world(on)
  expect(['continue', 'Continue.', 'go on', 'keep going', 'please continue', 'Συνέχισε', 'συνέχισε παρακαλώ', 'προχώρα'].every(isContinueWords)).toBe(true)
  expect(['continue with the footer', 'add a menu', 'συνέχισε με το μενού'].some(isContinueWords)).toBe(false)

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it', 'Ship it'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  let shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('■ Stopped')
  expect(shown).toContain('\nStopped')

  await $.turn.start({ text: 'συνέχισε', turnId: 't2' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Build my landing page')
  expect(shown).toContain('Write the page')
  expect(shown).not.toContain('Stopped')

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  await $.turn.start({ text: 'Add a contact form', turnId: 't3' })
  shown = (await texts($, 'terminal')).join('\n')
  expect(shown).not.toContain('Write the page')
})

test('the step Claude waits on says Waiting', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Needs you')
  expect(shown).toContain('\nWaiting')
  expect(shown).not.toContain('\nWorking')
})

test('in Simple the percentage moves with time before a step is checked off', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  expect((await texts($, 'terminal')).join('\n')).toContain(' · 0% · ')
  await clock.advance(90_000)
  const percent = Number(/ · (\d+)% · /.exec((await texts($, 'terminal')).join('\n'))?.[1])
  expect(percent).toBeGreaterThan(0)
  expect(percent).toBeLessThan(50)
})

test('in a narrow window the button gets short and the bars go before step names do', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  const wide = (await texts($, 'terminal', 80)).join('\n')
  expect(wide).toContain('● GlanceFlow: Simple')
  expect(wide).toContain('░░░░░░░░░░')

  const narrow = (await texts($, 'terminal', 36)).join('\n')
  expect(narrow).toContain('● Simple')
  expect(narrow).not.toContain('GlanceFlow: Simple')
  expect(narrow).not.toContain('░░░░')
  expect(narrow).toContain('Read your brand notes')
})

test('⚙ Settings opens one panel for the view, sounds and calm mode, each with a line on what it does', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const opened: string[] = []
  const played: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('audio.play', (_, e) => {
    played.push(String((e.clip as { asset?: string }).asset))
    return { value: undefined } as never
  })
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const SETTINGS = {
    plugin: 'glanceflow',
    component: 'Pane',
    requestId: 'glanceflow-settings',
    props: { title: 'Settings', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as const
  const settingsTexts = async () => {
    const ui = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    const found = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(one => one.text).join('\n')
    await ui.unmount()
    return found
  }
  const pick = async (key: string) => {
    const ui = await $.ui.mount({ ...SETTINGS, surface: 'terminal' })
    await ui.press({ key })
    await ui.unmount()
  }

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'settings' })
  await band.unmount()
  expect(opened).toEqual(['glanceflow-settings'])

  let shown = await settingsTexts()
  expect(shown).toContain('● Simple')
  expect(shown).toContain('● Off')
  expect(shown).toContain('No sounds')
  expect(shown).toContain('Bars and spinners move')
  expect(shown).toContain('● 50%')
  expect(shown).toContain('Finish on GitHub')
  expect(shown).toContain('Finished jobs stay on their branch')

  await pick('view-detailed')
  await pick('ship-on')
  await pick('sound-chime')
  await pick('calm-on')
  shown = await settingsTexts()
  expect(shown).toContain('● Details')
  expect(shown).toContain('● Chime')
  expect(shown).toContain('A short chime when Claude needs you')
  expect(shown).toContain('▶ Play it')
  expect(shown).toContain('Nothing on screen moves')
  expect(shown).toContain('merges once you approve')
  expect(shown).toContain('● On')
  expect(played).toEqual(['sounds/needs-you.wav'])
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Details')

  await pick('view-off')
  expect((await texts($, 'terminal')).join('\n')).toContain('GlanceFlow: Off')

  const result = await $.command.run({ command: 'glanceflow', args: 'settings' } as never)
  expect(result.text).toBe('Settings are in the side panel.')
  expect(opened).toHaveLength(2)
})

test('Tidy it up shows at the point picked in Settings, 50% full unless changed', async ($, on) => {
  world(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const full = async (percent: number) => {
    await $.session.measure({ context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits: [], changed: ['context'] } as never)
    return (await texts($, 'terminal')).join('\n')
  }
  expect(await full(45)).not.toContain('Tidy it up')
  expect(await full(52)).toContain('This chat is 52% full. Claude saves a checkpoint')

  await $.command.run({ command: 'glanceflow', args: 'tidy at 60' } as never)
  expect(await full(52)).not.toContain('Tidy it up')
  expect(await full(61)).toContain('Tidy it up')
  const off = await $.command.run({ command: 'glanceflow', args: 'tidy off' } as never)
  expect(off.text).toBe('GlanceFlow will not offer to tidy up.')
  expect(await full(90)).not.toContain('Tidy it up')
})

test('/glanceflow checkpoint says plainly when there is none yet', async ($, on) => {
  world(on)
  const result = await $.command.run({ command: 'glanceflow', args: 'checkpoint' } as never)
  expect(result.text).toContain('No checkpoint in this chat yet')
})

test('Tidy it up saves a checkpoint first, compacts keeping it, and Claude reads it afterwards', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'chat-1' }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  const forked: string[] = []
  on('model.fork', (_, e) => {
    forked.push(e.prompt)
    return { value: { isAnswered: true, text: 'Checkpoint: the pricing page is done; next, the contact form.', usage: {} } } as never
  })
  let instructions = ''
  on('session.compact', (_, e) => {
    instructions = String((e as { instructions?: string }).instructions ?? '')
    return { messages: [{ role: 'user', text: 'Summary of the chat so far.', toolUses: [] }] } as never
  })
  on('prompt.compose', () => ({ sections: [] }) as never)

  await $.session.measure({ context: { window: 200_000, tokens: 110_000, percent: 55 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  await ui.unmount()

  expect(forked[0]).toContain('Write a checkpoint')
  expect(instructions).toContain('Checkpoint: the pricing page is done; next, the contact form.')
  let band = (await texts($, 'terminal')).join('\n')
  expect(band).toContain('Chat tidied up. Claude kept a checkpoint of the work.')
  expect(band).toContain('Where we left off')
  // In the Desktop app its buttons sit with the other actions at the bottom right, not in the note's row.
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const deskBoxes = await desk.findAll({ type: 'Box' })
  await desk.unmount()
  expect(JSON.stringify(deskBoxes.find(one => one.props.key === 'actions') ?? null)).toContain('Where we left off')
  expect(JSON.stringify(deskBoxes.find(one => one.props.key === 'recap') ?? null)).not.toContain('Where we left off')
  // Its mark says Notice: the words say the chat was tidied up.
  expect(echoes(deskBoxes)).toEqual([])

  // Where we left off opens the checkpoint in a side panel, and the note on the band goes.
  const card = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await card.press({ key: 'recap' })
  await card.unmount()
  expect(opened).toEqual(['glanceflow-recap'])
  band = (await texts($, 'terminal')).join('\n')
  expect(band).not.toContain('Chat tidied up')
  const recap = await $.ui.mount({ plugin: 'glanceflow', component: 'Pane', requestId: 'glanceflow-recap', surface: 'terminal', props: { title: 'Where we left off', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)
  const recapText = (await recap.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  await recap.unmount()
  expect(recapText).toContain('the pricing page is done; next, the contact form.')
  expect(recapText).not.toContain('Checkpoint:')
  expect(recapText).toMatch(/Saved at \d\d:\d\d/)

  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [], sections: [] } as never)
  const checkpoint = (composed as unknown as { sections: { id: string; text: string }[] }).sections.find(one => one.id === 'glanceflow:checkpoint')
  expect(checkpoint?.text).toContain('the pricing page is done')
})

test("two chats saving jobs the same day keep both; the day's old shared key moves into the chat's own once", async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 6, 9, 42).getTime() })
  const at = new Date(2026, 9, 6, 9, 0).getTime()
  const job = (jobId: string, title: string) => ({ ...pastJob(jobId, '/work/landing-site', 2, 60_000), startedAt: at, finishedAt: at + 60_000, title })
  const store = new Map<string, unknown>([
    ['adoptedGlance', true],
    ['history:2026-10-06', [job('a', 'Saved before 0.25')]],
    ['history:2026-10-06:chat-2', [job('b', 'Saved by another chat')]],
  ])
  const written: string[] = []
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => {
    written.push(e.key)
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  historyWorld(on, { cwd: '/work/landing-site' })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: {} } as never }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: {} as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}) as never)

  await $.session.start({ cwd: '/work/landing-site', surface: 'terminal' } as never)
  expect(store.has('history:2026-10-06')).toBe(false)
  expect(store.get('history:2026-10-06:chat-1')).toEqual([job('a', 'Saved before 0.25')])

  await $.turn.start({ text: 'Build the pricing section', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it'] })
  await clock.advance(60_000)
  await callTool($, { tool: PROGRESS, task: 'Write it', percent: 100 })
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  // This chat writes only its own key: the other chat's job is never read back and rewritten.
  expect(written.filter(key => key.startsWith('history:'))).not.toContain('history:2026-10-06:chat-2')
  expect(store.get('history:2026-10-06:chat-2')).toEqual([job('b', 'Saved by another chat')])
  const result = await $.command.run({ command: 'glanceflow', args: 'history' } as never)
  expect(result.text).toBe('History for 2026-10-06: 3 tasks.')
  const shown = (await paneTexts($)).join('\n')
  expect(shown).toContain('Saved before 0.25')
  expect(shown).toContain('Saved by another chat')
  expect(shown).toContain('Build the pricing section')
})

test('in VS Code, which draws no band above the prompt, the checklist opens in a pane', async ($, on) => {
  world(on)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('session.attach', (_, e) => ({ clientId: e.clientId }) as never)

  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  expect(opened).toEqual(['glanceflow-checklist'])
  // A terminal or the desktop app has the band: no pane there.
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(opened).toEqual(['glanceflow-checklist'])

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write the page', 'Check it'] })
  const ui = await $.ui.mount({
    plugin: 'glanceflow',
    component: 'Pane',
    requestId: 'glanceflow-checklist',
    surface: 'vscode',
    props: { title: 'GlanceFlow', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const shown = (await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  const buttons = (await ui.findAll({ type: 'Button' })).map(one => one.text).join('\n')
  await ui.unmount()
  expect(shown).toContain('Write the page')
  expect(shown).toContain('Check it')
  expect(buttons).toContain('Settings')

  // Closed by the person, it comes back with /glanceflow show.
  const reply = await $.command.run({ command: 'glanceflow', args: 'show' } as never)
  expect(opened).toEqual(['glanceflow-checklist', 'glanceflow-checklist'])
  expect(JSON.stringify(reply)).toContain('checklist is open')
})

test("notices go through Claude Code first, so the person's Notification hooks reach them away from the computer", async ($, on) => {
  const { clock } = soundWorld(on)
  on('classic.StopFailure', () => ({}) as never)
  const ran: string[] = []
  on('process.run', (_, e) => {
    ran.push((e as { argv: readonly string[] }).argv[0] ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const notified: { text: string; title?: string }[] = []
  let answer: unknown = { isSent: true, channel: 'iterm2' }
  on('ui.notify', (_, e) => {
    notified.push({ text: e.text, title: e.title })
    return { value: answer } as never
  })
  await $.command.run({ command: 'glanceflow', args: 'notify on' } as never)
  await clock.advance(1)
  notified.length = 0
  ran.length = 0

  // Claude Code's channel showed it (and the hooks ran): no second notice from the computer.
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Write it', 'Check it'] })
  await $.classic.StopFailure({ error: 'overloaded_error', error_details: '' } as never)
  await clock.advance(1)
  expect(notified.map(one => one.title)).toEqual(['Claude is stuck'])
  expect(notified[0]?.text).toBeTruthy()
  expect(ran.filter(one => one === 'osascript' || one === 'notify-send')).toEqual([])

  // No text where the person looks (the Desktop app, a bare bell): the computer's own notice shows it too.
  for (const reply of [{ isSent: false, reason: 'no-surface' }, { isSent: true, channel: 'terminal_bell' }]) {
    answer = reply
    notified.length = 0
    ran.length = 0
    await $.turn.start({ text: 'Try again', turnId: `t-${notified.length}-${String(reply.isSent)}` })
    await callTool($, { tool: PLAN, steps: ['Write it'] })
    await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as never)
    await clock.advance(1)
    expect(notified.map(one => one.title)).toEqual(['Claude needs you'])
    expect(ran).toContain('osascript')
  }

  // Claude Code hears a mod's notice again as a plugin_notification: that is not Claude needing the person.
  notified.length = 0
  await $.turn.start({ text: 'One more', turnId: 't9' })
  await callTool($, { tool: PLAN, steps: ['Write it'] })
  await $.classic.Notification({ message: 'Claude is stuck', notification_type: 'plugin_notification' } as never)
  await clock.advance(1)
  expect(notified).toEqual([])
})

test("in plan mode the plan the person approves in Claude Code is the checklist, with no plan of the planning and no second approval", async ($, on) => {
  world(on)
  on('classic.UserPromptSubmit', () => ({}) as never)
  await $.command.run({ command: 'glanceflow', args: 'approve on' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'Add a subtract function', permission_mode: 'plan' } as never)
  await $.turn.start({ text: 'Add a subtract function', turnId: 't1' })

  // Claude looks around and writes the plan, with no checklist of the planning itself.
  const looked = await callTool($, { tool: 'Read', file_path: '/work/calc.py' })
  expect(looked.deny).toBeUndefined()
  const meta = await callTool($, { tool: PLAN, steps: ['Look at the code', 'Write the plan'] })
  expect(meta.deny).toContain('Plan mode')
  expect((await texts($, 'terminal')).join('\n')).not.toContain('Look at the code')

  // The person approves the plan in Claude Code: its steps become the checklist, and the work starts at once.
  const handed = await callTool($, { tool: 'ExitPlanMode' })
  expect(handed.deny).toBeUndefined()
  const planned = await callTool($, { tool: PLAN, steps: ['Add the subtract function', 'Test both functions'] })
  expect(String(planned.result)).not.toContain('wait for their reply')
  const ran = await callTool($, { tool: 'Edit', file_path: '/work/calc.py', old_string: 'a', new_string: 'b' })
  expect(ran.deny).toBeUndefined()
  const shown = (await texts($, 'terminal')).join('\n')
  expect(shown).toContain('Add the subtract function')
  expect(shown).not.toContain('▶ Start')

  // The next prompt, out of plan mode, plans and waits for Start as before.
  await $.classic.UserPromptSubmit({ prompt: 'Now a multiply function', permission_mode: 'default' } as never)
  await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: 'Now a multiply function', turnId: 't2' })
  const next = await callTool($, { tool: PLAN, steps: ['Add multiply', 'Test it'] })
  expect(String(next.result)).toContain('wait for their reply')
})

test('in the Plan, a helper opens in the main view, and one working in the background stops alone', async ($, on) => {
  const stopped: string[] = []
  world(on, ((_: unknown, e: { tool?: string; task_id?: unknown }) => {
    if (e.tool === 'TaskStop') stopped.push(String(e.task_id))
    return { result: {} }
  }) as never)
  on('classic.Stop', () => ({}) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  // The CI's Claude Code (2.1.296) predates ui.view, so no hook answers it here: Open says why it couldn't, never fails.
  let next = 'a1'
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: next }) as never)
  const spawn = (description: string, background: boolean) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`,
      prompt: description,
      description,
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background,
      fork: false,
    } as never)

  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await callTool($, { tool: PLAN, steps: ['Look around the project', 'Write the page'] })
  await spawn('Find the pricing data', false)
  next = 'a2'
  await spawn('Check the old page', true)
  await $.turn.complete({ answer: 'Working on it.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'Run the dev server' }] } as never)

  for (const surface of SURFACES) {
    const plan = await $.ui.mount({ ...PLAN_PANE, surface })
    const buttons = (await plan.findAll({ type: 'Button' })).map(one => String(one.props.key))
    // A helper in the foreground opens; Esc stops it with Claude. One in the background also stops; a shell task only stops.
    expect(buttons).toContain('open-a1')
    expect(buttons).not.toContain('stop-a1')
    expect(buttons).toContain('open-a2')
    expect(buttons).toContain('stop-a2')
    expect(buttons).not.toContain('open-bg:b1')
    expect(buttons).toContain('stop-bg:b1')
    if (surface === 'terminal') {
      await plan.press({ key: 'open-a1' })
      await plan.press({ key: 'stop-a2' })
      await plan.press({ key: 'stop-bg:b1' })
    }
    await plan.unmount()
  }
  expect(stopped).toEqual(['a2', 'b1'])
})
