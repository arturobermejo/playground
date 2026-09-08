# WebMCP: implementation guide

How to expose a web app's controls as tools so an agent can drive it. Written
from the W3C specification, the Chrome documentation and the ChatGPT one, and
from having implemented it in a DAW with 23 tools.

> **Status:** origin trial from Chrome 149. The API has moved at least once
> (`navigator` → `document`), so it pays to detect rather than assume. Check
> the sources at the end before trusting any detail.

---

## 1. What it is

A site registers **tools** —functions with a name, a description and a
schema— and the browser offers them to whichever agent is acting on the
user's behalf. Instead of the agent fighting the DOM guessing which button to
press, it calls `add_track({instrument: "bass-808"})` and your own code does
the work.

The important design consequence: **WebMCP does not create new capabilities**,
it only exposes the ones you already have. The session, the permissions and
the user validation stay the same. If an action requires confirmation in the
interface, it must keep requiring it from the tool.

## 2. Requirements

| Requirement | Detail |
|---|---|
| **Secure context** | HTTPS or `localhost`. On `file://` or `http://` the API does not exist. |
| **Availability** | Origin trial from Chrome 149. Locally: `chrome://flags/#enable-webmcp-testing` → *Enabled*. |
| **Permissions policy** | Controlled by `tools`, which defaults to `self`. |
| **Cross-origin iframes** | They need `allow="tools"` on the `<iframe>` tag. |

## 3. Detection

The only reliable check, because it covers both that the object exists and
that it carries the method:

```js
if (typeof document.modelContext?.registerTool === 'function') {
  // WebMCP is available
}
```

`navigator.modelContext` was the original name and became **deprecated in
Chromium 150**. If you care about older versions, try it as a fallback, never
first.

## 4. Minimal example

```js
const controller = new AbortController();

await document.modelContext.registerTool({
  name: 'add_todo',
  title: 'Add a task',
  description: 'Adds a task to the user list and shows it instantly.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What has to be done.' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['text'],
  },
  annotations: { readOnlyHint: false },
  execute: async ({ text, priority = 'medium' }, { signal }) => {
    const task = store.add({ text, priority });   // your usual logic
    render();                                     // and refresh the interface
    return { ok: true, summary: `Added "${text}".`, id: task.id, total: store.size };
  },
}, { signal: controller.signal });

// To remove it:
controller.abort();
```

## 5. The descriptor

```webidl
dictionary ModelContextTool {
  required DOMString name;          // 1–128 characters: [A-Za-z0-9_.-]
  USVString title;                  // human readable label, optional
  required DOMString description;   // what it does, in natural language
  object inputSchema;               // JSON Schema, type: "object"
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;         // changes nothing: read only
  boolean untrustedContentHint = false; // returns third-party content
};

callback ToolExecuteCallback = Promise<any> (object inputObject,
                                            ToolExecuteCallbackOptions options);
```

`registerTool` **returns a promise that rejects** if the name is duplicated or
malformed, if the description is empty, if the schema is invalid, or if the
origin or the permission do not allow it. Await it and catch.

`execute` receives `(input, { signal })`. That `signal` is there to abort long
operations: if the agent cancels, stop working.

## 6. What to return

The IDL says `Promise<any>`: anything JSON-serialisable. Chrome's examples
return strings; the ChatGPT guide asks for structured data the agent can
verify the result with. **What satisfies both** is an object with a prose
summary and the data next to it:

```js
// good
return { ok: true, summary: 'Track 3 "Bass" created with Bass 808.',
         track: { id: 'x1', n: 3, name: 'Bass' } };

// error: also a return value, not an exception
return { ok: false, error: 'There is no instrument called "made-up".',
         hint: 'Look it up with search_instruments.' };
```

Do not return `{ content: [{ type: 'text', … }] }`: that is the wire format of
an MCP **server**, not of this browser API.

## 7. Discovering and executing

```js
const tools  = await document.modelContext.getTools();
const output = await document.modelContext.executeTool(tools[0], { text: 'bread' });
// output is a JSON string
```

Useful above all for testing: it lets you walk the same path the agent will.

---

## 8. How to design the catalog

