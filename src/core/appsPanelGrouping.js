/**
 * Reorganizes the Sitecore Portal "Apps" panel into collapsible product
 * groups (Prod/UAT/QA sorted to the top of each) directly on the live page.
 * Pure DOM restyling in the isolated content-script world - no page-world
 * access needed, so this never goes through the secureInject mechanism.
 */
class AppsPanelGrouper {
  static ROOT_ID = 'qtl-grouped-root';
  static STYLE_ID = 'qtl-grouped-style';
  static SOURCE_ATTR = 'data-qtl-source';

  static BADGE_STYLES = {
    prod: { color: '#a8392f', background: '#f6e3e0', label: 'Prod' },
    trial: { color: '#8a6a15', background: '#f2e9d3', label: 'Trial' },
    nonprod: { color: '#2c5f8a', background: '#dfe9f2', label: 'Non-prod' },
  };

  constructor() {
    this.logger = Logger.createContextLogger('AppsPanelGrouper');
    this.observer = null;
    this.isObserving = false;
    this.debounceTimer = null;
    this.init();
  }

  init() {
    this.createObserver();
    this.startObserving();
  }

  createObserver() {
    this.observer = new MutationObserver(() => this.scheduleApply());
    if (typeof memoryManager !== 'undefined') {
      memoryManager.registerObserver(this.observer, CONFIG.get('TIMEOUTS.OBSERVER_TIMEOUT'));
    }
  }

  startObserving() {
    if (document.body && this.observer && !this.isObserving) {
      this.observer.observe(document.body, { childList: true, subtree: true });
      this.isObserving = true;
      this.scheduleApply(); // handle tiles already rendered by the time this script runs
    } else if (!document.body) {
      setTimeout(() => this.startObserving(), (CONFIG.get('TIMEOUTS.REQUEST_DEBOUNCE') || 500) / 50);
    }
  }

