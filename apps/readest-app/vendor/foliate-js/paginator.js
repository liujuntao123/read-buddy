const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const debounce = (f, wait, immediate) => {
    let timeout
    return (...args) => {
        const later = () => {
            timeout = null
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}

const lerp = (min, max, x) => x * (max - min) + min
const easeOutQuad = x => 1 - (1 - x) * (1 - x)
const animate = (a, b, duration, ease, render) => new Promise(resolve => {
    let start
    const step = now => {
        if (document.hidden) {
            render(lerp(a, b, 1))
            return resolve()
        }
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) requestAnimationFrame(step)
        else resolve()
    }
    if (document.hidden) {
        render(lerp(a, b, 1))
        return resolve()
    }
    requestAnimationFrame(step)
})

// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
const uncollapse = range => {
    if (!range?.collapsed) return range
    const { endOffset, endContainer } = range
    if (endContainer.nodeType === 1) {
        const node = endContainer.childNodes[endOffset]
        if (node?.nodeType === 1) return node
        return endContainer
    }
    if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1)
    else if (endOffset > 1) range.setStart(endContainer, endOffset - 1)
    else return endContainer.parentNode
    return range
}

const makeRange = (doc, node, start, end = start) => {
    const range = doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
}

// use binary search to find an offset value in a text node
const bisectNode = (doc, node, cb, start = 0, end = node.nodeValue.length) => {
    if (end - start === 1) {
        const result = cb(makeRange(doc, node, start), makeRange(doc, node, end))
        return result < 0 ? start : end
    }
    const mid = Math.floor(start + (end - start) / 2)
    const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end))
    return result < 0 ? bisectNode(doc, node, cb, start, mid)
        : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid
}

const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION,
    FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter

const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION

// needed cause there seems to be a bug in `getBoundingClientRect()` in Firefox
// where it fails to include rects that have zero width and non-zero height
// (CSSOM spec says "rectangles [...] of which the height or width is not zero")
// which makes the visible range include an extra space at column boundaries
const getBoundingClientRect = target => {
    let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity
    for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
    }
    return new DOMRect(left, top, right - left, bottom - top)
}

const getVisibleRange = (doc, start, end, mapRect) => {
    // first get all visible nodes
    const acceptNode = node => {
        const name = node.localName?.toLowerCase()
        // ignore all scripts, styles, and their children
        if (name === 'script' || name === 'style') return FILTER_REJECT
        if (node.nodeType === 1) {
            const { left, right } = mapRect(node.getBoundingClientRect())
            // no need to check child nodes if it's completely out of view
            if (right < start || left > end) return FILTER_REJECT
            // elements must be completely in view to be considered visible
            // because you can't specify offsets for elements
            if (left >= start && right <= end) return FILTER_ACCEPT
            // TODO: it should probably allow elements that do not contain text
            // because they can exceed the whole viewport in both directions
            // especially in scrolled mode
        } else {
            // ignore empty text nodes
            if (!node.nodeValue?.trim()) return FILTER_SKIP
            // create range to get rect
            const range = doc.createRange()
            range.selectNodeContents(node)
            const { left, right } = mapRect(range.getBoundingClientRect())
            // it's visible if any part of it is in view
            if (right >= start && left <= end) return FILTER_ACCEPT
        }
        return FILTER_SKIP
    }
    const walker = doc.createTreeWalker(doc.body, filter, { acceptNode })
    const nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node)

    // we're only interested in the first and last visible nodes
    const from = nodes[0] ?? doc.body
    const to = nodes[nodes.length - 1] ?? from

    // find the offset at which visibility changes
    const startOffset = from.nodeType === 1 ? 0
        : bisectNode(doc, from, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < start && q.left > start) return 0
            return q.left > start ? -1 : 1
        })
    const endOffset = to.nodeType === 1 ? 0
        : bisectNode(doc, to, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < end && q.left > end) return 0
            return q.left > end ? -1 : 1
        })

    const range = doc.createRange()
    range.setStart(from, startOffset)
    range.setEnd(to, endOffset)
    return range
}

