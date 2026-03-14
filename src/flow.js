class Flow {
  static store = {};
  static templatePrefix = '/templates/';
  static templateSuffix = '.tpl.html';
  static apiPrefix = '';
  static templateCache = new Map();
  static defaultHeaders = new Map();
  static routes = [];
  static defaultRoute = null;
  static _pendingAfterRender = [];
  static _listeners = {
    'before': [],
    'after-fetch': [],
    'before-render': [],
    'after-render': [],
    'error': [],
    'historyChange': []
  };

  // ─── Header Management ────────────────────────────────────────────────────

  static setDefaultHeader(name, value) { this.defaultHeaders.set(name, value); }
  static removeDefaultHeader(name) { this.defaultHeaders.delete(name); }
  static clearDefaultHeaders() { this.defaultHeaders.clear(); }

  static constructHeaders(additional = {}) {
    const headers = new Headers();
    for (const [k, v] of this.defaultHeaders) headers.append(k, v);
    for (const [k, v] of Object.entries(additional)) headers.append(k, v);
    console.log('Flow: constructed headers', Object.fromEntries(headers.entries()));
    return headers;
  }

  // ─── Route Management ────────────────────────────────────────────────────

  static registerRoutes(routes) {
    this.routes.push(...routes);
  }

  static _normalizePath(p) {
    return p.length > 1 ? p.replace(/\/$/, '') : p;
  }

  static resolveRoute(url) {
    const path = this._normalizePath(new URL(url, window.location.origin).pathname);
    const segments = path.split('/');

    for (const route of this.routes) {
      const patternSegments = this._normalizePath(route.pattern).split('/');
      if (patternSegments.length !== segments.length) continue;
      const match = patternSegments.every((seg, i) => seg.startsWith(':') || seg === segments[i]);
      if (!match) continue;

      return {
        method: route.method || 'get',
        source: path,
        template: route.template,
        templateType: route.template ? 'url' : null,
        layout: route.layout || null,
        target: route.target || '#content-body',
        targetType: 'selector',
        location: route.location || 'inner',
        history: route.history || false,
        historyUrl: path,
        jsonData: route.jsonData || null,
        afterRender: route.afterRender || null,
        afterFetch: route.afterFetch || null,
        beforeRender: route.beforeRender || null,
        before: route.before || null,
        error: route.error || null
      };
    }
    return null;
  }

  // ─── Event Bus ───────────────────────────────────────────────────────────

  static on(event, fn) {
    if (!this._listeners[event]) {
      //this._listeners[event] = [];
      throw new Error(`Flow: unknown event type ${event}`);
    }
    this._listeners[event].push(fn);
  }

  static off(event, fn) {
    if (!this._listeners[event]) return;
    const idx = this._listeners[event].indexOf(fn);
    if (idx !== -1) this._listeners[event].splice(idx, 1);
  }

  // Fires global listeners first, then element-local if flow-<event> attr present
  static async emit(event, data) {
    data.event = event;
    const globals = this._listeners[event] || [];
    for (const fn of globals) await fn(data);

    const routeKey = event.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const routeFn = data.parsed?.[routeKey];
    if (routeFn) {
      if (typeof routeFn === 'function') await routeFn(data);
      else if (typeof window[routeFn] === 'function') await window[routeFn](data);
    }

    if (data.element) {
      const localFn = data.element.getAttribute(`flow-${event}`);
      if (localFn && typeof window[localFn] === 'function') {
        await window[localFn](data);
      }
    }
  }

  // ─── Flow String Parser ───────────────────────────────────────────────────

  /*
    Format: method[source][:template][>target][@location]
 */
  static parseFlowAttributes(element, overrideFlowStr = null) {
    const flowStr = overrideFlowStr ||
      element.getAttribute('flow') ||
      element.getAttribute('flow-link') ||
      element.getAttribute('flow-form');

    if (!flowStr || !flowStr.trim()) return null;
    let str = flowStr.trim();

    let location = null;
    let target = null, targetType = 'self', template = null, templateType = null;

    const atIdx = str.lastIndexOf('@');
    if (atIdx !== -1) {
      location = str.slice(atIdx + 1).trim();
      str = str.slice(0, atIdx).trim();
    }

    const gtIdx = str.lastIndexOf('>');
    if (gtIdx !== -1) {
      const rawTarget = str.slice(gtIdx + 1).trim();
      str = str.slice(0, gtIdx).trim();
      if (rawTarget.startsWith('=')) {
        target = rawTarget.slice(1).trim();
        targetType = 'variable';
      } else {
        target = rawTarget;
        targetType = 'selector';
      }
    }

    const methodMatch = str.match(/^(\w+)\s*/);
    if (!methodMatch) return null;

    const method = methodMatch[1].toLowerCase();
    str = str.slice(methodMatch[0].length);

    if (method === 'route') {
      const source = str.trim() || null;
      const resolved = this.resolveRoute(source);
      if (!resolved) {
        console.error('Flow: no route matched for', source);
        return null;
      }
      return resolved;
    }

    let colonIdx = -1;
    let searchFrom = 0;
    while (searchFrom < str.length) {
      const idx = str.indexOf(':', searchFrom);
      if (idx === -1) break;
      if (str.slice(idx, idx + 3) === '://') { searchFrom = idx + 3; continue; }
      colonIdx = idx;
      break;
    }

    let source = null;
    if (colonIdx !== -1) {
      source = str.slice(0, colonIdx).trim() || null;
      const rawTemplate = str.slice(colonIdx + 1).trim();
      if (rawTemplate === '_') { templateType = 'inline'; template = '_'; }
      else if (rawTemplate.startsWith('#')) { templateType = 'id'; template = rawTemplate.slice(1); }
      else if (rawTemplate) { templateType = 'url'; template = rawTemplate; }
    } else {
      source = str.trim() || null;
    }

    if (location === null) {
      location = (targetType === 'selector' || targetType === 'variable') ? 'inner' : 'replace';
    }

    // Read remaining element attributes into parsed
    const layout = element.getAttribute('flow-layout') || null;
    const jsonData = method === 'json' ? (() => {
      const raw = element.getAttribute('flow-json');
      if (!raw) throw new Error('Flow: json method requires flow-json attribute');
      return JSON.parse(raw);
    })() : null;

    return { method, source, history: false, template, templateType, layout, jsonData, target, targetType, location };
  }

  // ─── Template Compilation (via Sketch) ───────────────────────────────────

  static async _compileTemplate(templateString) {
    // Preserve nested inline templates before Sketch processes the outer one.
    // Only inline templates (:_) need protection — url/id templates aren't
    // embedded in the HTML so they can't collide.
    const preserved = Sketch.preserve(templateString, (attrVal) => /:_/.test(attrVal));
    const compiled = await Sketch.compileAsync(preserved);
    //console.log('Flow: template compiled', { templateString, preserved, compiled });
    return (data, options = {}) => {
      const rendered = compiled(data, options);
      return Sketch.restore(rendered);
    };
  }

  // ─── Template Fetching ────────────────────────────────────────────────────

  static async fetchTemplate(parsed, element) {
    const { templateType, template } = parsed;

    if (templateType === 'inline') {
      // Return the element's current innerHTML as the template
      return element.innerHTML;
    }

    if (templateType === 'id') {
      const cacheKey = `#${template}`;
      if (this.templateCache.has(cacheKey)) return this.templateCache.get(cacheKey);
      const el = document.getElementById(template);
      if (!el) throw new Error(`Flow: template element #${template} not found`);
      const content = el.innerText;
      this.templateCache.set(cacheKey, content);
      return content;
    }

    if (templateType === 'url') {
      if (this.templateCache.has(template)) return this.templateCache.get(template);
      const path = this.templatePrefix + template + this.templateSuffix;
      const response = await fetch(path, { headers: this.constructHeaders() });
      if (!response.ok) throw new Error(`Flow: failed to fetch template ${path}`);
      const content = await response.text();
      this.templateCache.set(template, content);
      return content;
    }

    return null;
  }

  // ─── Data Fetching ────────────────────────────────────────────────────────

static async fetchData(parsed, element, parentScope = null, targetElement = null) {
  const { method, source, format } = parsed;

  const beforeEvent = { element, parsed, headers: {}, targetElement };
  await this.emit('before', beforeEvent);

  let data = null, isHTML = false, responseMeta = null;

  if (method === 'json') {
    data = parsed.jsonData;
  } else if (method === 'ref') {
    data = this.store[source];
  } else if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
    const requestHeaders = this.constructHeaders({
      'Accept': 'application/json, text/html',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Expires': '0',
      'If-None-Match': '',
      'Content-Type': (element && element.tagName === 'FORM') && format === 'html' ? 'application/x-www-form-urlencoded' : 'application/json',
      ...beforeEvent.headers
    });

    let body = undefined;
    let fetchUrl = (this.apiPrefix && source?.startsWith('/') ? this.apiPrefix : '') + source + window.location.search;

    if (element && element.tagName === 'FORM') {
      const formData = new FormData(element);
      if (method === 'get') {
        const existing = new URLSearchParams(window.location.search);
        for (const [key, value] of new URLSearchParams(formData)) existing.set(key, value);
        fetchUrl = (this.apiPrefix && source?.startsWith('/') ? this.apiPrefix : '') + source + '?' + existing.toString();
      } else {
        const obj = {};
        for (const [key, value] of formData.entries()) obj[key] = value;
        body = JSON.stringify(obj);
      }
    }

    const response = await fetch(fetchUrl, {
      method: method.toUpperCase(),
      cache: 'no-store',
      headers: Object.fromEntries(requestHeaders.entries()),
      body
    });

    responseMeta = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    };

    if (!response.ok) {
      const fetchEvent = { element, parsed, data: null, isHTML: false, response: responseMeta, targetElement };
      await this.emit('after-fetch', fetchEvent);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      data = await response.text();
      isHTML = true;
    } else {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    }
  }

  if (!isHTML) {
    data = Object.assign({}, parentScope || {}, data || {});
    const searchParams = new URLSearchParams(window.location.search);
    data.params = {};
    for (const key of searchParams.keys()) {
      if (key.endsWith('[]')) data.params[key.slice(0, -2)] = searchParams.getAll(key);
      else data.params[key] = searchParams.get(key);
    }
  }

  const fetchEvent = { element, parsed, data, isHTML, response: responseMeta, targetElement };
  await this.emit('after-fetch', fetchEvent);
  return { data: fetchEvent.data, isHTML: fetchEvent.isHTML, response: fetchEvent.response };
}

  // ─── Content Insertion ────────────────────────────────────────────────────

    static insertContent(sourceDiv, targetElement, location) {
        switch (location) {
            case 'replace': {
            const parent = targetElement.parentNode;
            while (sourceDiv.firstChild) parent.insertBefore(sourceDiv.firstChild, targetElement);
            targetElement.remove();
            return parent;
            }
            case 'inner': {
            targetElement.innerHTML = '';
            while (sourceDiv.firstChild) targetElement.appendChild(sourceDiv.firstChild);
            return targetElement;
            }
            case 'after': {
            const next = targetElement.nextSibling;
            while (sourceDiv.firstChild) targetElement.parentNode.insertBefore(sourceDiv.firstChild, next);
            return targetElement.parentNode;
            }
            case 'before': {
            while (sourceDiv.firstChild) targetElement.parentNode.insertBefore(sourceDiv.firstChild, targetElement);
            return targetElement.parentNode;
            }
            case 'prepend': {
            const first = targetElement.firstChild;
            while (sourceDiv.firstChild) targetElement.insertBefore(sourceDiv.firstChild, first);
            return targetElement;
            }
            case 'append': {
            while (sourceDiv.firstChild) targetElement.appendChild(sourceDiv.firstChild);
            return targetElement;
            }
            default:
            console.error('Flow: unknown location', location);
            return targetElement;
        }
    }
  // ─── Core Element Processor ───────────────────────────────────────────────

  static async processElement(element, parentScope = null, overrideFlowStr = null) {
    if (element.getAttribute('flow-done')) return;
    element.setAttribute('flow-done', 'true');

    const parsed = this.parseFlowAttributes(element, overrideFlowStr);
    if (!parsed) return;

    await this.processFlow(parsed, element);
  }

  // ─── Core Flow Processor ───────────────────────────────────────────────

  static async processFlow(parsed, element) {
  const targetElement = parsed.targetType === 'selector'
    ? document.querySelector(parsed.target)
    : (parsed.targetType === 'variable' ? null : element);

  try {
    if (parsed.history && parsed.source) {
      this.updateHistory(parsed.source);
    }

    const result = await this.fetchData(parsed, element, null, targetElement);
    if (result === null) return;
    const { data, isHTML } = result;

    if (parsed.targetType === 'variable') {
      this.store[parsed.target] = data;
      await this.emit('after-render', { element, parsed, data, targetElement });
      return;
    }

    if (parsed.targetType === 'selector' && !targetElement) {
      console.error('Flow: target not found:', parsed.target);
      return;
    }

    let insertedScope;

    if (isHTML) {
      const tempDiv = document.createElement('span');
      tempDiv.innerHTML = data;
      insertedScope = this.insertContent(tempDiv, targetElement, parsed.location);
    } else if (parsed.templateType) {
      const templateStr = await this.fetchTemplate(parsed, element);
      const layoutStr = parsed.layout ? await this.fetchTemplate({ templateType: 'url', template: parsed.layout }, element) : null;

      const renderEvent = { element, parsed, data, html: null, targetElement };
      const compiled = await this._compileTemplate(templateStr);
      renderEvent.html = compiled(data, layoutStr ? { layout: layoutStr } : {});
      await this.emit('before-render', renderEvent);

      const tempDiv = document.createElement('span');
      tempDiv.innerHTML = renderEvent.html;

      await this.processScope(tempDiv);
      insertedScope = this.insertContent(tempDiv, targetElement, parsed.location);
    }

    if (insertedScope) {
      if (!insertedScope.isConnected) {
        if (element) this._pendingAfterRender.push({ element, parsed, data });
      } else {
        this.postRender(insertedScope);
        await this.emit('after-render', { element, parsed, data, targetElement });
        const toFire = this._pendingAfterRender.filter(p => insertedScope.contains(p.element));
        this._pendingAfterRender = this._pendingAfterRender.filter(p => !insertedScope.contains(p.element));
        for (const pending of toFire) {
          await this.emit('after-render', pending);
        }
      }
    }

  } catch (error) {
    console.error('Flow: error processing element', element, error);
    await this.emit('error', { element, parsed, error, targetElement });
  }
}

  // ─── Link & Form Handlers ─────────────────────────────────────────────────

  static _isLinkElement(element) {
    const tag = element.tagName.toLowerCase();
    return element.hasAttribute('flow-link') ||
      (tag === 'a' && element.hasAttribute('flow') && !element.hasAttribute('flow-form'));
  }

  static _isFormElement(element) {
    const tag = element.tagName.toLowerCase();
    return element.hasAttribute('flow-form') ||
      (tag === 'form' && element.hasAttribute('flow') && !element.hasAttribute('flow-link'));
  }

  static processScope(scope = document) {
    const all = scope.querySelectorAll('[flow]:not([flow-done]), [flow-link]:not([flow-done]), [flow-form]:not([flow-done])');
    const forms = [], links = [], autos = [];
    all.forEach(el => {
      if (this._isFormElement(el)) forms.push(el);
      else if (this._isLinkElement(el)) links.push(el);
      else autos.push(el);
    });
    links.forEach(el => this._decorateLink(el));
    forms.forEach(el => this._decorateForm(el));
    return Promise.all(autos.map(el => this.processElement(el)));
  }

  static _decorateLink(el) {
    if (el.getAttribute('flow-done')) return;
    el.addEventListener('click', (event) => {
      event.preventDefault();
      el.removeAttribute('flow-done');
      this.processElement(el);
    });
    el.setAttribute('flow-done', 'true');
  }

  static decorateLinks(scope = document) {
    scope.querySelectorAll('[flow-link]:not([flow-done]), a[flow]:not([flow-done])').forEach(el => {
      if (this._isLinkElement(el)) this._decorateLink(el);
    });
  }

  static _decorateForm(el) {
    if (el.getAttribute('flow-done')) return;
    el.addEventListener('submit', (event) => {
      //console.log('Form submit intercepted by Flow:', el);
      event.preventDefault();
      el.removeAttribute('flow-done');
      this.processElement(el);
    });
    el.setAttribute('flow-done', 'true');
  }

  static decorateForms(scope = document) {
    scope.querySelectorAll('[flow-form]:not([flow-done]), form[flow]:not([flow-done])').forEach(el => {
      if (this._isFormElement(el)) this._decorateForm(el);
    });
  }

  // ─── Post Render ──────────────────────────────────────────────────────────

  static async postRender(scope = document) {
    // Hoist <link> tags to <head>
    scope.querySelectorAll('link').forEach(link => {
      if (link.parentNode !== document.head) document.head.appendChild(link);
    });

    await this.processScope(scope);

    // Walk scripts in DOM order, execute sequentially
    scope.querySelectorAll('script[flow-script]:not([flow-done])').forEach(el => {
      el.setAttribute('flow-done', 'true');
      setTimeout(() => {
        const windowEval = eval.bind(window);
        const src = el.innerText;
        try {
          windowEval(src);
        } catch (error) {
          const lineMatch = error.stack && error.stack.match(/> eval:(\d+)/);
          if (lineMatch) {
            const errLine = parseInt(lineMatch[1]) - 1;
            const lines = src.split('\n');
            console.error('Flow script error:', error.message);
            if (errLine > 0) console.error(`${errLine}: ${lines[errLine - 1]}`);
            console.error(`${errLine + 1}: >>> ${lines[errLine]} <<<`);
            if (errLine < lines.length - 1) console.error(`${errLine + 2}: ${lines[errLine + 1]}`);
          } else {
            console.error('Flow script error:', error);
          }
        }
        el.remove();
      }, 0);
    });
  }

  // ─── History ──────────────────────────────────────────────────────────────

  static async updateHistory(url) {
    const state = { url, flow: true, timestamp: Date.now() };
    window.history.pushState(state, '', url);
    await this.emit('historyChange', { url });
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  static processNewElements(mutations) {
    const added = mutations.flatMap(m =>
      Array.from(m.addedNodes).filter(n => n.nodeType === Node.ELEMENT_NODE)
    );
    if (!added.length) return;

    added.forEach(el => {
       this.postRender(el);
    });
  }

  // ─── Convenience ─────────────────────────────────────────────────────────────────

  static async go(url) {
      const route = this.resolveRoute(url) || (this.defaultRoute && this.resolveRoute(this.defaultRoute));
      if (route) this.processFlow(route);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  static async init(scope = document) {
    console.log('Flow initializing...');

    window.xstore = this.store;

    this.on('before', ({ targetElement }) => {
      if (!targetElement) return;
      targetElement.classList.remove('flow-processing', 'flow-finished', 'flow-error');
      targetElement.classList.add('flow-processing');
    });

    this.on('after-render', ({ targetElement }) => {
      if (!targetElement) return;
      targetElement.classList.remove('flow-processing');
      targetElement.classList.add('flow-finished');
    });

    this.on('error', ({ targetElement }) => {
      if (!targetElement) return;
      targetElement.classList.remove('flow-processing');
      targetElement.classList.add('flow-error');
    });

    const initialRoute = this.resolveRoute(window.location.href) || (this.defaultRoute && this.resolveRoute(this.defaultRoute));
    if (initialRoute) {
      console.log('Flow: processing initial route', initialRoute);
      const target = document.querySelector(initialRoute.target) || document.body;
      await this.processFlow(initialRoute, target);
    } else {
      this.processScope(scope);
    }

    const observer = new MutationObserver(mutations => this.processNewElements(mutations));
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', async (event) => {
      if (event.state && event.state.flow && event.state.url) {
        const resolved = this.resolveRoute(event.state.url);
        if (!resolved) return;
        const target = document.querySelector(resolved.target) || document.body;
        target.removeAttribute('flow-done');
        await this.processFlow(resolved, target);
      }
    });
  }

}

// ─── Auto-init ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Flow.init());
} else {
  Flow.init();
}
