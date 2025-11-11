# NearGo – Design & UX Audit (2025-11-11)

Status: Samo pregled. Glavne strani (`index.html`) in njen header NISEM spreminjal; predlagane izboljšave so ločene. Potrdi, preden karkoli dejansko uredimo v produkcijskih datotekah.

## 1. Barvna paleta
Primarne vrednosti (ponavljajoče):
- Brand / Primary: `#0bbbd6`
- Accent (home page / koralni): `#ff6b6b`
- Assistant (Nea): `#2a7fff`
- OK / Bad: `#11a67a` / `#d64c4c`

Te barve se mešajo brez jasne hierarhije (accent vs secondary). Predlog:
- `--color-primary: #0bbbd6`
- `--color-primary-dark: #078ca1`
- `--color-accent: #ff6b6b` (uporaba samo za akcente in promocije)
- `--color-secondary: #2a7fff` (Nea, interaktivna pomočna orodja)
- `--color-success: #11a67a`
- `--color-error: #d64c4c`
- `--color-surface: #ffffff`
- `--color-surface-alt: #f9fcff`
- `--color-border: #cfe1ee`
- `--color-bg-gradient-top: #e9f7ff`

Uvedi v `tokens.css` in zamenjaj v obstoječih datotekah postopoma.

Kontrast preverjanje:
- `#ff6b6b` na belem ozadju ≈ 4.3:1 (OK za večino besedila >14px bold/normal). Za manjši tekst (<14px) dodati temnejši odtenek `#e55a5a` ali povečati velikost.

## 2. Tipografija & Line-height
- Različni `line-height`: 1.25 / 1.35 / 1.4 / 1.45 / 1.6.
- Predlagana skala: `--lh-tight:1.2`, `--lh-base:1.4`, `--lh-relaxed:1.55`.
Uporabi `body { line-height: var(--lh-base); }` in odstopanja samo na listah/hero naslovih.

## 3. Razmiki / Spacing sistem
Obstoječi mix: 4,6,8,10,12,14,16,18,20,24 px.
Predlagan modularni set (4pt grid): 4,8,12,16,20,24,32.
CSS custom props:
```
:root { --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px; --space-6:24px; --space-7:32px; }
```
Ustvari utility razrede (`.mt-4`, `.mb-2`, `.gap-3`, ...) ali uporabi `data-space` atribut za generiranje (če želiš JS approach).

## 4. Shadows & Elevation
Trenutno: `0 10px 30px rgba(0,0,0,.08)` / `0 4px 12px` / različni 2px / 6px.
Predlagaj skalo:
- `--shadow-sm: 0 2px 6px rgba(0,0,0,.08)`
- `--shadow-md: 0 4px 12px rgba(0,0,0,.10)`
- `--shadow-lg: 0 8px 26px rgba(0,0,0,.14)`
- `--shadow-focus-ring: 0 0 0 4px var(--focus)`
Nadomesti inline definicije.

## 5. Duplikati slogov / Konflikti
Najdene duplicirane komponente:
- `.btn` definiran vsaj 3× (index inline, `assets/app.css`, `assets/css/app.css`). Razlikujejo se v paddingu, barvi, hover efektih.
- `.pill` definiran vsaj 2×.
- `.cat-chip` skoraj identičen v več datotekah (index, notifications, organizers-submit).
- Header stil: sticky vs fixed vs tri vrstice → lahko povzroča razlike v izračunu `--header-h`.

Akcija: centraliziraj v `components.css`:
```
.btn { ... }  /* osnovna (primary) */
.btn--accent { background: var(--color-accent); }
.btn--secondary { background: var(--color-secondary); }
.btn--link { background: transparent; border:1px solid var(--color-border); color: var(--text); }
.btn--mini { padding: var(--space-1) var(--space-2); font-size:13px; }
```

