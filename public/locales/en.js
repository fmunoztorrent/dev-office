// English (the default language). Same keys as es.js; {variables} are filled in when used.
// Character names come in as variables ({tl}, {po}, {manager}…) because they can be renamed.

export default {
  team: {
    titles: { designer: 'Designer', po: 'Product Owner', analyst: 'Business Analyst', manager: 'Manager', frontend: 'Frontend', backend: 'Backend', qa: 'QA', tl: 'Tech Lead' },
  },
  needs: { social: 'Social', coffee: 'Coffee', bladder: 'Bathroom', dream: 'Imagination', doubt: 'Doubts' },
  dream: { unicorn: 'a unicorn', rainbow: 'a rainbow', skull: 'a skull', pizza: 'pizza' },
  phase: {
    historia: 'Story', criterios: 'Criteria', prioriza: 'Prioritize', acepta: 'Accept', rechaza: 'Reject', analiza: 'Analyze',
    investiga: 'Research', requisitos: 'Requirements', planifica: 'Plan', asigna: 'Assign', desbloquea: 'Unblock', release: 'Release',
    arquitectura: 'Architecture', adr: 'ADR', review: 'Review', aprueba: 'Approve', cambios: 'Request changes', refactor: 'Refactor',
    'plan-pruebas': 'Test plan', red: 'RED', green: 'GREEN', regresion: 'Regression', bug: 'Bug', verifica: 'Verify',
    implementa: 'Implement', fix: 'Fix', migracion: 'Migration', ux: 'UX', ui: 'UI', 'revision-visual': 'Visual review', bloqueado: 'Blocked',
  },
  state: { idle: 'free', working: 'working', thinking: 'thinking', blocked: 'blocked', waiting: 'waiting', done: 'done', coffee: 'coffee', talking: 'talking', red: 'red', lunch: 'at lunch', alarm: 'emergency' },
  sessionStatus: { active: 'in progress', waiting: 'waiting for you', done: 'finished', ended: 'closed' },
  taskStatus: { queued: 'queued', sent: 'sent', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled' },
  runStatus: { running: 'running', done: 'finished', failed: 'failed', cancelled: 'cancelled', queued: 'queued', sent: 'sent' },
  weather: { clear: 'clear', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'fog', drizzle: 'drizzle', rain: 'rain', snow: 'snow', storm: 'storm' },
  season: { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' },

  // ---------------------------------------------------------------- office life (sim.js)
  sim: {
    journal: {
      deskchat: '{names} chat from their desks 💬',
      gossip: '{names} get together to chat 💬',
      idea: '{who} pitches an idea to {manager} 💡',
      dream: '{who} dreams of {dream} {emoji}{cause}',
      nightmare: '{who} has a nightmare about {dream} {emoji}{cause}',
      feasibility: '{who} asks {tl} if it is feasible 🤔',
      consult: '{who} goes to ask {tl} 🏛️',
      archchat: '{tl} goes to talk with {names} 🏛️',
      rounds: '{manager} does a round of the desks 👀',
      coffee: '{who} goes for a coffee ☕',
      requirement: '{who} brings a requirement to {manager}: “{text}”',
      assign: '{manager} hands it to {names}',
      bathroom: '{who} goes to the bathroom 🚻',
      lunch: '🍽️ It is 1 PM: the team goes to the dining room for lunch',
      lunchend: '💪 Lunch is over: everyone back to their desks',
      fire: '🔥 The server caught fire{cause}! {names} run with the extinguisher',
      repaired: '🧯 {names} put out the fire and fixed the server',
      tv: '{who} sits down to watch TV 📺{cause}',
      pane: '🪟 {who} takes pane {pane}: {title}',
      paneDone: '🪟 Pane {pane} closed ({title})',
      other: '{who}: {kind}',
    },
    cause: {
      subtask: 'finished a subtask', testsFailed: 'the tests failed', taskDone: 'the task is done',
      waitingOk: 'waiting for your OK', tooManyErrors: 'too many errors in a row',
    },
    sessionStart: "Let's go! ☕",
    sessionEnd: "That's it for today 👋",
    testsGreen: '✅ Tests are green!',
    redExpected: '🔴 Failing as expected (RED)',
    foundBug: '🐞 Found a bug!',
    bugReport: '🐞 {name}: {text}',
    checkIt: "Oops, I'll check it 🔧",
    helpError: 'Need help with that error? 🔍',
    reviewThis: 'Hmm, time to look into this… 🔍',
    assignSub: '{name}, this one is yours: {text}',
    subtask: 'Subtask: {text}',
    subDone: '✔ Done: {text}',
    needOk: 'We need your OK! ✋',
    chatReplies: ['Noted! 📝', "Let's cover it at the daily 👍", 'Got it 🙌', 'Good idea!'],
    poke: '{from} says hi 👋',
    turnEnd: '✔ My turn is done',
    stageOk: '✔ Stage done',
    stageFail: '✖ The gate did not pass',
    yourTurn: "{name}, you're up: {phase}",
    passTurn: '→ {name}: {phase}',
    whatBlocks: "What's blocking you? 🔓",
    release: 'Deploy{text}',
    cheers: ['Nice! 🎉', 'Finally!', 'Deploy! 🚀', 'What a team!'],
    gossip: {
      po: ['Did you see what the client asked for? 🙄', 'Everything is urgent, as usual 😅', 'Lunch together today? 🥗', '{manager} is already on coffee number five ☕😂', 'The roadmap looks gorgeous 📌'],
      analyst: ["Yesterday's numbers… went up! 📈", 'I found a great data point 🤓', 'Have you seen the new dashboard? 📊', '{backend} swore it was not a bug 👀', 'I made a spreadsheet of spreadsheets 😂'],
      designer: ['What if everything were purple? 💜', 'That button keeps me up at night 😱', 'That screen needs some air ✨', 'I brought you a new palette 🎨', 'Who used Comic Sans? 😤'],
    },
    gossipTask: 'Have you seen “{task}”? 👀',
    gossipError: '{name} had a fight with an error 😬',
    gossipGreen: '{name} saw everything green! 🟢',
    gossipFire: 'Did you see the server fire? 🔥😱',
    replies: ['Hahaha 😂', 'Nooo! 😱', 'Totally 💯', 'Really? 👀', 'Love it 💜', 'I know, right? 🙄', 'Tell me more ☕', 'Haha, typical 😅'],
    ideas: ['dark mode 🌙', 'a tour for new users', 'export to PDF', 'live notifications', 'a metrics dashboard', 'sign in with Google'],
    pitch: '{manager}, we had an idea: {idea}',
    pitchReplies: ['I like it! To the backlog 📝', "Let's see it at the planning 🗂️", "Noted, we'll prioritize it later 📌"],
    ask: {
      backend: ['should this endpoint be REST or RPC?', 'does this index look right?', 'how do we handle this error?', 'should I put it in a queue?'],
      frontend: ['local or global state here?', 'should I split this component?', 'what do you think of this hook?', 'is this the right way to make it responsive?'],
      qa: ['do we cover this edge case?', 'mock this or hit the database?', "I found something odd, can we look?", 'how much coverage do we want?'],
    },
    consultAsk: '{tl}, {doing}{ask}',
    // "Editing api.js" → "I'm editing api.js: "
    doing: ({ text }) => (/^[A-Z][a-z]+ing\b/.test(text || '') ? `I'm ${text.replace(/^./, (c) => c.toLowerCase())}: ` : ''),
    answers: ["Keep it simple, we'll refactor later 👍", "Send me the PR and I'll look 🔍", 'Follow the ADR we agreed on 📐', 'Yes, but add a test 🧪', "Split it, it's going to grow ♻️", "Let's pair for 5 minutes 👥"],
    thanks: ['Thanks! 🙌', 'On it 💪', 'Perfect 👌', 'You saved me! 😅'],
    tlAsks: {
      po: ['{po}, is this a priority or can it wait? 📌', "{po}, what's the MVP here?", "We'll need a technical spike for that 🏛️"],
      analyst: ['{analyst}, how many users do we expect? 📈', 'Where does that data come from? 🗄️', 'Which business rules apply here? 📑'],
      designer: ['{designer}, is that mockup doable? Let me see 🎨', 'That animation… on mobile too? 😅', 'Shall we build it with the design system? 🧩'],
    },
    tlReplies: {
      po: ["It's a priority, the client is waiting 📌", "MVP first, then we iterate ✨", "Sure, I'll put it in the planning 🗂️"],
      analyst: ['About 10k a month 📊', "I'll send you the spreadsheet 🤓", "I'll check with the business and get back to you 📑"],
      designer: ['Yes! With micro-interactions ✨', "I'll simplify it, promise 💜", 'It all comes from the design system 🎨'],
    },
    tlThanks: ["Perfect, I'll design the solution with that 🏛️", "Ok, I'll write it up in an ADR 📐", 'Great, thanks 🙌'],
    tlScope: {
      po: ["{po}, before I design: what's the scope? 🏛️", '{po}, what is the minimum that has to ship? 📌'],
      analyst: ['{analyst}, how much data are we talking about? 📈', "{analyst}, which business rules can't I break? 📑"],
      designer: ['{designer}, do you have the mockups? I want to see the flows 🎨'],
    },
    feasibleAsk: ['{tl}, is this feasible? 🤔', '{tl}, how long would this take us? ⏱️', '{tl}, can we do it this sprint? 📌'],
    feasibleAnswer: ['Yes, with a couple of tweaks 👍', 'Give me a moment to estimate it 📐', "Doable, but let's start with an MVP ✨", 'Yes, we already have almost everything 🙌'],
    dreamLines: {
      unicorn: ['An onboarding with unicorns! 🦄', 'A unicorn on the 404 page? 🦄✨', 'Picture it: the logo… with a horn! 🦄'],
      rainbow: ['What if the button were a rainbow? 🌈', 'A rainbow gradient in the header 🌈', 'More color! 🌈✨'],
      skull: ['I dream of stack traces 💀', 'What if they deleted production? 💀', 'That bug is coming back… 💀', 'A flaky test is haunting me 💀'],
      pizza: ['A pizza for every approved PR… 🍕', 'Shall we order pizza? 🍕', 'Pizza and deploy: the perfect combo 🍕', 'Mmm… pepperoni 🤤🍕'],
    },
    nightmares: ['Those red tests are haunting me 💀', 'I dream of stack traces 💀', 'What if it fails in production too? 💀', 'That bug is coming back… 💀'],
    pizzaReward: 'This deserves a pizza! 🍕',
    pizzaParty: ["Let's celebrate with pizza! 🍕", 'Shall we order pizza to celebrate? 🍕'],
    rounds: ['How is it going, {name}?', '{name}, need anything?', 'All good over here, {name}?'],
    roundsReplies: ['Good, making progress 💪', 'All under control 👍', 'A bit stuck, but getting there 😅', 'Almost done 🙌'],
    tv: ["What's on? 📺", "5 minutes and I'm back 😅", 'Gooool! ⚽', 'This show is so good 🍿'],
    tvForecast: 'The forecast: {label}{temp} {icon}',
    tvTask: 'Even the TV is talking about “{task}” 😅',
    coffee: ['☕', 'Mmm, coffee…', '🎵', 'Anyone want coffee?', 'Stretch break 🙆', 'A flat white, please ☕'],
    bathUrgent: ["I can't hold it! 😣", 'Excuse me, excuse me! 🏃'],
    bathWait: ['Hurry up! 😣', 'Much longer? 🙏', '🚻😬'],
    bathDone: ['Done! 🧼', 'Ahhh… 😌', 'Clean hands! 🧼'],
    reqArrived: 'A new requirement! “{text}”',
    reqMockups: "I'll do the mockups! 🎨",
    reqAnalyze: "I'll analyze it 🧐",
    reqGo: "Let's go! ✨",
    reqToManager: '{manager}, new requirement: {text}',
    reqSplit: 'On it! This is for {names} 📨',
    reqForYou: '{name}, this one is for you: {text}',
    reqTake: ['On it! 💪', "Sure, I'll take it 🙌", "I'll get on it ⌨️"],
    lunchBanner: '🍽️  1 PM · Lunch time!',
    lunchCall: ['Lunch time! 🍽️', "Let's eat, team! 🍝", "It's 1 PM… lunch! 🍽️"],
    lunchDesk: 'Lunch at my desk 🥪',
    lunchOrder: ['Yum!', 'One of these, please', 'My favorite!'],
    lunchTalk: {
      product: ['Have you seen the new show? 📺', "I'm going to the beach this weekend 🏖️", 'This salad is great! 🥗', 'Dessert? 🍰', '{manager} ordered a double portion 😂', "How's the sprint going? 📈"],
      tech: ['Tabs or spaces? 🤔', 'Pineapple on pizza is valid 🍍', 'Vim is the best 😎', 'Have you tried the new framework? 🚀', 'My build took 20 minutes 😩', 'No deploys after lunch today 😅'],
    },
    lunchEndBanner: '💪 Back to work!',
    lunchEnd: ['Back to work, team! 💪', 'Well… back at it! 💻'],
    fireBannerCause: '🔥 So many errors overheated the server and it caught fire! The tech team is on its way 🧯',
    fireBanner: '🔥 The server is on fire! The tech team is on its way 🧯',
    fireYell: { manager: 'Tech team, to the rack! 🧯', po: 'Fire! 😱', designer: 'Call the fire department! 🚒', analyst: "I'm logging the incident 📝" },
    fireGotExt: 'Got the extinguisher! 🧯',
    fireBack: 'Everyone back! 🧯💨',
    fireCrew: { tl: ["I'm cutting the power ⚡", 'Stay calm, team!'], frontend: ['Something is burning! 😵', 'My deploy! 😱'], qa: ['More foam! 🧯', 'This was not in the tests 💀'], other: ["Let's go!"] },
    sprinklers: '💦 The sprinklers kicked in',
    fireRepair: { tl: "Ok, let's restart calmly 🔁", backend: 'Restarting servers… ⏳', qa: 'Running the smoke tests 🧪', frontend: 'The site is back in 3, 2, 1… 🌐' },
    serverUp: '✅ Server is up!',
    postmortem: 'Postmortem tomorrow 📝',
    startle: ['Whoa! ⚡', 'What a thunder! 😱', 'That scared me! ⚡'],
    weatherNews: { fair: '☀️ It cleared up', cloudy: '☁️ It clouded over', fog: '🌫️ The fog rolled in', wet: '🌧️ It started raining', storm: '⛈️ A storm broke out', snow: '❄️ It is snowing', stars: '✨ It cleared up: you can see the stars' },
    weatherNote: '{news} ({label}{temp})',
    weatherTalk: {
      fair: ['The sun is out! ☀️', 'What a nice day 😎', 'It cleared up 🌤️'],
      cloudy: ['It clouded over ☁️', 'It got grey outside ☁️'],
      fog: ["You can't see a thing outside 🌫️", 'So foggy 🌫️'],
      wet: ["It's raining! ☔", 'And me without an umbrella… ☔😩', 'Rain makes me want a coffee ☕'],
      storm: ["A storm's coming! ⛈️", "Let's hope the power stays on ⚡😬"],
      snow: ["It's snowing! ❄️😍", 'Snow! ⛄', 'Did anyone bring gloves? 🧤'],
    },
    paneAssign: '{name}, pane {pane} is yours: {title}',
    paneWork: '🪟 {title}',
    paneDone: '✔ Pane closed: {title}',
    paneBlocked: '✋ Pane {pane} is waiting for your answer',
  },

  // ---------------------------------------------------------------- what the scene shows
  scene: {
    taskTitle: 'TASK: {title}',
    noTask: 'No task — waiting for the agent…',
    todo: 'TO DO', doing: 'DOING', done: 'DONE',
    todoShort: 'to do {todo} · doing {doing} · done {done}',
    boardTip: '✎ click: new brief',
    cafe: 'CAFÉ', wc: 'WC', dining: 'DINING', menu: 'MENU', menuToday: ['soup', 'pasta', 'dessert'],
    tvBreaking: 'BREAKING', tvServer: 'SERVER', tvNews: 'NEWS', tvWeather: 'WEATHER',
    tvLive: 'LIVE: the team is working on “{title}”', tvQuiet: 'All quiet at the office',
    resize: 'Make the terminal bigger (at least 60×18) · q to quit',
  },
  // ---------------------------------------------------------------- what the agent does (server)
  events: {
    updateBoard: 'Updates the board', newCard: 'New card: {text}', moveCard: 'Moves a card', failed: 'Failed: {text}{detail}',
    thinking: 'Thinking…', waiting: 'The agent is waiting for your approval', error: 'Something went wrong', compact: 'Tidies up the notes (compacts the context)',
    done: 'Task done!', sessionStart: 'New work session', sessionEnd: 'Session closed', you: 'You', office: 'Office', subtask: 'Subtask',
    permission: 'Permission for {tool}', turnEnd: 'ends the turn{text}',
    read: 'Reading {file}', write: 'Creating {file}', edit: 'Editing {file}', grep: 'Searching "{pattern}"', glob: 'Looking through {pattern}', files: 'files',
    websearch: 'Researching: {query}', webfetch: 'Reading {host}', web: 'Reading a web page', ask: 'Asks the user something',
    plan: 'Presents the plan', planning: 'Planning', skill: 'Using skill {skill}', mcp: 'Using {tool}', working: 'Working',
  },
  task: {
    queuedClaude: 'delivered when Claude finishes its turn', runningIn: '{exe} in {dir}', finished: 'finished', killed: 'killed ({signal})',
    exitCode: 'exited with code {code}{last}', disconnected: 'the agent disconnected', sentTo: 'sent to {agent}', accepted: 'the agent is on it',
    failedDefault: 'the agent could not do the task', failedEvent: '{agent} could not do the task: {detail}', claudeTook: 'Claude took it when its turn ended',
    cancelled: 'cancelled', dispatch: 'For {agent}: {title}', dispatchNew: 'New {agent} session: {title}', inPane: '{agent} in pane {pane} (herdr)',
    paneIdle: 'the agent in pane {pane} finished its turn',
  },
  run: {
    sent: 'sent to the agent', claudeTook: 'Claude took it when its turn ended', dispatch: 'Pipeline “{name}” for {agent}: {task}',
    cancelledEarly: 'cancelled before it started', cancelling: 'cancelling…',
  },
  targets: { openSession: 'open session', claudeTurn: 'Claude, when its turn ends' },
  offices: { main: 'Main office' },
  err: {
    pathMissing: 'the path is missing', pathRelative: '{path}: use the full path (e.g. ~/Workspace/my-project)', pathNotFound: '{path}: that folder does not exist',
    harness: 'choose the agent for that path: claude-code, opencode or pi', args: '{name}: args must be a list of strings',
    agentExists: 'that agent is already registered for that path', saveFailed: 'could not save: {error}', agentsMax: 'at most {n} agents',
    unknownAgent: 'unknown agent', unknownRole: 'unknown role: {role}', notEditable: '{role}: "{key}" cannot be changed',
    color: '{role}.{key}: use a color like #3f73f0', empty: '{role}.{key} cannot be empty',
    unknownOffice: 'unknown office: {office}', officeName: 'give the office a name', officeExists: 'there is already an office with that name',
    officesMax: 'at most {n} offices', mainOffice: 'the main office cannot be deleted', timezone: 'unknown time zone: {tz}',
    language: 'unknown language: {lang}', pref: 'unknown setting: {key}', prefValue: '{key}: invalid value',
    taskEmpty: 'the task is empty', taskTooLong: 'the task is longer than {n} characters', taskNoAgent: 'the target agent is missing', cantLaunch: 'I do not know how to launch "{agent}"',
    noDir: 'the directory {dir} does not exist', noSession: 'there is no connected {agent} session; ask for a new one', pickClaude: 'pick a Claude Code session',
    unknownTask: 'unknown task', cantCancel: 'a {status} task cannot be cancelled: the agent already has it',
    noSessionField: 'session is missing', pipelineSession: 'that session is not connected or does not have that pipeline', pipelineNone: 'no connected agent has the pipeline "{pipeline}"',
    pipelineIssues: 'the pipeline has errors: {issue}', unknownPipeline: 'unknown pipeline', pipelineDone: 'the pipeline is already {status}',
    promptEmpty: 'the prompt is empty', targetUnknown: 'that agent is neither registered nor connected', noEntry: 'the harness of {name} has no entry "{entry}"',
    sessionGone: 'that session is no longer open', needsSession: '“{label}” runs in an open session: open {agent} in {path} with its integration', noPath: '{path} does not exist', notInstalled: 'cannot find "{bin}" in the PATH',
    invalidMessage: 'invalid message', registerWs: 'register only over WebSocket', updateWs: 'task_update only over WebSocket', unknownCommand: 'command not available: {action}',
    unknownType: 'unknown type: {type}', notFound: 'route not found', fullPath: 'use the full path', hostDenied: 'host not allowed', originDenied: 'origin not allowed',
    tooLarge: 'payload too large', noHerdr: 'you are not inside herdr (HERDR_ENV=1)', herdrFailed: 'herdr: {error}', paneMissing: 'the pane is missing',
  },
  server: {
    started: 'Dev Team Office {version} at {url}', browser: '  Open it in your browser: {urls}', api: '  API: POST /v1/events/<source> · GET /v1/state · WS /v1/ws{socket}',
    socketUnavailable: 'Unix socket not available ({file}): {error}', socketTooLong: 'path too long for a Unix socket (max 103 bytes); use --socket with a shorter one',
    socketBusy: 'another office is already listening there',
  },
  weatherMsg: {
    noLocation: 'no location', notFound: 'could not find “{name}”', noData: 'response without data',
    unavailable: 'Weather not available ({error}): the office uses a simulated one for the season.',
  },
  herdr: {
    opened: '🪟 pane {pane} opened: {title} ({office})', closed: '🪟 pane {pane} closed: {title}', noAgent: 'cannot find any installed agent (claude, pi or opencode)',
    launched: '🪟 {agent} opened in pane {pane} ({office})', notInside: 'Not inside herdr: agents run in the background.',
    startTitle: 'the office agent', noPane: 'herdr did not return the new pane',
  },
  // ---------------------------------------------------------------- terminal and web
  conn: { live: 'live', offline: 'offline', connecting: 'connecting…', connectingTo: 'connecting to {host}…', connectedTo: 'connected to {host}', retrying: 'lost connection to {host}, retrying…' },
  tui: {
    msgTo: ' Message for {name}: ', msgTeam: ' Message to the team: ', msgHint: '  Enter send · Esc cancel ',
    keys: { t: 'brief (or click the board)', c: 'settings ⚙', a: 'activity >_', q: 'log', tab: 'pick', m: 'message', s: 'say hi', x: 'cancel', d: 'demo', p: 'TDD demo', r: 'reset', esc: 'deselect', o: 'office', quit: 'quit' },
    task: 'TASK', noTaskYet: 'Session without a task yet', waitingAgent: 'Waiting for events from an agent…',
    stats: '{tools} actions · {errors} errors · {subs} sub · {status}', flow: 'FLOW', pipelines: 'PIPELINES', tasks: 'TASKS',
    connected: '{n} agent(s) connected', team: 'TEAM', noActivity: 'No activity', detail: 'DETAIL · {name}', nothingYet: 'Has not done anything yet.',
    log: 'LOG', panes: 'PANES (herdr)', office: 'Office',
    flash: {
      demo: 'Claude Code demo running', demoPi: 'TDD demo (Pi) running', reset: 'Office reset', sent: 'Message sent', failed: 'Could not: {error}',
      cancelRun: 'Cancelling the pipeline “{name}”', cancelTask: 'Cancelling: {text}', noTasks: 'No tasks in progress', poked: 'You said hi to {name}', pickSomeone: 'Pick someone with tab or a click',
      newSession: ' (new session)', office: 'Viewing: {name}',
    },
  },
  brief: {
    title: 'New brief', close: 'esc ✕', agent: 'Agent', pipeline: 'Pipeline', session: 'Session', prompt: 'Prompt',
    noAgent: 'none: register one in ⚙ › Agents', noAgentWeb: 'No agent: register one in ⚙ › Agents',
    registerHint: 'Register an agent with its full path (c › Agents): the prompt starts the pipeline of its harness.',
    registerHintWeb: 'Register an agent with its full path in ⚙ › Agents: the prompt starts the pipeline of its harness.',
    placeholder: 'What do you need the team to do?', stages: 'Stages (run by {who})', bySession: 'the agent session', byHarness: 'the agent harness',
    more: '… and {n} more', gate: '⚙ {run} must {expect}{loop}', pass: 'pass', fail: 'fail', loop: ' · otherwise back to {goto} (×{max})',
    keyField: 'field', keyCycle: 'change', go: '▶ Get to work!', cancel: 'cancel', send: '⌘↵ to send', cancelBtn: 'Cancel',
    newSession: 'New {agent} session in {dir}', open: '● open', unregistered: '(unregistered)',
    pRegister: 'Register an agent in ⚙ › Agents (its full path), or open one with its integration', pWrite: 'Write the prompt',
    pNoPath: '{path} does not exist', pIssues: 'The pipeline has errors: {issue}', pNeedsSession: '“{label}” runs in an open session: open {agent} in {path}',
    pNotInstalled: 'Cannot find {agent} installed (its CLI is not in the PATH)', failed: 'Could not: {error}',
  },
  settings: {
    title: '⚙ Settings', loading: 'Loading…', close: 'Close', save: 'Save', saved: 'Saved: already in use.', file: 'stored in {file}',
    tabs: { general: 'General', offices: 'Offices', agents: 'Agents', look: 'Characters' },
    keys: { field: 'field', change: 'change', action: 'action', save: 'save', close: 'close', tabs: '◂ ▸ switch tab' },
    yes: 'yes', no: 'no',
    general: {
      language: 'Language', timezone: 'Time zone', tzSystem: 'the system one ({tz})', tzHint: 'The time zone gives the date, the time, the country and the weather. Each office can have its own (⚙ › Offices).',
      tzSearch: 'type to search (e.g. Madrid)', country: 'Country', weather: 'Real weather', weatherOn: 'yes (Open-Meteo, free)', weatherOff: 'no (simulated for the season)',
      herdr: 'herdr', herdrLaunch: 'Agents in panes', herdrDirection: 'New pane', right: 'to the right', down: 'below', startAgent: 'Agent on start', auto: 'automatic (the folder’s)', none: 'none',
      herdrOn: 'Inside herdr (pane {pane}): agents open in a new pane and can open more from there.', herdrOff: 'Not inside herdr: agents run in the background.',
      life: 'Office life in the log',
    },
    offices: {
      hint: 'Each office is a team or domain, like in a real company: its agents, its characters, its time zone and its weather. Pick which one to view at the top left (when there is more than one).',
      name: 'Name', timezone: 'Time zone', inherit: 'the company’s ({tz})', location: 'Location (weather)', locationPh: '(the time zone’s city)',
      agents: '{n} agent(s)', viewing: '● the one you are viewing', main: 'main', view: 'View', edit: 'Edit', delete: 'Delete', add: '＋ Add office', saveChanges: 'Save changes',
      newTitle: 'New office', editTitle: 'Edit “{name}”', created: 'Done: “{name}” is now part of the company.', updated: 'Office updated.', deleted: 'Office deleted (its agents moved to the main one).',
      confirmDelete: 'Delete the office “{name}”? Its agents move to the main office; their folders are not touched.', cancel: 'Cancel',
    },
    agents: {
      hint: 'Each agent is a full path, the CLI that serves it and its office. The office detects the pipeline of its harness (Errementari, commands, prompts, .devteam/). A prompt from the board starts it: in the session open in that path, or in a new session (inside herdr, in a pane).',
      registered: 'Registered agents (the prompt starts the pipeline of their harness)', none: 'None yet: add one below with its full path.',
      noneWeb: 'You have not registered any agent yet. Add one below with its full path.', loose: 'Open sessions not registered',
      open: '● open', sessionOpen: '● session open', missing: '✗ does not exist', pathMissing: '✗ the path does not exist', notInstalled: '✗ CLI not installed', cliMissing: '✗ {agent} is not installed',
      promptTo: '✉ Prompt to {name}', sendPrompt: '✉ Send prompt', removeOne: '✕ Delete {name}', edit: 'Edit', delete: 'Delete', register: 'Register',
      add: 'Add agent', editTitle: 'Edit “{name}”', path: 'Path', pathPh: '/full/path/to/the/project', pathPhWeb: '/Users/you/Workspace/my-project  (or ~/Workspace/my-project)',
      pathLabel: 'Full path of the project', agent: 'Agent', cliLabel: 'CLI that serves the path', name: 'Name', namePh: '(the folder’s)', office: 'Office',
      addBtn: '＋ Add', addAgent: '＋ Add agent', saveChanges: 'Save changes', cancel: 'Cancel', choose: '— choose —', configured: ' ✓ configured',
      detectHint: 'Type the path: the office detects which harness it has.', detectNone: '✗ That folder does not exist.', detected: 'Found: {what} — {n} entry(ies).',
      noHarness: 'no harness configured (direct prompt only)', advanced: 'Advanced', bin: 'Executable', binPh: '(the one in the PATH: claude, opencode, pi)',
      args: 'Arguments', argsPh: 'e.g. --permission-mode acceptEdits', argsHint: 'Only for new sessions. Claude Code uses --permission-mode acceptEdits when left empty (in the background).',
      added: 'Done: “{name}” now shows up on the board.', updated: 'Agent updated.', removed: '“{name}” deleted (its folder is not touched).',
      confirmDelete: 'Delete the agent “{name}”? It is only removed from the office: its folder is not touched.', deleted: 'Agent deleted.',
    },
    look: {
      hint: 'How the characters of this office look and what they are called. Each one still stands for its role (QA, backend…).',
      character: 'Character', name: 'Name', title: 'Title', shirt: 'Shirt', pants: 'Pants', hair: 'Hair', skin: 'Skin', long: 'Long hair', beard: 'Beard', glasses: 'Glasses',
      random: '🎲 Random', reset: '↺ Back to the original', randomTitle: 'Random', resetTitle: 'Back to the original', role: 'role: {role}', preview: 'Preview of {name}', of: '{label} of {name}',
      saved: 'Done: the team now looks like this in the office.',
    },
  },
  ui: {
    canvas: 'The office: click a character to see their card, the board for a new brief',
    settings: 'Settings', settingsKey: 'Settings (c)', fullscreen: 'Fullscreen', fullscreenKey: 'Fullscreen (f)',
    office: 'Office', officeKey: 'Pick which office to view (o)',
    sheetClose: 'Close card', poke: '👋 Say hi', message: '✉ Message', subagents: '{n} subagent(s)', nothingYet: 'Has not done anything in this session yet.',
    mood: { bath: 'in the bathroom 🚻', bathWait: 'waiting for the bathroom 😣', dream: 'dreaming of {dream} {emoji}', lunch: 'having lunch {food}', fire: 'putting out the fire! 🧯', talking: 'chatting 💬' },
    term: 'Team activity', termKey: 'Team activity (a)', termClose: 'Close terminal',
    tabs: { activity: 'activity', team: 'team', work: 'briefs' },
    promptTeam: 'team@office:~$', promptOne: '{name}@office:~$', chatPh: 'message to the team · /help',
    session: 'session', sessionLabel: 'Session', latest: 'most recent', noTaskYet: 'Session without a task yet', waitingAgent: 'Waiting for events from an agent…',
    stats: { tools: 'actions', errors: 'errors', subs: 'subagents', status: 'status' },
    newBrief: '📋 New brief', demo: '▶ Demo', demoTdd: '▶ TDD demo', reset: '⟲ Reset', connected: '{n} agent(s) connected',
    cancel: 'Cancel', cancelRun: '✕ cancel', runBy: 'Run by {agent}: {task}', isNew: ' (new)', flow: 'Flow by role', noActivity: 'no activity',
    help: 'commands: /brief · /demo · /tdd · /reset · /settings · /office <name> · /life (show or hide office life) · /clear · /screen. Without a slash: a message to the team (or to the selected one).',
    commands: { help: 'help', brief: 'brief', demo: 'demo', tdd: 'tdd', reset: 'reset', settings: 'settings', office: 'office', life: 'life', clear: 'clear', screen: 'screen' },
    unknownCommand: 'unknown command · /help', lifeOn: 'office life: shown', lifeOff: 'office life: hidden', noOffice: 'there is no office “{name}”',
    welcome: 'dev-team-office · the team activity shows up here · /help for the commands',
    viewing: '🏢 Viewing: {name} ({tz})',
    weatherTitle: '{label}{temp} · {season} · {where}', weatherReal: '{place} (Open-Meteo)', weatherSim: 'simulated for the season', here: 'your city',
  },
  console: {
    web: 'Web', webHint: '(o: open it in the browser)', game: 'Game', gameHint: 'g: open it in this terminal (q goes back to the log)', keys: 'Keys',
    keysLine: 'g game · o browser · h help · q quit',
    herdrOn: 'inside herdr (pane {pane}): agents open in a new pane', herdrOff: 'outside herdr: agents run in the background',
    logStart: '— log: what the agents are doing —', opening: 'Opening {url} in the browser…', back: '— back in the log ({n} new line(s)) —', bye: 'Closing the office…',
    task: '📨 {text} → {status}{detail}', run: '▶ “{name}”: {status}{stage}', weather: '{icon} Outside {office}: {label}{temp}', lang: '⚙ Language: {lang}',
    officeAdded: '🏢 New office: {name} ({tz})', officeRemoved: '🏢 The office {name} was deleted',
    startAgent: '🪟 {agent} opened in pane {pane} ({office}): it orchestrates its work from there (and can open more panes)', startFailed: 'Could not open the agent in herdr: {error}',
    attached: 'An office was already running: opening its game', noTty: 'No interactive terminal: just the log (and the web).',
  },
  cli: {
    help: `dev-team-office {version}: your coding agent as a development team (a company with one or more offices).

Usage:
  dev-team-office                 Starts the office: the API, the web view and, in the terminal, the log with
                                  what the agents are doing (g opens the game here, o in the browser, q quits).
                                  Inside herdr it opens the agent in a new pane (--agent, --no-launch).
  dev-team-office game            The same, but goes straight into the game (q goes back to the log).
  dev-team-office serve           Just the API and the log, no keys (to leave it in the background).
  dev-team-office watch [url]     Watch an office that is already running (the local one by default).
  dev-team-office status          Is an office running? Shows the version and endpoints.
  dev-team-office demo [--pi]     Plays a sample session (Claude Code, or a Pi TDD flow).
  dev-team-office offices         The company's offices (teams or domains).
  dev-team-office offices add "<name>" [--timezone Europe/Madrid] [--location "Madrid"]
  dev-team-office offices set <id> [--name …] [--timezone …] [--location …]
  dev-team-office offices rm <id>
  dev-team-office config [key] [value]
                                  The settings (in the SQLite database): lang en|es, timezone <zone>|system,
                                  weather on|off, herdr.launch on|off, herdr.direction right|down,
                                  herdr.startAgent auto|none|<id>, log.life on|off, view.office <id>.
  dev-team-office agents          The agent maintainer: the registered ones and what their harness brings.
  dev-team-office agents add <full path> --agent claude|opencode|pi [--name <name>] [--office <id>]
  dev-team-office agents rm <id>
  dev-team-office prompt <id> "<text>" [--pipeline <entry>] [--new]
                                  Sends a prompt to a registered agent through an entry of its harness.
  dev-team-office task "<text>" --agent pi|opencode|claude [--session <id>] [--launch [--cwd <dir>]]
  dev-team-office tasks           Lists the tasks sent and their status.
  dev-team-office pane [--role qa] [--title "tests"] [--direction right|down] [--agent pi|claude|opencode] -- <command or prompt>
                                  Inside herdr (the agent uses it): opens a pane next to its own with an
                                  activity (a command, or another agent with a prompt) and tells the office.
  dev-team-office install [pi|opencode|claude]
                                  Installs each agent's integration (all of them by default).
  dev-team-office team [--from <packsRoot>]
                                  The shipped teams (installable agent packs) and their roles.
  dev-team-office team install <team> --agent pi [--project <dir>] [--from <packsRoot>]
                                  Installs the team's agents into the harness's agent directory.
                                  --from points at an external packs root (same layout as teams/).
  dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …] [--source …] [--session …] [--office …]

Options:
  --port <n>        HTTP/WebSocket port (default {port}, or $DEV_TEAM_OFFICE_PORT)
  --host <ip>       Interface (default {host}, or $DEV_TEAM_OFFICE_HOST)
  --socket <path>   Unix socket of the API (default ~/.dev-team-office/office.sock)
  --no-socket       Do not open the Unix socket
  --agent <id|cli>  The agent opened in herdr on start (default: the one in the settings)
  --no-launch       Do not open any agent in herdr on start
  --no-herdr        Do not use herdr even when inside it
  --color <mode>    truecolor | 256 (detected automatically)
  -v, --version     Version
  -h, --help        This help

In the game: t brief · c settings · o office · a activity · x cancel · q log · tab pick · m message · s say hi
API: docs/api.md (POST /v1/events/<source>, GET /v1/state, WS /v1/ws)`,
    needsTty: 'The game needs an interactive terminal. Without one: dev-team-office serve',
    portBusyOther: 'Port {port} is taken by another program. Use --port <n>.',
    portBusy: 'Port {port} is already in use. Another office running? Try: dev-team-office status',
    noOffice: 'There is no office at {base}.', noOfficeOpen: 'There is no office at {base}. Start it with: dev-team-office',
    status: 'dev-team-office {version} (pid {pid}, {uptime}s)\n  HTTP/WS: {url}\n  socket:  {socket}', noSocket: '(no Unix socket)',
    demoRunning: 'Demo running.', couldNot: 'Could not: {error}', noAnswer: 'no answer',
    sendUsage: 'Usage: dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …]',
    sendOk: 'ok ({n} event(s))', sendErr: 'error: {error}',
    sessions: 'Connected sessions (they get the task right away):', none: '  (none)', launchers: 'New runs (--launch, in {dir} or --cwd):',
    notFound: '(cannot find "{cmd}")', claudeHint: 'Claude Code: --agent claude --session <id> queues the task until its turn ends.', noTasks: '(no tasks)',
    registered: 'Registered: {id}  ({path})', removed: 'Deleted: {id} (its folder is not touched)', unknownSub: 'Unknown subcommand: {cmd} {sub}',
    noAgents: '(no registered agents)  →  dev-team-office agents add <full path> --agent claude|opencode|pi', openSession: ' · ● session open',
    promptUsage: 'Usage: dev-team-office prompt <id> "<text>" [--pipeline <entry>] [--new]   (the ids: dev-team-office agents)',
    unknownCommand: 'Unknown command: {cmd}',
    offices: 'Offices:', officeLine: '  {id}  {name}  · {tz}{country}  · {agents} agent(s){viewing}', viewing: '  ← the one being viewed',
    officeAdded: 'Office created: {id}  ({name}, {tz})', officeSaved: 'Office updated: {id}', officeRemoved: 'Office deleted: {id} (its agents moved to the main one)',
    officesUsage: 'Usage: dev-team-office offices [add "<name>" | set <id> | rm <id>] [--name …] [--timezone …] [--location …]',
    config: 'Settings (in {file}):', configSaved: '{key} = {value}', configUnknown: 'Unknown setting: {key}. See: dev-team-office config',
    paneUsage: 'Usage: dev-team-office pane [--role qa] [--title "tests"] [--agent pi|claude|opencode] -- <command or prompt>',
    teams: 'Teams:', teamNone: '(no team packs shipped)',
    teamUsage: 'Usage: dev-team-office team [list] | dev-team-office team install <team> --agent pi [--project <dir>] [--from <packsRoot>]',
    paneOpened: '{pane}', paneOffline: '(the office is not running: the pane opened, but it does not show up in the game)',
  },
  install: {
    unknown: 'unknown: {names} (use pi, opencode or claude)', lib: 'Shared library at {path}', configSkill: 'Configuration skill at {path}',
    configSkillFail: 'Could not copy the configuration skill: {error} · the rest installs anyway',
    pi: 'Pi: extension at {ext} and skill at {skill}/', piHint: '    Open pi in your project: it connects to the office by itself.',
    opencode: 'OpenCode: plugin at {plugin}', opencodeHint: '    Open opencode in your project: it connects to the office by itself.',
    claude: 'Claude Code: hook at {hook}', claudeStep: '    One step left for you: copy the "hooks" section of {snippet}', claudeWhere: '    into ~/.claude/settings.json (or the project\'s .claude/settings.json).',
  },
  demo: {
    claude: {
      todos: ['Analyze the login requirements', 'Design the OAuth flow', 'Session endpoints', 'Login and profile UI', 'Tests and review'],
      explore: 'Explore the project and the current auth flow', plan: 'Plan the OAuth + PKCE architecture', ui: 'Design the profile UI and the color tokens',
      e2e: 'Write the login e2e tests', stories: 'Write the user stories and acceptance criteria',
      prompt: 'Add Google sign-in (OAuth) and a user profile page', search: 'OAuth 2.1 PKCE best practices',
      permission: 'Claude needs permission to use Bash', fail: 'FAIL auth.test.ts › callback rejects an invalid state', commit: 'feat: OAuth login and profile',
    },
    pi: {
      todos: ['Criteria', 'Technical design', 'Tests', 'API', 'UI', 'Review'], task: 'Endpoint and button to cancel orders',
      criteria: 'Only orders not yet shipped; 409 otherwise', analyze: 'Current order states', arch: 'CANCELLED state + POST /orders/:id/cancel',
      red: '2 tests: orders.cancel.test.ts', impl: 'OrderService.cancel + route', ux: 'Cancel button + confirmation', visual: 'Spacing and alert color',
      changes: 'SHIPPED orders must be rejected', fix: 'Guard for SHIPPED', accept: 'Meets the criteria', done: 'Order cancellation ready',
    },
  },
};
