/* ------------------------------------------------------------------
   WebMCP tools for the Tech Labs application form.

   Exposes the things a person can do on this page as tools an AI agent
   can call, so it does not have to guess which button to click.
   The tools use the very same form logic (window.cvForm), so the screen
   always shows what the agent did.

   Guide: https://developer.chrome.com/docs/ai/webmcp
------------------------------------------------------------------- */

const cv = window.cvForm;   // the small API exposed by app.js


/* ==================================================================
   1. Helpers
================================================================== */

const ok = (summary, data = {}) => ({ ok: true, summary, ...data });
const fail = (error, hint) => ({ ok: false, error, hint });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'];

// Accepts "2021-03", "2021/3", "March 2021", "mar 2021" or "2021".
// Returns the "YYYY-MM" value the <input type="month"> needs, or null.
function toMonth(value) {
  const text = String(value).trim().toLowerCase();
  const pad = (month) => String(month).padStart(2, '0');

  const numeric = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (numeric) return `${numeric[1]}-${pad(numeric[2])}`;

  const named = text.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (named) {
    const index = MONTHS.findIndex(month => month.startsWith(named[1].slice(0, 3)));
    if (index >= 0) return `${named[2]}-${pad(index + 1)}`;
  }

  if (/^\d{4}$/.test(text)) return `${text}-01`;
  return null;
}

// Accepts "example.com" as well as a full URL.
function toUrl(value) {
  const text = String(value).trim();
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withProtocol).href;
  } catch {
    return null;
  }
}

// Reuses the last card of a list when it is still empty, so the agent
// never leaves a blank entry behind the one it just filled in.
function entryFor(type) {
  const last = document.getElementById(`${type}-list`).lastElementChild;
  if (!last) return cv.addEntry(type);

  const hasContent = Array.from(last.querySelectorAll('input:not([type="checkbox"]), textarea'))
    .some(field => field.value.trim() !== '');

  return hasContent ? cv.addEntry(type) : last;
}

// Every write tool ends the same way: show the change and report the state.
function applied(summary, element, extra = {}) {
  cv.reveal(element);
  return ok(summary, { ...extra, missing: cv.missingFields() });
}

const DATE_HINT = 'Use "YYYY-MM" (for example "2021-03"), "March 2021" or "2021".';

// List name -> id of the section that contains it.
const SECTION_OF = { experience: 'experience', education: 'education', link: 'links', language: 'languages' };


/* ==================================================================
   2. Tool catalog
================================================================== */