  scheduleApply() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.applyGrouping(), CONFIG.get('TIMEOUTS.REQUEST_DEBOUNCE') || 500);
  }

  applyGrouping() {
    try {
      this.applyGroupingInternal();
    } catch (error) {
      if (typeof errorHandler !== 'undefined') {
        errorHandler.handleError(error, 'apps_panel_grouping', {}, async () => false);
      } else {
        this.logger.error('Apps panel grouping failed', error);
      }
    }
  }

  /**
   * Finds the real Chakra container Sitecore renders app tiles into. Tags it
   * on first discovery so later re-renders (org switches, data refreshes)
   * can be found again directly - without that tag, a naive re-scan could
   * pick up tiles already moved into our own grouped structure instead of
   * genuinely fresh ones. If Sitecore fully remounts the container (a new
   * DOM node), the tag won't be found and we re-discover + re-tag the new one.
   */
  findSourceContainer() {
    const tagged = document.querySelector(`[${AppsPanelGrouper.SOURCE_ATTR}]`);
    if (tagged) return tagged;

    const untouchedTile = Array.from(document.querySelectorAll('[data-testid^="app-card-"]')).find(
      (tile) => !tile.closest(`#${AppsPanelGrouper.ROOT_ID}`)
    );
    if (!untouchedTile) return null;

    const source = untouchedTile.parentElement;
    source.setAttribute(AppsPanelGrouper.SOURCE_ATTR, 'true');
    return source;
  }

  /**
   * True only on Sitecore Cloud's Home page. Matched against the nav bar's
   * own active-link state rather than a hardcoded testid suffix (nav-item
   * numbering shifts with which items a user's permissions show), by finding
   * whichever nav link points at the root path and checking if it's active.
   */
  isOnHomePage() {
    const navLinks = document.querySelectorAll('[data-testid^="nav-item-btn_"]');
    for (const link of navLinks) {
      let path;
      try {
        path = new URL(link.href, window.location.origin).pathname;
      } catch {
        continue;
      }
      if (path === '/') return link.hasAttribute('data-active');
    }
    // Nav bar not rendered yet - fall back to the URL itself.
    return window.location.pathname === '/';
  }

  applyGroupingInternal() {
    if (!this.isOnHomePage()) return;

    const source = this.findSourceContainer();
    if (!source) return;

    const freshTiles = Array.from(source.querySelectorAll('[data-testid^="app-card-"]'));
    if (freshTiles.length === 0) return; // nothing new since the last successful run

    const existingRoot = document.getElementById(AppsPanelGrouper.ROOT_ID);
    if (existingRoot) existingRoot.remove(); // its tiles are stale, replaced by freshTiles

    this.injectStyles();
    this.restyleTiles(freshTiles);
    const groups = this.groupByProduct(freshTiles);
    const root = this.buildGroupedUI(groups);

    source.style.display = 'none';
    source.insertAdjacentElement('afterend', root);

    this.logger.info(`Rebuilt ${groups.length} product groups from ${freshTiles.length} tiles`);
  }

  injectStyles() {
    if (document.getElementById(AppsPanelGrouper.STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = AppsPanelGrouper.STYLE_ID;
    style.textContent = `
      .qtl-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .qtl-group { border: 1px solid #e2e5e9; border-radius: 10px; margin-bottom: 10px; overflow: hidden; background: #fff; }
      .qtl-group-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; user-select: none; background: #f7f8fa; }
      .qtl-group-header:hover { background: #eef0f3; }
      .qtl-group-header img { width: 22px; height: 22px; object-fit: contain; border-radius: 4px; flex-shrink: 0; }
      .qtl-group-name { font-weight: 600; font-size: 14px; color: #1a1a1a; flex: 1; }
      .qtl-group-count { font-size: 12px; color: #6b7280; background: #e5e7eb; border-radius: 999px; padding: 2px 9px; }
      .qtl-caret { transition: transform 0.15s ease; color: #6b7280; flex-shrink: 0; }
      .qtl-group.qtl-expanded .qtl-caret { transform: rotate(90deg); }
      .qtl-group-body { border-top: 1px solid #e2e5e9; display: none; }
      .qtl-group.qtl-expanded .qtl-group-body { display: block; }
      .qtl-tile-row { display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: flex-start !important; gap: 10px; width: 100%; padding: 8px 16px 8px 44px !important; border-top: 1px solid #eef0f3; background: #fff !important; text-align: left !important; }
      .qtl-tile-row:first-child { border-top: none; }
      .qtl-tile-row:hover { background: #f7f8fa !important; }
      .qtl-qualifier { font-size: 13px; color: #374151; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left !important; }
      .qtl-badge { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
  }

  styleBadge(span, kind) {
    const s = AppsPanelGrouper.BADGE_STYLES[kind];
    span.className = 'qtl-badge';
    span.textContent = s.label;
    span.style.color = s.color;
    span.style.background = s.background;
  }

  restyleTiles(tiles) {
    tiles.forEach((tile) => {
      tile.classList.add('qtl-tile-row');
      // Chakra's own button styles set flex-direction: column + centered text;
      // pin these inline so they win regardless of stylesheet order/specificity.
      tile.style.flexDirection = 'row';
      tile.style.alignItems = 'center';
      tile.style.justifyContent = 'flex-start';
      tile.style.textAlign = 'left';

      const paragraphs = tile.querySelectorAll('p');
      if (paragraphs[0]) paragraphs[0].style.display = 'none'; // product name now lives in the group header
      if (paragraphs[1]) {
        paragraphs[1].classList.add('qtl-qualifier');
        paragraphs[1].style.textAlign = 'left';
        const wrapper = paragraphs[1].parentElement;
        if (wrapper) {
          wrapper.style.display = 'flex';
          wrapper.style.flexDirection = 'column';
          wrapper.style.alignItems = 'flex-start';
          wrapper.style.flex = '1 1 auto';
          wrapper.style.minWidth = '0';
        }
      }

      const img = tile.querySelector('img');
      if (img) img.style.display = 'none'; // ditto for the icon

      let tag = tile.querySelector('[data-testid="app-tile-environment-tag"], [data-testid="app-tile-trial-tag"]');
      if (tag) {
        const kind = tag.textContent.trim().toLowerCase() === 'trial' ? 'trial' : 'prod';
        this.styleBadge(tag, kind);
      } else {
        tag = document.createElement('span');
        tile.appendChild(tag);
        this.styleBadge(tag, 'nonprod');
      }
    });
  }

  productKeyOf(tile) {
    const src = tile.querySelector('img')?.getAttribute('src') || '';
    return src.split('/').pop() || tile.querySelector('p')?.textContent?.trim() || 'unknown';
  }

  productLabelOf(tile) {
    return tile.querySelector('p')?.textContent?.trim() || 'Unknown';
  }

  // Prod is read from the badge (set from the real environment tag); UAT/QA
  // aren't tagged by Sitecore at all, so they're detected from the org
  // qualifier text itself (e.g. "Bridgestone / QA", "Bridgestone / UAT").
  envRank(tile) {
    const badgeText = tile.querySelector('.qtl-badge')?.textContent?.trim().toLowerCase() || '';
    if (badgeText === 'prod') return 0;
    const qualifierText = tile.querySelector('.qtl-qualifier')?.textContent || '';
    if (/\buat\b/i.test(qualifierText)) return 1;
    if (/\bqa\b/i.test(qualifierText)) return 2;
    return 3;
  }

  groupByProduct(tiles) {
    const groups = new Map();
    tiles.forEach((tile) => {
      const key = this.productKeyOf(tile);
      if (!groups.has(key)) {
        groups.set(key, {
          label: this.productLabelOf(tile),
          icon: tile.querySelector('img')?.getAttribute('src') || null,
          tiles: [],
        });
      }
      groups.get(key).tiles.push(tile);
    });

    // Stable sort within each group (Prod, then UAT, then QA, then the rest).
    for (const group of groups.values()) {
      group.tiles.sort((a, b) => this.envRank(a) - this.envRank(b));
    }

    // Stable sort across groups per the fixed product order; anything not in
    // that list falls to the end, keeping its original relative order.
    return Array.from(groups.values()).sort((a, b) => CONFIG.getProductRank(a.label) - CONFIG.getProductRank(b.label));
  }

  buildGroupedUI(groups) {
    const root = document.createElement('div');
    root.id = AppsPanelGrouper.ROOT_ID;
    root.className = 'qtl-root';

    groups.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'qtl-group';

      const header = document.createElement('div');
      header.className = 'qtl-group-header';
      header.innerHTML = '<svg class="qtl-caret" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18Z"/></svg>';

      if (group.icon) {
        const img = document.createElement('img');
        img.src = group.icon;
        img.alt = group.label;
        header.appendChild(img);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'qtl-group-name';
      nameSpan.textContent = group.label;
      header.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'qtl-group-count';
      countSpan.textContent = String(group.tiles.length);
      header.appendChild(countSpan);

      header.addEventListener('click', () => groupEl.classList.toggle('qtl-expanded'));

      const body = document.createElement('div');
      body.className = 'qtl-group-body';
      group.tiles.forEach((tile) => body.appendChild(tile));

      groupEl.appendChild(header);
      groupEl.appendChild(body);
      root.appendChild(groupEl);
    });

    return root;
  }
}

const appsPanelGrouper = new AppsPanelGrouper();