This is the part that decides whether the agent gets it right. The API is
easy; the catalog is not.

### Few and non-overlapping

There is no maximum, but **every tool takes up context and makes answers
longer**, and two similar ones confuse the model. Ten is a typical number;
twenty for a rich application is already a lot.

What to group and what not to:

- **Group** the settings that are one single control panel in the interface.
  Six tools `set_tempo`, `set_loop`, `set_volume`… are a single `set_settings`
  with optional fields.
- **Group** the listings into the state tool, with an `include` parameter for
  the expensive detail.
- **Do not group** functions that produce different results even if their
  schemas look alike. A `generate({kind})` with six conditional parameters is
  worse than four tools with clean schemas: parameters that only apply to some
  values of an `enum` are a classic source of model errors.

### Names that say what happens

Use verbs and **distinguish executing from starting**: `create_event` creates
the event; `start_event_creation` opens the form so the person fills it in. If
the name does not make clear which of the two it is, the agent will choose
wrong.

### Descriptions in the positive

Say what the tool does and what effects it has, not what it does not do.

- ✅ "Creates a calendar event for a specific date and time."
- ✅ "Replaces the current song. Discards the previous work without asking."
- ❌ "Do not use this for the weather."

### The vocabulary, inside the schema

If you have closed lists —scales, genres, statuses— put them as an `enum` in
the `inputSchema`. The model reads them there without spending a call, and you
save yourself the `list_options` kind of tools.

```js
scale: { type: 'string', enum: ['major', 'minor', 'dorian', 'blues'] }
```

### Input the way a person would say it

Do not make the agent compute or transform strings. Accept whatever it has at
hand and normalise it yourself:

- Bars starting at 1, as the user sees them on screen; not in internal ticks.
- Pitches as `"C4"` **or** as a MIDI number.
- References by name, by row number or by id: all three.
- No opaque identifiers if there is a readable way to name the thing.

### Strict in the code, loose in the schema

Validate properly inside `execute` and return errors that let the agent
correct itself. A useful error says what happened **and** which values are
good:

```js
return { ok: false,
         error: '"machine" does not accept the value "TR-999".',
         hint: 'Valid values are: 606, 707, 808, 909, cr78, linn.' };
```

### Refresh the interface

When a tool changes the state, the screen has to reflect it. The user is
watching: if the agent adds something and it is not visible, trust breaks.

### Annotations

- `readOnlyHint: true` on everything that only reads. It helps the agent and
  the clients that separate reads from writes.
- `untrustedContentHint: true` if you return content written by third parties
  (comments, emails, search results), so it is not treated as instructions.

---

## 9. Reusable adapter

This is the skeleton I use: define the tools once, register them on whichever
API is available, and always leave a direct way in so you can test without
browser support.

```js
const tools = [ /* … your descriptors, with execute … */ ];

const state = { supported: false, api: null, registered: 0, failed: [], error: null };
let controller = null;

/** A failure comes back as an explained answer, not as an exception. */
const shield = (tool) => async (input, options) => {
  try {
    return await tool.execute(input || {}, options || {});
  } catch (err) {
    return { ok: false, error: err.message || String(err), hint: `Tool: ${tool.name}.` };
  }
};

function context() {
  if (typeof document.modelContext?.registerTool === 'function') {
    return { mc: document.modelContext, api: 'document.modelContext' };
  }
  if (typeof navigator.modelContext?.registerTool === 'function') {
    return { mc: navigator.modelContext, api: 'navigator.modelContext (deprecated)' };
  }
  return null;
}

export async function register() {
  if (state.registered) return state;            // registering twice is an error
  const ctx = context();
  state.supported = !!ctx;
  if (!ctx) {
    state.error = !window.isSecureContext
      ? 'WebMCP needs a secure context: HTTPS or localhost.'
      : 'This browser does not carry the API yet.';
    return state;
  }

  state.api = ctx.api;
  state.error = null;
  controller = new AbortController();

  for (const tool of tools) {
    try {
      await ctx.mc.registerTool({
        name: tool.name, title: tool.title, description: tool.description,
        inputSchema: tool.inputSchema, annotations: tool.annotations || {},
        execute: shield(tool),
      }, { signal: controller.signal });
      state.registered++;
    } catch (err) {
      state.failed.push({ name: tool.name, reason: err.message });
    }
  }
  return state;
}

export function unregister() {
  controller?.abort();                           // this is how they are removed
  controller = null;
  state.registered = 0;
  return state;
}

/** Same behaviour without a compatible browser: for tests and extensions. */
export const bridge = {
  list: () => tools.map(({ execute, ...rest }) => rest),
  call: (name, input) => {
    const tool = tools.find((t) => t.name === name);
    return tool ? shield(tool)(input, {})
                : Promise.resolve({ ok: false, error: `There is no "${name}".` });
  },
};
```

