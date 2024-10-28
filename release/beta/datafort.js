/* BEGIN src/util.js */
const $ = console.log.bind(console)
/* END src/util.js */
/* BEGIN src/site.js */

class Site {
   /** @type {Site | null} */
   parent = null

   /** @type {Site[]} */
   children = []

   /** @type {string} */
   name

   /** @type {string | null} */
   title

   /** @type {string | null} */
   description

   /** @type {string | null} */
   url

   /** E.g. `retripal.wowhead.game` */
   get path() {
    let path = this.name

    if (this.parent) {
      path += `.${this.parent.path}`
    }

    return path
   }

   /** E.g. `["retripal", "wowhead", "game"]` */
   get segments() {
    const segments = [this.name]

    if (this.parent) {
      segments.push(...this.parent.segments)
    }

    return segments
   }

   /**
    * @param {{
    *   parent: Site | null
    *   name: string
    *   title: string | null
    *   description: string | null
    *   url: string | null
    * }} args
    */
   constructor(args) {
    this.parent = args.parent
    this.name = args.name
    this.title = args.title
    this.description = args.description
    this.url = args.url
   }

   isSite() {
    return this.url !== null
   }

   isTreeNode() {
    return this.url === null
   }

   isRootLevel() {
    return this.parent === null
   }

   hasChildren() {
    return this.children.length > 0
   }

   /** @param {Site} child */
   addChild(child) {
    this.children.push(child)
    child.parent = this
   }
}
/* END src/site.js */
/* BEGIN src/db.js */
/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function downloadRawDb(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }

  const txt = await res.text()
  $(`downloadRawDb> Txt:\n%s`, txt)

  return txt
}

class Db {
  /** @type {string | undefined} */
  title

  /** @type {string | undefined} */
  splash

  /** @type {Site[]} */
  #tree = []

  /** @type {Record<string, Site>} */
  #pathMap = {}

  /**
   * @param {{
   *   title?: string
   *   splash?: string
   * }} args
   */
  constructor(args) {
    this.title = args.title
    this.splash = args.splash
  }

  getRootSites() {
    return this.#tree
  }

