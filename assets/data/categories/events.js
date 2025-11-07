export const EVENT_CATEGORY_SOURCE = [
  {
    key: 'koncert',
    label: 'Koncerti',
    emoji: '🎸',
    icon: 'guitar.svg',
    aliases: ['koncerti', 'glasba', 'music'],
    sub: [
      { key: 'rock', label: 'Rock' },
      { key: 'pop', label: 'Pop' },
      { key: 'klasicna', label: 'Klasična glasba' },
      { key: 'jazz', label: 'Jazz & blues' },
      { key: 'elektronska', label: 'Elektronska' }
    ]
  },
  {
    key: 'hrana',
    label: 'Kulinarika',
    emoji: '🍲',
    icon: 'food.svg',
    aliases: ['kulinarika', 'degustacija', 'gastro'],
    sub: [
      { key: 'festivali', label: 'Festivali hrane' },
      { key: 'degustacije', label: 'Degustacije' },
      { key: 'street-food', label: 'Street food' },
      { key: 'vino', label: 'Vino & pijače' }
    ]
  },
  {
    key: 'kultura',
    label: 'Kultura & umetnost',
    emoji: '🎭',
    icon: 'culture.svg',
    aliases: ['umetnost', 'razstave'],
    sub: [
      { key: 'gledalisce', label: 'Gledališče' },
      { key: 'razstava', label: 'Razstave' },
      { key: 'film', label: 'Film & kino' },
      { key: 'literatura', label: 'Literatura' }
    ]
  },
  {
    key: 'izobrazevanje',
    label: 'Izobraževanje & delavnice',
    emoji: '🎓',
    icon: 'education.svg',
    aliases: ['učenje', 'workshop', 'delavnice'],
    sub: [
      { key: 'workshop', label: 'Delavnice' },
      { key: 'tecnicno', label: 'Tehnična izobraževanja' },
  { key: 'mehke-vescine', label: 'Mehke veščine' }
    ]
  },
  {
    key: 'otroci',
    label: 'Družina & otroci',
    emoji: '🧸',
    icon: 'family.svg',
    aliases: ['druzina', 'otrosko', 'family'],
    sub: [
      { key: 'delavnice-otroske', label: 'Delavnice za otroke' },
      { key: 'pustolovscine', label: 'Pustolovščine' },
      { key: 'drustva', label: 'Druženja & klubi' }
    ]
  },
  {
    key: 'sport',
    label: 'Šport & rekreacija',
    emoji: '⚽',
    icon: 'sport.svg',
    aliases: ['šport', 'fit', 'rekreacija'],
    sub: [
      { key: 'tek', label: 'Tek' },
      { key: 'kolesarjenje', label: 'Kolesarjenje' },
      { key: 'fitnes', label: 'Fitnes' },
      { key: 'yoga', label: 'Joga & wellbeing' }
    ]
  },
  {
    key: 'narava',
    label: 'Outdoor & narava',
    emoji: '⛰️',
    icon: 'fair.svg',
    aliases: ['outdoor', 'pohodi', 'naravni'],
    sub: [
      { key: 'izleti', label: 'Izleti' },
      { key: 'kampiranje', label: 'Kampiranje' },
      { key: 'vodenja', label: 'Vodeni ogledi' }
    ]
  },
  {
    key: 'zabava',
    label: 'Zabava & nočno življenje',
    emoji: '🎉',
    icon: 'other.svg',
    aliases: ['party', 'nocno-zivljenje', 'nightlife'],
    sub: [
      { key: 'klubi', label: 'Klubi & lounge' },
      { key: 'tematski', label: 'Tematski večeri' },
      { key: 'pub-quiz', label: 'Pub kvizi' }
    ]
  },
  {
    key: 'za-podjetja',
    label: 'Poslovni dogodki',
    emoji: '🏢',
    icon: 'service.svg',
    aliases: ['poslovni', 'business', 'b2b', 'konference'],
    sub: [
      { key: 'konference', label: 'Konference' },
      { key: 'networking', label: 'Networking' },
      { key: 'interno', label: 'Interni dogodki' }
    ]
  },
  {
    key: 'ostalo',
    label: 'Ostalo',
    emoji: '✨',
    icon: 'other.svg',
    aliases: ['drugo', 'misc'],
    sub: []
  }
];
