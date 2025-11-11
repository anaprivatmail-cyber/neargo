export const CATEGORY_SOURCE = {
  events: [
    {
      key: 'koncerti',
      label: 'Koncerti',
      emoji: '🎸',
      icon: 'guitar.svg',
      aliases: ['koncert', 'koncerti', 'glasba', 'music', 'zabava'],
      sub: [
        { key: 'rock-alternativa', label: 'Rock & alternativa' },
        { key: 'pop-mainstream', label: 'Pop & mainstream' },
        { key: 'jazz-blues', label: 'Jazz & blues' },
        { key: 'klasicna-opera', label: 'Klasična & opera' },
        { key: 'klub-vecer', label: 'Klub večer' },
        { key: 'koncert-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'kulinarka',
      label: 'Kulinarka',
      emoji: '🍽️',
      icon: 'food.svg',
      aliases: ['kulinarika', 'hrana', 'gastro', 'food', 'degustacija', 'trznica'],
      sub: [
        { key: 'degustacije', label: 'Degustacije' },
        { key: 'tematski-veceri', label: 'Tematski večeri' },
        { key: 'chef-meni', label: 'Chef meni' },
        { key: 'gostilna-tedni', label: 'Gostilna tedni' },
        { key: 'ulicni-okusi', label: 'Ulični okusi' },
        { key: 'kulinarika-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'kultura-umetnost',
      label: 'Kultura & umetnost',
      emoji: '🎨',
      icon: 'culture.svg',
      aliases: ['kultura', 'umetnost', 'razstava', 'film'],
      sub: [
        { key: 'gledalisce', label: 'Gledališče' },
        { key: 'razstave-muzeji', label: 'Razstave & muzeji' },
        { key: 'film-kino', label: 'Film & kino' },
        { key: 'literatura-pogovori', label: 'Literatura & pogovori' },
        { key: 'stand-up', label: 'Stand-up' },
        { key: 'kultura-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'druzina-otroci',
      label: 'Družina & otroci',
      emoji: '👨‍👩‍👧',
      icon: 'family.svg',
      aliases: ['otroci', 'family', 'kids', 'druzina'],
      sub: [
        { key: 'ustvarjalne-delavnice', label: 'Ustvarjalne delavnice' },
        { key: 'otroske-predstave', label: 'Otroške predstave' },
        { key: 'druzenski-izleti', label: 'Družinski izleti' },
        { key: 'varstvo-na-dogodkih', label: 'Varstvo na dogodkih' },
        { key: 'druzina-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'sport-tekmovanja',
      label: 'Šport & tekmovanja',
      emoji: '🏃‍♀️',
      icon: 'sport.svg',
      aliases: ['sport', 'šport', 'rekreacija', 'fit', 'tekma', 'tekmovanje', 'liga'],
      sub: [
        { key: 'rekreativni-teki', label: 'Rekreativni teki' },
        { key: 'ekipni-turnirji', label: 'Ekipni turnirji' },
        { key: 'fit-izzivi', label: 'Fit izzivi' },
        { key: 'joga-mindfulness', label: 'Joga & mindfulness' },
        { key: 'solski-sport', label: 'Šolski šport' },
        { key: 'sport-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'outdoor-narava',
      label: 'Outdoor & narava',
      emoji: '🏞️',
      icon: 'nature.svg',
      aliases: ['narava', 'outdoor', 'pohodi', 'trek'],
      sub: [
        { key: 'pohodi-treking', label: 'Pohodi & treking' },
        { key: 'kampiranje-glamping', label: 'Kampiranje & glamping' },
        { key: 'vodni-sporti', label: 'Vodni športi' },
        { key: 'naravoslovni-ogledi', label: 'Naravoslovni ogledi' },
        { key: 'kmetije-dozivetja', label: 'Kmetije doživetja' },
        { key: 'outdoor-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'ucenje-skill',
      label: 'Učenje & skill',
      emoji: '🧠',
      icon: 'learn.svg',
      aliases: ['ucenje', 'delavnice', 'skill', 'workshop', 'izobrazevanje'],
      sub: [
        { key: 'karierni-pospesek', label: 'Karierni pospešek' },
        { key: 'tech-digital', label: 'Tech & digital' },
        { key: 'kreativne-delavnice', label: 'Kreativne delavnice' },
        { key: 'jezikovni-tecaji', label: 'Jezikovni tečaji' },
        { key: 'starsevski-coaching', label: 'Starševski coaching' },
        { key: 'ucenje-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'dom-vrt',
      label: 'Dom & vrt',
      emoji: '🏡',
      icon: 'home-garden.svg',
      aliases: ['dom', 'vrt', 'home', 'garden'],
      sub: [
        { key: 'diy-delavnice', label: 'DIY delavnice' },
        { key: 'vrtnarski-dnevi', label: 'Vrtnarski dnevi' },
        { key: 'pametni-dom', label: 'Pametni dom' },
        { key: 'notranje-oblikovanje', label: 'Notranje oblikovanje' },
        { key: 'trajnostni-projekti', label: 'Trajnostni projekti' },
        { key: 'dom-vrt-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'posel-networking',
      label: 'Posel & networking',
      emoji: '�',
      icon: 'service.svg',
      aliases: ['poslovni', 'business', 'b2b', 'za-podjetja'],
      sub: [
        { key: 'konference', label: 'Konference' },
        { key: 'startup-pitch', label: 'Startup pitch' },
        { key: 'b2b-meetupi', label: 'B2B meetupi' },
        { key: 'korporativni-forumi', label: 'Korporativni forumi' },
        { key: 'produktni-launch', label: 'Produktni launch' },
        { key: 'posel-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'ostalo',
      label: 'Ostalo',
      emoji: '✨',
      icon: 'other.svg',
      aliases: ['ostalo', 'drugo', 'zabava'],
      sub: [
        { key: 'afterwork-druzenja', label: 'Afterwork druženja' },
        { key: 'pub-kvizi', label: 'Pub kvizi' },
        { key: 'dobrodelne-akcije', label: 'Dobrodelne akcije' },
        { key: 'lokalna-skupnost', label: 'Lokalna skupnost' },
        { key: 'sezonski-dogodki', label: 'Sezonski dogodki' },
        { key: 'ostalo-ostalo', label: 'Ostalo' }
      ]
    }
  ],
  services: [
    {
      key: 'lepota',
      label: 'Lepota',
      emoji: '🪞',
      icon: 'beauty.svg',
      aliases: ['frizer', 'barber', 'lepota', 'salon'],
      sub: [
        { key: 'frizerji-barber', label: 'Frizerji & barber' },
        { key: 'licenje-videzi', label: 'Ličenje & posebni videzi' },
        { key: 'stilsko-svetovanje', label: 'Stilsko svetovanje' },
        { key: 'lepota-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'nega-kozmetika',
      label: 'Nega & kozmetika',
      emoji: '🧴',
      icon: 'beauty.svg',
      aliases: ['kozmetika', 'nega', 'kozmeticni salon'],
      sub: [
        { key: 'nega-obraza', label: 'Nega obraza & lash/brow' },
        { key: 'manikura-pedikura', label: 'Manikura & pedikura' },
        { key: 'tretmaji-telesa', label: 'Tretmaji telesa' },
        { key: 'estetski-posegi', label: 'Estetski posegi' },
        { key: 'aparaturne-terapije', label: 'Aparaturne terapije' },
        { key: 'nega-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'wellness',
      label: 'Wellness',
      emoji: '�‍♀️',
      icon: 'wellness.svg',
      aliases: ['spa', 'wellness', 'relax'],
      sub: [
        { key: 'masaze', label: 'Masaže' },
        { key: 'savne-rituali', label: 'Savne & rituali' },
        { key: 'spa-razvajanja', label: 'Spa razvajanja' },
        { key: 'mindfulness-programi', label: 'Mindfulness programi' },
        { key: 'wellness-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'zdravje',
      label: 'Zdravje',
      emoji: '🩺',
      icon: 'health.svg',
      aliases: ['zdravje', 'terapije', 'health'],
      sub: [
        { key: 'fizioterapija', label: 'Fizioterapija' },
        { key: 'psihoterapija-coaching', label: 'Psihoterapija & coaching' },
        { key: 'nutricionistika', label: 'Nutricionistika' },
        { key: 'zobozdravstvo', label: 'Zobozdravstvo' },
        { key: 'alternativne-terapije', label: 'Alternativne terapije' },
        { key: 'zdravje-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'trening',
      label: 'Trening',
      emoji: '🏋️‍♂️',
      icon: 'fit.svg',
      aliases: ['fitnes', 'sport', 'coaching'],
      sub: [
        { key: 'osebni-trenerji', label: 'Osebni trenerji' },
        { key: 'skupinske-vadbe', label: 'Skupinske vadbe' },
        { key: 'joga-pilates', label: 'Joga & pilates' },
        { key: 'outdoor-kondicija', label: 'Outdoor kondicija' },
        { key: 'fitnes-centri', label: 'Fitnes centri' },
        { key: 'trening-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'kulinarka-catering',
      label: 'Kulinarka & catering',
      emoji: '�️',
      icon: 'food.svg',
      aliases: ['kulinarika-catering', 'catering', 'kulinarika', 'kulinarične storitve'],
      sub: [
        { key: 'catering', label: 'Catering' },
        { key: 'privatni-kuhar', label: 'Privatni kuhar' },
        { key: 'tematski-meni', label: 'Tematski meni' },
        { key: 'degustacije-storitve', label: 'Degustacije' },
        { key: 'slascicarne', label: 'Slaščičarne' },
        { key: 'specialne-ponudbe', label: 'Specialne ponudbe' },
        { key: 'kulinarika-catering-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'dom-vrt',
      label: 'Dom & vrt',
      emoji: '🏡',
      icon: 'home-garden.svg',
      aliases: ['dom', 'vrt', 'home', 'garden'],
      sub: [
        { key: 'ciscenje', label: 'Čiščenje' },
        { key: 'gradbena-instalacijska', label: 'Gradbena & instalacijska dela' },
        { key: 'vzdrzevanje-doma', label: 'Vzdrževanje doma' },
        { key: 'selitve-prevozi', label: 'Selitve & prevozi' },
        { key: 'vrtnarjenje', label: 'Vrtnarjenje' },
        { key: 'dom-vrt-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'avto',
      label: 'Avto',
      emoji: '🚗',
      icon: 'car.svg',
      aliases: ['mobilnost', 'vozila', 'avtomobil', 'mobilnost-servis'],
      sub: [
        { key: 'servis-vozil', label: 'Servis vozil' },
        { key: 'gume-vulkanizer', label: 'Gume & vulkanizer' },
        { key: 'pranje-detailing', label: 'Pranje & detailing' },
        { key: 'izposoja', label: 'Izposoja' },
        { key: 'prevozi-po-meri', label: 'Prevozi po meri' },
        { key: 'avto-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'druzina-otroci',
      label: 'Družina & otroci',
      emoji: '👨‍👩‍👧',
      icon: 'family.svg',
      aliases: ['varstvo', 'kids', 'otroci', 'druzina'],
      sub: [
        { key: 'varstvo', label: 'Varstvo' },
        { key: 'dopoldanske-aktivnosti', label: 'Dopoldanske aktivnosti' },
        { key: 'animatorji', label: 'Animatorji' },
        { key: 'ucna-pomoc', label: 'Učna pomoč' },
        { key: 'druzinski-coaching', label: 'Družinski coaching' },
        { key: 'druzina-storitve-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'poslovne',
      label: 'Poslovne storitve',
      emoji: '�',
      icon: 'service.svg',
      aliases: ['poslovne-storitve', 'business', 'b2b'],
      sub: [
        { key: 'racunovodstvo-finance', label: 'Računovodstvo & finance' },
        { key: 'pravne-storitve', label: 'Pravne storitve' },
        { key: 'marketing-branding', label: 'Marketing & branding' },
        { key: 'it-razvoj', label: 'IT podpora & razvoj' },
        { key: 'hr-recruitment', label: 'HR & recruitment' },
        { key: 'poslovne-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'izobrazevanje',
      label: 'Izobraževanje & mentoring',
      emoji: '🎓',
      icon: 'learn.svg',
      aliases: ['izobrazevanje', 'mentoring', 'tecaji', 'coaching'],
      sub: [
        { key: 'jezikovni-tecaji-storitve', label: 'Jezikovni tečaji' },
        { key: 'digitalne-vescine', label: 'Digitalne veščine' },
        { key: 'umetniski-coaching', label: 'Umetniški coaching' },
        { key: 'karierni-mentorji', label: 'Karierni mentorji' },
        { key: 'delavnice-za-podjetja', label: 'Delavnice za podjetja' },
        { key: 'izobrazevanje-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'ljubljencki',
      label: 'Ljubljenčki',
      emoji: '🐾',
      icon: 'other.svg',
      aliases: ['pets', 'zivali', 'zival'],
      sub: [
        { key: 'veterinar', label: 'Veterinar' },
        { key: 'pasji-salon', label: 'Pasji salon' },
        { key: 'hotel-za-zivali', label: 'Hotel za živali' },
        { key: 'varstvo-sprehodi', label: 'Varstvo & sprehodi' },
        { key: 'solanje-ljubljenckov', label: 'Šolanje hišnih ljubljenčkov' },
        { key: 'ljubljencki-ostalo', label: 'Ostalo' }
      ]
    },
    {
      key: 'ostalo',
      label: 'Ostalo',
      emoji: '✨',
      icon: 'other.svg',
      aliases: ['ostalo', 'drugo'],
      sub: [
        { key: 'kreativni-projekti', label: 'Kreativni projekti' },
        { key: 'digitalne-storitve', label: 'Digitalne storitve' },
        { key: 'lokalna-podpora', label: 'Lokalna podpora' },
        { key: 'sezonske-ponudbe', label: 'Sezonske ponudbe' },
        { key: 'ostalo-ostalo', label: 'Ostalo' }
      ]
    }
  ]
};
