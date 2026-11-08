// Runs the real app.js against a minimal DOM stub and drives it the way a user
// does: fire the file input, then submit prompts through the form.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function createElement(id) {
  const listeners = {};
  return {
    id, options: [], selected: '', hidden: false, disabled: false, dataset: {}, style: {},
    textContent: '', innerHTML: '', title: '', listeners,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
    setAttribute() {}, focus() {}, scrollIntoView() {}, querySelector() { return null; },
    add(option) { this.options.push(option); if (this.options.length === 1) this.selected = option.value; },
    replaceChildren(...options) { this.options = options; this.selected = options[0]?.value ?? ''; },
    get value() { return this.selected; },
    set value(next) {
      // A real <select> ignores values that have no matching option.
      this.selected = !this.options.length || this.options.some((option) => option.value === next) ? next : '';
    },
  };
}

function bootDashboard({ navigator } = {}) {
  // Only ids that exist in index.html (or are created at runtime) resolve, as in the browser.
  const pageIds = new Set([...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const elements = {};
  const element = (id) => {
    if (!pageIds.has(id) && !/^extra-chart-\d+$/.test(id)) throw new Error(`#${id} is not in index.html`);
    return (elements[id] ||= createElement(id));
  };
  const context = {
    console, setTimeout, clearTimeout,
    Option: function Option(label, value) { this.label = label; this.value = value; },
    localStorage: { getItem() { return null; }, setItem() {} },
    requestAnimationFrame: (callback) => callback(),
    navigator: navigator || { language: 'en-IN' },
    document: { getElementById: element, querySelector: () => createElement('stub'), addEventListener() {}, body: createElement('body') },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['parser.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });

  return {
    element,
    async upload(name, text) {
      const file = { name, size: text.length, text: async () => text };
      element('file-input').listeners.change[0]({ target: { files: [file], value: '' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    prompt(text) {
      element('prompt-input').value = text;
      element('prompt-form').listeners.submit[0]({ preventDefault() {} });
    },
  };
}

module.exports = { bootDashboard };
