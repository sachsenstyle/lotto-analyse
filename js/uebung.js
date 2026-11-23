'use strict';

// Oberfläche der Übung. Benutzt nur Generator, Analyse und Uebung.
(() => {
  const SCHRITTE = 80;             // so viele Bilder zeigt der Zeitraffer höchstens
  const BILD_DAUER = 50;           // Millisekunden je Bild
  const PUNKTE_MAX = 400;
  const AUSSCHNITTE = { ganz: [0, 1.5, 0.25], nah: [0.6, 0.9, 0.05] };
  const RUHIG = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (id) => document.getElementById(id);
  let fest = Uebung.neueFesteTipps();
  let lauf = Uebung.neu(fest);
  let ausschnitt = 'ganz';
  let uhr = null;

  // ---------- Hilfen ----------

  function h(name, eigenschaften, ...kinder) {
    const svg = ['svg', 'g', 'path', 'line', 'text', 'circle', 'rect', 'clipPath', 'defs'].includes(name);
    const element = svg ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name);
    for (const [schluessel, wert] of Object.entries(eigenschaften || {})) {
      if (wert == null || wert === false) continue;
      if (schluessel.startsWith('on')) element.addEventListener(schluessel.slice(2), wert);
      else element.setAttribute(schluessel, wert === true ? '' : wert);
    }
    for (const kind of kinder.flat(Infinity)) {
      if (kind == null || kind === false) continue;
      element.append(kind instanceof Node ? kind : String(kind));
    }
    return element;
  }

  const zahl2 = (wert, stellen = 2) => wert.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
  const ganz = (wert) => wert.toLocaleString('de-DE');
  const prozent = (anteil) => `${zahl2(anteil * 100, anteil > 0 && anteil < 0.001 ? 4 : 1)} %`;
  const kugel = (zahl, art) => h('span', { class: `kugel${art ? ` ${art}` : ''}` }, zahl);

  let meldungUhr = null;
  function melde(text) {
    $('meldung').textContent = text;
    $('meldung').classList.add('sichtbar');
    clearTimeout(meldungUhr);
    meldungUhr = setTimeout(() => $('meldung').classList.remove('sichtbar'), 3500);
  }

  // ---------- Ablauf ----------

  function starte(anzahl) {
    halteAn();
    let rest = Math.min(anzahl, Uebung.ZIEHUNGEN_MAX - lauf.anzahl);
    if (rest <= 0) {
      melde(`Bei ${ganz(Uebung.ZIEHUNGEN_MAX)} Ziehungen ist Schluss. Fang neu an.`);
      return;
    }
    const proBild = RUHIG.matches ? rest : Math.ceil(rest / SCHRITTE);
    const bild = () => {
      for (let i = 0; i < proBild && rest > 0; i += 1, rest -= 1) Uebung.ziehe(lauf);
      uhr = rest > 0 ? setTimeout(bild, BILD_DAUER) : null;
      zeichne();
    };
    bild();
  }

  function halteAn() {
    clearTimeout(uhr);
    uhr = null;
  }

  function neuAnfangen() {
    halteAn();
    lauf = Uebung.neu(fest);
    zeichne();
  }

  // ---------- Anzeige ----------

  function zeichne() {
    const laeuft = uhr !== null;
    $('stopp').disabled = !laeuft;
    $('neustart').disabled = lauf.anzahl === 0;
    for (const id of ['karte-verlauf', 'karte-tabelle', 'karte-verteilung']) $(id).hidden = lauf.anzahl === 0;

    if (lauf.anzahl === 0) {
      $('stand-uebung').textContent = 'Noch keine Ziehung.';
      $('letzte').replaceChildren();
      return;
    }
    // Während des Zeitraffers nicht bei jedem Bild vorlesen lassen
    $('stand-uebung').setAttribute('aria-live', laeuft ? 'off' : 'polite');
    const jahre = lauf.anzahl / Uebung.ZIEHUNGEN_PRO_JAHR;
    $('stand-uebung').textContent = `${ganz(lauf.anzahl)} ${lauf.anzahl === 1 ? 'Ziehung' : 'Ziehungen'}`
      + (jahre >= 1 ? ` · so viele wie in ${zahl2(jahre, 1)} Jahren echtem Lotto` : '');
    zeichneLetzte();
    zeichneVerlauf();
    zeichneTabelle();
    zeichneVerteilung();
  }

  function zeichneLetzte() {
    const { echt, scheine } = lauf.letzte;
    const gezogen = new Set(echt.zahlen);
    $('letzte').replaceChildren(
      h('h3', null, `Ziehung Nr. ${ganz(lauf.anzahl)}`),
      h('div', { class: 'superzeile' },
        h('span', { class: 'kugeln' }, echt.zahlen.map((zahl) => kugel(zahl, 'treffer'))),
        h('span', { class: 'unterzeile' }, 'Superzahl'), kugel(echt.superzahl, 'super treffer')),
      h('div', { class: 'letzte-tipps' }, lauf.spieler.map((s, i) => h('div', null,
        h('p', { class: 'unterzeile' }, h('span', { class: `punkt ${s.id}` }), s.name),
        scheine[i].tipps.map((tipp) => h('div', { class: 'tipp' },
          h('span', { class: 'kugeln' }, tipp.map((zahl) => kugel(zahl, gezogen.has(zahl) ? 'treffer' : ''))),
          h('span', { class: 'tipp-treffer' }, `${Analyse.zaehleTreffer(tipp, echt.zahlen)} Richtige`)))))));
  }

  function zeichneVerlauf() {
    const w = lauf.wechsel;
    const bestes = Math.max(...lauf.spieler.map((s) => s.summe));
    const vorn = lauf.spieler.filter((s) => s.summe === bestes);
    $('fuehrung').replaceChildren(
      vorn.length === 1 ? 'Vorn liegt gerade ' : 'Gerade Gleichstand an der Spitze',
      vorn.length === 1 ? h('strong', null, vorn[0].name) : '',
      `. Die Führung hat bisher ${w === 0 ? 'nie' : `${ganz(w)}-mal`} gewechselt.`);
    $('legende').replaceChildren(
      ...lauf.spieler.map((s) => h('li', null, h('span', { class: `punkt ${s.id}` }), `${s.name} `,
        h('strong', null, zahl2(s.summe / s.tipps)))),
      h('li', null, h('span', { class: 'strich' }), `Erwartung ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)}`));
    zeichneDiagramm();
  }

  function zeichneDiagramm() {
    const kasten = $('diagramm');
    const breite = Math.max(280, Math.floor(kasten.clientWidth));
    const hoehe = Math.round(Math.min(340, Math.max(220, breite * 0.5)));
    const rand = { oben: 10, rechts: 12, unten: 40, links: 44 };
    const [yMin, yMax, yTeil] = AUSSCHNITTE[ausschnitt];
    const n = lauf.anzahl;
    const x = (i) => rand.links + (n === 1 ? 0.5 : (i - 1) / (n - 1)) * (breite - rand.links - rand.rechts);
    const y = (wert) => hoehe - rand.unten - ((wert - yMin) / (yMax - yMin)) * (hoehe - rand.oben - rand.unten);

    // Nur so viele Stützpunkte wie nötig, der letzte ist immer dabei
    const stellen = [];
    const schritt = Math.max(1, (n - 1) / (PUNKTE_MAX - 1));
    for (let i = 1; i < n; i += schritt) stellen.push(Math.round(i));
    stellen.push(n);

    const teile = [];
    for (let wert = yMin; wert <= yMax + 1e-9; wert += yTeil) {
      teile.push(h('line', { class: 'gitter', x1: rand.links, x2: breite - rand.rechts, y1: y(wert), y2: y(wert) }),
        h('text', { class: 'achse', x: rand.links - 8, y: y(wert) + 4, 'text-anchor': 'end' }, zahl2(wert)));
    }
    const marken = [...new Set(n === 1 ? [1] : [1, Math.round((n + 1) / 2), n])];
    marken.forEach((i, k) => teile.push(h('text', {
      class: 'achse', x: x(i), y: hoehe - rand.unten + 18,
      'text-anchor': marken.length === 1 ? 'middle' : ['start', 'middle', 'end'][marken.length === 2 && k === 1 ? 2 : k],
    }, ganz(i))));
    teile.push(h('text', { class: 'achse', x: (rand.links + breite - rand.rechts) / 2, y: hoehe - 4, 'text-anchor': 'middle' }, 'Ziehung'));

    const flaeche = { x: rand.links, y: rand.oben, width: breite - rand.links - rand.rechts, height: hoehe - rand.oben - rand.unten };
    const linien = h('g', { 'clip-path': 'url(#ausschnitt-rahmen)' },
      h('line', { class: 'erwartung', x1: rand.links, x2: breite - rand.rechts, y1: y(Analyse.ERWARTUNG_PRO_TIPP), y2: y(Analyse.ERWARTUNG_PRO_TIPP) }),
      lauf.spieler.map((s) => (n === 1
        ? h('circle', { class: `marke ${s.id}`, cx: x(1), cy: y(s.verlauf[0]), r: 5 })
        : h('path', { class: `linie ${s.id}`, d: stellen.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.verlauf[i - 1]).toFixed(1)}`).join('') }))));

    const faden = h('line', { class: 'faden', y1: rand.oben, y2: hoehe - rand.unten, x1: 0, x2: 0, visibility: 'hidden' });
    const svg = h('svg', {
      width: breite, height: hoehe, viewBox: `0 0 ${breite} ${hoehe}`, role: 'img',
      'aria-label': `Durchschnittliche Richtige pro Tipp im Verlauf von ${ganz(n)} Ziehungen. Die Werte stehen im Spielstand darunter.`,
    },
    h('defs', null, h('clipPath', { id: 'ausschnitt-rahmen' }, h('rect', flaeche))),
    teile, linien, faden,
    h('rect', { ...flaeche, fill: 'transparent' }));

    const tipp = h('div', { class: 'diagramm-tipp', hidden: true });
    const zeige = (ereignis) => {
      const links = svg.getBoundingClientRect().left;
      const anteil = (ereignis.clientX - links - rand.links) / (breite - rand.links - rand.rechts);
      const i = Math.min(n, Math.max(1, Math.round(1 + anteil * (n - 1))));
      faden.setAttribute('x1', x(i));
      faden.setAttribute('x2', x(i));
      faden.setAttribute('visibility', 'visible');
      tipp.replaceChildren(h('strong', null, `Ziehung ${ganz(i)}`),
        ...[...lauf.spieler].sort((a, b) => b.verlauf[i - 1] - a.verlauf[i - 1])
          .map((s) => h('div', null, h('span', { class: `punkt ${s.id}` }), `${s.name} `, h('strong', null, zahl2(s.verlauf[i - 1])))));
      tipp.hidden = false;
      const platz = x(i) + 12 + tipp.offsetWidth > breite ? x(i) - 12 - tipp.offsetWidth : x(i) + 12;
      tipp.style.left = `${Math.max(0, platz)}px`;
    };
    const verstecke = () => {
      tipp.hidden = true;
      faden.setAttribute('visibility', 'hidden');
    };
    svg.addEventListener('pointermove', zeige);
    svg.addEventListener('pointerdown', zeige);
    svg.addEventListener('pointerleave', verstecke);
    kasten.replaceChildren(svg, tipp);
  }

  function tabelle(kopf, zeilen) {
    return h('div', { class: 'tabelle-rahmen abstand' }, h('table', { class: 'wette-tabelle' },
      h('thead', null, h('tr', null, kopf.map((titel) => h('th', { scope: 'col' }, titel)))),
      h('tbody', null, zeilen.map(([titel, ...werte]) => h('tr', null,
        h('th', { scope: 'row' }, titel), werte.map((wert) => h('td', null, wert)))))));
  }

  function zeichneTabelle() {
    const gewinnChance = Analyse.gewinnWahrscheinlichkeit();
    const erwartet = lauf.spieler[0].tipps * gewinnChance;
    const zeilen = [...lauf.spieler].sort((a, b) => b.summe - a.summe).map((s) => {
      const z = Uebung.abweichung(lauf, s);
      return [
        [h('span', { class: `punkt ${s.id}` }), s.name],
        zahl2(s.summe / s.tipps),
        z === null ? '–' : `${z > 0 ? '+' : ''}${zahl2(z)}`,
        s.beste,
        ganz(s.gewinne),
      ];
    });
    $('tabelle').replaceChildren(
      tabelle(['Spieler', 'Ø Richtige', 'Abweichung', 'Bester Tipp', 'Gewinne'], zeilen),
      h('p', { class: 'klein abstand' }, `Zu erwarten sind ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)} Richtige pro Tipp und je Spieler `
        + `${zahl2(erwartet, 1)} Gewinne. Abweichungen zwischen −2 und +2 sind bei reinem Zufall normal. Bei fünf Spielern liegt `
        + 'aber ab und zu auch einer außerhalb, ohne dass er etwas besser kann.'));
  }

  function zeichneVerteilung() {
    const alle = lauf.spieler.reduce((summe, s) => summe + s.tipps, 0);
    const zeilen = Analyse.erwarteteVerteilung().map((p, treffer) => {
      const anzahl = lauf.spieler.reduce((summe, s) => summe + s.verteilung[treffer], 0);
      return [`${treffer} Richtige`, ganz(anzahl), prozent(anzahl / alle), prozent(p)];
    });
    $('verteilung').replaceChildren(
      tabelle(['Treffer', 'Anzahl', 'Anteil', 'Erwartet'], zeilen),
      h('p', { class: 'klein abstand' }, `${ganz(alle)} Tipps insgesamt. Je mehr Ziehungen, desto näher rückt der Anteil an die Erwartung.`));
  }

  // ---------- Feste Tipps ----------

  function zeichneFeste() {
    $('feste').replaceChildren(
      h('div', { class: 'feste-liste' }, fest.tipps.map((tipp, i) => h('div', { class: 'tipp' },
        h('span', { class: 'tipp-nr' }, i + 1),
        h('span', { class: 'kugeln' }, tipp.map((zahl) => kugel(zahl))),
        h('button', { type: 'button', class: 'spiel-knopf', 'data-aendern': i, onclick: () => waehleZahlen(i) }, 'Ändern')))),
      h('div', { class: 'knopf-zeile' },
        h('button', { type: 'button', class: 'knopf', onclick: () => setzeFest(Uebung.neueFesteTipps()) }, 'Neu auslosen')),
      h('div', { id: 'zahlenwahl' }));
  }

  function setzeFest(neuFest) {
    halteAn();
    if (lauf.anzahl > 0 && !window.confirm('Die Übung beginnt dann neu. Fortfahren?')) {
      zeichne();
      return false;
    }
    fest = neuFest;
    neuAnfangen();
    zeichneFeste();
    return true;
  }

  function waehleZahlen(index) {
    const gewaehlt = new Set();
    const zaehler = h('p', { class: 'unterzeile', 'aria-live': 'polite' }, 'Noch 6 Zahlen auswählen.');
    const speichern = h('button', { type: 'button', class: 'knopf haupt', disabled: true }, 'Übernehmen');
    speichern.addEventListener('click', () => {
      const neuerTipp = [...gewaehlt].sort((a, b) => a - b);
      if (fest.tipps.some((tipp, i) => i !== index && tipp.join() === neuerTipp.join())) {
        melde('Diese Zahlen stehen schon im anderen Tipp.');
        return;
      }
      if (setzeFest({ ...fest, tipps: fest.tipps.map((tipp, i) => (i === index ? neuerTipp : tipp)) })) {
        document.querySelector(`[data-aendern="${index}"]`).focus();
      }
    });
    const feld = h('div', { class: 'zahlenfeld', role: 'group', 'aria-label': `Zahlen für festen Tipp ${index + 1}` });
    for (let zahl = 1; zahl <= Generator.ZAHLEN_MAX; zahl += 1) {
      const knopf = h('button', { type: 'button', 'aria-pressed': 'false' }, zahl);
      knopf.addEventListener('click', () => {
        if (gewaehlt.has(zahl)) gewaehlt.delete(zahl);
        else if (gewaehlt.size < Generator.ZAHLEN_PRO_TIPP) gewaehlt.add(zahl);
        else { melde('Es sind schon 6 Zahlen gewählt.'); return; }
        knopf.setAttribute('aria-pressed', String(gewaehlt.has(zahl)));
        const fehlen = Generator.ZAHLEN_PRO_TIPP - gewaehlt.size;
        zaehler.textContent = fehlen > 0 ? `Noch ${fehlen} ${fehlen === 1 ? 'Zahl' : 'Zahlen'} auswählen.` : 'Alles ausgewählt.';
        speichern.disabled = fehlen > 0;
      });
      feld.append(knopf);
    }
    $('zahlenwahl').replaceChildren(h('h3', null, `Tipp ${index + 1}`), feld,
      h('div', { class: 'knopf-zeile' }, speichern,
        h('button', { type: 'button', class: 'knopf', onclick: () => $('zahlenwahl').replaceChildren() }, 'Abbrechen'), zaehler));
    feld.querySelector('button').focus();
  }

  // ---------- Start ----------

  for (const knopf of document.querySelectorAll('[data-anzahl]')) {
    knopf.addEventListener('click', () => starte(Number(knopf.dataset.anzahl)));
  }
  $('stopp').addEventListener('click', () => { halteAn(); zeichne(); });
  $('neustart').addEventListener('click', neuAnfangen);
  for (const knopf of document.querySelectorAll('[data-ausschnitt]')) {
    knopf.addEventListener('click', () => {
      ausschnitt = knopf.dataset.ausschnitt;
      for (const anderer of document.querySelectorAll('[data-ausschnitt]')) {
        anderer.setAttribute('aria-pressed', String(anderer === knopf));
      }
      zeichneDiagramm();
    });
  }
  window.addEventListener('resize', () => { if (lauf.anzahl > 0) zeichneDiagramm(); });
  zeichneFeste();
  zeichne();
})();