const selectionIsBackward = sel => {
    const range = document.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

const setSelectionTo = (target, collapse) => {
    let range
    if (target.startContainer) range = target.cloneRange()
    else if (target.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (range) {
        const sel = range.startContainer.ownerDocument.defaultView.getSelection()
        if (sel) {
            sel.removeAllRanges()
            if (collapse === -1) range.collapse(true)
            else if (collapse === 1) range.collapse()
            sel.addRange(range)
        }
    }
}

const getDirection = doc => {
    const { defaultView } = doc
    const { writingMode, direction } = defaultView.getComputedStyle(doc.body)
    const vertical = writingMode === 'vertical-rl'
        || writingMode === 'vertical-lr'
    const rtl = doc.body.dir === 'rtl'
        || direction === 'rtl'
        || doc.documentElement.dir === 'rtl'
    return { vertical, rtl }
}

const getBackground = doc => {
    const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
    return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        && bodyStyle.backgroundImage === 'none'
        ? doc.defaultView.getComputedStyle(doc.documentElement).background
        : bodyStyle.background
}

const makeMarginals = (length, part) => Array.from({ length }, () => {
    const div = document.createElement('div')
    const child = document.createElement('div')
    div.append(child)
    child.setAttribute('part', part)
    return div
})

const setStylesImportant = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}

class View {
    #observer = new ResizeObserver(() => this.expand())
    #element = document.createElement('div')
    #iframe = document.createElement('iframe')
    #contentRange = document.createRange()
    #overlayer
    #vertical = false
    #rtl = false
    #column = true
    #size
    #layout = {}
    constructor({ container, onExpand }) {
        this.container = container
        this.onExpand = onExpand
        this.#iframe.setAttribute('part', 'filter')
        this.#element.append(this.#iframe)
        Object.assign(this.#element.style, {
            boxSizing: 'content-box',
            position: 'relative',
            overflow: 'hidden',
            flex: '0 0 auto',
            width: '100%', height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
        })
        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        this.#iframe.setAttribute('scrolling', 'no')
    }
    get element() {
        return this.#element
    }
    get document() {
        return this.#iframe.contentDocument
    }
    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(`${src} is not string`)
        return new Promise(resolve => {
            this.#iframe.addEventListener('load', () => {
                const doc = this.document
                afterLoad?.(doc)

                // it needs to be visible for Firefox to get computed style
                this.#iframe.style.display = 'block'
                const { vertical, rtl } = getDirection(doc)
                const background = getBackground(doc)
                this.#iframe.style.display = 'none'

                this.#vertical = vertical
                this.#rtl = rtl

                this.#contentRange.selectNodeContents(doc.body)
                const layout = beforeRender?.({ vertical, rtl, background })
                this.#iframe.style.display = 'block'
                this.render(layout)
                this.#observer.observe(doc.body)

                // the resize observer above doesn't work in Firefox
                // (see https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)
                // until the bug is fixed we can at least account for font load
                doc.fonts.ready.then(() => this.expand())

                resolve()
            }, { once: true })
            this.#iframe.src = src
        })
    }
    render(layout) {
        if (!layout || !this.document?.documentElement) return
        this.#column = layout.flow !== 'scrolled'
        this.#layout = layout
        if (this.#column) this.columnize(layout)
        else this.scrolled(layout)
    }
    scrolled({ gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        if (!doc?.documentElement) return
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'padding': vertical ? `${gap}px 0` : `0 ${gap}px`,
            'column-width': 'auto',
            'column-gap': 'normal',
            'column-fill': 'auto',
            'height': 'auto',
            'width': 'auto',
            'overflow': 'visible',
            'position': 'static',
            'border': '0',
            'margin': '0',
            'max-height': 'none',
            'max-width': 'none',
        })
        setStylesImportant(doc.body, {
            [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
            'margin-left': 'auto',
            'margin-right': 'auto',
            'margin-top': '0',
            'margin-bottom': '0',
            'width': '100%',
            'box-sizing': 'border-box',
        })
        this.setImageSize()
        this.expand()
    }
    columnize({ width, height, gap, columnWidth }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width

        const doc = this.document
        if (!doc?.documentElement) return
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': `${Math.trunc(columnWidth)}px`,
            'column-gap': `${gap}px`,
            'column-fill': 'auto',
            ...(vertical
                ? { 'width': `${width}px` }
                : { 'height': `${height}px` }),
            'padding': vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
            'overflow': 'hidden',
            // force wrap long words
            'overflow-wrap': 'break-word',
            // reset some potentially problematic props
            'position': 'static', 'border': '0', 'margin': '0',
            'max-height': 'none', 'max-width': 'none',
            'min-height': 'none', 'min-width': 'none',
            // fix glyph clipping in WebKit
            '-webkit-line-box-contain': 'block glyphs replaced',
        })
        setStylesImportant(doc.body, {
            'max-height': 'none',
            'max-width': 'none',
            'margin': '0',
        })
        this.setImageSize()
        this.expand()
    }
    setImageSize() {
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        if (!doc?.body) return
        for (const el of doc.body.querySelectorAll('img, svg, video')) {
            // preserve max size if they are already set
            const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
            setStylesImportant(el, {
                'max-height': vertical
                    ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
                    : `${height - margin * 2}px`,
                'max-width': vertical
                    ? `${width - margin * 2}px`
                    : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%'),
                'object-fit': 'contain',
                'page-break-inside': 'avoid',
                'break-inside': 'avoid',
                'box-sizing': 'border-box',
            })
        }
    }
    expand() {
        // readest-plus: a view whose iframe has been removed (a page turn, a
        // chapter dropped out of the continuous flow) still gets late callbacks —
        // `doc.fonts.ready` above all. Its document is gone, so there is nothing
        // to measure and no reason to throw.
        const { documentElement } = this.document ?? {}
        if (!documentElement) return
        if (this.#column) {
            const side = this.#vertical ? 'height' : 'width'
            const otherSide = this.#vertical ? 'width' : 'height'
            const contentRect = this.#contentRange.getBoundingClientRect()
            const rootRect = documentElement.getBoundingClientRect()
            // offset caused by column break at the start of the page
            // which seem to be supported only by WebKit and only for horizontal writing
            const contentStart = this.#vertical ? 0
                : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
            const contentSize = contentStart + contentRect[side]
            const pageCount = Math.ceil(contentSize / this.#size)
            const expandedSize = pageCount * this.#size
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize + this.#size * 2}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            documentElement.style[side] = `${this.#size}px`
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = '0'
                this.#overlayer.element.style.left = this.#vertical ? '0' : `${this.#size}px`
                this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        } else {
            const side = this.#vertical ? 'width' : 'height'
            const otherSide = this.#vertical ? 'height' : 'width'
            const contentSize = documentElement.getBoundingClientRect()[side]
            const expandedSize = contentSize
            const { margin } = this.#layout
            const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`
            this.#element.style.padding = padding
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = padding
                this.#overlayer.element.style.left = '0'
                this.#overlayer.element.style.top = '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        }
        this.onExpand()
    }
    set overlayer(overlayer) {
        this.#overlayer = overlayer
        this.#element.append(overlayer.element)
    }
    get overlayer() {
        return this.#overlayer
    }
    destroy() {
        if (this.document) this.#observer.unobserve(this.document.body)
    }
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
    static observedAttributes = [
        'flow', 'gap', 'margin',
        'max-inline-size', 'max-block-size', 'max-column-count',
        // readest-plus: continuous scrolled reading (several chapters stacked in
        // one scroll flow). See `#continuous*` below.
        'continuous',
    ]
    #root = this.attachShadow({ mode: 'open' })
    #observer = new ResizeObserver(() => this.render())
    #top
    #background
    #container
    #header
    #footer
    #view
    #vertical = false
    #rtl = false
    #margin = 0
    #index = -1
    #anchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #locked = false // while true, prevent any further navigation
    #styles
    #styleMap = new WeakMap()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener
    #scrollBounds
    #touchState
    #touchScrolled
    #lastVisibleRange
    // readest-plus: continuous scrolled mode state. `#entries` are the live
    // chapters, in document order and contiguous; `#stack` is the single flex
    // column they live in inside the (still natively scrolling) `#container`.
    #stack = null
    #entries = []
    #stackHeight = 0
    #materializing = false
    #scrollFrame = 0
    #anchorIndex = -1
    /** In-flight chapter loads, so one index can never be mounted twice. */
    #loading = new Map()
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                var(--_margin)
                minmax(0, 1fr)
                var(--_margin);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
            /* readest-plus: 单页（scrolled）模式隐藏滚动条。容器仍是原生可滚动
               区域（滚轮 / 触控板 / 翻页键行为不变），只是不再画那条系统滚动条；
               这一块在 shadow DOM 里，globals.css 的全局滚动条样式够不到它。 */
            scrollbar-width: none;
        }
        /* readest-plus: WebKit / Chromium（Tauri = WebView2）侧的隐藏。 */
        :host([flow="scrolled"]) #container::-webkit-scrollbar {
            display: none;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container"></div>
            <div id="footer"></div>
        </div>
        `

        this.#top = this.#root.getElementById('top')
        this.#background = this.#root.getElementById('background')
        this.#container = this.#root.getElementById('container')
        this.#header = this.#root.getElementById('header')
        this.#footer = this.#root.getElementById('footer')

        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () => {
            this.dispatchEvent(new Event('scroll'))
            // readest-plus: keep the continuous flow fed while the reader scrolls.
            // A frame's worth of work at most; the relocate event stays on the
            // debounced listener below.
            if (this.continuous) this.#continuousOnScroll()
        })
        this.#container.addEventListener('scroll', debounce(() => {
            if (this.scrolled) {
                if (this.#justAnchored) this.#justAnchored = false
                else if (this.continuous) this.#continuousAfterScroll('scroll')
                else this.#afterScroll('scroll')
            }
        }, 250))

        const opts = { passive: false }
        this.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
        this.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
        this.addEventListener('load', ({ detail: { doc } }) => {
            doc.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
            doc.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
        })

        this.addEventListener('relocate', ({ detail }) => {
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })
        const checkPointerSelection = debounce((range, sel) => {
            if (!sel.rangeCount) return
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev()
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next()
        }, 700)
        this.addEventListener('load', ({ detail: { doc } }) => {
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointerup', () => isPointerSelecting = false)
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                if (this.scrolled) return
                const range = this.#lastVisibleRange
                if (!range) return
                const sel = doc.getSelection()
                if (!sel.rangeCount) return
                if (isPointerSelecting && sel.type === 'Range')
                    checkPointerSelection(range, sel)
                else if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
            })
            doc.addEventListener('focusin', e => this.scrolled ? null :
                // NOTE: `requestAnimationFrame` is needed in WebKit
                requestAnimationFrame(() => this.#scrollToAnchor(e.target)))
        })

        this.#mediaQueryListener = () => {
            if (!this.#view?.document?.defaultView) return
            this.#background.style.background = getBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'flow':
                this.render()
                break
            case 'continuous':
                // readest-plus: entering/leaving the continuous flow rebuilds (or
                // dismantles) the stack. `render()` re-renders whatever is left.
                if (this.continuous) this.#continuousInit()
                else this.#continuousTeardown()
                break
            case 'gap': {
                const val = typeof value === 'string' && value.endsWith('%') ? value : `${parseFloat(value) || 7}%`
                this.#top.style.setProperty('--_gap', val)
                break
            }
            case 'margin': {
                const val = typeof value === 'string' && (value.endsWith('px') || value.endsWith('%')) ? value : `${parseFloat(value) || 48}px`
                this.#top.style.setProperty('--_margin', val)
                break
            }
            case 'max-block-size': {
                const val = typeof value === 'string' && (value.endsWith('px') || value.endsWith('%')) ? value : `${parseFloat(value) || 1440}px`
                this.#top.style.setProperty('--_max-block-size', val)
                break
            }
            case 'max-column-count':
                this.#top.style.setProperty('--_max-column-count', value)
                this.render()
                break
            case 'max-inline-size': {
                const val = typeof value === 'string' && (value.endsWith('px') || value.endsWith('%')) ? value : `${parseFloat(value) || 720}px`
                this.#top.style.setProperty('--_max-inline-size', val)
                this.render()
                break
            }
        }
    }
    open(book) {
        this.bookDir = book.dir
        this.sections = book.sections
        book.transformTarget?.addEventListener('data', ({ detail }) => {
            if (detail.type !== 'text/css') return
            const w = innerWidth
            const h = innerHeight
            // data may legitimately be a non-string (the loader's circular-
            // reference guard passes raw blobs through); only transform strings.
            detail.data = Promise.resolve(detail.data).then(data => typeof data === 'string'
                ? data
                // unprefix as most of the props are (only) supported unprefixed
                .replace(/(?<=[{\s;])-epub-/gi, '')
                // replace vw and vh as they cause problems with layout
                .replace(/(\d*\.?\d+)vw/gi, (_, d) => parseFloat(d) * w / 100 + 'px')
                .replace(/(\d*\.?\d+)vh/gi, (_, d) => parseFloat(d) * h / 100 + 'px')
                // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(/page-break-(after|before|inside)\s*:/gi, (_, x) =>
                    `-webkit-column-break-${x}:`)
                .replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_, x, y) =>
                    `break-${x}: ${y ?? ''}column`)
                : data)
        })
    }
    #createView() {
        if (this.#view) {
            this.#view.destroy()
            this.#container.removeChild(this.#view.element)
        }
        this.#view = new View({
            container: this,
            onExpand: () => this.#scrollToAnchor(this.#anchor),
        })
        this.#container.append(this.#view.element)
        return this.#view
    }

    // ---------------------------------------------------------------------
    // readest-plus: continuous scrolled reading
    //
    // Upstream's `flow="scrolled"` stacks exactly one section in the scroll
    // container: reaching the end of a chapter is a wall, and crossing the
    // boundary is a page turn that throws the document away. Continuous mode
    // keeps a small window of chapters mounted in one flex column inside the
    // same natively-scrolling `#container`, so scrolling simply continues into
    // the next chapter — and "go to chapter N" becomes what it should be in a
    // flowing text: a scroll to that chapter's (or anchor's) position.
    //
    // Nothing here runs unless the `continuous` attribute is set: the
    // paginated and plain-scrolled paths are untouched.
    // ---------------------------------------------------------------------

    /** How many viewports of content are kept loaded ahead of the reader. */
    static #PREFETCH_SCREENS = 1.5
    /** Live chapters at most: unbounded iframes would grow without limit. */
    static #MAX_LIVE_SECTIONS = 5
    /** Materialization steps per pass, so one scroll cannot load a whole book. */
    static #MAX_FILL_STEPS = 6

    /** Scrolled **and** continuous. Both halves matter: leave one and the flow ends. */
    get continuous() {
        return this.scrolled && this.hasAttribute('continuous')
    }
    #isContinuous() {
        return this.continuous
    }
    #continuousStack() {
        if (!this.#stack) {
            this.#stack = document.createElement('div')
            Object.assign(this.#stack.style, {
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                // The reader's eye must stay on the same text when a chapter is
                // prepended above it; browser scroll anchoring would fight the
                // manual `scrollTop` compensation below.
                overflowAnchor: 'none',
            })
            this.#container.append(this.#stack)
        }
        return this.#stack
    }
    /** Adopt the already-rendered view into the stack (entering continuous mode). */
    #continuousInit() {
        const stack = this.#continuousStack()
        // Never adopt while a chapter is being loaded: `#view` may already point at
        // the view that load is about to register, and adopting it here would give
        // one chapter two entries (see `#continuousLoad`).
        if (this.#entries.length === 0 && this.#view && this.#loading.size === 0) {
            stack.append(this.#view.element)
            this.#entries = [{
                index: this.#index,
                view: this.#view,
                element: this.#view.element,
                height: 0,
                offset: 0,
            }]
            this.#anchorIndex = this.#index
        }
        this.#measure()
        void this.#continuousFill()
    }
    /** Dismantle the stack, keeping only the chapter the reader is on. */
    #continuousTeardown() {
        if (!this.#stack) return
        const current = this.#continuousCurrent()
        const keep = current ?? this.#entries[0] ?? null
        for (const entry of [...this.#entries]) {
            if (entry === keep) continue
            this.#dropEntry(entry)
        }
        if (keep) {
            this.#container.append(keep.element)
            this.#view = keep.view
            this.#index = keep.index
        }
        this.#stack.remove()
        this.#stack = null
        this.#stackHeight = 0
        this.render()
    }
    /** Record every live chapter's height and its offset inside the stack. */
    #measure() {
        let offset = 0
        for (const entry of this.#entries) {
            entry.offset = offset
            entry.height = entry.view.document
                ? entry.element.getBoundingClientRect().height
                : 0
            offset += entry.height
        }
        this.#stackHeight = offset
    }
    /** The chapter the viewport's top edge is in (the reader's position). */
    #continuousCurrent() {
        if (!this.#entries.length) return null
        const top = this.#container.scrollTop + 1
        return this.#entries.find(entry => top < entry.offset + entry.height)
            ?? this.#entries[this.#entries.length - 1]
    }
    /** Throw one chapter's document away (and tell the world it is gone). */
    #removeEntry(entry) {
        this.dispatchEvent(new CustomEvent('unload', {
            detail: { doc: entry.view.document, index: entry.index },
        }))
        entry.view.destroy?.()
        entry.element.remove()
        this.sections?.[entry.index]?.unload?.()
        // `#view` must never outlive the element it points at.
        if (this.#view === entry.view) this.#view = null
    }
    /** Drop one chapter from the flow. */
    #dropEntry(entry) {
        const index = this.#entries.indexOf(entry)
        if (index >= 0) this.#entries.splice(index, 1)
        this.#removeEntry(entry)
    }
    /**
     * Load one section as a new view inside the stack.
     *
     * Idempotent per index: two callers can ask for the same chapter in the same
     * breath (the initial navigation and the fill it triggers, a scroll and a
     * jump), and a second view for one section would be a duplicate the whole
     * offset model cannot survive — the chapter would be counted twice while the
     * container scrolls it once.
     *
     * `prepend` inserts it above the current chapters and compensates the scroll
     * position by exactly the height it added, so the text under the reader's eye
     * does not move.
     */
    async #continuousLoad(index, { prepend = false } = {}) {
        if (!this.#isContinuous() || !this.#canGoToIndex(index)) return null
        const existing = this.#entries.find(entry => entry.index === index)
        if (existing) return existing
        const inFlight = this.#loading.get(index)
        if (inFlight) return inFlight
        const task = this.#loadEntry(index, prepend)
        this.#loading.set(index, task)
        try {
            return await task
        } finally {
            this.#loading.delete(index)
        }
    }
    async #loadEntry(index, prepend) {
        const section = this.sections[index]
        if (!section) return null
        let src
        try {
            src = await section.load()
        } catch (e) {
            console.warn(e)
            return null
        }
        if (!src || !this.#isContinuous()) return null

        const view = new View({
            container: this,
            onExpand: () => this.#continuousOnExpand(index),
        })
        const entry = { index, view, element: view.element, height: 0, offset: 0 }
        const stack = this.#continuousStack()
        if (prepend) stack.prepend(entry.element)
        else stack.append(entry.element)

        const beforeRender = this.#beforeRender.bind(this)
        const afterLoad = doc => {
            if (doc.head) {
                const $styleBefore = doc.createElement('style')
                doc.head.prepend($styleBefore)
                const $style = doc.createElement('style')
                doc.head.append($style)
                this.#styleMap.set(doc, [$styleBefore, $style])
                this.#applyStylesTo(doc)
            }
        }
        const scrollTopBefore = this.#container.scrollTop
        try {
            await view.load(src, afterLoad, beforeRender)
        } catch (e) {
            console.warn(e)
            view.destroy?.()
            entry.element.remove()
            this.sections[index]?.unload?.()
            return null
        }
        // The window may have been rebuilt while this chapter was loading (a jump
        // to a far chapter). Its element is already detached; adopting it now
        // would add a ghost entry that is measured but never laid out.
        if (!stack.contains(entry.element)) {
            view.destroy?.()
            entry.element.remove()
            this.sections[index]?.unload?.()
            return null
        }
        // The entry joins the flow only once it has a height: a half-loaded view
        // in `#entries` would briefly report an offset of 0 and make the reader's
        // position jump.
        this.#entries.push(entry)
        this.#entries.sort((a, b) => a.index - b.index)
        this.#measure()
        // Prepend compensation: exactly the height that was added above.
        if (prepend) this.#container.scrollTop = scrollTopBefore + entry.height
        if (entry.index === this.#index) this.#view = view

        this.dispatchEvent(new CustomEvent('load', {
            detail: { doc: view.document, index },
        }))
        this.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: {
                doc: view.document, index,
                attach: overlayer => view.overlayer = overlayer,
            },
        }))
        return entry
    }
    /** Keep one viewport and a half of chapters loaded on both sides. */
    async #continuousFill() {
        if (!this.#isContinuous() || this.#materializing || !this.#entries.length) return
        this.#materializing = true
        const prefetch = Paginator.#PREFETCH_SCREENS
        try {
            for (let step = 0; step < Paginator.#MAX_FILL_STEPS; step += 1) {
                const { scrollTop, clientHeight } = this.#container
                this.#measure()
                const below = this.#stackHeight - (scrollTop + clientHeight)
                const last = this.#entries[this.#entries.length - 1]
                if (below >= clientHeight * prefetch) break
                if (!last) break
                const next = this.#continuousNeighbor(last.index, 1)
                if (next === null) break
                if (!await this.#continuousLoad(next)) break
                this.#continuousTrim()
            }
            for (let step = 0; step < Paginator.#MAX_FILL_STEPS; step += 1) {
                const { scrollTop, clientHeight } = this.#container
                const first = this.#entries[0]
                if (scrollTop > clientHeight * prefetch) break
                if (!first) break
                const previous = this.#continuousNeighbor(first.index, -1)
                if (previous === null) break
                if (!await this.#continuousLoad(previous, { prepend: true })) break
                this.#continuousTrim()
            }
        } finally {
            this.#materializing = false
        }
    }
    /**
     * The next chapter of the **reading flow** from `index` in `dir`, or null.
     *
     * `linear="no"` marks auxiliary content (a cover page, a pop-up footnote, an
     * ad) that the paginated reader deliberately steps over — `#adjacentIndex`
     * owns that rule there. The flow has to agree, or a reader scrolling on would
     * hit content neither reader was meant to read as part of the book.
     */
    #continuousNeighbor(index, dir) {
        for (let candidate = index + dir; this.#canGoToIndex(candidate); candidate += dir)
            if (this.sections[candidate]?.linear !== 'no') return candidate
        return null
    }
    /** Drop chapters from whichever end is farther from the reading position. */
    #continuousTrim() {
        const current = this.#continuousCurrent()
        while (this.#entries.length > Paginator.#MAX_LIVE_SECTIONS) {
            const first = this.#entries[0]
            const last = this.#entries[this.#entries.length - 1]
            if (!first || !last) break
            const distance = entry => Math.abs(entry.index - (current?.index ?? this.#index))
            const dropFirst = first !== current
                && (last === current || distance(first) >= distance(last))
            const entry = dropFirst ? first : (last !== current ? last : null)
            if (!entry) break
            const wasAbove = current ? entry.index < current.index : false
            const droppedHeight = entry.height
            this.#dropEntry(entry)
            if (wasAbove) this.#container.scrollTop -= droppedHeight
            this.#measure()
        }
    }
    #continuousOnScroll() {
        if (this.#scrollFrame) return
        this.#scrollFrame = requestAnimationFrame(() => {
            this.#scrollFrame = 0
            void this.#continuousFill()
        })
    }
    /**
     * A live chapter changed height (fonts, images, a typography change). Every
     * offset moves; when it is the chapter the reader is looking at, the anchored
     * range is put back where it was.
     */
    #continuousOnExpand(index) {
        this.#measure()
        if (index !== this.#anchorIndex) return
        const entry = this.#entries.find(candidate => candidate.index === index)
        const anchor = this.#anchor
        if (!entry || !anchor) return
        const rects = uncollapse(anchor)?.getClientRects?.()
        if (!rects?.length) return
        const rect = Array.from(rects).find(r => r.width > 0 && r.height > 0) ?? rects[0]
        if (!rect) return
        this.#container.scrollTop = entry.offset + rect.top
    }
    /** The relocate detail for the viewport's current chapter. */
    #continuousAfterScroll(reason) {
        const entry = this.#continuousCurrent()
        if (!entry?.view.document) return
        const size = this.size
        const local = Math.max(0, this.#container.scrollTop - entry.offset)
        const range = getVisibleRange(entry.view.document,
            local + this.#margin, local + size - this.#margin, this.#getRectMapper())
        this.#lastVisibleRange = range
        // Don't set a new anchor if relocation was to scroll to an anchor (same
        // rule as `#afterScroll`).
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#anchor = range
        else this.#justAnchored = true
        this.#index = entry.index
        this.#anchorIndex = entry.index
        this.#view = entry.view
        const detail = { reason, range, index: entry.index }
        detail.fraction = entry.height > 0
            ? Math.max(0, Math.min(1, local / entry.height))
            : 0
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
    }
    /** Scroll to an absolute offset inside the stack (clamped to its extent). */
    #continuousScrollTo(offset, reason, smooth) {
        const element = this.#container
        const max = Math.max(0, this.#stackHeight - this.size)
        const target = Math.max(0, Math.min(max, offset))
        const apply = () => {
            element.scrollTop = target
            this.#continuousAfterScroll(reason)
            this.#continuousOnScroll()
        }
        if (element.scrollTop === target) return Promise.resolve(apply())
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated'))
            return animate(element.scrollTop, target, 300, easeOutQuad,
                x => element.scrollTop = x).then(apply)
        return Promise.resolve(apply())
    }
    /** Scroll to an anchor (fraction, Element or Range) inside one live chapter. */
    #continuousScrollToAnchor(entry, anchor, reason = 'anchor') {
        this.#anchor = anchor
        this.#anchorIndex = entry.index
        const rects = uncollapse(anchor)?.getClientRects?.()
        if (rects?.length) {
            const rect = Array.from(rects).find(r => r.width > 0 && r.height > 0) ?? rects[0]
            if (!rect) return Promise.resolve()
            // `#getRectMapper` maps a rect inside the chapter's iframe viewport into
            // the view element's own coordinates (it adds the page margin); the
            // stack offset is what the container scrolls in.
            const offset = entry.offset + this.#getRectMapper()(rect).left - this.#margin
            return this.#continuousScrollTo(offset, reason)
        }
        if (typeof anchor === 'number')
            return this.#continuousScrollTo(entry.offset + anchor * entry.height, reason)
        return Promise.resolve()
    }
    /**
     * Continuous navigation: an already-loaded chapter is reached by **scrolling
     * to it** (that is the whole point — 章节跳转 == 滚动到锚点); a chapter that is
     * not mounted yet replaces the window.
     */
    async #continuousGoTo({ index, anchor, select }) {
        if (!this.#canGoToIndex(index)) return
        let entry = this.#entries.find(candidate => candidate.index === index)
        if (!entry) {
            for (const stale of [...this.#entries]) this.#dropEntry(stale)
            this.#stackHeight = 0
            this.#index = index
            entry = await this.#continuousLoad(index)
        }
        if (!entry) return
        this.#index = index
        this.#view = entry.view
        const resolved = (typeof anchor === 'function' ? anchor(entry.view.document) : anchor) ?? 0
        await this.#continuousScrollToAnchor(entry, resolved,
            select ? 'selection' : 'navigation')
        void this.#continuousFill()
    }
    /** Repaint a chapter's injected stylesheet from the current reader styles. */
    #applyStylesTo(doc) {
        const $$styles = this.#styleMap.get(doc)
        if (!$$styles) return
        const [$beforeStyle, $style] = $$styles
        const styles = this.#styles
        if (Array.isArray(styles)) {
            const [beforeStyle, style] = styles
            $beforeStyle.textContent = beforeStyle
            $style.textContent = style
        } else $style.textContent = styles ?? ''
    }
    #beforeRender({ vertical, rtl, background }) {
        this.#vertical = vertical
        this.#rtl = rtl
        this.#top.classList.toggle('vertical', vertical)

        // set background to `doc` background
        // this is needed because the iframe does not fill the whole element
        this.#background.style.background = background

        const { width, height } = this.#container.getBoundingClientRect()
        const size = vertical ? height : width

        const style = getComputedStyle(this.#top)
        const maxInlineSize = parseFloat(style.getPropertyValue('--_max-inline-size'))
        const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count-spread'))
        const margin = parseFloat(style.getPropertyValue('--_margin'))
        this.#margin = margin

        const g = parseFloat(style.getPropertyValue('--_gap')) / 100
        // The gap will be a percentage of the #container, not the whole view.
        // This means the outer padding will be bigger than the column gap. Let
        // `a` be the gap percentage. The actual percentage for the column gap
        // will be (1 - a) * a. Let us call this `b`.
        //
        // To make them the same, we start by shrinking the outer padding
        // setting to `b`, but keep the column gap setting the same at `a`. Then
        // the actual size for the column gap will be (1 - b) * a. Repeating the
        // process again and again, we get the sequence
        //     x₁ = (1 - b) * a
        //     x₂ = (1 - x₁) * a
        //     ...
        // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
        // So to make the spacing even, we must shrink the outer padding with
        //     f(x) = x / (1 + x).
        // But we want to keep the outer padding, and make the inner gap bigger.
        // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
        const gap = -g / (g - 1) * size

        const flow = this.getAttribute('flow')
        if (flow === 'scrolled') {
            // FIXME: vertical-rl only, not -lr
            this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
            this.#top.style.padding = '0'
            const columnWidth = maxInlineSize

            this.heads = null
            this.feet = null
            this.#header.replaceChildren()
            this.#footer.replaceChildren()

            return { flow, margin, gap, columnWidth }
        }

        const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize))
        const columnWidth = (size / divisor) - gap
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        const marginalDivisor = vertical
            ? Math.min(2, Math.ceil(width / maxInlineSize))
            : divisor
        const marginalStyle = {
            gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
            gap: `${gap}px`,
            direction: this.bookDir === 'rtl' ? 'rtl' : 'ltr',
        }
        Object.assign(this.#header.style, marginalStyle)
        Object.assign(this.#footer.style, marginalStyle)
        const heads = makeMarginals(marginalDivisor, 'head')
        const feet = makeMarginals(marginalDivisor, 'foot')
        this.heads = heads.map(el => el.children[0])
        this.feet = feet.map(el => el.children[0])
        this.#header.replaceChildren(...heads)
        this.#footer.replaceChildren(...feet)

        return { height, width, margin, gap, columnWidth }
    }
    render() {
        if (!this.isConnected) return
        // readest-plus: every live chapter shares one relayout in continuous mode
        // (a typography or column-width change must reach all of them).
        if (this.#isContinuous()) {
            // Idempotent: adopts the view that is already rendered when the mode
            // was entered before anything was drawn.
            this.#continuousInit()
            if (!this.#entries.length) return
            const layout = this.#beforeRender({ vertical: this.#vertical, rtl: this.#rtl })
            const anchorIndex = this.#anchorIndex
            for (const entry of this.#entries) entry.view.render(layout)
            this.#measure()
            // Each view's own `expand()` re-anchors the reader's chapter; this is
            // the floor for the case where none of them did.
            const anchorEntry = this.#entries.find(entry => entry.index === anchorIndex)
            if (anchorEntry) this.#continuousScrollToAnchor(anchorEntry, this.#anchor, 'anchor')
            return
        }
        if (!this.#view || !this.#view.document?.documentElement) return
        this.#view.render(this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        }))
        this.#scrollToAnchor(this.#anchor)
    }
    get scrolled() {
        return this.getAttribute('flow') === 'scrolled'
    }
    get scrollProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
            : scrolled ? 'scrollTop' : 'scrollLeft'
    }
    get sideProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'width' : 'height')
            : scrolled ? 'height' : 'width'
    }
    get size() {
        return this.#container.getBoundingClientRect()[this.sideProp]
    }
    get viewSize() {
        return this.#view.element.getBoundingClientRect()[this.sideProp]
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get page() {
        return Math.floor(((this.start + this.end) / 2) / this.size)
    }
    get pages() {
        return Math.round(this.viewSize / this.size)
    }
    scrollBy(dx, dy) {
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        const [offset, a, b] = this.#scrollBounds
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        element[scrollProp] = Math.max(min, Math.min(max,
            element[scrollProp] + delta))
    }
    snap(vx, vy) {
        const velocity = this.#vertical ? vy : vx
        const [offset, a, b] = this.#scrollBounds
        const { start, end, pages, size } = this
        const min = Math.abs(offset) - a
        const max = Math.abs(offset) + b
        const d = velocity * (this.#rtl ? -size : size)
        const page = Math.floor(
            Math.max(min, Math.min(max, (start + end) / 2
                + (isNaN(d) ? 0 : d))) / size)

        this.#scrollToPage(page, 'snap').then(() => {
            const dir = page <= 0 ? -1 : page >= pages - 1 ? 1 : null
            if (dir) return this.#goTo({
                index: this.#adjacentIndex(dir),
                anchor: dir < 0 ? () => 1 : () => 0,
            })
        })
    }
    #onTouchStart(e) {
        const touch = e.changedTouches[0]
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, xy: 0,
        }
    }
    #onTouchMove(e) {
        const state = this.#touchState
        if (state.pinched) return
        state.pinched = globalThis.visualViewport.scale > 1
        if (this.scrolled || state.pinched) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        e.preventDefault()
        const touch = e.changedTouches[0]
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        this.#touchScrolled = true
        this.scrollBy(dx, dy)
    }
    #onTouchEnd() {
        this.#touchScrolled = false
        if (this.scrolled) return

        // XXX: Firefox seems to report scale as 1... sometimes...?
        // at this point I'm basically throwing `requestAnimationFrame` at
        // anything that doesn't work
        requestAnimationFrame(() => {
            if (globalThis.visualViewport.scale === 1)
                this.snap(this.#touchState.vx, this.#touchState.vy)
        })
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper() {
        if (this.scrolled) {
            const size = this.viewSize
            const margin = this.#margin
            return this.#vertical
                ? ({ left, right }) =>
                    ({ left: size - right - margin, right: size - left - margin })
                : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })
        }
        const pxSize = this.pages * this.size
        return this.#rtl
            ? ({ left, right }) =>
                ({ left: pxSize - right, right: pxSize - left })
            : this.#vertical
                ? ({ top, bottom }) => ({ left: top, right: bottom })
                : f => f
    }
    async #scrollToRect(rect, reason) {
        if (this.scrolled) {
            const offset = this.#getRectMapper()(rect).left - this.#margin
            return this.#scrollTo(offset, reason)
        }
        const offset = this.#getRectMapper()(rect).left
        return this.#scrollToPage(Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason)
    }
    async #scrollTo(offset, reason, smooth) {
        const element = this.#container
        const { scrollProp, size } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.scrolled && this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animate(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        }
    }
    async #scrollToPage(page, reason, smooth) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor, select) {
        return this.#scrollToAnchor(anchor, select ? 'selection' : 'navigation')
    }
    async #scrollToAnchor(anchor, reason = 'anchor') {
        this.#anchor = anchor
        const rects = uncollapse(anchor)?.getClientRects?.()
        // if anchor is an element or a range
        if (rects) {
            // when the start of the range is immediately after a hyphen in the
            // previous column, there is an extra zero width rect in that column
            const rect = Array.from(rects)
                .find(r => r.width > 0 && r.height > 0) || rects[0]
            if (!rect) return
            await this.#scrollToRect(rect, reason)
            return
        }
        // if anchor is a fraction
        if (this.scrolled) {
            await this.#scrollTo(anchor * this.viewSize, reason)
            return
        }
        const { pages } = this
        if (!pages) return
        const textPages = pages - 2
        const newPage = Math.round(anchor * (textPages - 1))
        await this.#scrollToPage(newPage + 1, reason)
    }
    #getVisibleRange() {
        if (this.scrolled) return getVisibleRange(this.#view.document,
            this.start + this.#margin, this.end - this.#margin, this.#getRectMapper())
        const size = this.#rtl ? -this.size : this.size
        return getVisibleRange(this.#view.document,
            this.start - size, this.end - size, this.#getRectMapper())
    }
    #afterScroll(reason) {
        const range = this.#getVisibleRange()
        this.#lastVisibleRange = range
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#anchor = range
        else this.#justAnchored = true

        const index = this.#index
        const detail = { reason, range, index }
        if (this.scrolled) detail.fraction = this.start / this.viewSize
        else if (this.pages > 0) {
            const { page, pages } = this
            this.#header.style.visibility = page > 1 ? 'visible' : 'hidden'
            detail.fraction = (page - 1) / (pages - 2)
            detail.size = 1 / (pages - 2)
        }
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
    }
    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise
        const previous = this.#view ? { doc: this.#view.document, index: this.#index } : null
        this.#index = index
        const hasFocus = this.#view?.document?.hasFocus()
        if (src) {
            // readest-plus: the replaced chapter's document is going away; say so,
            // or every listener wired to it (selection capture, 划线 marks) would
            // keep pointing at a detached document.
            if (previous?.doc) this.dispatchEvent(new CustomEvent('unload', { detail: previous }))
            const view = this.#createView()
            const afterLoad = doc => {
                if (doc.head) {
                    const $styleBefore = doc.createElement('style')
                    doc.head.prepend($styleBefore)
                    const $style = doc.createElement('style')
                    doc.head.append($style)
                    this.#styleMap.set(doc, [$styleBefore, $style])
                    this.#applyStylesTo(doc)
                }
                onLoad?.({ doc, index })
            }
            const beforeRender = this.#beforeRender.bind(this)
            await view.load(src, afterLoad, beforeRender)
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: overlayer => view.overlayer = overlayer,
                },
            }))
            this.#view = view
        }
        await this.scrollToAnchor((typeof anchor === 'function'
            ? anchor(this.#view.document) : anchor) ?? 0, select)
        if (hasFocus) this.focusView()
    }
    #canGoToIndex(index) {
        return index >= 0 && index <= this.sections.length - 1
    }
    async #goTo({ index, anchor, select}) {
        // readest-plus: in the continuous flow a chapter is reached by scrolling
        // to it; only a chapter that is not mounted yet rebuilds the window.
        if (this.#isContinuous()) return this.#continuousGoTo({ index, anchor, select })
        if (index === this.#index) await this.#display({ index, anchor, select })
        else {
            const oldIndex = this.#index
            const onLoad = detail => {
                this.sections[oldIndex]?.unload?.()
                this.setStyles(this.#styles)
                this.dispatchEvent(new CustomEvent('load', { detail }))
            }
            await this.#display(Promise.resolve(this.sections[index].load())
                .then(src => ({ index, src, anchor, onLoad, select }))
                .catch(e => {
                    console.warn(e)
                    console.warn(new Error(`Failed to load section ${index}`))
                    return {}
                }))
        }
    }
    async goTo(target) {
        if (this.#locked) return
        const resolved = await target
        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)
    }
    #scrollPrev(distance) {
        if (!this.#view) return true
        // readest-plus: continuous flow — a page turn is a scroll, never a jump to
        // another chapter (the chapters are already one flow).
        if (this.#isContinuous()) {
            const target = this.start - (distance ?? this.size)
            return this.#continuousScrollTo(target, 'page').then(() => false)
        }
        if (this.scrolled) {
            if (this.start > 0) return this.#scrollTo(
                Math.max(0, this.start - (distance ?? this.size)), null, true)
            return true
        }
        if (this.atStart) return
        const page = this.page - 1
        return this.#scrollToPage(page, 'page', true).then(() => page <= 0)
    }
    #scrollNext(distance) {
        if (!this.#view) return true
        if (this.#isContinuous()) {
            const target = this.start + (distance ?? this.size)
            return this.#continuousScrollTo(target, 'page').then(() => false)
        }
        if (this.scrolled) {
            if (this.viewSize - this.end > 2) return this.#scrollTo(
                Math.min(this.viewSize, distance ? this.start + distance : this.end), null, true)
            return true
        }
        if (this.atEnd) return
        const page = this.page + 1
        const pages = this.pages
        return this.#scrollToPage(page, 'page', true).then(() => page >= pages - 1)
    }
    get atStart() {
        return this.#adjacentIndex(-1) == null && this.page <= 1
    }
    get atEnd() {
        return this.#adjacentIndex(1) == null && this.page >= this.pages - 2
    }
    #adjacentIndex(dir) {
        for (let index = this.#index + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    async #turnPage(dir, distance) {
        if (this.#locked) return
        this.#locked = true
        const prev = dir === -1
        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
        if (shouldGo) await this.#goTo({
            index: this.#adjacentIndex(dir),
            anchor: prev ? () => 1 : () => 0,
        })
        if (shouldGo || !this.hasAttribute('animated')) await wait(100)
        this.#locked = false
    }
    prev(distance) {
        return this.#turnPage(-1, distance)
    }
    next(distance) {
        return this.#turnPage(1, distance)
    }
    prevSection() {
        return this.goTo({ index: this.#adjacentIndex(-1) })
    }
    nextSection() {
        return this.goTo({ index: this.#adjacentIndex(1) })
    }
    firstSection() {
        const index = this.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    getContents() {
        // readest-plus: every live chapter is a content, so overlays, CFI lookups
        // and search can find the one they belong to.
        if (this.#isContinuous()) return this.#entries.map(entry => ({
            index: entry.index,
            overlayer: entry.view.overlayer,
            doc: entry.view.document,
        }))
        if (this.#view) return [{
            index: this.#index,
            overlayer: this.#view.overlayer,
            doc: this.#view.document,
        }]
        return []
    }
    setStyles(styles) {
        this.#styles = styles
        // readest-plus: in continuous mode the stylesheet has to reach every live
        // chapter, not just the one `#view` happens to point at.
        const views = this.#isContinuous()
            ? this.#entries.map(entry => entry.view)
            : (this.#view ? [this.#view] : [])
        for (const view of views) {
            const doc = view.document
            if (!doc) continue
            this.#applyStylesTo(doc)
            // needed because the resize observer doesn't work in Firefox
            doc.fonts?.ready?.then(() => {
                // A chapter can be gone by the time its fonts settle (a page turn,
                // the continuous flow dropping it): expanding a detached document
                // throws, and nothing is left to expand.
                if (view.document === doc) view.expand()
            })
        }
        // NOTE: needs `requestAnimationFrame` in Chromium — and the document it
        // reads must still be alive when the frame runs, which is why it is
        // captured (and re-checked) here rather than read inside the callback.
        const primary = this.#view
        if (!primary?.document) return
        requestAnimationFrame(() => {
            const doc = primary.document
            if (doc?.defaultView) this.#background.style.background = getBackground(doc)
        })
    }
    focusView() {
        this.#view.document.defaultView.focus()
    }
    connectedCallback() {
        this.#observer.observe(this.#container)
    }
    disconnectedCallback() {
        this.#observer.disconnect()
    }
    destroy() {
        this.#observer.unobserve(this.#container)
        this.#observer.disconnect()
        if (this.#entries.length) {
            for (const entry of [...this.#entries]) this.#dropEntry(entry)
            this.#stack?.remove()
            this.#stack = null
            this.#stackHeight = 0
            this.#view = null
        }
        this.#view?.destroy?.()
        this.#view = null
        this.sections[this.#index]?.unload?.()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

customElements.define('foliate-paginator', Paginator)