const tools = [

  {
    name: 'get_form_state',
    title: 'Read the application form',
    description: 'Returns what the candidate profile form contains right now and which required fields are still missing.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'string',
          enum: ['summary', 'full'],
          description: '"full" also returns every value already typed into the form.'
        }
      }
    },
    annotations: { readOnlyHint: true },
    execute: ({ include = 'summary' }) => {
      const data = cv.collectData();
      const counts = {
        experience: data.experience.length,
        education: data.education.length,
        links: data.links.length,
        skills: data.skills.length,
        languages: data.languages.length
      };
      const missing = cv.missingFields();

      return ok(
        missing.length === 0
          ? 'The form is complete and ready to be sent.'
          : `The form still needs ${missing.length} field(s).`,
        {
          candidate: data.personal.fullName || '(no name yet)',
          counts,
          missing,
          consentGiven: cv.isConsentGiven(),
          data: include === 'full' ? data : undefined
        }
      );
    }
  },

  {
    name: 'set_personal_details',
    title: 'Fill in the personal details',
    description: 'Writes the personal details of the candidate. Only the fields you send are changed, the rest keep their value.',
    inputSchema: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'Full name of the candidate.' },
        headline: { type: 'string', description: 'Professional headline, e.g. "Senior Full Stack Engineer".' },
        email: { type: 'string', description: 'Contact email.' },
        phone: { type: 'string' },
        city: { type: 'string' },
        country: { type: 'string' },
        workSetup: { type: 'string', enum: ['onsite', 'hybrid', 'remote'] },
        yearsOfExperience: { type: 'integer', minimum: 0, maximum: 60 },
        summary: { type: 'string', description: 'Two or three lines about the profile. Max 400 characters.' }
      }
    },
    execute: (input) => {
      if (Object.keys(input).length === 0) {
        return fail('No values received.', 'Send at least one field, for example { "fullName": "Ada Lovelace" }.');
      }

      const section = document.getElementById('personal');
      const unknown = cv.setFields(section, input);
      const written = Object.keys(input).filter(key => !unknown.includes(key));

      return applied(`Updated ${written.length} personal field(s): ${written.join(', ')}.`,
        section, { written, ignored: unknown });
    }
  },

  {
    name: 'add_work_experience',
    title: 'Add a position',
    description: 'Adds one position to the work experience section. Call it once per job, most recent first.',
    inputSchema: {
      type: 'object',
      properties: {
        jobTitle: { type: 'string' },
        company: { type: 'string' },
        employmentType: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship'] },
        location: { type: 'string', description: 'City and country of the job.' },
        startDate: { type: 'string', description: 'When the job started. "2021-03", "March 2021" or "2021".' },
        endDate: { type: 'string', description: 'When it ended. Leave it out when the job is the current one.' },
        current: { type: 'boolean', description: 'True when the candidate still works there.' },
        description: { type: 'string', description: 'Responsibilities and achievements.' }
      },
      required: ['jobTitle', 'company', 'startDate']
    },
    execute: (input) => {
      const startDate = toMonth(input.startDate);
      if (!startDate) return fail(`"${input.startDate}" is not a valid start date.`, DATE_HINT);

      const endDate = input.endDate ? toMonth(input.endDate) : '';
      if (input.endDate && !endDate) return fail(`"${input.endDate}" is not a valid end date.`, DATE_HINT);

      const entry = entryFor('experience');
      cv.setFields(entry, {
        jobTitle: input.jobTitle,
        company: input.company,
        employmentType: input.employmentType || 'full-time',
        location: input.location || '',
        startDate,
        endDate: input.current ? '' : endDate,
        current: Boolean(input.current),
        description: input.description || ''
      });

      const position = cv.countEntries('experience');
      return applied(`Position ${position} saved: ${input.jobTitle} at ${input.company}.`,
        entry, { position });
    }
  },

  {
    name: 'add_education',
    title: 'Add a study',
    description: 'Adds one degree, bootcamp or certification to the education section.',
    inputSchema: {
      type: 'object',
      properties: {
        degree: { type: 'string', description: 'e.g. "BSc Computer Science".' },
        institution: { type: 'string' },
        fieldOfStudy: { type: 'string' },
        grade: { type: 'string' },
        startDate: { type: 'string', description: '"2014-09", "September 2014" or "2014".' },
        endDate: { type: 'string' },
        current: { type: 'boolean', description: 'True when the candidate is still studying there.' }
      },
      required: ['degree', 'institution', 'startDate']
    },
    execute: (input) => {
      const startDate = toMonth(input.startDate);
      if (!startDate) return fail(`"${input.startDate}" is not a valid start date.`, DATE_HINT);

      const endDate = input.endDate ? toMonth(input.endDate) : '';
      if (input.endDate && !endDate) return fail(`"${input.endDate}" is not a valid end date.`, DATE_HINT);

      const entry = entryFor('education');
      cv.setFields(entry, {
        degree: input.degree,
        institution: input.institution,
        fieldOfStudy: input.fieldOfStudy || '',
        grade: input.grade || '',
        startDate,
        endDate: input.current ? '' : endDate,
        current: Boolean(input.current)
      });

      const position = cv.countEntries('education');
      return applied(`Education ${position} saved: ${input.degree} at ${input.institution}.`,
        entry, { position });
    }
  },

  {
    name: 'add_link',
    title: 'Add a link',
    description: 'Adds a profile or portfolio link, such as LinkedIn or GitHub.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Name of the site, e.g. "GitHub".' },
        url: { type: 'string', description: 'Full URL. "github.com/ada" also works.' }
      },
      required: ['label', 'url']
    },
    execute: (input) => {
      const url = toUrl(input.url);
      if (!url) return fail(`"${input.url}" is not a valid URL.`, 'Send something like "https://github.com/ada".');

      const entry = entryFor('link');
      cv.setFields(entry, { label: input.label, url });

      return applied(`Link saved: ${input.label} → ${url}.`, entry, { url });
    }
  },

  {
    name: 'set_skills',
    title: 'Add or replace the skills',
    description: 'Adds skills to the list. With mode "replace" it clears the current skills first.',
    inputSchema: {
      type: 'object',
      properties: {
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skill names, e.g. ["React", "Node.js", "PostgreSQL"].'
        },
        mode: { type: 'string', enum: ['add', 'replace'], description: 'Default "add".' }
      },
      required: ['skills']
    },
    execute: ({ skills, mode = 'add' }) => {
      if (!Array.isArray(skills) || skills.length === 0) {
        return fail('The "skills" list is empty.', 'Send an array such as ["React", "Node.js"].');
      }

      if (mode === 'replace') cv.getSkills().forEach(skill => cv.removeSkill(skill));
      skills.forEach(skill => cv.addSkill(skill));

      const current = cv.getSkills();
      return applied(`The candidate now has ${current.length} skill(s).`,
        document.getElementById('skills'), { skills: current });
    }
  },

  {
    name: 'add_language',
    title: 'Add a language',
    description: 'Adds a spoken language with its level.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'e.g. "English".' },
        level: { type: 'string', enum: ['basic', 'intermediate', 'advanced', 'native'] }
      },
      required: ['language']
    },
    execute: (input) => {
      const entry = entryFor('language');
      cv.setFields(entry, { language: input.language, level: input.level || 'intermediate' });

      return applied(`Language saved: ${input.language} (${input.level || 'intermediate'}).`, entry);
    }
  },

  {
    name: 'remove_entry',
    title: 'Remove an entry',
    description: 'Deletes one card from a repeatable section, counting from 1 as shown on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['experience', 'education', 'link', 'language'] },
        position: { type: 'integer', minimum: 1, description: 'Card number, starting at 1.' }
      },
      required: ['section', 'position']
    },
    execute: ({ section, position }) => {
      const total = cv.countEntries(section);
      if (position > total) {
        return fail(`There is no entry ${position} in "${section}".`,
          total === 0 ? `The section "${section}" is empty.` : `Valid positions: 1 to ${total}.`);
      }

      cv.removeEntryAt(section, position - 1);
      return applied(`Entry ${position} removed from "${section}".`,
        document.getElementById(SECTION_OF[section]),
        { remaining: cv.countEntries(section) });
    }
  },

  {
    name: 'submit_application',
    title: 'Send the application',
    description: 'Sends the finished application to Tech Labs. The person must tick the consent checkbox first; this tool never ticks it. Once sent, the form is replaced by a confirmation screen.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      if (!cv.isConsentGiven()) {
        return fail('The consent checkbox is not ticked.',
          'Ask the person to tick "I agree that Tech Labs stores this data for 12 months", then call this tool again.');
      }

      const result = cv.submitApplication();
      if (!result.ok) {
        return fail('The form is not complete yet.', `Missing: ${result.problems.join(', ')}.`);
      }

      return ok(`Application sent for ${result.payload.personal.fullName}.`, { payload: result.payload });
    }
  }
];