## 6. Responsive strategija
Trenutno hack za prisilni mobilni pogled na desktop (`@media (min-width: 768px) { body { max-width:390px; ... } }`). To zavira realno testiranje.
Predlog:
- Odstrani mobilni-simulator v produkciji; uporabi ga samo v dev (npr. dodaj `body.simulate-mobile {...}` class).
- Standardni breakpoints: 480px, 640px, 768px, 1024px, 1280px.
- Uporabi `clamp()` za hero naslove že prisotno – konsistentno za vse `h1` / `.title`.

## 7. Fiksni elementi / FAB / Bannerji
Potencialni konflikt: cookie banner (`bottom:12px; left:12px; right:12px`) in `.nea-fab` (`bottom:24px; right:24px`). Na majhnih zaslonih lahko prekrivanje.
Rešitve:
- Dodaj `safe-area` upoštevajoč `env(safe-area-inset-bottom)`.
- Dodaj prilagoditev: če je prikazan cookie banner, dodaj razred `body.cookie-open` in premakni FAB (`bottom: 86px`).

## 8. Dostopnost (A11y)
- Custom checkbox/radio 14px – minimalni tap target na mobilnem iOS/Android naj bo ~44px. Dodaj `padding` ali pseudo-element za večji klik area.
- Barvni badgeji (korala, zelen) imajo dobro kontrastno razmerje; preveri temno temo – korala na temnem ozadju potrebuje `#ff7d7d` ali outline.
- Focus stanja: nekateri gumbi nimajo `:focus-visible` (npr. `.mode`, `.pill.lang button` znotraj menuja). Dodaj univerzalno: `*:focus-visible { outline: 3px solid var(--focus); outline-offset:2px; }` (z modulacijo za specifične komponente).
- `aria-live` uporabljeno pri statusih OK – dobro; dodaj `role="status"` kjer manjka (toast?).

