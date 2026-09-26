const $ = (selector) => document.querySelector(selector);
function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = String(text);
  if (className) item.className = className;
  return item;
}
function renderBody(body, privateReply = false) {
  const root = node('div');
  if (privateReply) root.append(node('p', 'EPHEMERAL / recorded private reply', 'private'));
  if (body.content) root.append(node('p', body.content, 'content'));
  for (const embed of body.embeds ?? []) {
    const panel = node('div', undefined, 'embed');
    if (embed.title) panel.append(node('h3', embed.title));
    if (embed.description) panel.append(node('p', embed.description));
    const fields = node('div', undefined, 'embed-fields');
    for (const field of embed.fields ?? []) {
      const value = node('div', undefined, 'field');
      value.append(node('strong', field.name), node('p', field.value));
      fields.append(value);
    }
    panel.append(fields);
    if (embed.footer?.text) panel.append(node('div', embed.footer.text, 'embed-footer'));
    root.append(panel);
  }
  const buttons = node('div', undefined, 'buttons');
  for (const row of body.components ?? [])
    for (const component of row.components ?? []) {
      const button = node('button', component.label || 'Button');
      button.disabled = true;
      button.title = 'Recorded preview only; no Discord or website action';
      buttons.append(button);
    }
  root.append(buttons);
  return root;
}
async function start() {
  const response = await fetch('/extensions-report.json');
  if (!response.ok) throw new Error('Run pnpm lab:extensions before opening this viewer.');
  const report = await response.json();
  if (
    report.evidenceKind !== 'simulated-discord-extensions' ||
    report.executionStatus !== 'completed' ||
    !report.scenarios?.length
  )
    throw new Error('The extension report is incomplete. Regenerate it.');
  const failed = report.scenarios.flatMap((s) => s.checks).filter((c) => !c.passed).length;
  $('#run-status').textContent = failed ? 'FAILURES RECORDED' : 'OFFLINE CHECKS PASSED';
  if (failed) $('#run-status').classList.add('failed');
  $('#total').textContent = report.scenarios.length;
  $('#failed').textContent = failed;
  $('#revision').textContent =
    `Source ${report.revision.sha} · ${report.revision.dirty ? 'DIRTY WORKTREE' : 'clean source'}`;
  $('#generated').textContent = `Recorded ${report.generatedAt}`;
  const select = $('#scenario');
  for (const scenario of report.scenarios) {
    const option = node('option', `${scenario.locale.toUpperCase()} · ${scenario.title}`);
    option.value = scenario.id;
    select.append(option);
  }
  function show() {
    const scenario = report.scenarios.find((s) => s.id === select.value);
    $('#locale').textContent = scenario.locale.toUpperCase();
    $('#scenario-title').textContent = scenario.title;
    const passed = scenario.checks.every((c) => c.passed) && scenario.status === 'passed';
    $('#scenario-status').textContent = passed
      ? 'PASSED / recorded assertions'
      : 'FAILED / inspect assertions';
    $('#scenario-status').classList.toggle('failed', !passed);
    $('#messages').replaceChildren();
    const payload = scenario.payloads.at(-1);
    if (payload) $('#messages').append(renderBody(payload.body));
    for (const reply of scenario.responses) $('#messages').append(renderBody(reply, true));
    $('#checks').replaceChildren(
      ...scenario.checks.map((check) => node('li', check.label, check.passed ? '' : 'failed')),
    );
    $('#observations').textContent = JSON.stringify(
      { observations: scenario.observations, requests: scenario.requests },
      null,
      2,
    );
    history.replaceState(null, '', `/extensions#${encodeURIComponent(scenario.id)}`);
  }
  select.addEventListener('change', show);
  const fromLocation = () => {
    const desired = decodeURIComponent(location.hash.slice(1));
    if (report.scenarios.some((s) => s.id === desired)) select.value = desired;
    show();
  };
  window.addEventListener('hashchange', fromLocation);
  fromLocation();
}
start().catch((error) => {
  $('#run-status').textContent = 'REPORT UNAVAILABLE';
  $('#error').textContent = error.message;
});