/* ==================================================================
   3. Banner: shows which tool the agent is using
================================================================== */

const banner = {
  box: document.getElementById('tool-banner'),
  label: document.getElementById('tool-banner-label'),
  name: document.getElementById('tool-banner-name'),
  text: document.getElementById('tool-banner-text')
};

let runningTools = 0;
let hideBannerTimer = null;

function bannerStart(tool) {
  runningTools++;
  clearTimeout(hideBannerTimer);

  show('running',
    tool.annotations?.readOnlyHint ? 'AI agent is reading' : 'AI agent is using',
    tool.name,
    tool.title);
}

function bannerEnd(tool, result) {
  runningTools--;
  if (runningTools > 0) return;              // another tool is still working

  show(result.ok ? 'ok' : 'error',
    result.ok ? 'Done' : 'Failed',
    tool.name,
    result.summary || result.error || '');

  hideBannerTimer = setTimeout(() => { banner.box.hidden = true; }, 5000);
}

function show(status, label, name, text) {
  banner.box.hidden = false;
  banner.box.className = `tool-banner ${status}`;
  banner.label.textContent = label;
  banner.name.textContent = name;
  banner.text.textContent = text;
}


/* ==================================================================
   4. Registration adapter
================================================================== */

const state = { supported: false, api: null, registered: 0, failed: [], error: null };
let controller = null;

