# E2E tests: watch them as they run

**English** · [Español](e2e.es.md)

When an agent runs **Playwright** tests, a **small screen** shows up in the game's bottom right corner: the project, how the run is going (✓ passed, ✗ failed, ◌ running, of how many), the test and the step it is on (*agregar al carrito › Click*), and the last frame of the browser, with **LIVE** while it runs. QA does it in the game: they announce the run, shake when a test fails and celebrate (or get stuck) when it ends. Click the screen (or press `e`) and it **expands**:

- **the run's tests**, each with how it ended and how long it took; it follows the live one until you pick another (▶ Follow live takes you back);
- **its movie**, taken from its trace: the browser's frames, with **a dot where it clicked or typed**, the action's caption (`Click · getByRole('button', { name: 'Pagar' })`), a timeline with a mark per action (red, the one that failed), play/pause and speed;
- **its steps** (navigate, fill, click, expect, your `test.step`s), with their timing and **the error where it happened**; click one to go to that moment;
- **its video** and **its screenshots**, when the config records them.

Nothing to set up: `setup` installs the office's Playwright reporter and every agent's session gets it (`$PW_TEST_REPORTER`, which Playwright adds **next to** the project's reporters, never instead of them). It never gets in the way of the tests: it prints nothing, and if the office is not running it stops trying. The movie needs the trace: run `npx playwright test --trace=on`, or **`dev-team-office e2e -- npx playwright test`**, which turns it on for you (a script like `npm run e2e` goes as it is: its config decides). The office reads only files inside the folder where the tests run, copies them before the next run clears them, and keeps the last 6 runs. Other runners (Cypress, Selenium) are not watched yet. API in [docs/api.md](api.md#e2e-tests-watched).

The command (`dev-team-office e2e -- <command>`) and the rest of the CLI are in the [usage guide](usage.md#the-full-cli).
