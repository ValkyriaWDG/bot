const byId = (id) => document.getElementById(id);
const text = (id, value) => {
  byId(id).textContent = String(value);
};
const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
let report;
let selected;

function selectScenario(id) {
  const scenario = report.scenarios.find((item) => item.id === id) || report.scenarios[0];
  if (!scenario) return;
  selected = scenario.id;
  history.replaceState(null, '', `#${encodeURIComponent(selected)}`);
  text('scenario-title', scenario.title);
  text('scenario-description', scenario.description);
  const passed = scenario.status === 'passed' && scenario.checks.every((check) => check.passed);
  text('scenario-status', passed ? '✓ PASSED' : '× FAILED');
  byId('scenario-status').classList.toggle('bad', !passed);
  byId('scenario-select').value = selected;
  for (const link of document.querySelectorAll('.scenario-link'))
    link.setAttribute('aria-current', String(link.dataset.scenario === selected));
  const messages = byId('messages');
  messages.replaceChildren();
  for (const message of scenario.messages) {
    const item = node('div', `message ${message.speaker}`);
    item.append(
      node(
        'div',
        'avatar',
        message.speaker === 'bot'
          ? 'VK'
          : message.speaker === 'system'
            ? '•'
            : message.displayName.slice(0, 2).toUpperCase(),
      ),
    );
    const body = node('div', 'message-body');
    const author = node('div', 'message-author');
    author.append(node('strong', '', message.displayName));
    if (message.speaker === 'bot') author.append(node('span', 'tag', 'SIM BOT'));
    if (message.locale) author.append(node('span', 'locale', message.locale.toUpperCase()));
    body.append(author);
    if (message.command) body.append(node('div', 'message-command', message.command));
    if (message.content && message.content !== message.command)
      body.append(node('div', 'message-content', message.content));
    if (message.buttons?.length) {
      const buttons = node('div', 'message-buttons');
      for (const label of message.buttons) buttons.append(node('span', '', label));
      body.append(buttons);
    }
    if (message.speaker === 'bot')
      body.append(node('div', 'privacy', 'Private response · recorded interaction output'));
    item.append(body);
    messages.append(item);
  }
  if (!scenario.messages.length)
    messages.append(
      node(
        'div',
        'message-content empty-note',
        'This scenario verifies service state. See the checks and observations.',
      ),
    );
  const checks = byId('checks');
  checks.replaceChildren();
  for (const check of scenario.checks) {
    const item = node('li', `check ${check.passed ? '' : 'failed'}`);
    item.append(node('strong', '', check.label));
    if (check.details)
      item.append(
        node(
          'p',
          '',
          typeof check.details === 'string' ? check.details : JSON.stringify(check.details),
        ),
      );
    checks.append(item);
  }
  const observations = byId('observations');
  observations.replaceChildren();
  for (const [key, value] of Object.entries(scenario.observations)) {
    const item = node('div', 'observation');
    item.append(
      node('div', 'observation-label', key.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()),
      node('pre', '', JSON.stringify(value, null, 2)),
    );
    observations.append(item);
  }
  document.title = `${scenario.title} · Valkyria Bot Lab · Simulation`;
}

function filterScenarios(query = '') {
  const list = byId('scenario-list');
  list.replaceChildren();
  for (const scenario of report.scenarios.filter((item) =>
    `${item.title} ${item.id}`.toLowerCase().includes(query.toLowerCase()),
  )) {
    const link = node(
      'button',
      `scenario-link ${scenario.status !== 'passed' || scenario.checks.some((check) => !check.passed) ? 'failed' : ''}`,
      scenario.title,
    );
    link.type = 'button';
    link.dataset.scenario = scenario.id;
    link.setAttribute('aria-current', String(scenario.id === selected));
    link.append(node('span', 'result-dot'));
    link.addEventListener('click', () => selectScenario(scenario.id));
    list.append(link);
  }
}

async function start() {
  try {
    const response = await fetch('/report.json');
    if (!response.ok) throw new Error('report unavailable');
    report = await response.json();
    if (
      report.schemaVersion !== 1 ||
      report.evidenceKind !== 'simulated-discord' ||
      !report.scenarios?.length
    )
      throw new Error('invalid report');
    const passed = report.scenarios.filter(
      (scenario) => scenario.status === 'passed' && scenario.checks.every((check) => check.passed),
    ).length;
    const total = report.scenarios.length;
    text('total', total);
    text('passed', passed);
    text('failed', total - passed);
    text('nav-count', total);
    text('run-status', passed === total ? '✓ ALL SCENARIOS PASSED' : '× FAILURES NEED ATTENTION');
    byId('run-status').classList.toggle('bad', passed !== total);
    const revision = String(report.sourceRevision || 'unavailable').slice(0, 12);
    text(
      'run-revision',
      `${revision}${report.sourceDirty ? ' · DIRTY WORKTREE' : ' · CLEAN SOURCE'}`,
    );
    text('generated-at', `Captured run: ${report.generatedAt} · ${report.environment.database}`);
    for (const scenario of report.scenarios) {
      const option = node('option', '', scenario.title);
      option.value = scenario.id;
      byId('scenario-select').append(option);
    }
    selected = decodeURIComponent(location.hash.slice(1));
    filterScenarios();
    selectScenario(selected);
    globalThis.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (report.scenarios.some((scenario) => scenario.id === id)) selectScenario(id);
    });
    byId('search').addEventListener('input', (event) => filterScenarios(event.target.value));
    byId('scenario-select').addEventListener('change', (event) =>
      selectScenario(event.target.value),
    );
    byId('workspace').hidden = false;
  } catch {
    text('run-status', 'REPORT UNAVAILABLE');
    byId('run-status').classList.add('bad');
    text(
      'load-error',
      'No valid scenario report is available. Run pnpm lab:run, then reload this viewer. No results have been invented.',
    );
    byId('load-error').hidden = false;
  }
}
void start();