  getJson() {
    return JSON.stringify(this.#tree, undefined, 2)
  }

   /** @param {Site} site */
  addSite(site) {
    if (!site.parent) {
      this.#tree.push(site)
    } else {
      site.parent.addChild(site)
    }

    this.#pathMap[site.path] = site
  }

   /** @param {string} sitePath */
  find(sitePath) {
    const site = this.#pathMap[sitePath]
    if (!site) {
      throw new Error(`Expected to find site with path "${sitePath}"`)
    }

    return site
  }
}

/**
 * @param {string} dbTsv
 * @returns {Db}
 */
function parseRawDb(dbTsv) {
  const db = new Db({})

  const lines = dbTsv.split(`\n`)

  /** @type {Record<number, Site>} */
  const map = {}

  let lastLevel = 0

  /** @type {Site | undefined} */
  let parent

  for (const line of lines) {
    if (!line) {
      continue
    }

    const cols = line.split(`\t`)

    // A line with no tabs is a metadata line in the form of key=value. The
    // value itself can contain =.
    if (cols.length === 1) {
      const [col] = cols
      const [key, ...rest] = col.split(`=`)
      const value = rest.join(`=`)
      switch (key) {
        case `title`:
          db.title = value
          break
        case `splash`:
          db.splash = value
          break
      }
      continue
    }

    // Determine what level we're at and that determines which parent we should
    // use.
    let level = 0
    for (const col of cols) {
      if (!col) {
        level++
      } else {
        break
      }
    }

    const sliced = cols.slice(level)

    const [name, title, url, description] = sliced

    const site = new Site({
      parent: null,
      name,
      title,
      description,
      url,
    })

    // If the level went to a low number, then we've ascended in the tree and
    // need to rewind back to a previous parent, except at level 0, where we
    // have no parent.
    //
    // If the number went up, we're descending into the tree. Save the site we
    // just entered as the parent for the children we're about to add.
    if (level < lastLevel) {
      if (level === 0) {
      $(`parseFlatDb> We're back at the root.`)
        parent = undefined
      } else {
        parent = map[level]
        $(`parseFlatDb> Moved up in the tree %s->%s. Parent is now %o.`, lastLevel, level, parent.path)
      }
    } else if (level > lastLevel) {
      parent = map[lastLevel]
      $(`parseFlatDb> Moved deeper in the tree %s->%s, parent now %o.`, lastLevel, level, parent.path)
    }

    map[level] = site

    site.parent = parent || null

    lastLevel = level
    db.addSite(site)
  }

  return db
}

/* END src/db.js */
/* BEGIN src/ui.js */
/** @param {Db} db */
function loadUrl(db) {
  // @ts-ignore
  const url = new URL(window.location)
  const { search } = url

  if (search) {
    $(`loadUrl> Search=%o`, search)
    const sitePath = search.slice(1)
    showSite(db, sitePath)
    return
  }

  $(`loadUrl> No search. Displaying root sites...`)
  displayRootSites(db)
}

/** @param {Db} db */
function displayRootSites(db) {
  const splashHtml = db.splash || ``
  $(`displayRootSites> Splash=%o`, splashHtml)

  if (db.title) {
    document.title = db.title 
  }

  const sites = db.getRootSites()
  const sitesHtml = renderSiteList(sites)

  document.body.innerHTML = `
    ${splashHtml}
    <div class="root-sites">${sitesHtml}</div>
  `
}

/**
 * @param {Db} db
 * @param {string} sitePath
 */
function showSite(db, sitePath) {
  const site = db.find(sitePath)
  const html = renderSite(site)
  document.body.innerHTML = html
}

/**
 * @param {Site} site
 * @returns {string}
 */
function renderSite(site) {
  // $(`renderSite> Rendering %o... Site=%o`, site.path, site)

  const segments = site.segments
  const revSegments = segments.slice().reverse()
  // $(`renderSite> RevSeg=%o`, revSegments)

  const titleParts = []
  titleParts.push(`<a href="" onclick="handleClick(event, '')">~</a>`)
  for (let i = 0; i < revSegments.length; i++) {
    const name = revSegments[i]
    // $(`renderSite> titleParts> Loop=%o Name=%o`, i, name)

    if (name === site.name) {
      // $(`renderSite> titleParts> Name=%o Path=%o`, name, name)
      titleParts.push(name)
      continue
    }

    const rest = revSegments.slice(0, i + 1).reverse()
    // $(`renderSite> titleParts> Name=%o Rest=%o`, name, rest)
    const path = rest.join(`.`)
    // $(`renderSite> titleParts> Name=%o Path=%o`, name, path)
    // $(`renderSite> titleParts> Name=%o Path=%o`, name, path)
    titleParts.push(`<a href="?${path}" onclick="handleClick(event, '?${path}')">${name}</a>`)
  }
  // let titleContent = `<a href="?">&lt;root&gt;</a>` + titleParts.join(`.`)
  let titleContent = titleParts.join(`/`)

  const visitButton = site.url ? `&nbsp;<a href="${site.url}" class="visit" onclick="handleExternalClick(event, '${site.url}')">Visit</a>` : ``
  const title = `<h1 class="monospace">${titleContent}${visitButton}</h1>`

  const titleRow = site.title ? `<tr><th>Title</th><td>${site.title}</td></tr>` : ``
  const urlRow = site.url ? `<tr><th>URL</th><td><tt><a href="${site.url}" onclick="handleClick(event, '${site.url}')">${site.url}</a></tt></td></tr>` : ``
  const descRow = site.description ? `<tr><th>Description</th><td>${site.description}</td></tr>` : ``

  const urlClass = site.url ? `site-has-url` : `site-no-url`

  let html = `
    <div class="site ${urlClass}">
      ${title}
      <table class="dict">
        <tbody>
          ${titleRow}
          ${urlRow}
          ${descRow}
        </tbody>
      </table>
    </div>
  `

  if (site.hasChildren()) {
    const childrenHtml = renderSiteList(site.children)
    html += `
      <div class="children-sites">
        ${childrenHtml}
      </div>
    `
  }

  return html
}

/**
 * @param {Site[]} sites
 * @returns {string}
 */
function renderSiteList(sites) {
  /** @type {string[]} */
  const rows = []

  for (const site of sites) {
    const visitButton = site.url ? `<a class="visit" href="${site.url}" onclick="handleExternalClick(event, '${site.url}')">Visit</a>` : ``

    const name = site.url || site.hasChildren()
      ? `<a href="?${site.path}" onclick="handleClick(event, '?${site.path}')"><tt>${site.name}</tt></a>`
      : `<tt>${site.name}</tt>`

    const row = `
      <tr>
        <td>${name}${visitButton}</td>
        <td>${site.title}</td>
        <td class="center">${site.children.length}</td>
      </tr>
    `
    rows.push(row)
  }

  return `
    <table class="list site-table">
      <thead>
        <tr>
          <th class="path-col">Site</th>
          <th class="title-col">Title</th>
          <th class="sites-col">Children</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join(`\n`)}
      </tbody>
    </table>
  `
}

function handleExternalClick(event, url) {
}

/** @param {Db} db */
function getClickHandler(db) {
  /**
   * @param {Event} event
   * @param {string} url 
   */
  return function handleClick(event, url) {
    if (url.startsWith(`http`)) {
      return
    }

    $(`handleClick> URL=%o`, url)
    event.preventDefault()
    if (!url) {
      const loc = window.location
      const newUrl = loc.protocol + "//" + loc.host + loc.pathname
      url = newUrl
    }
    history.pushState({ page: `index` }, ``, url);
    loadUrl(db)
  }
}

/** @param {Db} db */
function attachBackHandler(db) {
  window.addEventListener(`popstate`, event => loadUrl(db))
}

function isFileSchema() {
  return window.location.href.startsWith(`file://`)
}

/* END src/ui.js */
/* BEGIN src/main.js */
const exampleFlatDb = `title=Example site
splash=Hello, World!
root1	Root1
	child1	Child1	http://example.com/child1
	child2	Child2	http://example.com/child2
root2	Root2
	child3	Child3	http://example.com/child3`

/**
 * @param {{
 *   url?: string
 *   rawDb?: string
 * }} args
 */
async function main(args = {}) {
  $(`main> Args=%o`, args)

  // const res = parseRawDb(exampleFlatDb)
  // // $(`main> Res:\n%s`, res.getJson())
  // $(`main> Res=%o`, res)
  // return

  /** @type {string} */
  let rawDb

  if (args.rawDb) {
    rawDb = args.rawDb
  } else {
    if (isFileSchema()) {
      $(`main> This is a local file, can't use XHR. Trying to load database from db.js...`)
      const script = document.createElement(`script`)
      script.src = `db.js`
      document.body.appendChild(script)
      // Control passes to db.js which needs to call main({ rawDb }).
      return
    }

    if (args.url) {
      $(`main> Downloading raw DB...`)
      rawDb = await downloadRawDb(args.url)
    } else {
      throw new Error(`Expected either rawDb or url to be provided to main()`)
    }
  }

  const db = parseRawDb(rawDb)
  loadUrl(db)

  window['handleClick'] = getClickHandler(db)

  attachBackHandler(db)
}
/* END src/main.js */
main({ url: "db.tsv" })