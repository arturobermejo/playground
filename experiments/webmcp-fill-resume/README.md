# Tech Labs — Candidate Profile

A demo of a job application form that an AI agent can fill in.

The page is a fictional company (Tech Labs) collecting a candidate's CV through a long,
fiddly form: repeatable blocks for every position, every degree, every link. On top of
that, the same form is exposed to AI agents as [WebMCP](https://developer.chrome.com/docs/ai/webmcp)
tools, so an agent can fill it by calling `add_work_experience(...)` instead of guessing
which button to click.

Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole page: sections, plus one `<template>` per repeatable block |
| `styles.css` | Minimal styling, light and dark friendly, responsive |
| `app.js` | Form logic: repeatable entries, skills as tags, validation, submit |
| `webmcp.js` | The 9 WebMCP tools and the registration adapter |
| `sample-cv.pdf` | A deliberately messy sample CV to test the flow with |
| `webmcp.md` | The WebMCP implementation guide these tools follow |

## Running it

Open `index.html` in a browser and the form works.

For the WebMCP part you need a secure context, so serve it over `localhost`:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`. The badge in the header tells you what happened:
`9 AI tools ready` when the browser exposes the API, `AI tools unavailable` otherwise
(hover it for the reason).

To get the API in Chrome 149+, enable `chrome://flags/#enable-webmcp-testing`.

## Deploying to GitHub Pages

The site is plain static files at the repository root, so there is nothing to build and no
workflow to run. Serve the branch directly:

1. Push the repository to GitHub.
2. Settings -> Pages -> Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait for the first build (a minute or so). Every later push to `main` republishes.

It ends up at `https://<user>.github.io/<repo>/`. All asset paths are relative, so the
project subpath works with no changes. `.nojekyll` is there so Pages copies the files as
they are instead of running them through Jekyll.

Two notes about the deployed version:

- Pages serves over HTTPS, which is a secure context, so WebMCP can work there. But the
  API is behind an origin trial: visitors either enable the Chrome flag themselves, or you
  register a token for your Pages origin and paste it into the commented `origin-trial`
  meta tag at the top of `index.html`.
- Nothing is actually sent anywhere. Submitting prints the payload on screen and logs it
  to the console; there is no server and no storage.

## The form

One page split into sections: Personal, Links, Experience, Education, Skills, Languages,
Submit. The sticky menu at the top highlights the section you are reading.

- **Repeatable blocks.** One generic `addEntry(type)` clones `#{type}-template` into
  `#{type}-list`, so adding a new repeatable section is mostly HTML.
- **Skills as tags.** Type and press Enter (or comma).
- **"I currently work here"** disables and clears the end date.
- **Validation on submit.** Native `checkValidity()` plus two rules HTML cannot express
  (at least one position, at least one skill). Errors are shown per section and the page
  scrolls to the first one.
- **Sending** replaces the form with a confirmation screen showing the JSON payload that
  would go to the server.

## The AI tools

`webmcp.js` registers 9 tools, once, when the page loads:

| Tool | Notes |
|---|---|
| `get_form_state` | Read only. Counters, what is still missing, and the full data with `include: "full"` |
| `set_personal_details` | One call for all personal fields; only what you send changes |
| `add_work_experience` | Dates accept `2021-03`, `March 2021`, `2021/7` or `2021` |
| `add_education` | Same date handling |
| `add_link` | `github.example/user` is upgraded to a full URL |
| `set_skills` | Array of names, `mode: "add" \| "replace"` |
| `add_language` | Level as an `enum` |
| `remove_entry` | Section as an `enum`, position counting from 1 as shown on screen |
| `submit_application` | Refuses to send until the person ticks the consent checkbox |

Three things worth knowing:

- Tools call the same functions the UI calls (`window.cvForm`, defined at the end of
  `app.js`), so the screen always shows what the agent did. Changed entries flash and
  scroll into view.
- Failures come back as data (`{ ok: false, error, hint }`), never as exceptions, and the
  hint lists the valid values.
- A banner at the bottom shows which tool is running, and whether it finished or failed.

### Trying them without a compatible browser

Every tool is reachable from the console through a bridge that runs the same code the
browser API would:

```js
await webmcp.bridge.call('set_personal_details', { fullName: 'Ada Lovelace' })
await webmcp.bridge.call('get_form_state', { include: 'full' })
webmcp.bridge.list()          // the descriptors, without execute
```

`webmcp.register()` and `webmcp.unregister()` are exposed too, so you can re-register
against a fake `document.modelContext` when testing (section 10 of the guide has one).

## The sample CV

`sample-cv.pdf` is a fictional full-stack developer from Lima with ~11 years of
experience, written to be awkward on purpose: sections in a strange order, seven date
formats, a freelance stint overlapping a full-time job, an unfinished master's, grades on
a 0-20 scale, and languages hidden inside an "other stuff" section. Good material for
checking whether an agent fills the form correctly.
