import { CATEGORY_SOURCE } from './data/categories/source.js';

const ICON_BASE = '/assets/icons';

const canonicalEventCategories = CATEGORY_SOURCE.events;
const canonicalServiceCategories = CATEGORY_SOURCE.services;

const normalizeIcon = (iconName) => {
  if (!iconName) return null;
  return iconName.startsWith('/') ? iconName : `${ICON_BASE}/${iconName}`;
};

const deepCloneCategory = (cat) => ({
  key: cat.key,
  label: cat.label,
  emoji: cat.emoji || null,
  icon: normalizeIcon(cat.icon || null),
  sub: Array.isArray(cat.sub) ? cat.sub.map((item) => ({ ...item })) : [],
  aliases: Array.isArray(cat.aliases) ? [...cat.aliases] : []
});

const EVENT_CATEGORIES = canonicalEventCategories.map(deepCloneCategory);
const SERVICE_CATEGORIES = canonicalServiceCategories.map(deepCloneCategory);

const cloneList = (list = []) => list.map(deepCloneCategory);

const toMap = (list) => list.reduce((acc, cat) => {
  acc[cat.key] = cat;
  return acc;
}, {});

const EVENT_CATEGORY_MAP = toMap(EVENT_CATEGORIES);
const SERVICE_CATEGORY_MAP = toMap(SERVICE_CATEGORIES);

const normalizeKey = (value) => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' in ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const registerAlias = (map, aliasValue, canonical) => {
  const norm = normalizeKey(aliasValue);
  if (!norm) return;
  if (!map[norm]) map[norm] = canonical;
};

const buildAliasMap = (list) => {
  const map = Object.create(null);
  list.forEach((cat) => {
    registerAlias(map, cat.key, cat.key);
    registerAlias(map, cat.label, cat.key);
    registerAlias(map, cat.emoji, cat.key);
    if (Array.isArray(cat.aliases)) {
      cat.aliases.forEach((alias) => registerAlias(map, alias, cat.key));
    }
    if (Array.isArray(cat.sub)) {
      cat.sub.forEach((sub) => registerAlias(map, sub.key, cat.key));
    }
  });
  return map;
};

const CATEGORY_ALIASES = {
  events: buildAliasMap(canonicalEventCategories),
  services: buildAliasMap(canonicalServiceCategories)
};

const resolveCategoryKey = (type = 'events', value = '') => {
  const norm = normalizeKey(value);
  if (!norm) return '';
  const map = type === 'services' ? SERVICE_CATEGORY_MAP : EVENT_CATEGORY_MAP;
  if (map[norm]) return norm;
  const aliasMap = CATEGORY_ALIASES[type] || {};
  return aliasMap[norm] || norm;
};

const getCategoryList = (type = 'events') => {
  const list = type === 'services' ? SERVICE_CATEGORIES : EVENT_CATEGORIES;
  return cloneList(list);
};

const getCategoryKeys = (type = 'events') => getCategoryList(type).map((cat) => cat.key);

const getSubcategories = (type = 'events', key = '') => {
  const canonical = resolveCategoryKey(type, key);
  const map = type === 'services' ? SERVICE_CATEGORY_MAP : EVENT_CATEGORY_MAP;
  const target = map[canonical];
  return target ? target.sub.map((sub) => ({ ...sub })) : [];
};

const formatCategoryLabel = (key = '') => {
  const canonicalEvent = resolveCategoryKey('events', key);
  const canonicalService = resolveCategoryKey('services', key);
  const resolvedKey = EVENT_CATEGORY_MAP[canonicalEvent] ? canonicalEvent : canonicalService;
  const target = EVENT_CATEGORY_MAP[resolvedKey] || SERVICE_CATEGORY_MAP[resolvedKey];
  if (target) return target.label;
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const createUtils = () => ({
  getList: getCategoryList,
  getKeys: getCategoryKeys,
  getByKey(type, key) {
    const canonical = resolveCategoryKey(type, key);
    const map = type === 'services' ? SERVICE_CATEGORY_MAP : EVENT_CATEGORY_MAP;
    const item = map[canonical];
    return item ? {
      ...item,
      aliases: [...item.aliases],
      sub: item.sub.map((sub) => ({ ...sub }))
    } : null;
  },
  getSubcategories,
  resolveKey: resolveCategoryKey,
  formatLabel: formatCategoryLabel,
  getAliases(type = 'events') {
    const aliasMap = CATEGORY_ALIASES[type] || {};
    return { ...aliasMap };
  }
});

const publishToWindow = () => {
  if (typeof window === 'undefined') return;
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[categories] publishToWindow start');
  }
  const utils = createUtils();
  const eventsList = cloneList(EVENT_CATEGORIES);
  const servicesList = cloneList(SERVICE_CATEGORIES);
  window.NearGoCategories = {
    events: cloneList(EVENT_CATEGORIES),
    services: cloneList(SERVICE_CATEGORIES)
  };
  window.NearGoCategoryBootstrap = {
    events: eventsList,
    services: servicesList
  };
  window.NearGoCategoryMaps = {
    events: { ...EVENT_CATEGORY_MAP },
    services: { ...SERVICE_CATEGORY_MAP }
  };
  window.NearGoCategoryAliases = {
    events: { ...CATEGORY_ALIASES.events },
    services: { ...CATEGORY_ALIASES.services }
  };
  window.NearGoCategorySource = CATEGORY_SOURCE;
  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('neargo:categories-ready', {
      detail: {
        events: window.NearGoCategories.events,
        services: window.NearGoCategories.services
      }
    }));
  }
};

publishToWindow();

export {
  EVENT_CATEGORIES,
  SERVICE_CATEGORIES,
  EVENT_CATEGORY_MAP,
  SERVICE_CATEGORY_MAP,
  CATEGORY_ALIASES,
  getCategoryList,
  getCategoryKeys,
  getSubcategories,
  formatCategoryLabel,
  createUtils,
  resolveCategoryKey
};
