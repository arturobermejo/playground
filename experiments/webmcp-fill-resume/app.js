/* ------------------------------------------------------------------
   Tech Labs — candidate profile form
   One single page split into sections, with repeatable blocks
   (links, experience, education, languages) built from HTML templates.
------------------------------------------------------------------- */

const form = document.getElementById('cv-form');
const summaryLine = document.getElementById('summary-line');

let skills = [];   // skills are kept in an array, not in inputs


/* ==================================================================
   1. Repeatable blocks (link, experience, education, language)
================================================================== */

// Each "+ Add" button says which template it should clone.
document.querySelectorAll('[data-add]').forEach(button => {
  button.addEventListener('click', () => addEntry(button.dataset.add));
});

function addEntry(type) {
  const template = document.getElementById(`${type}-template`);
  const list = document.getElementById(`${type}-list`);

  list.appendChild(template.content.cloneNode(true));
  const entry = list.lastElementChild;

  // Remove button
  entry.querySelector('.btn-remove').addEventListener('click', () => {
    entry.remove();
    refreshList(type);
  });

  // "I currently work / study here" disables the end date
  const currentToggle = entry.querySelector('[data-toggle="current"]');
  if (currentToggle) {
    currentToggle.addEventListener('change', () => {
      const endDate = entry.querySelector('[name="endDate"]');
      endDate.disabled = currentToggle.checked;
      if (currentToggle.checked) endDate.value = '';
    });
  }

  refreshList(type);

  // Focus the new entry, but not while the page is still loading.
  const firstInput = entry.querySelector('input, select, textarea');
  if (firstInput && document.readyState === 'complete') firstInput.focus();

  return entry;
}

// Renumber the entry titles and show/hide the empty-state message.
function refreshList(type) {
  const list = document.getElementById(`${type}-list`);
  const emptyMessage = document.querySelector(`[data-empty-for="${type}"]`);
  const entries = Array.from(list.children);

  entries.forEach((entry, i) => {
    const title = entry.querySelector('.entry-title');
    if (title) title.textContent = `${type === 'experience' ? 'Position' : 'Education'} ${i + 1}`;
  });

  if (emptyMessage) emptyMessage.hidden = entries.length > 0;
  updateSummaryLine();
}

function countEntries(type) {
  return document.getElementById(`${type}-list`).children.length;
}


/* ==================================================================
   2. Skills as tags
================================================================== */

const skillInput = document.getElementById('skill-input');
const skillTags = document.getElementById('skill-tags');

skillInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ',') return;
  event.preventDefault();
  addSkill(skillInput.value);
  skillInput.value = '';
});

function addSkill(value) {
  const skill = value.trim();
  if (!skill || skills.includes(skill)) return;

  skills.push(skill);

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = skill;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    skills = skills.filter(item => item !== skill);
    tag.remove();
    updateSummaryLine();
  });

  tag.appendChild(remove);
  skillTags.insertBefore(tag, skillInput);
  updateSummaryLine();
}


/* ==================================================================
   3. Validation
================================================================== */

// Validates one section and returns true when everything is fine.
function validateSection(section) {
  const fields = Array.from(section.querySelectorAll('input, select, textarea'));
  let firstInvalid = null;

  fields.forEach(field => {
    const valid = field.disabled || field.checkValidity();
    field.classList.toggle('invalid', !valid);
    if (!valid && !firstInvalid) firstInvalid = field;
  });

  if (firstInvalid) {
    setSectionError(section, 'Please complete the highlighted fields.');
    return false;
  }

  // Custom rules that HTML validation cannot express
  if (section.id === 'experience' && countEntries('experience') === 0) {
    setSectionError(section, 'Add at least one position.');
    return false;
  }

  if (section.id === 'skills' && skills.length === 0) {
    setSectionError(section, 'Add at least one skill.');
    return false;
  }

  setSectionError(section, '');
  return true;
}

function setSectionError(section, message) {
  let error = section.querySelector('.error-text');

  if (!message) {
    if (error) error.remove();
    return;
  }
  if (!error) {
    error = document.createElement('p');
    error.className = 'error-text';
    section.appendChild(error);
  }
  error.textContent = message;
}

// Lists what is still missing without painting anything (used by the tools).
function missingFields() {
  const problems = Array.from(form.querySelectorAll('[required]'))
    .filter(field => !field.disabled && !field.checkValidity())
    .map(fieldPath);

  if (countEntries('experience') === 0) problems.push('experience: add at least one position');
  if (skills.length === 0) problems.push('skills: add at least one skill');
  return problems;
}

// "experience[2].jobTitle" — a readable address for one field.
function fieldPath(field) {
  const section = field.closest('.section').id;
  const entry = field.closest('.entry');
  if (!entry) return `${section}.${field.name || field.id}`;

  const position = Array.from(entry.parentElement.children).indexOf(entry) + 1;
  return `${section}[${position}].${field.name}`;
}

