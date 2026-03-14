# Flow.js

A declarative, almost-zero-dependency frontend wiring library for the browser. Loosely inspired by [HTMX](https://htmx.org/) and [Alpine.js](https://alpinejs.dev/), Flow gives HTML elements the ability to fetch data, render templates, and manage navigation — all through attributes on the element itself, with no build step required. Think HTMX on steroids.

Flow works in two complementary modes depending on what your server returns:

- **`text/html` response** — the HTML is inserted directly into the target element, no template needed. This is the HTMX model: your server renders the fragment and Flow just puts it in the right place.
- **`application/json` response** — the JSON is parsed and, if a template is specified, passed as scope data to a [Sketch.js](./SKETCH.md) template which renders the HTML client-side before insertion. If no template is given, the response is a no-op on the client — useful when you only care about the server-side effect of the request.

Both modes use the same attribute syntax. This means Flow works equally well with a classic server-side rendering stack and a JSON API, and you can mix both approaches freely within the same page.

---

## Quick Start

```html
<script src="sketch.js"></script>
<script src="flow.js"></script>

<!-- Fetch /api/hello and render it into this div -->
<div flow="get /api/hello :dashboard>#content"></div>
<div id="content"></div>
```

Flow auto-initializes on `DOMContentLoaded` and processes all `[flow]`, `[flow-link]`, and `[flow-form]` elements it finds.

---

## Core Concept: The Flow String

The power of Flow lives in a single attribute string — a mini-DSL that declares *what* to fetch, *how* to render it, and *where* to put it.

```
method source[:template][>target][@location]
```

| Part | Description |
|---|---|
| `method` | HTTP verb (`get`, `post`, `put`, `patch`, `delete`) or special method (`json`, `ref`, `route`) |
| `source` | URL to fetch, store key, or route path |
| `:template` | Optional. Template to render data into |
| `>target` | Optional. CSS selector for destination element |
| `@location` | Optional. Where to insert content relative to target |

---

## Methods

### HTTP methods: `get`, `post`, `put`, `patch`, `delete`

Fetches from the given URL. If the response is `text/html`, it is inserted directly. If it is JSON, it is passed to a template for rendering.

```html
<!-- GET /api/stats, render with template, replace #dashboard contents -->
<div flow="get /api/stats:dashboard>#dashboard"></div>
```

### `json` — inline data, no fetch

Render a template with static JSON data embedded in a `flow-json` attribute. No network request is made.

```html
<div flow="json :user-card" flow-json='{"name":"Alice","role":"admin"}'></div>
```

### `ref` — data from the Flow store

Render a template using a value already in `Flow.store`:

```javascript
Flow.store.currentUser = { name: 'Alice', role: 'admin' };
```

```html
<div flow="ref currentUser:user-card"></div>
```

When the target is a `>variable` (see below), data is written *to* the store rather than rendered. Used to cache API responses:

```html
<div flow="get /api/config >=configData"></div>
```

This populates `Flow.store.configData` with the fetched JSON without rendering anything.

### `route` — trigger a registered route

Navigates to a registered route by path (see [Route Management](#route-management)):

```html
<a flow-link="route /dashboard">Dashboard</a>
```

---

## Template Sources

After the `:` in the flow string, you specify where the template comes from.

### `:templateName` — URL template

Fetches from `Flow.templatePrefix + name + Flow.templateSuffix` (defaults: `/templates/` and `.tpl.html`). Responses are cached.

```html
<div flow="get /api/users:user-list>#main"></div>
<!-- fetches template from: /templates/user-list.tpl.html -->
```

### `:#element-id` — DOM template

Reads template content from a `<script>` or element with that ID:

```html
<script type="text/sketch" id="user-card-tpl">
  <div class="card">{{ name }} — {{ role }}</div>
</script>

<div flow="get /api/me:#user-card-tpl>#sidebar"></div>
```

### `:_` — inline template

The element's own `innerHTML` is the template. The element is replaced with its rendered output.

```html
<div flow="get /api/user:_">
  <p>{{ name }} ({{ email }})</p>
</div>
```

> When using `:_`, the element replaces *itself*. Nested elements with their own `flow` attributes are automatically protected during the outer render using `Sketch.preserve`.

---

## Target Selectors

`>target` controls where rendered content goes.

### CSS selector

```html
<div flow="get /api/nav:nav>#site-nav"></div>
```

Renders into `document.querySelector('#site-nav')`.

### `>=variableName` — store target

Writes the fetched JSON data into `Flow.store` without rendering:

```html
<div flow="get /api/session >=session"></div>
<!-- Flow.store.session now holds the response JSON -->
```

No template is needed. Useful for pre-loading shared data.

---

## Insert Locations

`@location` controls how content is inserted into the target. Default is `inner` for selector targets and `replace` for self-targets.

| Location | Behaviour |
|---|---|
| `inner` | Replace the target's inner content (default for `>selector`) |
| `replace` | Replace the target element itself (default for self-targeting) |
| `append` | Append after existing children |
| `prepend` | Prepend before existing children |
| `before` | Insert before the target element in the DOM |
| `after` | Insert after the target element in the DOM |

```html
<!-- Load more: append results to a list -->
<button flow-link="get /api/items?page=2:item-list>#item-list@append">
  Load more
</button>
```

```html
<!-- Notification toast: insert before the main content -->
<div flow="get /api/alerts:alert-tpl>#main@before"></div>
```

---

## Triggering: Auto, Links, and Forms

Flow processes elements differently depending on their tag and attributes.

### Auto-fire elements

Elements with `flow` on a non-link, non-form tag fire **immediately** on page load (or when they enter the DOM):

```html
<!-- Fires on load, populates #stats-panel -->
<div flow="get /api/stats:stats>#stats-panel"></div>
```

### Links — `flow-link` or `<a flow="...">`

Decorated with a click handler. The network request fires on click, not on load.

```html
<a flow-link="get /api/profile:profile>#main">My Profile</a>

<!-- Using flow attribute on an <a> tag is equivalent -->
<a flow="get /api/profile:profile>#main">My Profile</a>
```

### Forms — `flow-form` or `<form flow="...">`

Intercepts `submit`. Form fields are serialized automatically.

- For `GET` forms: fields are appended as query string parameters.
- For all other methods: fields are serialized as JSON and sent in the request body.

```html
<form flow-form="post /api/search:results>#results">
  <input type="text" name="q" placeholder="Search...">
  <button type="submit">Search</button>
</form>
```

```html
<!-- GET form: appends ?q=... to the URL -->
<form flow="get /api/items:item-list>#items">
  <input type="text" name="q">
  <button>Filter</button>
</form>
```

---

## Layout Support

A layout template wraps the rendered output, useful for consistent page chrome. Specify the layout template name with `flow-layout`:

```html
<div flow="get /api/page:content>#app" flow-layout="base-layout"></div>
```

The layout is a Sketch template with `{yield}` where the page content goes (see [Sketch layout docs](./SKETCH.md#layout-inheritance)).

---

## History

Push the current URL to browser history when a flow completes by adding the `flow-history` attribute:

```html
<a flow-link="get /api/page:content>#main" flow-history>Page</a>
```

Flow listens for `popstate` and re-renders the matched route on back/forward navigation. The `flow-history` attribute is the per-element equivalent of `history: true` in a route definition.

---

## Route Management

Routes provide URL-pattern-based navigation with history support. Define routes upfront and then navigate to them with `route` or `Flow.go()`.

```javascript
Flow.registerRoutes([
  {
    pattern: '/dashboard',
    template: 'dashboard',
    target: '#content',
    history: true
  },
  {
    pattern: '/users/:id',
    template: 'user-detail',
    target: '#content',
    history: true,
    layout: 'base-layout'
  },
  {
    pattern: '/settings',
    template: 'settings',
    target: '#content',
    history: true
  }
]);

Flow.defaultRoute = '/dashboard';
```

Route properties:

| Property | Description |
|---|---|
| `pattern` | URL pattern, supports `:param` segments |
| `template` | Template name (resolved as a URL template) |
| `target` | CSS selector for render target (default: `#content-body`) |
| `layout` | Optional layout template name |
| `history` | Push URL to browser history on navigation |
| `jsonData` | Static data to pass to the template |
| `afterRender` | Function name (string) or function called after render |
| `afterFetch` | Function name (string) or function called after data fetch |
| `beforeRender` | Function name (string) or function called before render |
| `before` | Function name (string) or function called before fetch |
| `error` | Function name (string) or function called on error |

### Navigating programmatically

```javascript
await Flow.go('/dashboard');
```

### Link to a route

```html
<a flow-link="route /dashboard">Dashboard</a>
<a flow-link="route /users/42">View User</a>
```

---

## Lifecycle Classes

Flow automatically manages three CSS classes on the **target element** throughout the request lifecycle. These are set by default with no configuration required — you just style them.

| Class | When set |
|---|---|
| `flow-processing` | Added at the start of every request, removed when done |
| `flow-finished` | Added on success, cleared on the next request to the same target |
| `flow-error` | Added on failure, cleared on the next request to the same target |

On every new request to a target, all three classes are removed first, then `flow-processing` is added. This means `flow-finished` and `flow-error` persist until the next cycle — they tell you where things last landed.

Store targets (`>=variable`) have no DOM element, so no classes are applied.

```css
/* Spinner while loading */
.flow-processing { opacity: 0.5; pointer-events: none; }

/* Highlight a newly rendered item */
.flow-finished { animation: highlight 0.4s ease-out; }

/* Error state */
.flow-error { border: 1px solid red; }
```

---

## Events

Flow emits lifecycle events you can listen to globally using `Flow.on(event, fn)`. Every event includes `targetElement` — the resolved DOM element that content will be rendered into (or `null` for store targets).

```javascript
Flow.on('before', ({ element, parsed, headers, targetElement }) => {
  // Called before every fetch. Mutate `headers` to add custom request headers.
  headers['X-CSRF-Token'] = document.querySelector('meta[name=csrf-token]').content;
});

Flow.on('after-fetch', ({ element, parsed, data, isHTML, response, targetElement }) => {
  // Called after every fetch (including errors). `data` is the parsed response body.
  if (response && response.status === 401) {
    Flow.go('/login');
  }
});

Flow.on('before-render', ({ element, parsed, data, html, targetElement }) => {
  // Called after template compilation but before DOM insertion.
  // You can mutate `html` on the event object.
});

Flow.on('after-render', ({ element, parsed, data, targetElement }) => {
  // Called after content is inserted into the DOM.
  // Good place to initialize third-party widgets.
});

Flow.on('error', ({ element, parsed, error, targetElement }) => {
  // Called when an unhandled error occurs during processing.
  console.error('Flow error:', error);
});

Flow.on('historyChange', ({ url }) => {
  // Called when Flow pushes a new entry to browser history.
  analytics.track('pageview', { url });
});
```

### Removing listeners

```javascript
const handler = (data) => { /* ... */ };
Flow.on('after-render', handler);
Flow.off('after-render', handler);
```

### Per-element and per-route event handlers

In addition to global listeners, you can attach handlers directly on elements or in route definitions. They fire *after* the global listeners for the same event.

**On an element attribute:**

```html
<div flow="get /api/chart:chart>#chart-area" flow-after-render="initChart"></div>
```

```javascript
function initChart({ element, data }) {
  new Chart(element.querySelector('canvas'), data.chartConfig);
}
```

**In a route definition:**

```javascript
Flow.registerRoutes([{
  pattern: '/dashboard',
  template: 'dashboard',
  target: '#content',
  afterRender: 'initDashboard',   // string name of a window function
  before: (data) => { data.headers['X-Page'] = 'dashboard'; }  // or inline function
}]);
```

Valid event hook names on routes: `before`, `afterFetch`, `beforeRender`, `afterRender`, `error`.

---

## Headers

Set default headers that are sent with every Flow HTTP request:

```javascript
Flow.setDefaultHeader('X-CSRF-Token', csrfToken);
Flow.setDefaultHeader('X-App-Version', '2.1.0');
```

Remove a header:

```javascript
Flow.removeDefaultHeader('X-App-Version');
```

Clear all defaults:

```javascript
Flow.clearDefaultHeaders();
```

Per-request headers can be added in the `before` event by mutating `data.headers`.

---

## The Flow Store

`Flow.store` is a plain object shared across the entire page. It acts as a lightweight shared state bus.

```javascript
// Write manually:
Flow.store.currentUser = { name: 'Alice' };

// Read in a `ref` flow:
// <div flow="ref currentUser:user-card>#sidebar"></div>

// Write via a fetch (no render):
// <div flow="get /api/session >=session"></div>
// → Flow.store.session = { ...response JSON... }
```

`window.xstore` is an alias for `Flow.store` — it can be accessed from `<script flow-script>` blocks and inline templates.

---

## Inline Scripts — `<script flow-script>`

After rendering, Flow executes any `<script flow-script>` tags found in rendered content. These run in the window scope and are removed from the DOM after execution.

```html
<!-- Inside a rendered template: -->
<script flow-script>
  document.querySelector('#chart').addEventListener('click', handleChartClick);
  initTooltips();
</script>
```

> Errors in `flow-script` blocks are caught and logged with the offending line highlighted in the console. The page does not crash.

---

## `params` — URL Query Parameters

After every fetch, Flow parses `window.location.search` and injects a `params` object into the template scope:

```
/items?category=books&page=2
```

```html
{if params.category}
  <h2>Category: {{ params.category }}</h2>
{/if}
<p>Page {{ params.page | default:'1' }}</p>
```

Array params (`?tag[]=a&tag[]=b`) are available as arrays: `params.tag`.

---

## API Reference

### `Flow.init(scope?)`

Bootstrapped automatically on `DOMContentLoaded`. Processes all flow elements in scope, sets up the `MutationObserver`, and handles `popstate`. You normally don't call this manually.

### `Flow.processScope(scope?)`

Finds and processes all unprocessed `[flow]`, `[flow-link]`, `[flow-form]` elements within a scope element (defaults to `document`). Useful after dynamically inserting HTML.

### `Flow.processElement(element, parentScope?, overrideFlowStr?)`

Processes a single element. Parses its flow string, fetches data, renders, and inserts.

### `Flow.go(url)`

Resolves and triggers a registered route programmatically.

```javascript
await Flow.go('/dashboard');
```

### `Flow.resolveRoute(url)`

Resolves a URL against registered routes and returns the parsed route config, or `null` if no route matches.

### `Flow.registerRoutes(routes)`

Registers an array of route definitions (see [Route Management](#route-management)).

### `Flow.setDefaultHeader(name, value)` / `Flow.removeDefaultHeader(name)` / `Flow.clearDefaultHeaders()`

Manage headers sent with every HTTP request.

### `Flow.on(event, fn)` / `Flow.off(event, fn)`

Subscribe/unsubscribe from lifecycle events.

### `Flow.updateHistory(url)`

Pushes a URL to browser history and emits `historyChange`.

### Configuration

| Property | Default | Description |
|---|---|---|
| `Flow.templatePrefix` | `'/templates/'` | Prefix for URL template fetches |
| `Flow.templateSuffix` | `'.tpl.html'` | Suffix for URL template fetches |
| `Flow.apiPrefix` | `''` | Prefix for API fetch URLs (only applied to paths starting with `/`) |
| `Flow.store` | `{}` | Shared state object |

---

## Complete Example

```html
<!DOCTYPE html>
<html>
<head><title>My App</title></head>
<body>

  <!-- Auto-load current user into the nav -->
  <header>
    <div flow="get /api/me:#nav-user-tpl>#user-area"></div>
    <div id="user-area"></div>
  </header>

  <!-- Route navigation -->
  <nav>
    <a flow-link="route /dashboard">Dashboard</a>
    <a flow-link="route /users">Users</a>
  </nav>

  <!-- Route content target -->
  <main id="content"></main>

  <!-- Inline template for user nav area -->
  <script type="text/sketch" id="nav-user-tpl">
    {if name}
      <span>{{ name }}</span>
      <a href="/logout">Sign out</a>
    {else}
      <a href="/login">Sign in</a>
    {/if}
  </script>

  <script src="sketch.js"></script>
  <script src="flow.js"></script>
  <script>
    // CSRF token on every request
    Flow.on('before', ({ headers }) => {
      headers['X-CSRF-Token'] = document.querySelector('meta[name=csrf-token]').content;
    });

    // Redirect to login on 401
    Flow.on('after-fetch', ({ response }) => {
      if (response && response.status === 401) window.location = '/login';
    });

    Flow.registerRoutes([
      { pattern: '/dashboard', template: 'dashboard', target: '#content', history: true },
      { pattern: '/users',     template: 'users',     target: '#content', history: true },
      { pattern: '/users/:id', template: 'user',      target: '#content', history: true }
    ]);

    Flow.defaultRoute = '/dashboard';
  </script>
</body>
</html>
```