**When to register.** Chrome recommends static registration for most
applications: at startup, once. Dynamic registration —adding and removing
according to the state of the page— only pays off if the catalog really
changes depending on where the user is. In a component framework, register on
mount and remove on unmount.

## 10. Testing without browser support

While the API is not available, a double faithful to the IDL checks what
matters: that the names are valid, that rejections are handled and that
removal works.

```js
const registry = new Map();

// Careful: `modelContext` is a read-only attribute, so in a browser that
// already carries it you have to define it, not assign it.
Object.defineProperty(document, 'modelContext', { configurable: true, value: {
  registerTool(tool, { signal } = {}) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name ?? ''))
      return Promise.reject(new DOMException('invalid name', 'InvalidStateError'));
    if (!tool.description || typeof tool.execute !== 'function')
      return Promise.reject(new DOMException('incomplete descriptor', 'InvalidStateError'));
    if (registry.has(tool.name))
      return Promise.reject(new DOMException('duplicate name', 'InvalidStateError'));
    registry.set(tool.name, tool);
    signal?.addEventListener('abort', () => registry.delete(tool.name));
    return Promise.resolve();
  },
  getTools: () => Promise.resolve([...registry.values()]),
  executeTool: async (tool, input = {}) =>
    JSON.stringify(await registry.get(tool.name).execute(input,
      { signal: new AbortController().signal })),
} });
```

With that, check: that all of them register, that none is rejected, that
`executeTool` returns JSON that parses, that an error comes back as data and
not as an exception, that registering twice does not duplicate, that aborting
removes them all and that they can be registered again afterwards.

And on top of that, **test end to end**: chain twenty calls building something
real and see whether the result is what you expected. Chrome recommends
eval-driven development —define the ideal result and measure— rather than
patching the prompt when a particular model fails.

---

## 11. Five traps I fell into

1. **The wrong object.** `navigator.modelContext` was the old name. It lives
   on `document`. Detect the method, not the object.
2. **Uncaught promises.** `registerTool` rejects; calling it in a loop without
   `await` leaves loose rejections you do not see until something breaks.
3. **The return format.** `{content:[{type:'text'}]}` belongs to an MCP server.
   Here you return plain JSON.
4. **No way to remove them.** There is no `unregisterTool`: it is `AbortSignal`,
   and you have to pass the signal from the start or you lose the chance.
5. **Too many tools.** I started with 36 because the application has a lot of
   controls. Grouping the ones that are a single panel got me down to 23
   without losing anything.

## 12. Checklist

- [ ] Detection with `typeof document.modelContext?.registerTool === 'function'`
- [ ] Served over HTTPS or localhost
- [ ] `await` and `try/catch` on every `registerTool`
- [ ] `AbortController` kept so tools can be removed
- [ ] Names `[A-Za-z0-9_.-]`, 1 to 128 characters, with a verb
- [ ] `readOnlyHint` on every read-only tool
- [ ] Closed lists as `enum` in the schema
- [ ] Errors returned as data, with the valid values
- [ ] The interface refreshes after every change
- [ ] Destructive actions say so in their description
- [ ] Tested end to end against a double of the API

---

## Sources

- [WebMCP specification — W3C Web Machine Learning](https://webmachinelearning.github.io/webmcp/)
- [WebMCP in Chrome](https://developer.chrome.com/docs/ai/webmcp)
- [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Tools with security in mind](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [WebMCP in the ChatGPT documentation](https://learn.chatgpt.com/docs/webmcp)