// Clear the error style as soon as the user fixes a field.
form.addEventListener('input', event => event.target.classList.remove('invalid'));


/* ==================================================================
   4. Reading the data
================================================================== */

// Reads every [name] field inside an element into a plain object.
function readFields(scope) {
  const data = {};
  scope.querySelectorAll('[name]').forEach(field => {
    data[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim();
  });
  return data;
}

function readList(type) {
  return Array.from(document.getElementById(`${type}-list`).children).map(readFields);
}

function collectData() {
  return {
    personal: readFields(document.getElementById('personal')),
    links: readList('link'),
    experience: readList('experience'),
    education: readList('education'),
    skills: skills,
    languages: readList('language')
  };
}


/* ==================================================================
   5. Submit
================================================================== */

form.addEventListener('submit', event => {
  event.preventDefault();
  submitApplication();
});

// Validates every section and, if everything is fine, "sends" the application.
function submitApplication() {
  const sections = Array.from(form.querySelectorAll('.section'));
  const invalidSections = sections.filter(section => !validateSection(section));

  if (invalidSections.length > 0) {
    const first = invalidSections[0];
    first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const field = first.querySelector('.invalid');
    if (field) field.focus({ preventScroll: true });
    return { ok: false, problems: missingFields() };
  }

  const payload = collectData();
  console.log('Submitting application:', payload);

  form.hidden = true;
  document.getElementById('section-nav').hidden = true;
  document.querySelector('.intro').hidden = true;
  document.getElementById('done').hidden = false;
  document.getElementById('payload').textContent = JSON.stringify(payload, null, 2);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  return { ok: true, payload };
}

document.getElementById('restart-btn').addEventListener('click', () => {
  window.location.reload();
});


/* ==================================================================
   6. Section menu: highlight the section you are reading
================================================================== */

const navLinks = Array.from(document.querySelectorAll('.section-nav a'));
const sections = Array.from(document.querySelectorAll('.section'));

function highlightSection() {
  const marker = window.scrollY + 120;   // a bit below the sticky menu

  // The active section is the last one that starts above the marker.
  let active = sections[0];
  sections.forEach(section => {
    if (section.offsetTop <= marker) active = section;
  });

  navLinks.forEach(link => {
    link.classList.toggle('active', link.hash === `#${active.id}`);
  });
}

window.addEventListener('scroll', highlightSection);

/* ==================================================================
   7. Small extras + start
================================================================== */

// Live counters shown next to the submit button.
function updateSummaryLine() {
  summaryLine.textContent = [
    count(countEntries('experience'), 'position', 'positions'),
    count(countEntries('education'), 'study', 'studies'),
    count(skills.length, 'skill', 'skills'),
    count(countEntries('language'), 'language', 'languages')
  ].join(' · ');
}

function count(total, singular, plural) {
  return `${total} ${total === 1 ? singular : plural}`;
}

// Character counter for the summary textarea.
const summary = document.querySelector('[name="summary"]');
const counter = document.querySelector('[data-counter-for="summary"]');
summary.addEventListener('input', () => {
  counter.textContent = `${summary.value.length} / 400`;
});

// Start with one empty entry in each list so the form does not look dead.
['experience', 'education', 'language'].forEach(type => addEntry(type));
['link', 'experience', 'education', 'language'].forEach(type => refreshList(type));
highlightSection();


/* ==================================================================
   8. Small API used by webmcp.js (the AI tools)
================================================================== */

// Writes values into the [name] fields of a container.
// Returns the keys that did not match any field.
function setFields(scope, values) {
  const unknown = [];

  Object.entries(values).forEach(([name, value]) => {
    const field = scope.querySelector(`[name="${name}"]`);
    if (!field) return unknown.push(name);

    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
      field.dispatchEvent(new Event('change'));
    } else {
      field.value = value;
    }
    field.classList.remove('invalid');
  });

  updateSummaryLine();
  return unknown;
}

function removeEntryAt(type, index) {
  const entry = document.getElementById(`${type}-list`).children[index];
  if (!entry) return false;

  entry.remove();
  refreshList(type);
  return true;
}

function removeSkill(name) {
  const tag = Array.from(skillTags.querySelectorAll('.tag'))
    .find(item => item.firstChild.textContent.trim() === name);
  if (!tag) return false;

  tag.querySelector('button').click();   // reuses the same removal logic
  return true;
}

// Brings an element into view and flashes it, so the user sees what changed.
function reveal(element) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('flash');
  void element.offsetWidth;              // restarts the animation
  element.classList.add('flash');
}

// Everything webmcp.js is allowed to touch, in one place.
window.cvForm = {
  addEntry,
  removeEntryAt,
  countEntries,
  setFields,
  addSkill,
  removeSkill,
  getSkills: () => [...skills],
  collectData,
  missingFields,
  submitApplication,
  reveal,
  isConsentGiven: () => document.getElementById('consent').checked
};