// Single entry point for every call: announces the tool in the banner and
// turns a failure into an explained answer, never into an exception.
const shield = (tool) => async (input, options) => {
  bannerStart(tool);
  let result;

  try {
    result = await tool.execute(input || {}, options || {});
  } catch (error) {
    result = fail(error.message || String(error), `Tool: ${tool.name}.`);
  }

  bannerEnd(tool, result);
  return result;
};

// The API moved from navigator to document, so detect the method.
function findContext() {
  if (typeof document.modelContext?.registerTool === 'function') {
    return { modelContext: document.modelContext, api: 'document.modelContext' };
  }
  if (typeof navigator.modelContext?.registerTool === 'function') {
    return { modelContext: navigator.modelContext, api: 'navigator.modelContext (deprecated)' };
  }
  return null;
}

async function register() {
  if (state.registered) return state;          // registering twice is an error

  const context = findContext();
  state.supported = Boolean(context);

  if (!context) {
    state.error = window.isSecureContext
      ? 'This browser does not expose the WebMCP API yet.'
      : 'WebMCP needs a secure context: HTTPS or localhost.';
  } else {
    state.api = context.api;
    state.error = null;
    state.failed = [];
    controller = new AbortController();

    for (const tool of tools) {
      try {
        await context.modelContext.registerTool({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations || {},
          execute: shield(tool)
        }, { signal: controller.signal });
        state.registered++;
      } catch (error) {
        state.failed.push({ name: tool.name, reason: error.message });
      }
    }
  }

  showStatus();
  return state;
}

function unregister() {
  controller?.abort();                          // this is how tools are removed
  controller = null;
  state.registered = 0;
  showStatus();
  return state;
}

// Same tools without a compatible browser: handy for testing and extensions.
const bridge = {
  list: () => tools.map(({ execute, ...descriptor }) => descriptor),
  call: (name, input) => {
    const tool = tools.find(item => item.name === name);
    return tool
      ? shield(tool)(input, {})
      : Promise.resolve(fail(`There is no tool called "${name}".`,
          `Available tools: ${tools.map(item => item.name).join(', ')}.`));
  }
};


/* ==================================================================
   5. Start
================================================================== */

function showStatus() {
  const badge = document.getElementById('webmcp-status');

  badge.textContent = state.registered
    ? `${state.registered} AI tools ready`
    : 'AI tools unavailable';

  badge.classList.toggle('on', state.registered > 0);
  badge.title = state.error || `Registered through ${state.api}`;
}

register();   // static registration: once, when the page loads

// Exposed so you can try the tools from the console:
//   webmcp.bridge.call('set_personal_details', { fullName: 'Ada Lovelace' })
window.webmcp = { tools, state, register, unregister, bridge };