## 9. Performance & Organizacija
- Inline CSS v `index.html` ~ obsežno → prerazporedi v ločeno `home.css` (manj HTML velikosti, boljše keširanje).
- Združi gradient ozadje v en `background: ...` var za reuse.
- Preload kritične font datoteke (Inter, variable). `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
- Lazy load ne-kritičnih modulov (`featuredCard` carousel JS po `requestIdleCallback`).

## 10. Dark Mode
- Trenutno spremeni le besedilne + surface barve. Accent (#ff6b6b) ostane; lahko dodamo `--accent-dark: #ff8585` za dark (manj kontrasta glare).
- Map overlay gumbi v dark načinu: ozadje ostane svetlo (#fff). Dodaj `.dark .btn.secondary { background:#0aa5c1; }` itd.

## 11. Priporočena struktura map
```
assets/styles/
  tokens.css        # barve, spacing, shadows, z-index, radii
  base.css          # reset, body, typography
  components.css    # .btn, .pill, .card, .chip, form controls
  layout.css        # header, nav, grid helpers, spacing utilities
  pages/
    home.css        # samo stvari za index
    organizers.css  # strani za organizatorje
    account.css     # profil/notifications
    assistant.css   # Nea panel/fab
```
In vsaka HTML stran naj nalaga: tokens.css + base.css + components.css + layout.css + specifičen pages/*.

## 12. Cat-chip konsolidacija
Skoraj identični odseki. Uporabi en markup:
```
<button class="chip chip--cat" data-cat="kulinarka" aria-pressed="false">
  <span class="chip__icon">🍽️</span>
  <span class="chip__label">Kulinarka</span>
</button>
```
CSS modul:
```
.chip{ ... }
.chip--cat{ display:inline-flex; gap:8px; ... }
.chip--cat[aria-pressed="true"]{ background:var(--color-primary); color:#fff; }
.chip--cat:hover{ transform:translateY(-1px); }
```
JS: toggle `aria-pressed` + `.is-active` class.

## 13. Transition & Timing standard
Uskladi na:
- `--ease-out: cubic-bezier(.4,0,.2,1)` (Material-like)
- `--dur-fast: .12s`
- `--dur: .18s`
- `--dur-slow: .30s`
V `tokens.css`: uporabno za `.btn`, `.fab`, dropdown, modale.

## 14. Z-index lestvica
Trenutno random (1000, 2000, 1002...). Predlog:
- base: 0
- header/nav: 100
- dropdown/menus: 300
- modal: 600
- toast/banner: 700
- fab/assistant panel: 800–850
Upravljaj z: `--z-header:100`, `--z-modal:600`, ...

## 15. Form kontrola konsistenca
- Različne min-height (40px, 44px). Predlagaj `--control-h:44px`.
- Autofill override OK; dodaj dark-mode variant (`.dark input:-webkit-autofill { box-shadow: 0 0 0px 1000px #0f1f30 inset !important; }`).

## 16. Checkbox/radio hit area
Rešitev:
```
.chk-wrap{ position:relative; display:inline-flex; align-items:center; }
.chk-wrap input{ width:18px; height:18px; }
.chk-wrap input + label{ padding-left:8px; }
.chk-wrap::after{ content:""; position:absolute; inset:-8px; }
```

## 17. Map overlay gumbi (notifications)
- Trenutno stacking OK, but add focus styles.
```
.map-overlay .btn.small:focus-visible{ outline:2px solid var(--focus); outline-offset:2px; }
```

## 18. Odstranitev `!important`
- V `assets/app.css` je bilo nekaj `!important` (header, padding). To otežuje page-specifične prilagoditve. Morda jih postopno odstrani (1 commit naenkrat) – začeto (header/main padding je že mehkejši).

## 19. Fallback za `color-mix()`
`color-mix()` ni na vseh starejših mobilnih Safari. Dodaj fallback:
```
.header { background: var(--color-surface); }
@supports (background: color-mix(in srgb, white 80%, transparent)) {
  .header { background: color-mix(in srgb, var(--color-surface) 88%, transparent); }
}
```

## 20. Stran `organizers-submit.html`
- Veliko inline JS + UI logike → loči CSS iz `<style>` v `pages/organizers.css`.
- Preveri `chips` tukaj in na index za združitev.

## 21. Predlagan postopen refactor plan
1. Ustvari `assets/styles/tokens.css` z barvami, spacing, shadow, z-index, timing.
2. Iz `assets/app.css` izvleci generične komponente v `components.css`.
3. Odstrani podvojeno `assets/css/app.css` (združi vse v en izvor; pusti alias dokler ne odstraniš referenc).
4. Premakni inline CSS iz `index.html` v `pages/home.css` (brez spreminjanja header strukture za zdaj).
5. Združi `.btn` variante pod BEM ali modifikatorje (`.btn--accent`, `.btn--secondary`, `.btn--link`).
6. Dodaj testno stran z vizualnim pregledom komponent (style guide).
7. Šele nato obravnava dark-mode fine tuning (accent prilagoditev).

## 22. Merila uspeha (checklist)
- Ena sama definicija `.btn`, `.pill`, `.cat-chip` v codebase.
- Ni inline barvnih hex vrednosti v večini HTML (razen ikone / SVG gradienti).
- Mobile: brez prekrivanja FAB ↔ cookie banner ↔ overlay.
- Tap target vsi >40px na mobilnem (gumbi in interaktivni chipi).
- LCP < 2.5s (odstranitev velikega inline CSS blok-a pomaga keširanju).

## 23. Kaj NI bilo spremenjeno
- `index.html` header / layout.
- Barve koralnih badge-ov (samo predlogi, brez posega).

## 24. Naslednji koraki (po tvoji potrditvi)
- [ ] Dodam `tokens.css` + `components.css` + `layout.css` (brez spremembad headerja).
- [ ] Preselim hero & search panel CSS v `pages/home.css`.
- [ ] Konsolidiram `.btn` / `.pill` / `.cat-chip` (z ohranitvijo obstoječih barv).
- [ ] Dodam fallback za `color-mix()`.
- [ ] Pripravim style-guide (`/style-guide.html`).

Potrdi, kateri koraki naj gredo naprej (lahko izbereš vse ali podmnožico).

---
Če želiš hiter vizualni test pred spremembami: lahko pripravim screenshot test harness ali storybook-lite (vanilla). Sporoči.
