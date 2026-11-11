// English (the default language). Same keys as es.js; {variables} are filled in when used.
// Character names come in as variables ({tl}, {po}, {manager}…) because they can be renamed.

export default {
  team: {
    you: 'you', // the PO is the user
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
  taskStatus: { queued: 'queued', sent: 'sent', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled', waiting: 'waiting its turn' },
  runStatus: { running: 'running', done: 'finished', failed: 'failed', cancelled: 'cancelled', queued: 'queued', sent: 'sent' },
  weather: { clear: 'clear', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'fog', drizzle: 'drizzle', rain: 'rain', snow: 'snow', storm: 'storm' },
  season: { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' },

  // ---------------------------------------------------------------- office life (sim.js)
  sim: {
    journal: {
      standup: '🗣 Daily standup: {names}',
      workcoffeeAlone: '{who} goes for a coffee to think about what they are doing ☕',
      workcoffee: '{who} goes for a coffee with {names} to talk about what they are doing ☕',
      newcomer: '{name} comes in to help with {role}: {text}', farewell: '{name} finished their part and leaves',
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
      bathgossip: '{names} whisper at the bathroom mirror 🤫',
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
    askOk: '{name}, can I have your OK? ✋',
    askYou: '{name}, I have a question for you ❓',
    chatReplies: ['Noted! 📝', "Let's cover it at the daily 👍", 'Got it 🙌', 'Good idea!'],
    btwThinking: ['Hmm, good question… 🤔', 'Let me check… 🔍', 'One sec, looking it up 📚'],
    standup: { open: 'Good morning! Daily: what did each one do? 🗣', waiting: '{n} thing(s) waiting for the PO: {what}', open2: '{n} brief(s) still open. Let’s go! 💪', close: 'Nothing pending. Let’s go! 💪' },
    clarify: { review: ['Let me read it carefully 🔍', 'Checking we have everything 📋', 'Before starting, let me review it 🤓'], ask: 'I have {n} question(s) before we start 📝', sent: ['All clear: to work! 🚀', 'Ready for the team 💪'], cancelled: 'Ok, we drop it' },
    btwFail: "I couldn't find out 🤷",
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
      po: ['Hope this ships today 🤞', 'Everything is urgent, as usual 😅', 'Lunch together today? 🥗', '{manager} is already on coffee number five ☕😂', 'The roadmap looks gorgeous 📌'],
      analyst: ["Yesterday's numbers… went up! 📈", 'I found a great data point 🤓', 'Have you seen the new dashboard? 📊', '{backend} swore it was not a bug 👀', 'I made a spreadsheet of spreadsheets 😂'],
      designer: ['What if everything were purple? 💜', 'That button keeps me up at night 😱', 'That screen needs some air ✨', 'I brought you a new palette 🎨', 'Who used Comic Sans? 😤'],
    },
    // the chit-chat about what is going on (sim.js liveTopics)
    newcomer: { welcome: 'Welcome, {name}! 👋', bye: 'Done, heading out! 👋' },
    live: {
      board: "We're {done} of {total} on the board 📋", doing: '{name} is {action} 👀', stuck: '{name} got stuck {action} 😬',
      waitingYou: "We're waiting for {po}'s OK ✋", newcomer: '{name} came to help with {role} 👋',
      rounds: "{name}, how's it going? I see you're {action}",
      replies: ["Let's get it done! 💪", 'Hope it ships today 🤞', "It's moving along 👍", 'Nice 🙌', "I'll help if needed", "Let's see how it ends 👀"],
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
      analyst: ['{analyst}, how many users do we expect? 📈', 'Where does that data come from? 🗄️', 'Which business rules apply here? 📑'],
      designer: ['{designer}, is that mockup doable? Let me see 🎨', 'That animation… on mobile too? 😅', 'Shall we build it with the design system? 🧩'],
    },
    tlReplies: {
      analyst: ['About 10k a month 📊', "I'll send you the spreadsheet 🤓", "I'll check with the business and get back to you 📑"],
      designer: ['Yes! With micro-interactions ✨', "I'll simplify it, promise 💜", 'It all comes from the design system 🎨'],
    },
    tlThanks: ["Perfect, I'll design the solution with that 🏛️", "Ok, I'll write it up in an ADR 📐", 'Great, thanks 🙌'],
    tlScope: {
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
    stressed: ['It failed again… 😰', 'Third error in a row. Breathe. 😰', 'Why won’t it pass?! 😰'],
    tired: 'I’m running out of context ({pct}% left)… I’m getting tired 🥱',
    rested: ['Context compacted: good as new! ☕', 'Fresh memory, let’s keep going! 💪'],
    pizzaParty: ["Let's celebrate with pizza! 🍕", 'Shall we order pizza to celebrate? 🍕'],
    rounds: ['How is it going, {name}?', '{name}, need anything?', 'All good over here, {name}?'],
    roundsReplies: ['Good, making progress 💪', 'All under control 👍', 'A bit stuck, but getting there 😅', 'Almost done 🙌'],
    tv: ["What's on? 📺", "5 minutes and I'm back 😅", 'Gooool! ⚽', 'This show is so good 🍿'],
    tvForecast: 'The forecast: {label}{temp} {icon}',
    tvTask: 'Even the TV is talking about “{task}” 😅',
    // a break in the middle of a task: to the café, talking about what they are doing ({action}:
    // "editing api.js"; {task}: the board's task), and back thinking how to solve it
    workCoffee: {
      open: ['I\'m {action} and I can\'t see how to handle the errors 🤔', 'Been {action} for a while… how would you do it?', 'This «{task}» has me going in circles ☕', 'Coffee first: I\'m {action} and my head is fried', 'Half way through «{task}», I think 😅', 'I\'m {action}: it works, but it looks ugly'],
      reply: ['What\'s the hard part?', 'Have you tried splitting it in two?', 'Happened to me last week, hang on…', 'Explain it like I\'m five 😄', 'And the tests, what do they say?', 'Uff, sounds like an edge case'],
      tlReply: ['Start with the simplest case and grow from there', 'Is there a test that says what it should do?', 'Don\'t over-design it: make it work first', 'Draw it on the board and we\'ll see'],
      more: ['The thing is, if it fails half way it leaves it all broken', 'I think I\'m mixing two problems in one', 'There are three cases and I only covered one', 'The old code does something strange there'],
      advice: ['Then handle the error at the edge, not inside 👍', 'Write the test first, it\'ll tell you', 'Separate them: one function per case', 'Ask the agent, it surely knows 😉', 'Try it with an example by hand'],
      alone: ['Hmm… {action}… ☕', 'Coffee and think. {action}, {action}… 🤔', 'Let\'s see, «{task}»: where was I?'],
      aloneMore: ['What if I start from the end?', 'It must be something silly…', 'Ok, one more sip and I\'ve got it'],
      back: ['💭 What if I separate the validation from the saving…?', '💭 Maybe a smaller function…', '💭 First the test, then the rest', '💭 There must be a simpler way…', '💭 And if the list comes empty…?'],
      eureka: ['That\'s it! 💡', 'Got it 💡', 'Let\'s go 💪', 'Ahh, of course 💡'],
    },
    coffee: ['☕', 'Mmm, coffee…', '🎵', 'Anyone want coffee?', 'Stretch break 🙆', 'A flat white, please ☕'],
    bathUrgent: ["I can't hold it! 😣", 'Excuse me, excuse me! 🏃'],
    bathWait: ['Hurry up! 😣', 'Much longer? 🙏', '🚻😬'],
    bathDone: ['Done! 🧼', 'Ahhh… 😌', 'Clean hands! 🧼'],
    bathGossip: ['🤫 Did you see what {manager} said in the meeting?', '🤫 Between us: I think {tl} wants to rewrite everything', '🤫 Don\'t tell anyone, but…', '🤫 Did you hear about the new project?', '🤫 They say there are bonuses this year', '🤫 Have you seen how {backend} and the tests get along? 😏'],
    bathGossipEnd: ['Shhh, someone\'s coming 👀', 'Not a word, huh 🤐', 'Hahaha, I knew it! 😂', 'Let\'s go back before they miss us 🏃‍♀️'],
    reqArrived: 'I have a new requirement: “{text}”',
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
  // the whiteboard, expanded (board-ui.js)
  board: { untitled: 'The whiteboard', progress: '{done} of {total} done', empty: 'There are no tasks on the whiteboard.', newBrief: '✚ New brief' },
  scene: {
    taskTitle: 'TASK: {title}',
    noTask: 'No task — waiting for the agent…',
    todo: 'TO DO', doing: 'DOING', done: 'DONE',
    todoShort: 'to do {todo} · doing {doing} · done {done}',
    boardTip: '✎ click: new brief', boardTipTickets: '🔍 click: see the tasks',
    cafe: 'CAFÉ', wc: 'WC', exit: 'EXIT', dining: 'DINING', menu: 'MENU', menuToday: ['soup', 'pasta', 'dessert'],
    tvBreaking: 'BREAKING', tvServer: 'SERVER', tvNews: 'NEWS', tvWeather: 'WEATHER',
    tvLive: 'LIVE: the team is working on “{title}”', tvQuiet: 'All quiet at the office',
    resize: 'Make the terminal bigger (at least 60×18) · q to quit',
  },
  // ---------------------------------------------------------------- what the agent does (server)
  // what a command or a tool does, in words (server/humanize.js): never the command itself
  act: {
    tests: 'Running the tests', testsOf: 'Running the tests of {target}', build: 'Building the project', dev: 'Starting the dev server',
    lint: 'Checking the code style', format: 'Formatting the code', typecheck: 'Checking the types', script: 'Running the “{name}” script',
    install: 'Installing dependencies', installPkgs: 'Installing {pkgs}', uninstall: 'Removing dependencies', publish: 'Publishing the package', tool: 'Using {prog}',
    gitStatus: 'Checking what changed', gitDiff: 'Looking at the changes', gitLog: 'Going over the history', gitShow: 'Looking at a commit', gitAdd: 'Staging the changes',
    gitCommit: 'Committing: “{msg}”', gitCommitPlain: 'Making a commit', gitPush: 'Pushing the changes', gitPull: 'Pulling changes from the repo',
    gitCheckout: 'Switching to {ref}', gitBranch: 'Checking the branches', gitStash: 'Setting changes aside', gitMerge: 'Merging branches', gitRebase: 'Reordering commits',
    gitRestore: 'Undoing changes', gitTag: 'Tagging a version', gitClone: 'Cloning {repo}', gitInit: 'Creating the repository', gitWorktree: 'Opening another copy of the repo', gitOther: 'Using git',
    gh: 'Checking GitHub', ghPr: 'Going over pull requests', ghRun: 'Looking at the CI', ghIssue: 'Going over issues', ghRelease: 'Preparing a release on GitHub',
    list: 'Looking at the files', listIn: 'Looking inside {dir}', find: 'Looking for files', read: 'Reading {file}', readSome: 'Reading a file',
    search: 'Searching for “{pattern}”', editText: 'Touching up text', mkdir: 'Creating the {dir} folder', remove: 'Deleting {file}', move: 'Moving {file}', copy: 'Copying {file}',
    touch: 'Creating {file}', link: 'Linking files', chmod: 'Changing permissions of {file}', fetch: 'Checking {host}', web: 'Checking the web',
    run: 'Running {file}', snippet: 'Trying a bit of code', containers: 'Working with containers', make: 'Running “{target}”',
    kill: 'Stopping a process', ps: 'Looking at what is running', sleep: 'Waiting a moment', echo: 'Noting something in the terminal', env: 'Checking the environment',
    process: 'Crunching data', open: 'Opening {file}', archive: 'Packing files', disk: 'Checking the disk space', remote: 'Working on another machine',
    panes: 'Arranging the panes', office: 'Talking to the office', agent: 'Asking {agent} for something', other: 'Using {prog}', shell: 'Working in the terminal',
    cd: 'Going into {dir}', background: '{what} (in the background)', mcp: 'Using {server}: {what}', toolUse: 'Using {tool}',
  },
  events: {
    standup: '🗣 {text}',
    clarify: { review: '🔍 Reviewing the brief for {project}', ask: '❓ {n} question(s) for you: {text}', sent: '📨 The brief goes to work: {text}', failed: '✖ The brief could not be sent: {text}', cancelled: '⊘ Brief cancelled' },
    updateBoard: 'Updates the board', newCard: 'New card: {text}', moveCard: 'Moves a card', failed: 'Failed: {text}{detail}',
    thinking: 'Thinking…', waiting: 'The agent is waiting for your approval', error: 'Something went wrong', compact: 'Tidies up the notes (compacts the context)',
    done: 'Task done!', sessionStart: 'New work session', sessionEnd: 'Session closed', serviceUp: 'Started a service: {name}', serviceDown: 'The service stopped: {name}', you: 'You', office: 'Office', subtask: 'Subtask',
    permission: 'Permission for {tool}', interrupted: 'Interrupted', turnEnd: 'ends the turn{text}',
    read: 'Reading {file}', write: 'Creating {file}', edit: 'Editing {file}', grep: 'Searching "{pattern}"', glob: 'Looking through {pattern}', files: 'files',
    websearch: 'Researching: {query}', webfetch: 'Reading {host}', web: 'Reading a web page', ask: 'Asks you something', askWhat: 'Asks you: {question}',
    plan: 'Presents the plan', planning: 'Planning', skill: 'Using skill {skill}', mcp: 'Using {tool}', working: 'Working',
  },
  task: {
    scope: 'Work only inside {dir}: do not read or change files outside that folder. Do exactly what is asked (or the agreed plan step), without going off on tangents or adding ideas nobody asked for.',
    queuedClaude: 'delivered when Claude finishes its turn', runningIn: '{exe} in {dir}', finished: 'finished', killed: 'killed ({signal})',
    exitCode: 'exited with code {code}{last}', disconnected: 'the agent disconnected', sentTo: 'sent to {agent}', accepted: 'the agent is on it',
    failedDefault: 'the agent could not do the task', failedEvent: '{agent} could not do the task: {detail}', claudeTook: 'Claude took it when its turn ended',
    cancelled: 'cancelled', dispatch: 'For {agent}: {title}', dispatchNew: 'New {agent} session: {title}', inPane: '{agent} in pane {pane} (herdr)',
    paneIdle: 'the agent in pane {pane} finished its turn',
    paneNoTurn: 'the agent did not start its turn in pane {pane} (herdr: {code})',
  },
  run: {
    sent: 'sent to the agent', claudeTook: 'Claude took it when its turn ended', dispatch: 'Pipeline “{name}” for {agent}: {task}',
    cancelledEarly: 'cancelled before it started', cancelling: 'cancelling…',
  },
  targets: { openSession: 'open session', claudeTurn: 'Claude, when its turn ends' },
  offices: { main: 'Main office' },
  // the analyst reviews a brief before it goes to work (server/clarify.js)
  ingest: { tooBig: 'too big (more than {mb} MB)', convert: 'to read {name} the office needs {tool} installed (or ask an agent to convert it: ✨ Ask an agent)', format: 'the archive does not read .{ext} files (Markdown, text, CSV, JSON, HTML, PDF or Word)', empty: '{name} has no text', url: 'that is not an http(s) address', fetch: 'could not download it: {error}' },
  // the daily standup (server/standup.js)
  standup: { title: 'Daily · {office} · {date}', did: 'Yesterday: {did} ({steps}).', steps: { one: '1 step', other: '{n} steps' }, errors: { one: 'It got stuck once.', other: 'It got stuck {n} times.' }, nothing: 'reviewing and planning', waitingHead: 'Waiting for the PO:', openHead: 'Still open:', source: 'The daily', now: '🗣 Daily now' },
  rag: { block: 'From the archive (cite its [id]; search more with search_knowledge):' },
  clarify: {
    promptHead: '[review] Before a brief goes to work, check whether it has everything needed to do it end to end without asking anyone. Do not change any file and do not start the work: only review it.',
    promptProject: 'Project: {name} ({dir})',
    promptBrief: 'The brief:\n{text}',
    promptRules: 'If it can be done well with what there is (or with reasonable, safe assumptions), answer exactly: READY\nIf something only the PO knows is missing and it would change the result (the scope, the acceptance criteria, a business decision), answer with 1 to {n} short questions, one per line, each starting with "Q: ". Nothing else. Write them in {lang}.',
    heading: 'What the PO clarified:', q: 'Q:', a: 'A:', noAnswer: '(no answer: decide reasonably and note it)',
    skipped: 'The PO leaves the open points to the team: make reasonable assumptions and note them in your summary.',
    unknown: 'unknown clarification', notAsking: 'that brief is no longer waiting for answers',
    ui: {
      title: '{name} has questions about your brief', reviewing: '{name} is reviewing your brief for {project}…', placeholder: 'Your answer…',
      send: '▶ Send it to work', skip: 'Let the team decide', cancel: 'Cancel the brief', sent: 'Brief sent to work.', hint: 'Answer what you can: an empty answer is left to the team.',
    },
  },
  // the screen's signal when an agent (or the analyst) waits for you
  attention: {
    all: 'See all {n}', inbox: '✋ Waiting for you', inboxHint: 'Oldest first. Each one stays here until you answer.', now: 'just now', one: '{who} is waiting for you', many: '{n} are waiting for you', since: '{min} min', answer: 'Answer', terminal: 'answer in its terminal', see: 'See',
    question: 'asks you: {text}', clarify: '{name} has {n} question(s) about your brief', title: '✋ ({n}) waiting for you',
    sound: 'A sound when they wait for you', notify: 'A system notification when they wait for you', notifyTitle: 'Dev Team Office: waiting for you',
  },
  // the instructions on top of a brief (server/guides.js)
  guide: {
    company: 'The company’s standards (the CTO’s):', 
    department: 'Instructions of the department «{name}»:', project: 'Instructions of the project «{name}»:',
    autonomous: 'Autonomous mode: work on it to the end on your own (plan, implement, test and check it; use subagents if it helps). Ask only what only the PO can answer, with your question tool; otherwise make reasonable assumptions and note them.',
  },

  // ---------------------------------------------------------------- the two shared floors: the executive one and the archive
  directiveStatus: { running: 'running', done: 'accomplished', partial: 'partly accomplished', failed: 'failed', cancelled: 'cancelled', interrupted: 'interrupted' },
  knowledgeKind: { note: 'note', decision: 'decision', doc: 'doc', term: 'term', minute: 'minutes', skill: 'skill', connector: 'connector' },
  floors: {
    lift: { title: 'Elevator', here: 'you are here' },
    name: { exec: '🏛 Executive floor', archive: '📚 Archive' }, key: 'Pick the floor: the executive one, an office or the archive (o · PgUp/PgDn)', going: 'Floor: {name}',
    elevator: 'the elevator',
    // the game (floors.js): each floor's scene, its people and what they say
    exec: {
      sign: 'EXECUTIVE', board: 'DIRECTIVES', none: 'No directives: click here', wall: 'THE COMPANY',
      errors: '⚠{n}/h', context: 'ctx {pct}%', working: '{n} working', waiting: '{n} waiting for you ✋', idle: 'quiet', tasks: '📋{n}',
      chat: [
        'How are the offices doing?', 'We have to align every team', "Let's check the board", 'Did anyone see the Payments report?',
        'We need one rule for every project', 'The next directive has to be clear', "Let's ask the archive what we already know",
      ],
      at: {
        coffee: ['A coffee before the board meeting ☕', 'This coffee beats the offices’ one'],
        window: ['What a view from up here', 'You can see the whole city from here'],
        screen: ['The offices are doing fine', 'One office is waiting for an answer', 'Who is working right now?'],
        board: ["Let's go over the directives", 'This one is almost done'],
      },
      react: {
        order: 'I need everyone to do this: "{title}"',
        wait: '({n} wait their turn: I won’t overload anyone)',
        split: 'Splitting it across {n} project(s): {offices}',
        department: 'New department: {name}. It needs its repositories, its people and its instructions before it can take orders', departmentOk: 'Good: get it ready',
        tech: ['Making sure each one does it its own way', 'Each team uses its own harness', "Careful not to break the APIs between projects"],
        done: 'Directive accomplished! "{title}" ({done}/{total}) 🎉', trouble: 'The directive "{title}" had trouble: {done} of {total} went well',
      },
      who: {
        ceo: 'I preside the company (I am you): I give the orders that cross offices', coo: 'Operations: I split each directive across the offices and follow how they go',
        cto: 'Technology: I make sure the directives make sense in each project', assistant: 'I take the directives to each office in the elevator',
      },
    },
    archive: {
      sign: 'ARCHIVE', entries: '{n} entries', connectors: 'CONNECTORS · {n}', skills: 'SKILLS · {n}',
      chat: ['The minutes need better tags', 'Did anyone ask for the API decision?', 'This knowledge is gold', 'A new skill for every team'],
      at: { shelf: ['Filing it with the rest', 'All the decisions are here'], patch: ['Checking the connectors answer', 'One more cable to the outside'], rack: ['The skills, ready to install', 'Every team uses this one'] },
      react: {
        saved: 'Filed: {kind} "{title}"', read: '📖 An agent looks up: "{title}"', search: '🔎 An agent searches: "{title}"',
        installed: '"{name}" installed in {n} project(s)', generate: 'Asking an agent for a {kind}: "{text}"', removed: 'Taking "{title}" out of the archive',
      },
      who: {
        archivist: 'Archivist: I keep what the company knows and find it for the agents', skills: 'Skills: I prepare them and install them in each project',
        connectors: 'Connectors: I connect the agents to outside information (MCP servers)',
      },
    },
  },
  exec: {
    from: 'Executive floor',
    waitTurn: 'the department has {n} brief(s) open',
    brief: '🏛 Directive from the executive floor: "{title}". Also working on it: {others}. Do this project\'s part.',
    interrupted: 'the office restarted before it ended',
    minuteTitle: 'Minutes: {title}', minuteAsked: 'Asked by: {who}', minuteParts: 'How it ended in each project:',
    log: { created: '🏛 Directive "{title}" to {n} project(s): {offices}', department: '🏛 New department: {name}', ended: '🏛 Directive "{title}": {status} ({done}/{total})' },
    ui: {
      company: 'The company · last 7 days',
      health: { ok: 'healthy', warn: 'watch it', bad: 'needs you' },
      co: {
        col: { dept: 'Department', now: 'Now', autonomy: 'Autonomy', briefs: 'Briefs', ok: 'Without failing', lead: 'Median time' },
        waiting: '✋ waiting {min} min', errors: '{n} errors/h', context: 'context {pct}%', fine: 'all good', companyAutonomy: 'the company’s', flow: '{n} ({done} done)', lead: '{min} min',
      },
      title: '🏛 Directives', text: 'What must they do?', placeholder: 'One order for several offices or projects: "Every API exposes /health"',
      scope: 'Who', all: 'all its projects ({n})', none: 'no registered projects', noAgents: 'Register each department’s projects in ⚙ › Departments (or ⚙ › Agents) to give them directives.',
      send: '▶ Make it happen!', recent: 'The latest', empty: 'No directives yet.', pick: 'Pick at least one project', write: 'Write the directive',
      sent: 'Directive sent to {n} project(s)', stop: '⏹ Stop', progress: '{done} of {total}', by: 'by {who}',
      deptPh: 'A department that does not exist yet…', deptAdd: '＋ New department', deptName: 'Write the new department’s name', deptCreated: 'Department “{name}” created: add its projects, people and instructions in ⚙ › Departments.',
    },
  },
  archive: {
    from: 'Archive',
    generate: {
      skill: 'The company archive asks you for a skill: {text}\n\nWrite it and save it in the archive with the dev-team-office MCP tool save_knowledge (kind "skill", name in lowercase with dashes, title: what it does and when to use it, body: the instructions in Markdown). Do not change the project\'s files.',
      connector: 'The company archive asks you for a connector to outside information: {text}\n\nFind the right MCP server and save it in the archive with the dev-team-office MCP tool save_knowledge (kind "connector", name, title: what information it gives, command + args for a local one or url for a remote one, body: how to set it up and which credentials it needs, without writing any secret). Do not change the project\'s files.',
      note: 'The company archive asks you for a note: {text}\n\nLook into what is needed and save it with the dev-team-office MCP tool save_knowledge (kind "note", title and a Markdown body). Do not change the project\'s files.',
      doc: 'The company archive asks you for a document: {text}\n\nWrite it and save it with the dev-team-office MCP tool save_knowledge (kind "doc", title and a Markdown body). Do not change the project\'s files.',
    },
    log: {
      saved: '📚 {who} saved to the archive: {kind} "{title}"', updated: '📚 {who} updated in the archive: {kind} "{title}"',
      installed: '📚 {kind} "{name}" installed in: {projects}', generate: '📚 The archive asked an agent for: {kind} "{text}"',
    },
    reason: { exists: 'it has its own one with that name', manual: 'it has opencode.jsonc: add it by hand', invalid: 'its config file is not valid JSON', harness: 'its agent does not support it', unknown: 'it is not registered', error: 'it could not be written' },
    action: { created: 'installed', updated: 'added', same: 'already had it' },
    ui: {
      title: '📚 Archive', search: 'Search the archive…', all: 'All', kinds: { note: 'Notes', decision: 'Decisions', doc: 'Docs', term: 'Glossary', minute: 'Minutes', skill: 'Skills', connector: 'Connectors' },
      empty: 'The archive is empty. Save what the company knows, or ask an agent for it.', none: 'Nothing matches "{q}".', pickOne: 'Pick an entry to read it.',
      new: '✚ New', ask: '✨ Ask an agent', edit: '✎ Edit', remove: '🗑 Delete', removeAsk: 'Delete "{title}" from the archive?', save: 'Save', back: '← Back',
      kind: 'Kind', name: 'Name', titleField: 'Title', descField: 'Description (what it does and when to use it)', infoField: 'What information it gives', body: 'Text (Markdown)', instructions: 'Instructions (Markdown)', setup: 'How to set it up (no secrets)',
      tags: 'Tags', office: 'For', company: 'the whole company', command: 'Command (a local MCP server)', args: 'Arguments', url: 'or URL (a remote MCP server)',
      install: 'Install in', installGo: '⬇ Install', installHint: 'It is written in each project’s folder, in its agent’s format (Claude Code: .claude/; Pi, OpenCode and Codex: .agents/ or their MCP config).',
      uses: '{n} read(s)', by: 'by {who}', saved: 'Saved', removed: 'Deleted', describe: 'What do you need?', describePh: 'A skill to deploy to staging with our pipeline…', agent: 'Agent',
      asked: 'You asked {agent}: it will save it in the archive when it is done', noTargets: 'Register an agent in ⚙ › Agents to ask it',
      termField: 'Term', definition: 'Definition (Markdown)', synonyms: 'Synonyms (comma-separated)', project: 'Only for the project', anyProject: 'any project', validUntil: 'Valid until', expired: 'expired', origin: 'from {origin}',
      index: '🧠 {n} chunk(s) indexed · {e} with embedding', chunks: 'How it was indexed', download: '⬇ .md',
      import: '📥 Load', importTitle: 'Load documents', importHint: 'Markdown, text, CSV, JSON, HTML, PDF or Word (PDF and Word need pdftotext or pandoc on this machine). Their readable text is kept, and it is indexed for the agents.',
      drop: 'Drop files here, or pick them', url: 'or a web address', importGo: '📥 Load into the archive', importing: 'Loading {name}…', imported: 'Loaded: {n} document(s)', importFailed: '{name}: {error}',
      gaps: '🕳 Gaps', gapsHint: 'What the agents searched and did not find. Answer it (a note, a doc, a term) and they will find it next time.', gapsEmpty: 'No gaps: the agents found what they searched for.',
      gapTimes: '{n} time(s)', gapAnswer: '✍ Answer it', gapDismiss: 'Dismiss',
    },
  },
  services: {
    title: 'Background services', running: 'running', since: 'since {time}', stopped: 'stopped at {time}',
    empty: 'Nothing is running in the background. When an agent leaves a service running (a dev server, a watcher…), it shows up here and lights a unit of the rack.',
    waiting: 'Waiting for its output…', noLog: 'Its log is gone (the agent may have cleaned it up).',
    openPane: '⧉ Open in herdr', paneOpened: 'Its logs are in herdr pane {pane}.', keyPick: 'choose',
  },
  // what the agents ask you on their screens (inside herdr), and your answer
  prompts: {
    title: 'Your agents are asking', empty: 'Nothing pending: it was answered.', theAgent: 'the agent',
    asks: '{agent} is asking you', pane: 'pane {pane}', options: 'Options',
    cancel: 'Cancel the question (Esc)', hint: 'Your answer is pressed in the agent’s herdr pane, as if you were there.',
    sending: 'Answering…', sent: 'Answered: “{answer}”.', cancelledMsg: 'Esc pressed in its pane.', failed: 'It could not be answered.',
    chip: '{agent} is asking you', chipMany: '{n} questions for you',
    waiting: '{agent} is asking you: {summary}', answered: '✋ answered “{answer}” in pane {pane}', cancelled: '✋ question cancelled in pane {pane}',
  },
  err: {
    pathMissing: 'the path is missing', pathRelative: '{path}: use the full path (e.g. ~/Workspace/my-project)', pathNotFound: '{path}: that folder does not exist',
    harness: 'choose the agent for that path: claude-code, opencode or pi', args: '{name}: args must be a list of strings',
    agentExists: 'that agent is already registered for that path', saveFailed: 'could not save: {error}', agentsMax: 'at most {n} agents',
    unknownAgent: 'unknown agent', unknownGap: 'unknown gap', character: { json: 'that file is not JSON', kind: 'that is not a Dev Team Office character (its "kind" must be "dev-team-office/character")' }, unknownRole: 'unknown role: {role}', oneOf: '{role}: "{key}" must be one of: {values}', notEditable: '{role}: "{key}" cannot be changed',
    color: '{role}.{key}: use a color like #3f73f0', empty: '{role}.{key} cannot be empty',
    unknownOffice: 'unknown department (office): {office}', officeName: 'give the department a name', officeExists: 'there is already a department with that name', autonomy: 'autonomy must be one of: {levels} (or empty: the company’s)',
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
    tooLarge: 'payload too large', noHerdr: 'you are not inside herdr (HERDR_ENV=1)', unknownService: 'there is no such service', serviceNoLog: 'that service has no log to follow', herdrFailed: 'herdr: {error}', paneMissing: 'the pane is missing',
    promptGone: 'that question is no longer there', promptChanged: 'the question changed on the agent’s screen: this is the one it shows now', promptOption: 'that option does not exist',
    knowledgeKind: 'unknown kind: use {kinds}', knowledgeTitle: 'give it a title (for a skill: what it does and when to use it)', knowledgeTooLong: 'the text is over {n} KB',
    knowledgeName: 'give it a name (letters, digits and dashes)', knowledgeExists: 'there is another one named "{name}"', knowledgeMax: 'the archive keeps at most {n} entries',
    connectorUrl: "the connector's URL must start with http:// or https://", connectorHow: 'a connector needs a command (a local MCP server) or a URL (a remote one)',
    unknownKnowledge: 'no such entry in the archive', notInstallable: 'only skills and connectors are installed in a project', installFailed: 'it was not installed in any project',
    pickProjects: 'pick at least one office or registered project', unknownProject: 'unknown project: {project}', tooManyProjects: 'at most {n} projects per directive', unknownDirective: 'no such directive',
  },
  server: {
    started: 'Dev Team Office {version} at {url}', browser: '  Open it in your browser: {urls}', api: '  API: POST /v1/events/<source> · GET /v1/state · WS /v1/ws{socket}',
    socketUnavailable: 'Unix socket not available ({file}): {error}', socketTooLong: 'path too long for a Unix socket (max 103 bytes); use --socket with a shorter one',
    socketBusy: 'another office is already listening there',
    outdatedPage: 'the office was updated to {version}: reload this page (⌘R or Ctrl+R) to see the new version',
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
  // the activity monitor (inside herdr, instead of the game)
  monitor: {
    directives: '{n} directive(s) running', knowledge: '{n} in the archive',
    agents: '{n} active agent(s)', waiting: '{n} waiting for you', subagents: '{n} subagent(s) running', working: '{n} of the team working',
    panes: '{n} pane(s)', tasks: '{n} task(s) running', agentsTitle: 'AGENTS', subDone: 'finished', teamIdle: 'everyone is free', more: '{n} more',
    none: 'No agents yet: open one (pi, claude, opencode…) in another pane, or ask for something from the game in the browser (o).',
    noHerdr: 'outside herdr', keys: 'o browser · g game · ←→ office · q {quit}', quit: 'quit', quitOffice: 'close the office',
    services: '{n} service(s) running', servicesTitle: 'SERVICES', svcUp: 'running · {ago}', svcDown: 'stopped {ago} ago', keysServices: '1-9 a service’s logs',
    svcPane: 'Logs of {name} in pane {pane}', svcNone: 'no service with that number',
    promptsTitle: 'WAITING FOR YOU', keysPrompts: 'r answer', answerKeys: '1-{n} answer · x cancel the question · esc back', promptNone: 'no agent is asking you anything',
  },
  // a subagent's pane (dev-team-office follow)
  follow: {
    waiting: 'waiting for the subagent…', thinking: 'thinking…', red: 'fails, as expected in RED', done: 'finished ({time})',
    closes: 'this pane closes by itself in a few seconds', offline: 'lost connection to the office, retrying…', gone: 'the office closed',
    usage: 'Usage: dev-team-office follow --session <session> --sub <subagent id> [--office <id>]',
  },
  // ---------------------------------------------------------------- terminal and web
  conn: { live: 'live', offline: 'offline', connecting: 'connecting…', connectingTo: 'connecting to {host}…', connectedTo: 'connected to {host}', retrying: 'lost connection to {host}, retrying…' },
  tui: {
    msgTo: ' Message for {name}: ', msgTeam: ' Message to the team: ', msgHint: '  Enter send · Esc cancel ',
    keys: { t: 'brief (or click the board)', c: 'settings ⚙', a: 'activity >_', q: 'log', tab: 'pick', m: 'message', b: 'btw (ask)', s: 'say hi', x: 'cancel', d: 'demo', p: 'TDD demo', r: 'reset', esc: 'deselect', o: 'office', quit: 'quit', l: 'services (or click the rack)' },
    task: 'TASK', noTaskYet: 'Session without a task yet', waitingAgent: 'Waiting for events from an agent…',
    stats: '{tools} actions · {errors} errors · {subs} sub · {status}', flow: 'FLOW', pipelines: 'PIPELINES', tasks: 'TASKS',
    connected: '{n} agent(s) connected', team: 'TEAM', noActivity: 'No activity', detail: 'DETAIL · {name}', nothingYet: 'Has not done anything yet.',
    log: 'LOG', panes: 'PANES (herdr)', office: 'Office',
    flash: {
      demo: 'Claude Code demo running', demoPi: 'TDD demo (Pi) running', reset: 'Office reset', sent: 'Message sent', failed: 'Could not: {error}',
      cancelRun: 'Cancelling the pipeline “{name}”', cancelTask: 'Cancelling: {text}', noTasks: 'No tasks in progress', poked: 'You said hi to {name}', pickSomeone: 'Pick someone with tab or a click',
      newSession: ' (new session)', office: 'Viewing: {name}', asked: 'Asked the agent on duty (btw)',
    },
  },
  brief: {
    models: 'Models', ownModel: "The agent's own model", profileOpen: 'The open session keeps its model: the profile counts for a new session or for a pipeline\'s stages.',
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
    models: {
      hint: 'A profile says which model each role uses. It is used when a brief opens a new session (the agent starts with the default model) and by a pipeline\'s stages that set no model. You can add your own.',
      active: 'Default profile', label: 'Name', for: 'For:', default: 'Default', same: 'same as the default ({model})', remove: 'Remove this profile', add: '✚ New profile', newLabel: 'Profile {n}',
    },
    title: '⚙ Settings', loading: 'Loading…', close: 'Close', save: 'Save', saved: 'Saved: already in use.', file: 'stored in {file}',
    tabs: { general: 'General', offices: 'Departments', agents: 'Agents', look: 'Characters', models: 'Models' },
    keys: { field: 'field', change: 'change', action: 'action', save: 'save', close: 'close', tabs: '◂ ▸ switch tab' },
    yes: 'yes', no: 'no',
    general: {
      archive: 'Archive (the agents’ knowledge)', archivePush: 'What the archive knows goes on top of every brief and question (the glossary terms and the most relevant passages)', embeddings: 'Semantic search', embed_off: 'Off: by words only (offline)', embed_ollama: 'Ollama, on this machine', embed_openai: 'An OpenAI-compatible API (OpenAI, Voyage…)', embedModel: 'Embedding model', embedUrl: 'Address', embedOllamaHint: 'Install Ollama and run: ollama pull nomic-embed-text. Nothing leaves this machine.', embedKeyHint: 'Its key goes in the DEV_TEAM_OFFICE_EMBED_KEY environment variable (never in the database). The archive’s text is sent to that API to be embedded.', indexStatus: '🧠 {chunks} chunk(s) indexed · {embedded} with embedding', reindex: '↻ Index it again',
      autonomy: 'Autonomy', clarify: 'Before a brief goes to work, the analyst checks it has everything (and asks you only what is missing)', autonomous: 'The agents work on their own to the end (they ask only what only you can answer)',
      language: 'Language', timezone: 'Time zone', tzSystem: 'the system one ({tz})', tzHint: 'The time zone gives the date, the time and the country. Each office can have its own (⚙ › Offices).',
      city: 'City', cityZone: 'the time zone’s ({city})', cityHint: 'The city gives the weather, the sun and the moon. Type to search among the cities of the time zone’s country: in Chile, for example, Concepción and Punta Arenas share Santiago’s time zone.',
      cityNone: 'no city like that in {country}', cityOffline: 'no connection: write the city or its coordinates (lat, lon)',
      tzSearch: 'type to search (e.g. Madrid)', country: 'Country', weather: 'Real weather', weatherOn: 'yes (Open-Meteo, free)', weatherOff: 'no (simulated for the season)',
      herdr: 'herdr', viewMode: 'Office view', view_flat: 'Front (the classic one)', view_iso: 'Top-down (isometric)', herdrLaunch: 'Agents in panes', herdrSubagents: 'Each subagent in its own pane', herdrDirection: 'New pane', right: 'to the right', down: 'below', startAgent: 'Agent on start', auto: 'automatic (the folder’s)', none: 'none',
      herdrOn: 'Inside herdr (pane {pane}): agents open in a new pane and can open more from there.', herdrOff: 'Not inside herdr: agents run in the background.',
      life: 'Office life in the log',
    },
    offices: {
      hint: 'Each department is an office of the company (a floor of the building): its projects (repositories, with their agents), its people (the characters), its instructions (how to work there: they go with every brief, directive and question to its projects), its time zone and its weather. Pick which one to view at the top left.',
      companyTitle: 'The company', departments: 'Departments', saveCompany: 'Save',
      standards: 'The company’s standards (the CTO’s)', standardsPh: 'What every project of every department follows: conventions, security, how to document… They go on top of every brief, before the department’s and the project’s instructions.',
      capacity: 'Capacity', capacityHint: 'How many briefs a department takes at once from a directive (counting the ones it already has open). Operations does not overload anyone: the rest wait their turn and go as soon as one ends.',
      autonomy: 'Autonomy', autonomyCompany: 'The company’s (⚙ › General)', autonomyCompanyHint: 'It works as ⚙ › General › Autonomy says.',
      autonomyLevel: { guided: 'Guided', balanced: 'Balanced', autonomous: 'Autonomous' },
      autonomyHint: { guided: 'The analyst reviews each brief and the agent asks you when in doubt.', balanced: 'The analyst reviews each brief; then the agent works to the end on its own.', autonomous: 'No review: each brief goes straight to work and the agent works to the end on its own.' },
      name: 'Name', timezone: 'Time zone', inherit: 'the company’s ({tz})', location: 'City (weather)', locationPh: 'the time zone’s ({city})', cityInherit: 'the company’s ({city})',
      agents: '{n} agent(s)', viewing: '● the one you are viewing', main: 'main', view: 'View', edit: 'Edit', delete: 'Delete', add: '＋ Add department', saveChanges: 'Save changes',
      newTitle: 'New department', editTitle: 'Edit “{name}”', created: 'Done: “{name}” is now part of the company.', updated: 'Department updated.', deleted: 'Department deleted (its projects moved to the main one).',
      confirmDelete: 'Delete the department “{name}”? Its projects move to the main one; their folders are not touched.', cancel: 'Cancel',
      instructions: 'Instructions', instructionsPh: 'How to work in this department: conventions, what to never do, who to ask… They go with every brief, directive and question to its projects.',
      projects: 'Projects', noProjects: 'No projects yet.', addProject: '＋ New project', moveHere: 'Bring a project here…', people: 'People', editPeople: 'Edit its people', hasInstructions: '📋 with instructions',
    },
    agents: {
      instructions: 'Project instructions', instructionsPh: 'How to work with this project (for every agent in its folder): commands, conventions, what not to touch… They go with every brief, pipeline and question.', hasInstructions: '📋 instructions',
      hint: 'Each agent is a full path, the CLI that serves it and its office. The office detects the pipeline of its harness (Errementari, commands, prompts, .devteam/). A prompt from the board starts it: in the session open in that path, or in a new session (inside herdr, in a pane).',
      registered: 'Registered agents (the prompt starts the pipeline of their harness)', none: 'None yet: add one below with its full path.',
      noneWeb: 'You have not registered any agent yet. Add one below with its full path.', loose: 'Open sessions not registered',
      open: '● open', sessionOpen: '● session open', missing: '✗ does not exist', pathMissing: '✗ the path does not exist', notInstalled: '✗ CLI not installed', cliMissing: '✗ {agent} is not installed',
      promptTo: '✉ Prompt to {name}', sendPrompt: '✉ Send prompt', removeOne: '✕ Delete {name}', edit: 'Edit', delete: 'Delete', register: 'Register',
      add: 'Add agent', editTitle: 'Edit “{name}”', path: 'Path', pathPh: '/full/path/to/the/project', pathPhWeb: '/Users/you/Workspace/my-project  (or ~/Workspace/my-project)',
      pathLabel: 'Full path of the project', agent: 'Agent', cliLabel: 'CLI that serves the path', name: 'Name', namePh: '(the folder’s)', office: 'Department',
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
      sex: 'Sex', style: 'Style', styles: { normal: 'Normal', concise: 'Concise: straight to the point', explanatory: 'Explanatory: the why, with examples', teacher: 'Teacher: step by step, to learn', formal: 'Formal: like a report' }, export: '⬇ Export', exportTitle: 'Download {name} as JSON, to share them', import: '⬆ Import', importTitle: 'Bring a character from a JSON file into this role', imported: 'Done: {name} imported (Save to keep it).', sexes: { f: 'Female', m: 'Male' }, personality: 'Personality', personalities: { chatty: 'Chatty: talks a lot, at the desk and at the café', focused: 'Focused: barely leaves the desk', anxious: 'Anxious: many doubts, coffee often', calm: 'Calm: takes breaks, no rush', dreamer: 'Dreamer: daydreams while working' }, traits: { chatty: 'chatty', focused: 'focused', anxious: 'anxious', calm: 'calm', dreamer: 'dreamer' }, pickColor: 'Pick a color', moreColors: 'Other color…',
      random: '🎲 Random', reset: '↺ Back to the original', randomTitle: 'Random', resetTitle: 'Back to the original', role: 'role: {role}', you: "that's you", preview: 'Preview of {name}', of: '{label} of {name}',
      saved: 'Done: the team now looks like this in the office.',
    },
  },
  ui: {
    lately: 'What they did lately', newcomerOf: 'Newcomer · {role} · {project}', talkEmpty: 'Ask {name} something about what they are doing (end with ?) and their agent answers. Anything else, they answer in their own words.', talkEmptyTeam: 'Say something to the whole team.',
    contextNone: 'The agent’s context, as a health bar: it shows up when an agent reports it (Claude Code, Pi and OpenCode do while they work).',
    context: 'Context · {agent}', contextAria: 'Context: {pct}% free ({used} of {max} used)',
    canvas: 'The office: click a character to see their card, the board for a new brief',
    settings: 'Settings', settingsKey: 'Settings (c)', fullscreen: 'Fullscreen', fullscreenKey: 'Fullscreen (f)', view: 'Front or top-down view', viewKey: 'Front or top-down view (v)', servicesKey: 'Background services: {n} running (l)',
    office: 'Office', officeKey: 'Pick which office to view (o)', floor: 'Floor',
    sheetClose: 'Close card', poke: '👋 Say hi', subagents: '{n} subagent(s)', nothingYet: 'Has not done anything in this session yet.',
    mood: { stressed: 'stressed 😰 ({n} errors in a row)', tired: 'tired 🥱 (their agent has {pct}% context left)', bath: 'in the bathroom 🚻', bathWait: 'waiting for the bathroom 😣', dream: 'dreaming of {dream} {emoji}', lunch: 'having lunch {food}', fire: 'putting out the fire! 🧯', talking: 'chatting 💬' },
    session: 'session', sessionLabel: 'Session', latest: 'most recent', noTaskYet: 'Session without a task yet', waitingAgent: 'Waiting for events from an agent…',
    stats: { tools: 'actions', errors: 'errors', subs: 'subagents', status: 'status' },
    standupBtn: '🗣 Daily', standupTip: 'The daily standup now: each one tells what their agent did in the last 24 hours (the minutes go to the archive)', newBrief: '📋 New brief', demo: '▶ Demo', demoTdd: '▶ TDD demo', reset: '⟲ Reset', connected: '{n} agent(s) connected',
    cancel: 'Cancel', cancelRun: '✕ cancel', runBy: 'Run by {agent}: {task}', isNew: ' (new)', flow: 'Flow by role', noActivity: 'no activity',
    btwUsage: 'btw <question>: a side question to the agent on duty about the team, the domain or the office', btwThinking: 'thinking…', btwFailed: 'no answer: {error}', btwClose: 'Close',
    lifeOn: 'office life: shown', lifeOff: 'office life: hidden',
    welcome: 'dev-team-office · the team activity shows up here',
    viewing: '🏢 Viewing: {name} ({tz})',
    weatherTitle: '{label}{temp} · {season} · {where}', weatherReal: '{place} (Open-Meteo)', weatherSim: 'simulated for the season', here: 'your city',
    feed: 'Activity', feedKey: 'Activity: what the agents do and the office life (a)', feedClose: 'Close the activity', life: 'office life', lifeKey: 'Show the office life too: chit-chat, dreams, lunch, fires…', clear: 'clear',
    work: '📋 Work', workKey: 'Work: the task, the pipelines, the tasks and the demos (w)', team: 'The team',
    you: 'You', send: 'Send', talkPh: 'Write to {name}… (a question is answered by their agent)', talkTeamPh: 'Say something to the team…',
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
                                  Inside herdr, instead of the log, the activity monitor (--no-monitor: the log),
                                  and it opens the agent in a new pane (--agent, --no-launch).
  dev-team-office monitor         The activity monitor: how many agents and subagents are running, what each one is
                                  doing, the team and the log (o browser, g game, ←→ office, q quit).
  dev-team-office game            The same as the first one, but goes straight into the game (q goes back to the log).
  dev-team-office join [path] [--agent <cli>] [--office <office>] [--team <pack>|--no-team] [--open]
                                  Adds this folder to the game: starts the office if needed, registers the repo root
                                  with its agent and shows which character plays each subagent (MCP: join_office).
                                  The roles its subagents do not cover are filled with the office team, in the
                                  project and in the agent's format (--team picks another pack; --no-team, none).
  dev-team-office serve           Just the API and the log, no keys (to leave it in the background).
  dev-team-office start           Starts the office in the background (the game at its URL; the log in ~/.dev-team-office/office.log).
  dev-team-office stop            Stops the running office (in the background or in a terminal).
  dev-team-office restart         Stops it and starts it again in the background, with the installed code.
  dev-team-office watch [url]     Watch an office that is already running (the local one by default).
  dev-team-office status          Is an office running? Shows the version and endpoints.
  dev-team-office demo [--pi]     Plays a sample session (Claude Code, or a Pi TDD flow).
  dev-team-office offices         The company's departments (offices: teams or domains). Also: departments.
  dev-team-office offices add "<name>" [--timezone Europe/Madrid] [--location "Madrid"] [--instructions "<how to work there>"]
  dev-team-office offices set <id> [--name …] [--timezone …] [--location …] [--instructions …]
  dev-team-office offices rm <id>
  dev-team-office config [key] [value]
                                  The settings (in the SQLite database): lang en|es, timezone <zone>|system, city <city>|zone,
                                  weather on|off, herdr.launch on|off, herdr.subagents on|off, herdr.direction right|down,
                                  herdr.startAgent auto|none|<id>, log.life on|off, view.office <id>, view.mode flat|iso.
  dev-team-office agents          The agent maintainer: the registered ones and what their harness brings.
  dev-team-office agents add <full path> --agent claude|opencode|pi|codex [--name <name>] [--office <id>] [--instructions "<how to work with it>"]
  dev-team-office agents set <id> [--name …] [--office <id>] [--instructions …]
                                  A project's instructions go on top of every brief, pipeline and question to its folder.
  dev-team-office agents rm <id>
  dev-team-office character export <role> [--office <id>] [--out <file or folder>]
  dev-team-office character import <file.json> [--role <role>] [--office <id>]
                                  A character as JSON, to share them: name, sex, personality, style and look.
  dev-team-office prompt <id> "<text>" [--pipeline <entry>] [--new]
                                  Sends a prompt to a registered agent through an entry of its harness.
  dev-team-office task "<text>" --agent pi|opencode|claude [--session <id>] [--launch [--cwd <dir>]]
  dev-team-office tasks           Lists the tasks sent and their status.
  dev-team-office pane [--role qa] [--title "tests"] [--direction right|down] [--agent pi|claude|opencode|codex] -- <command or prompt>
                                  Inside herdr (the agent uses it): opens a pane next to its own with an
                                  activity (a command, or another agent with a prompt) and tells the office.
  dev-team-office follow --session <id> --sub <id>
                                  What a subagent is doing, live. Inside herdr the office opens it by itself,
                                  one pane per subagent (⚙ › herdr › Each subagent in its own pane).
  dev-team-office setup [--only claude,codex,…] [--dry-run]
                                  Connects every coding agent found (Pi, Claude Code, OpenCode, Codex, Gemini,
                                  Cursor): its live integration, hooks, the MCP server and the skills.
  dev-team-office doctor          Checks the installation (Node, launcher, office, each agent).
  dev-team-office uninstall [--only …] [--purge]
                                  Undoes setup (--purge also deletes the database).
  dev-team-office update          Updates to the latest version (a git clone: git pull) and restarts the running office with it.
  dev-team-office mcp             The MCP server (stdio) that setup registers in each agent.
  dev-team-office btw "<question>" [--office <id>]
                                  A side question to the agent on duty about the team (like /btw).
  dev-team-office team [--from <packsRoot>]
                                  The shipped teams (installable agent packs) and their roles.
  dev-team-office team install <team> --agent <cli> [--project <dir>] [--from <packsRoot>]
                                  Installs the team's agents into the harness's agent folder (pi, claude, opencode
                                  or codex), each one in its format.
                                  --from points at an external packs root (same layout as teams/).
  dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …] [--source …] [--session …] [--office …]

Options:
  --port <n>        HTTP/WebSocket port (default {port}, or $DEV_TEAM_OFFICE_PORT)
  --host <ip>       Interface (default {host}, or $DEV_TEAM_OFFICE_HOST)
  --socket <path>   Unix socket of the API (default ~/.dev-team-office/office.sock)
  --no-socket       Do not open the Unix socket
  --agent <id|cli>  The agent opened in herdr on start (default: the one in the settings)
  --no-launch       Do not open any agent in herdr on start
  --no-monitor      Inside herdr, the log instead of the monitor
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
    noAgents: '(no registered agents)  →  dev-team-office agents add <full path> --agent claude|opencode|pi|codex', openSession: ' · ● session open',
    promptUsage: 'Usage: dev-team-office prompt <id> "<text>" [--pipeline <entry>] [--new]   (the ids: dev-team-office agents)',
    unknownCommand: 'Unknown command: {cmd}',
    offices: 'Offices:', officeLine: '  {id}  {name}  · {tz}{country}  · {agents} agent(s){viewing}', viewing: '  ← the one being viewed',
    officeAdded: 'Office created: {id}  ({name}, {tz})', officeSaved: 'Office updated: {id}', agentSaved: 'Project updated: {id}', agentsUsage: 'Usage: dev-team-office agents [add <full path> --agent … | set <id> | rm <id>] [--name …] [--office …] [--instructions …]', characterUsage: 'Usage: dev-team-office character export <role> [--office <id>] [--out <file>]  ·  character import <file.json> [--role <role>] [--office <id>]', characterRole: 'Which role is it for? Add --role qa|backend|frontend|tl|manager|analyst|designer|po', characterExported: '{name} exported to {file}', characterImported: '{name} is now the {role} of {office}', officeRemoved: 'Office deleted: {id} (its agents moved to the main one)',
    officesUsage: 'Usage: dev-team-office offices [add "<name>" | set <id> | rm <id>] [--name …] [--timezone …] [--location …]',
    config: 'Settings (in {file}):', configSaved: '{key} = {value}', configUnknown: 'Unknown setting: {key}. See: dev-team-office config',
    paneUsage: 'Usage: dev-team-office pane [--role qa] [--title "tests"] [--agent pi|claude|opencode|codex] -- <command or prompt>',
    teams: 'Teams:', teamNone: '(no team packs shipped)',
    teamUsage: 'Usage: dev-team-office team [list] | dev-team-office team install <team> --agent <pi|claude|opencode|codex> [--project <dir>] [--from <packsRoot>]',
    btwUsage: 'Usage: dev-team-office btw "<question>" [--office <id>]', btwAsking: '❓ asking {agent}…',
    updateGit: 'Updating the git clone at {dir} (git pull --ff-only)…',
    updateGitFailed: 'Could not update {dir} with git pull --ff-only (local changes, or another branch?): update it by hand, then dev-team-office restart',
    replaced: 'The office {old} that was running was replaced by this one ({version})',
    alreadyRunning: 'The office {version} is already running at {url} (pid {pid})',
    started: 'Office {version} started in the background at {url} (pid {pid}) · dev-team-office stop stops it',
    startFailed: 'The office did not start: see {log}', stopped: 'Office {version} stopped (pid {pid})', notRunning: 'No office is running at {base}',
    restarted: 'Office {version} restarted at {url} (pid {pid})',
    refreshed: 'The running office was restarted: {old} → {version} ({url}). The game open in the browser reloads by itself (one from 0.8.1 or older says so in its terminal: reload it then).',
    refreshTerminal: 'The office {old} that was open in a terminal was closed so that {version} is the one serving: open it again there with dev-team-office',
    refreshFailed: 'Could not restart the running office ({version}): {error} · use dev-team-office restart',
    paneOpened: '{pane}', paneOffline: '(the office is not running: the pane opened, but it does not show up in the game)',
  },
  install: {
    unknown: 'unknown: {names} (use pi, opencode, claude or codex)', lib: 'Shared library at {path}', configSkill: 'Configuration skill at {path}',
    configSkillFail: 'Could not copy the configuration skill: {error} · the rest installs anyway',
    skill: 'Skill at {path}', skillFail: 'Could not copy a skill: {error} · the rest installs anyway',
    pi: 'Pi: extension at {ext} and skill at {skill}/', piHint: '    Open pi in your project: it starts the office if needed and registers the project (/office in Pi).',
    opencode: 'OpenCode: plugin at {plugin}', opencodeHint: '    Open opencode in your project: it connects to the office by itself.',
    claude: 'Claude Code: hook at {hook}', claudeStep: '    One step left for you: copy the "hooks" section of {snippet}', claudeWhere: '    into ~/.claude/settings.json (or the project\'s .claude/settings.json).',
    codex: 'Codex: hook at {hook}',
  },
  btw: {
    empty: 'btw what? Write the question after btw', busy: 'The agent on duty is still answering the previous question',
    noAgent: 'No agent on duty in this office: open a session or register a project (⚙ › Agents)',
    timeout: 'It took too long to answer', noAnswer: 'The agent did not answer (exit {code})',
    ctxOffice: 'Office (team/domain): {office}', ctxTask: 'Current task: {task}', ctxTurn: 'On duty now: {role}', ctxRecent: 'Latest activity:',
    ctxProject: 'Project: {project} ({dir})', ctxRole: 'The question is for {who}, of the team: answer as them, about what they are doing in this project and its current task.',
    ctxPlan: 'Plan:', ctxSubagents: 'Their subagents at work:',
    promptHead: '[btw] A side question from the Dev Team Office game. Do not change any file and do not continue your current task: just answer.',
    promptQuestion: 'Question: {question}',
    promptRules: 'Answer briefly (at most 3 short sentences, plain text, no markdown headings), in {lang}.',
    // the character's style (⚙ › Characters): how they answer
    rules: {
      concise: 'Answer in one or two short sentences, straight to the point, plain text, in {lang}.',
      explanatory: 'Answer explaining the why, with a concrete example from the project if it helps (up to 8 sentences, plain text, no markdown headings), in {lang}.',
      teacher: 'Answer as a patient teacher to someone learning: step by step, the concepts behind it and what to try next to understand it (up to 10 sentences, plain text, no markdown headings), in {lang}.',
      formal: 'Answer formally and precisely, as in a work report (at most 4 sentences, plain text), in {lang}.',
    },
  },
  setup: {
    title: 'Dev Team Office {version} · setup',
    unknown: 'unknown agent: {names} (use {known})',
    badJson: '{file} is not valid JSON ({error}): left untouched',
    manualMcp: 'Could not add the MCP server to {file} safely: add "dev-team-office" under "mcp" by hand (see docs/mcp.md)',
    piMcp: 'Pi uses the MCP server from 1.0 on (or with pi-mcp-adapter); an older Pi just needs the extension.',
    codexTrust: 'Codex asks you to trust new hooks once: open codex and run /hooks.',
    appCopied: 'App installed at {path}',
    launcher: 'Launcher at {path} (the hooks and the MCP server use it)',
    linked: 'Command `dev-team-office` at {path}',
    linkedNotInPath: 'Command `dev-team-office` at {path} · add {dir} to your PATH (e.g. export PATH="{dir}:$PATH")',
    otherOnPath: 'Another `dev-team-office` comes first in your PATH ({path}): that one is what your terminal runs',
    agentLine: '✓ {agent}: {what}',
    viaPlugin: 'installed as a Claude Code plugin (hooks, MCP and skills come with it)',
    noAgents: 'No coding agents found (Pi, Claude Code, OpenCode, Codex, Gemini, Cursor). Install one and run `dev-team-office setup` again.',
    removedLine: '✓ {agent}: removed {what}',
    removedPath: '✓ removed {path}',
    removedProfile: '✓ removed our PATH line from {file}',
    profileAsk: 'Add {dir} to your PATH in {file}, so new terminals find `dev-team-office`?',
    profileAdded: '✓ {file}: new terminals will find `dev-team-office`',
    keptData: '· kept your data in {path} (projects, offices, settings): --purge deletes it too',
    nothing: 'Nothing to remove.',
    done: 'Ready. Open the office with: dev-team-office   ·   check it with: dev-team-office doctor',
    doneNewTerminal: 'Ready. Open a new terminal and run: dev-team-office   ·   right now, in this one: {cmd}',
    doneFullPath: 'Ready. Open the office with: {cmd}   ·   to type just dev-team-office, add {dir} to your PATH',
    dryDone: 'Dry run: nothing was written.',
    part: { integration: 'integration', hooks: 'hooks', mcp: 'MCP server', skills: 'skills' },
  },
  doctor: {
    title: 'Dev Team Office {version} · doctor',
    node: 'Node.js {v}', nodeFix: 'Node.js >= 22.13 is needed (it brings SQLite): https://nodejs.org',
    launcher: 'Launcher {path}', onPath: '`dev-team-office` in the PATH ({path})', notOnPath: '`dev-team-office` is not in the PATH',
    pathFix: 'add {dir} to your PATH, or run: dev-team-office setup',
    running: 'The office is running at {url} ({version})', stopped: 'The office is not running ({url}) · open it with `dev-team-office`',
    herdr: 'herdr available (agents open in panes)', noHerdr: 'herdr not found (optional: agents in panes)',
    agent: '{agent}: {what}',
    ok: 'All good.', fail: 'Something is missing: run the suggested command.',
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
