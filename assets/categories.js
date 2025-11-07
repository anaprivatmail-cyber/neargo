// Centraliziran seznam kategorij za NearGo.
// Vse spremembe (nazivi, ikone, vrstni red) uredite tukaj.

const ICON_BASE = '/assets/icons';
const icon = (name) => `${ICON_BASE}/${name}`;

export const EVENT_CATEGORIES = [
  { key: 'koncert', label: 'Koncerti', icon: icon('guitar.svg') },
  { key: 'hrana', label: 'Kulinarika', icon: icon('food.svg') },
  { key: 'otroci', label: 'Družina & otroci', icon: icon('family.svg') },
  { key: 'sport', label: 'Šport & rekreacija', icon: icon('sport.svg') },
  { key: 'kultura', label: 'Kultura & umetnost', icon: icon('culture.svg') },
  { key: 'sejmi', label: 'Sejmi & tržnice', icon: icon('fair.svg') },
  { key: 'narava', label: 'Narava & izleti', icon: icon('nature.svg') },
  { key: 'zabava', label: 'Zabava & nočno življenje', icon: icon('party.svg') },
  { key: 'za-podjetja', label: 'Za podjetja', icon: icon('service.svg') },
  { key: 'ostalo', label: 'Ostalo', icon: icon('other.svg') }
];

export const SERVICE_CATEGORIES = [
  { key: 'frizer', label: 'Frizerji & lepota', icon: icon('beauty.svg') },
  { key: 'kozmetika', label: 'Kozmetika & nega', icon: icon('beauty.svg') },
  { key: 'wellness', label: 'Wellness & spa', icon: icon('wellness.svg') },
  { key: 'zdravje', label: 'Zdravje & optike', icon: icon('health.svg') },
  { key: 'kulinarika', label: 'Kulinarika & catering', icon: icon('food.svg') },
  { key: 'fitnes', label: 'Šport & fitnes', icon: icon('fit.svg') },
  { key: 'avto-moto', label: 'Avto & moto', icon: icon('car.svg') },
  { key: 'turizem', label: 'Turizem & doživetja', icon: icon('travel.svg') },
  { key: 'gospodinjske', label: 'Dom & gospodinjstvo', icon: icon('home-garden.svg') },
  { key: 'ostalo', label: 'Ostalo', icon: icon('other.svg') }
];

export const EVENT_CATEGORY_MAP = EVENT_CATEGORIES.reduce((acc, cat) => {
  acc[cat.key] = cat;
  return acc;
}, {});

export const SERVICE_CATEGORY_MAP = SERVICE_CATEGORIES.reduce((acc, cat) => {
  acc[cat.key] = cat;
  return acc;
}, {});

export const getEventCategory = (key) => EVENT_CATEGORY_MAP[key] || null;
export const getServiceCategory = (key) => SERVICE_CATEGORY_MAP[key] || null;

export const formatCategoryLabel = (key = '') => (key || '')
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

export const getCategoryList = (type = 'events') => {
  if (type === 'services') return [...SERVICE_CATEGORIES];
  return [...EVENT_CATEGORIES];
};

export const getCategoryKeys = (type = 'events') => getCategoryList(type).map((cat) => cat.key);

const createUtils = () => ({
  getList: getCategoryList,
  getKeys: getCategoryKeys,
  getByKey(type, key){
    const list = getCategoryList(type);
    return list.find((cat) => cat.key === key) || null;
  },
  formatLabel: formatCategoryLabel
});

if (typeof window !== 'undefined'){
  window.NearGoCategories = {
    events: EVENT_CATEGORIES,
    services: SERVICE_CATEGORIES
  };
  window.NearGoCategoryMaps = {
    events: EVENT_CATEGORY_MAP,
    services: SERVICE_CATEGORY_MAP
  };
  window.NearGoCategoryUtils = createUtils();
  document.dispatchEvent(new CustomEvent('neargo:categories-ready', {
    detail: {
      events: EVENT_CATEGORIES,
      services: SERVICE_CATEGORIES
    }
  }));
}
