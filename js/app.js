'use strict';

// App: die Oberfläche. Liest und ändert den Zustand und zeichnet danach neu.
(() => {
  const SICHERUNG_ERINNERN_NACH_TAGEN = 14;
  const WOCHEN_BIS_ANALYSE = Analyse.WOCHEN_PRO_HALBJAHR;
  const GESPIELTE_IN_KURZLISTE = 10;

  const zustand = {
    daten: Speicher.laden(),
    ansicht: 'mi',
    datum: { mi: null, sa: null },     // gewählter Termin je Wochentag
    strategie: 'zufall',               // gewählter Schein in der Tagesansicht
    // zeitraum: 'alle' oder 'h1', 'h2', ... für ein einzelnes Halbjahr
    analyse: { tag: 'alle', strategie: 'zufall', zeitraum: 'alle', alleGespielten: false },
  };

  const inhalt = document.getElementById('inhalt');
  const meldungFeld = document.getElementById('meldung');
  const tooltip = document.getElementById('tooltip');

  // ---------- Hilfen ----------

  // Baut ein HTML-Element: h('p', { class: 'klein' }, 'Text', weitereElemente)
  function h(name, eigenschaften, ...kinder) {
    const element = document.createElement(name);
    for (const [schluessel, wert] of Object.entries(eigenschaften || {})) {
      if (wert == null || wert === false) continue;
      if (schluessel === 'class') element.className = wert;
      else if (schluessel.startsWith('on')) element.addEventListener(schluessel.slice(2), wert);
      else element.setAttribute(schluessel, wert === true ? '' : wert);
    }
    for (const kind of kinder.flat(Infinity)) {
      if (kind == null || kind === false) continue;
      element.append(kind instanceof Node ? kind : String(kind));
    }
    return element;
  }

  const zahl2 = (wert) => wert.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ganz = (wert) => wert.toLocaleString('de-DE');
  const prozent = (anteil, stellen = 1) => `${(anteil * 100).toLocaleString('de-DE', {
    minimumFractionDigits: stellen, maximumFractionDigits: stellen,
  })} %`;

  // Sehr kleine Wahrscheinlichkeiten brauchen mehr Nachkommastellen,
  // sonst steht dort nur „0,0 %“.
  const prozentKlein = (anteil) => {
    if (anteil >= 0.001) return prozent(anteil, 1);
    if (anteil >= 0.00001) return prozent(anteil, 4);
    return prozent(anteil, 6);
  };

  let meldungUhr = null;
  function melde(text) {
    meldungFeld.textContent = text;
    meldungFeld.classList.add('sichtbar');
    clearTimeout(meldungUhr);
    meldungUhr = setTimeout(() => meldungFeld.classList.remove('sichtbar'), 3500);
  }

  function sichern() {
    if (!Speicher.speichern(zustand.daten)) {
      melde('Speichern im Browser ist fehlgeschlagen. Bitte unter „Daten“ eine Sicherung anlegen.');
    }
    Wolke.geaendert();
  }

  function leererEintrag() {
    return { scheine: null, echt: null, gespielt: null, erstelltAm: null, basisZiehungen: 0 };
  }

  function eintrag(datum) {
    return zustand.daten.ziehungen[datum] || leererEintrag();
  }

  function eintragAnlegen(datum) {
    if (!zustand.daten.ziehungen[datum]) zustand.daten.ziehungen[datum] = leererEintrag();
    return zustand.daten.ziehungen[datum];
  }

  function hatDaten() {
    return Object.keys(zustand.daten.ziehungen).length > 0
      || Object.keys(DAUER_ARTEN).some((art) => dauerschein('mi', art).tipps.length + dauerschein('sa', art).tipps.length > 0);
  }

  // Alle Termine eines Wochentags vom Start bis zur nächsten Ziehung, neueste zuerst.
  function termineFuer(tag) {
    const naechster = Kalender.naechsterTermin(tag, Kalender.heute());
    const gespeichert = Object.keys(zustand.daten.ziehungen).filter((d) => Kalender.tagVon(d) === tag);
    const start = [zustand.daten.startDatum, ...gespeichert].sort()[0];
    const ende = [naechster, ...gespeichert].sort().pop();
    return Kalender.termine(tag, start, ende).reverse();
  }

  function kugel(zahl, optionen = {}) {
    const klassen = ['kugel'];
    if (optionen.treffer) klassen.push('treffer');
    if (optionen.super) klassen.push('super');
    return h('span', { class: klassen.join(' ') }, zahl);
  }

  function auswahl(beschriftung, optionen, aktiv, beiWahl) {
    return h('div', { class: 'auswahl', role: 'group', 'aria-label': beschriftung },
      optionen.map((option) => h('button', {
        type: 'button',
        'aria-pressed': String(option.id === aktiv),
        onclick: () => beiWahl(option.id),
      }, option.punkt ? h('span', { class: `punkt ${option.id}` }) : null, option.name)));
  }

  const STRATEGIE_OPTIONEN = Generator.STRATEGIEN.map((s) => ({ id: s.id, name: s.name, punkt: true }));

  // ---------- Aktionen ----------

  function tippsErzeugen(datum) {
    const tag = Kalender.tagVon(datum);
    // Nur echte Ziehungen VOR diesem Termin und vom selben Wochentag zählen.
    const frueher = Object.entries(zustand.daten.ziehungen)
      .filter(([d, e]) => d < datum && Kalender.tagVon(d) === tag && e.echt)
      .map(([, e]) => e.echt.zahlen);
    const kontext = Generator.kontextAus(frueher);

    const ziel = eintragAnlegen(datum);
    ziel.scheine = {};
    for (const strategie of Generator.STRATEGIEN) {
      ziel.scheine[strategie.id] = Generator.erzeugeSchein(strategie.id, kontext);
    }
    ziel.gespielt = null;              // die alte Markierung gehörte zu den alten Tipps
    ziel.erstelltAm = new Date().toISOString();
    ziel.basisZiehungen = frueher.length;
    sichern();
    melde('Tipps erzeugt und gespeichert.');
    zeichne();
  }

  // Markiert einen Tipp als wirklich gespielt (höchstens einer pro Termin).
  // Ein zweiter Klick auf denselben Tipp nimmt die Markierung zurück.
  // Nach der Ziehung ist die Markierung gesperrt, genau wie die Tipps.
  function tippSpielen(datum, strategieId, index) {
    const ziel = zustand.daten.ziehungen[datum];
    if (!ziel || !ziel.scheine || !ziel.scheine[strategieId] || ziel.echt) return;

    const bisher = ziel.gespielt;
    if (bisher && bisher.strategie === strategieId && bisher.tipp === index) {
      ziel.gespielt = null;
    } else {
      // Eine von Hand eingestellte Superzahl bleibt beim Wechsel des Tipps erhalten.
      const vonHand = bisher && bisher.superzahl !== ziel.scheine[bisher.strategie].superzahl;
      ziel.gespielt = {
        strategie: strategieId,
        tipp: index,
        superzahl: vonHand ? bisher.superzahl : ziel.scheine[strategieId].superzahl,
      };
    }
    sichern();
    zeichne();
    const knopf = inhalt.querySelector(`[data-spiel="${index}"]`);
    if (knopf) knopf.focus();
  }

  // ---------- Dauerschein ----------

  const DAUERTIPPS_MAX = Generator.TIPPS_PRO_SCHEIN;

  // Drei Scheine mit festen Tipps je Wochentag, alle mit gleichem Aufbau:
  // übernommene Tipps des Zufallsgenerators und zwei Scheine mit eigenen Zahlen.
  const DAUER_ARTEN = {
    generator: { feld: 'dauerscheine', name: 'Zufallsgenerator', ausWo: 'aus dem Dauerschein' },
    eigen1: { feld: 'eigeneScheine', name: 'eigener Schein 1', nr: 1, ausWo: 'aus deinem eigenen Schein 1' },
    eigen2: { feld: 'eigeneScheine2', name: 'eigener Schein 2', nr: 2, ausWo: 'aus deinem eigenen Schein 2' },
  };
  const EIGENE_ARTEN = ['eigen1', 'eigen2'];

  function dauerschein(tag, art = 'generator') {
    const { feld } = DAUER_ARTEN[art];
    if (!zustand.daten[feld]) zustand.daten[feld] = {};
    if (!zustand.daten[feld][tag]) zustand.daten[feld][tag] = Speicher.leererDauerschein();
    return zustand.daten[feld][tag];
  }

  // Erste Ziehung dieses Wochentags, deren echte Zahlen noch nicht eingetragen
  // sind. Ab hier zählt ein neuer Dauertipp: So kann niemand einen Tipp
  // übernehmen, dessen Ergebnis er schon kennt.
  function naechsteOffeneZiehung(tag) {
    let datum = Kalender.naechsterTermin(tag, Kalender.heute());
    while (eintrag(datum).echt) datum = Kalender.plusTage(datum, 7);
    return datum;
  }

  const gleicheZahlen = (a, b) => a.length === b.length && a.every((zahl, i) => zahl === b[i]);

  function aktiveDauertipps(tag, art = 'generator') {
    return dauerschein(tag, art).tipps.filter((tipp) => !tipp.bis);
  }

  function dauertippIndex(tag, zahlen, art = 'generator') {
    return dauerschein(tag, art).tipps.findIndex((tipp) => !tipp.bis && gleicheZahlen(tipp.zahlen, zahlen));
  }

  function dauertippUebernehmen(datum, strategieId, index) {
    const tag = Kalender.tagVon(datum);
    const schein = eintrag(datum).scheine?.[strategieId];
    if (!schein) return;
    const zahlen = schein.tipps[index];
    const ds = dauerschein(tag);
    const name = `${Kalender.TAGE[tag].name}s-Dauerschein`;

    if (dauertippIndex(tag, zahlen) >= 0) {
      dauertippEntfernen(tag, 'generator', dauertippIndex(tag, zahlen), index);
      return;
    }
    if (aktiveDauertipps(tag).length >= DAUERTIPPS_MAX) {
      melde(`Der ${name} ist voll (${DAUERTIPPS_MAX} Tipps). Entferne erst einen.`);
      return;
    }

    const ab = naechsteOffeneZiehung(tag);
    ds.tipps.push({ zahlen: [...zahlen], ab, bis: null, herkunft: { datum, strategie: strategieId, nr: index + 1 } });
    // Die Superzahl des Dauerscheins kommt anfangs vom Schein des ersten Tipps.
    if (ds.superzahlen.length === 0) ds.superzahlen.push({ ab, wert: schein.superzahl });
    sichern();
    melde(`In den ${name} übernommen. Er zählt ab dem ${Kalender.formatKurz(ab)}.`);
    zeichne();
    const knopf = inhalt.querySelector(`[data-dauer="${index}"]`);
    if (knopf) knopf.focus();
  }

  // Nimmt selbst gewählte Zahlen in einen eigenen Schein auf. Für sie gilt dieselbe
  // Regel wie für übernommene: Sie zählen erst ab der nächsten offenen Ziehung.
  function eigenenTippSpeichern(tag, art, auswahlZahlen, superzahl) {
    const ds = dauerschein(tag, art);
    const zahlen = [...auswahlZahlen].sort((a, b) => a - b);
    if (!Speicher.istZahlenreihe(zahlen) || aktiveDauertipps(tag, art).length >= DAUERTIPPS_MAX) return;
    if (dauertippIndex(tag, zahlen, art) >= 0) {
      melde('Dieser Tipp steht schon auf dem Schein.');
      return;
    }
    const ab = naechsteOffeneZiehung(tag);
    ds.tipps.push({ zahlen, ab, bis: null, herkunft: null });
    if (ds.superzahlen.length === 0 && superzahl !== null) ds.superzahlen.push({ ab, wert: superzahl });
    sichern();
    melde(`Tipp auf deinem eigenen Schein ${DAUER_ARTEN[art].nr} gespeichert. Er zählt ab dem ${Kalender.formatKurz(ab)}.`);
    zeichne();
    const knopf = inhalt.querySelector(`[data-eigen="${art}"]`);
    if (knopf) knopf.focus();
  }

  // Ein Tipp, der schon ausgewertet wurde, wird nur beendet: Seine bisherigen
  // Ergebnisse bleiben in der Analyse. Sonst könnte man schlechte Tipps
  // aussortieren und nur die guten übrig lassen.
  function dauertippEntfernen(tag, art, tippIndex, fokusIndex) {
    const ds = dauerschein(tag, art);
    const { ausWo } = DAUER_ARTEN[art];
    const tipp = ds.tipps[tippIndex];
    if (!tipp || tipp.bis) return;
    if (!window.confirm(`Tipp ${tipp.zahlen.join(' · ')} ${ausWo} nehmen? `
      + 'Bisherige Ergebnisse bleiben in der Analyse erhalten.')) return;

    const ab = naechsteOffeneZiehung(tag);
    if (tipp.ab >= ab) ds.tipps.splice(tippIndex, 1);   // noch nie ausgewertet
    else tipp.bis = ab;
    sichern();
    melde(`Tipp ${ausWo} genommen.`);
    zeichne();
    if (fokusIndex != null) {
      const knopf = inhalt.querySelector(`[data-dauer="${fokusIndex}"]`);
      if (knopf) knopf.focus();
    }
  }

  // Eine neue Superzahl gilt ab der nächsten offenen Ziehung. Frühere
  // Auswertungen behalten die Superzahl, die damals galt.
  function dauerSuperzahlSetzen(tag, art, wert) {
    const ds = dauerschein(tag, art);
    const ab = naechsteOffeneZiehung(tag);
    const letzte = ds.superzahlen[ds.superzahlen.length - 1];
    if (letzte && letzte.ab === ab) letzte.wert = wert;
    else if (!letzte || letzte.wert !== wert) ds.superzahlen.push({ ab, wert });
    sichern();
  }

  function echteZahlenSpeichern(datum, zahlen, superzahl) {
    const ziel = eintragAnlegen(datum);
    ziel.echt = { zahlen: [...zahlen].sort((a, b) => a - b), superzahl };
    sichern();
    melde('Echte Zahlen gespeichert.');
    zeichne();
  }

  function sicherungHerunterladen() {
    zustand.daten.letzteSicherung = new Date().toISOString();
    sichern();
    const blob = new Blob([Speicher.alsDateiText(zustand.daten)], { type: 'application/json' });
    const link = h('a', {
      href: URL.createObjectURL(blob),
      download: `lotto-analyse-sicherung-${Kalender.heute()}.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    melde('Sicherung heruntergeladen. Lege die Datei in den Ordner „Lotto-Analyse“.');
    zeichne();
  }

  function sicherungEinlesen(datei) {
    const leser = new FileReader();
    leser.onload = () => {
      let neu;
      try {
        neu = Speicher.ausDateiText(String(leser.result));
      } catch (fehler) {
        melde(fehler.message);
        return;
      }
      const anzahl = Object.keys(neu.ziehungen).length;
      const frage = `Die Sicherung enthält ${anzahl} Termine. Die jetzigen Daten im Browser werden dadurch ersetzt. Fortfahren?`;
      if (hatDaten() && !window.confirm(frage)) return;
      zustand.daten = neu;
      sichern();
      melde('Sicherung eingelesen.');
      zeichne();
    };
    leser.onerror = () => melde('Die Datei lässt sich nicht lesen.');
    leser.readAsText(datei);
  }

  // ---------- Ansicht: Mittwoch / Samstag ----------

  function statusText(e) {
    if (e.scheine && e.echt) return { text: 'ausgewertet', fertig: true };
    if (e.scheine) return { text: 'Tipps bereit', fertig: false };
    if (e.echt) return { text: 'nur echte Zahlen', fertig: false };
    return { text: 'offen', fertig: false };
  }

  function ansichtTag(tag) {
    const termine = termineFuer(tag);
    if (!termine.includes(zustand.datum[tag])) zustand.datum[tag] = termine[0];
    const datum = zustand.datum[tag];

    const liste = h('nav', { class: 'karte terminliste', 'aria-label': 'Termine' },
      h('h2', null, `${Kalender.TAGE[tag].name}sziehungen`),
      termine.map((termin) => {
        const status = statusText(eintrag(termin));
        return h('button', {
          type: 'button',
          class: 'termin',
          'aria-current': String(termin === datum),
          onclick: () => { zustand.datum[tag] = termin; zeichne(); },
        },
        h('span', null, Kalender.formatKurz(termin)),
        h('span', { class: `status${status.fertig ? ' fertig' : ''}` }, status.text));
      }));

    return h('div', { class: 'tag-raster' }, liste,
      h('div', { class: 'stapel' }, kartenTipps(datum), karteEcht(datum), karteDauerschein(tag, datum),
        EIGENE_ARTEN.map((art) => karteEigene(tag, datum, art))));
  }

  // Der feste Schein des Wochentags mit übernommenen Tipps des Generators.
  function karteDauerschein(tag, datum) {
    const ds = dauerschein(tag);
    const name = Kalender.TAGE[tag].name;
    const karte = h('section', { class: 'karte' },
      h('p', { class: 'schritt' }, 'Feste Tipps'),
      h('h2', null, `${name}s-Dauerschein`));

    const anzahl = aktiveDauertipps(tag).length;
    if (anzahl === 0) {
      const beendet = ds.tipps.length;
      karte.append(h('p', { class: 'unterzeile' }, `Ein Dauerschein sind bis zu ${DAUERTIPPS_MAX} feste Tipps, die das Tool `
        + `bei jeder ${name}sziehung automatisch auswertet. Übernimm Tipps oben mit „+ Dauer“.`
        + (beendet ? ` Die Ergebnisse von ${beendet} früheren Dauertipps stehen in der Analyse.` : '')));
      return karte;
    }

    karte.append(
      h('p', { class: 'unterzeile' }, `${anzahl} von ${DAUERTIPPS_MAX} Tipps. Sie werden bei jeder ${name}sziehung `
        + 'ausgewertet, du musst nichts weiter tun.'),
      ...festeTippsTeile(tag, datum, 'generator', 'Superzahl des Dauerscheins'));
    return karte;
  }

  // Ein Schein mit selbst gewählten festen Tipps. Solange noch Platz ist, steht
  // darunter das Zahlenfeld für den nächsten.
  function karteEigene(tag, datum, art) {
    const ds = dauerschein(tag, art);
    const { nr } = DAUER_ARTEN[art];
    const name = Kalender.TAGE[tag].name;
    const superTitel = `Superzahl deines eigenen Scheins ${nr}`;
    const anzahl = aktiveDauertipps(tag, art).length;
    const beendet = ds.tipps.length - anzahl;
    const karte = h('section', { class: 'karte' },
      h('p', { class: 'schritt' }, 'Feste Tipps · eigene Zahlen'),
      h('h2', null, `Mein eigener ${name}s-Schein ${nr}`),
      h('p', { class: 'unterzeile' }, anzahl === 0
        ? `Platz für bis zu ${DAUERTIPPS_MAX} Tipps mit deinen eigenen Zahlen. Du trägst sie einmal ein, danach wertet das `
          + `Tool sie bei jeder ${name}sziehung automatisch aus.`
        : `${anzahl} von ${DAUERTIPPS_MAX} Tipps. Sie werden bei jeder ${name}sziehung ausgewertet, du musst nichts weiter tun.`,
      beendet ? ` Frühere Tipps (${beendet}) stehen mit ihren Ergebnissen in der Analyse.` : null));

    if (anzahl > 0) karte.append(...festeTippsTeile(tag, datum, art, superTitel));
    if (anzahl >= DAUERTIPPS_MAX) return karte;

    const formular = h('div', { class: 'eigen-formular' });
    function oeffnen() {
      const eingabe = zahlenEingabe({
        beschriftung: `Zahlen für Tipp ${anzahl + 1} auf Schein ${nr}`,
        mitSuperzahl: ds.superzahlen.length === 0,
        knopfText: 'Tipp speichern',
        beiSpeichern: (zahlen, superzahl) => eigenenTippSpeichern(tag, art, zahlen, superzahl),
      });
      formular.replaceChildren(
        h('h3', null, `Tipp ${anzahl + 1}`),
        h('p', { class: 'unterzeile' }, `Wähle 6 Zahlen. Der Tipp zählt ab dem ${Kalender.formatKurz(naechsteOffeneZiehung(tag))}.`),
        eingabe.feld,
        ...(eingabe.superFeld ? [
          h('h3', null, superTitel),
          h('p', { class: 'unterzeile' }, 'Auf einem echten Schein ist das die letzte Ziffer der Spielschein-Nummer. '
            + 'Sie gilt für alle Tipps auf diesem Schein.'),
          eingabe.superFeld,
        ] : []),
        h('div', { class: 'knopf-zeile' },
          eingabe.speichernKnopf,
          h('button', { type: 'button', class: 'knopf', onclick: schliessen }, 'Abbrechen'),
          eingabe.zaehler));
      formular.querySelector('button').focus();
    }
    function schliessen() {
      formular.replaceChildren(h('div', { class: 'knopf-zeile' },
        h('button', { type: 'button', class: 'knopf haupt', 'data-eigen': art, onclick: oeffnen },
          anzahl === 0 ? 'Eigenen Tipp eintragen' : 'Weiteren Tipp eintragen')));
    }
    schliessen();
    karte.append(formular);
    return karte;
  }

  // Gemeinsamer Inhalt dieser Karten: die aktiven festen Tipps mit ihren
  // Treffern am gewählten Termin und die Wahl der Superzahl.
  function festeTippsTeile(tag, datum, art, superTitel) {
    const ds = dauerschein(tag, art);
    const aktive = ds.tipps.map((tipp, index) => ({ tipp, index })).filter(({ tipp }) => !tipp.bis);
    const echt = eintrag(datum).echt;
    const gezogen = echt ? new Set(echt.zahlen) : null;
    const superzahlDamals = Analyse.dauerSuperzahl(ds, datum);
    const superRichtig = echt && superzahlDamals === echt.superzahl;

    const teile = [h('ol', { class: 'schein' }, aktive.map(({ tipp, index }, position) => {
      const zaehlt = echt && Analyse.dauertippAktiv(tipp, datum);
      const treffer = zaehlt ? Analyse.zaehleTreffer(tipp.zahlen, echt.zahlen) : null;
      let info;
      if (zaehlt) info = h('span', { class: `tipp-treffer${treffer >= 3 ? ' stark' : ''}` }, `${treffer} Richtige`);
      else if (datum < tipp.ab) info = h('span', { class: 'tipp-treffer' }, `ab ${Kalender.formatKurz(tipp.ab)}`);
      return h('li', { class: 'tipp' },
        h('span', { class: 'tipp-nr' }, position + 1),
        h('span', { class: 'kugeln' }, tipp.zahlen.map((zahl) => kugel(zahl, { treffer: zaehlt && gezogen.has(zahl) }))),
        info,
        h('button', {
          type: 'button',
          class: 'spiel-knopf',
          'aria-label': `Tipp ${tipp.zahlen.join(', ')} ${DAUER_ARTEN[art].ausWo} nehmen`,
          onclick: () => dauertippEntfernen(tag, art, index),
        }, 'Entfernen'));
    }))];

    if (echt && superzahlDamals !== null && aktive.some(({ tipp }) => Analyse.dauertippAktiv(tipp, datum))) {
      teile.push(h('div', { class: 'superzeile' },
        h('span', { class: 'unterzeile' }, `Superzahl am ${Kalender.formatKurz(datum)}`),
        kugel(superzahlDamals, { super: true, treffer: superRichtig }),
        h('span', { class: 'klein' }, superRichtig ? 'richtig' : 'nicht getroffen')));
    }

    // Superzahl für die kommenden Ziehungen. Ändert sich direkt beim Anklicken.
    const aktuell = ds.superzahlen.length ? ds.superzahlen[ds.superzahlen.length - 1].wert : null;
    const superFeld = h('div', { class: 'zahlenfeld super', role: 'group', 'aria-label': superTitel });
    for (let zahl = 0; zahl <= 9; zahl += 1) {
      const knopf = h('button', { type: 'button', 'aria-pressed': String(aktuell === zahl) }, zahl);
      knopf.addEventListener('click', () => {
        dauerSuperzahlSetzen(tag, art, zahl);
        for (const [i, anderer] of [...superFeld.children].entries()) anderer.setAttribute('aria-pressed', String(i === zahl));
      });
      superFeld.append(knopf);
    }
    teile.push(
      h('h3', null, superTitel),
      h('p', { class: 'unterzeile' }, `Gilt ab der nächsten offenen Ziehung (${Kalender.formatKurz(naechsteOffeneZiehung(tag))}). `
        + 'Spielst du den Schein wirklich, stell hier die letzte Ziffer deiner Spielschein-Nummer ein.'),
      superFeld);
    return teile;
  }

  function kartenTipps(datum) {
    const e = eintrag(datum);
    const kopf = [
      h('p', { class: 'schritt' }, 'Schritt 1 · Vor der Ziehung'),
      h('h2', null, `Tipps für ${Kalender.formatLang(datum)}`),
    ];

    if (!e.scheine) {
      if (e.echt) {
        return h('section', { class: 'karte' }, kopf,
          h('p', { class: 'unterzeile' }, 'Für diesen Termin wurden keine Tipps erzeugt. '
            + 'Nachträglich geht das nicht, weil die echten Zahlen schon bekannt sind.'));
      }
      return h('section', { class: 'karte' }, kopf,
        h('p', { class: 'unterzeile' }, `Jede der ${Generator.STRATEGIEN.length} Strategien füllt einen Schein `
          + `mit ${Generator.TIPPS_PRO_SCHEIN} Tipps und einer Superzahl.`),
        h('div', { class: 'knopf-zeile' },
          h('button', { type: 'button', class: 'knopf haupt', onclick: () => tippsErzeugen(datum) }, 'Tipps erzeugen')));
    }

    const strategie = Generator.strategie(zustand.strategie);
    const schein = e.scheine[strategie.id];
    const gezogen = e.echt ? new Set(e.echt.zahlen) : null;

    const koerper = [];
    if (!schein) {
      koerper.push(h('p', { class: 'unterzeile abstand' }, 'Für diese Strategie gibt es an diesem Termin keinen Schein.'));
    } else {
      const tag = Kalender.tagVon(datum);
      koerper.push(h('ol', { class: 'schein' }, schein.tipps.map((tipp, index) => {
        const treffer = e.echt ? Analyse.zaehleTreffer(tipp, e.echt.zahlen) : null;
        const istGespielt = Boolean(e.gespielt) && e.gespielt.strategie === strategie.id && e.gespielt.tipp === index;
        const imDauerschein = dauertippIndex(tag, tipp) >= 0;
        const dauerKnopf = h('button', {
          type: 'button',
          class: 'spiel-knopf dauer',
          'data-dauer': index,
          'aria-pressed': String(imDauerschein),
          'aria-label': imDauerschein
            ? `Tipp ${index + 1} ist im Dauerschein. Herausnehmen.`
            : `Tipp ${index + 1} in den Dauerschein übernehmen`,
          onclick: () => dauertippUebernehmen(datum, strategie.id, index),
        }, imDauerschein ? 'Dauer ✓' : '+ Dauer');
        return h('li', { class: `tipp${istGespielt ? ' gespielt' : ''}` },
          h('span', { class: 'tipp-nr' }, index + 1),
          h('span', { class: 'kugeln' }, tipp.map((zahl) => kugel(zahl, { treffer: gezogen && gezogen.has(zahl) }))),
          e.echt
            ? h('span', { class: `tipp-treffer${treffer >= 3 ? ' stark' : ''}` }, `${treffer} Richtige`)
            : h('button', {
              type: 'button',
              class: 'spiel-knopf',
              'data-spiel': index,
              'aria-pressed': String(istGespielt),
              'aria-label': istGespielt
                ? `Tipp ${index + 1} ist als gespielt markiert. Markierung entfernen.`
                : `Tipp ${index + 1} als gespielt markieren`,
              onclick: () => tippSpielen(datum, strategie.id, index),
            }, istGespielt ? 'Gespielt' : 'Spielen'),
          dauerKnopf);
      })));

      const superRichtig = e.echt && e.echt.superzahl === schein.superzahl;
      koerper.push(h('div', { class: 'superzeile' },
        h('span', { class: 'unterzeile' }, 'Superzahl des Scheins'),
        kugel(schein.superzahl, { super: true, treffer: superRichtig }),
        e.echt ? h('span', { class: 'klein' }, superRichtig ? 'richtig' : 'nicht getroffen') : null));
    }

    const grundlage = strategie.brauchtHistorie
      ? ` · Grundlage: ${e.basisZiehungen} frühere ${Kalender.TAGE[Kalender.tagVon(datum)].name}sziehungen`
        + (e.basisZiehungen === 0 ? ' (ohne Vorgeschichte wie reiner Zufall)' : '')
      : '';
    const erstellt = e.erstelltAm
      ? `Erzeugt am ${new Date(e.erstelltAm).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Erzeugt';

    return h('section', { class: 'karte' }, kopf,
      h('div', { class: 'abstand' }, auswahl('Strategie', STRATEGIE_OPTIONEN, strategie.id, (id) => {
        zustand.strategie = id;
        zeichne();
      })),
      h('p', { class: 'unterzeile abstand' }, strategie.kurz),
      koerper,
      kastenGespielt(datum, e),
      h('p', { class: 'klein abstand' }, erstellt + grundlage),
      e.echt ? null : h('div', { class: 'knopf-zeile' },
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: () => {
            const frage = 'Alle Tipps für diesen Termin durch neue ersetzen?'
              + (e.gespielt ? ' Die Markierung „gespielt“ geht dabei verloren.' : '');
            if (window.confirm(frage)) tippsErzeugen(datum);
          },
        }, 'Neu erzeugen')));
  }

  // Zeigt den wirklich gespielten Tipp des Termins, egal welcher Schein
  // gerade zu sehen ist.
  function kastenGespielt(datum, e) {
    const gespielt = e.gespielt;
    if (!gespielt) {
      if (e.echt) return null;
      return h('p', { class: 'klein abstand' }, 'Spielst du einen dieser Tipps wirklich? Dann markiere ihn vor der '
        + 'Ziehung mit „Spielen“. Die Analyse wertet deine gespielten Tipps getrennt aus.');
    }

    const zahlen = e.scheine[gespielt.strategie].tipps[gespielt.tipp];
    const titel = h('h3', null, `Dein gespielter Tipp: Nr. ${gespielt.tipp + 1} · `,
      h('span', { class: `punkt ${gespielt.strategie}` }), Generator.strategie(gespielt.strategie)?.name || gespielt.strategie);

    if (e.echt) {
      const gezogen = new Set(e.echt.zahlen);
      const treffer = Analyse.zaehleTreffer(zahlen, e.echt.zahlen);
      const superRichtig = gespielt.superzahl === e.echt.superzahl;
      const klasse = Analyse.gewinnklasse(treffer, superRichtig);
      return h('div', { class: 'gespielt-kasten' }, titel,
        h('div', { class: 'superzeile' },
          h('span', { class: 'kugeln' }, zahlen.map((zahl) => kugel(zahl, { treffer: gezogen.has(zahl) }))),
          h('span', { class: 'unterzeile' }, 'Superzahl'),
          kugel(gespielt.superzahl, { super: true, treffer: superRichtig })),
        h('p', { class: 'abstand' }, `${treffer} Richtige, Superzahl ${superRichtig ? 'richtig' : 'nicht getroffen'}: `,
          h('strong', null, klasse > 0 ? `Gewinnklasse ${klasse}` : 'kein Gewinn')));
    }

    // Die Superzahl ändert sich direkt beim Anklicken, ohne neu zu zeichnen.
    const superFeld = h('div', { class: 'zahlenfeld super', role: 'group', 'aria-label': 'Superzahl deines Spielscheins' });
    for (let zahl = 0; zahl <= 9; zahl += 1) {
      const knopf = h('button', { type: 'button', 'aria-pressed': String(gespielt.superzahl === zahl) }, zahl);
      knopf.addEventListener('click', () => {
        gespielt.superzahl = zahl;
        sichern();
        for (const [index, anderer] of [...superFeld.children].entries()) {
          anderer.setAttribute('aria-pressed', String(index === zahl));
        }
      });
      superFeld.append(knopf);
    }

    return h('div', { class: 'gespielt-kasten' }, titel,
      h('span', { class: 'kugeln' }, zahlen.map((zahl) => kugel(zahl))),
      h('p', { class: 'unterzeile abstand' }, 'Superzahl deines Spielscheins. Das ist die letzte Ziffer der '
        + 'Spielschein-Nummer, du findest sie auf der Quittung.'),
      superFeld,
      h('div', { class: 'knopf-zeile' },
        h('button', {
          type: 'button',
          class: 'knopf',
          onclick: () => tippSpielen(datum, gespielt.strategie, gespielt.tipp),
        }, 'Markierung entfernen'),
        h('span', { class: 'klein' }, 'Nach der Ziehung lässt sich die Markierung nicht mehr ändern.')));
  }

  // Baut ein Zahlenfeld zum Anklicken: 6 aus 49 und, wenn gewünscht, die Superzahl.
  // Es ändert sich beim Anklicken direkt, ohne die ganze Seite neu zu zeichnen.
  // So bleibt der Tastatur-Fokus auf dem angeklickten Feld.
  function zahlenEingabe({ vorgabe = null, beschriftung, mitSuperzahl = true, knopfText, beiSpeichern }) {
    const gewaehlt = new Set(vorgabe ? vorgabe.zahlen : []);
    let superzahl = vorgabe ? vorgabe.superzahl : null;

    const zaehler = h('p', { class: 'unterzeile', 'aria-live': 'polite' });
    const speichernKnopf = h('button', {
      type: 'button',
      class: 'knopf haupt',
      onclick: () => beiSpeichern([...gewaehlt], superzahl),
    }, knopfText);

    function aktualisiere() {
      const fehlen = Generator.ZAHLEN_PRO_TIPP - gewaehlt.size;
      const superFehlt = mitSuperzahl && superzahl === null;
      if (fehlen > 0) zaehler.textContent = `Noch ${fehlen} ${fehlen === 1 ? 'Zahl' : 'Zahlen'} auswählen.`;
      else if (superFehlt) zaehler.textContent = 'Jetzt noch die Superzahl auswählen.';
      else zaehler.textContent = 'Alles ausgewählt.';
      speichernKnopf.disabled = fehlen > 0 || superFehlt;
    }

    const feld = h('div', { class: 'zahlenfeld', role: 'group', 'aria-label': beschriftung, 'data-eingabe': true });
    for (let zahl = 1; zahl <= Generator.ZAHLEN_MAX; zahl += 1) {
      const knopf = h('button', { type: 'button', 'aria-pressed': String(gewaehlt.has(zahl)) }, zahl);
      knopf.addEventListener('click', () => {
        if (gewaehlt.has(zahl)) gewaehlt.delete(zahl);
        else if (gewaehlt.size < Generator.ZAHLEN_PRO_TIPP) gewaehlt.add(zahl);
        else { melde('Es sind schon 6 Zahlen gewählt. Zum Ändern erst eine abwählen.'); return; }
        knopf.setAttribute('aria-pressed', String(gewaehlt.has(zahl)));
        aktualisiere();
      });
      feld.append(knopf);
    }

    let superFeld = null;
    if (mitSuperzahl) {
      superFeld = h('div', { class: 'zahlenfeld super', role: 'group', 'aria-label': 'Superzahl', 'data-eingabe': true });
      for (let zahl = 0; zahl <= 9; zahl += 1) {
        const knopf = h('button', { type: 'button', 'aria-pressed': String(superzahl === zahl) }, zahl);
        knopf.addEventListener('click', () => {
          superzahl = superzahl === zahl ? null : zahl;
          for (const [index, anderer] of [...superFeld.children].entries()) {
            anderer.setAttribute('aria-pressed', String(index === superzahl));
          }
          aktualisiere();
        });
        superFeld.append(knopf);
      }
    }

    aktualisiere();
    return { feld, superFeld, zaehler, speichernKnopf };
  }

  function karteEcht(datum) {
    const e = eintrag(datum);
    const kopf = [
      h('p', { class: 'schritt' }, 'Schritt 2 · Nach der Ziehung'),
      h('h2', null, 'Echte Zahlen'),
    ];
    const karte = h('section', { class: 'karte' }, kopf);

    if (datum > Kalender.heute()) {
      karte.append(h('p', { class: 'unterzeile' },
        `Die Ziehung ist erst am ${Kalender.formatLang(datum)}. Danach trägst du hier die gezogenen Zahlen ein.`));
      return karte;
    }

    function zeigeGespeichert() {
      karte.replaceChildren(...kopf,
        h('div', { class: 'superzeile' },
          h('span', { class: 'kugeln' }, e.echt.zahlen.map((zahl) => kugel(zahl, { treffer: true }))),
          h('span', { class: 'unterzeile' }, 'Superzahl'),
          kugel(e.echt.superzahl, { super: true, treffer: true })),
        h('div', { class: 'knopf-zeile' },
          h('button', { type: 'button', class: 'knopf', onclick: () => zeigeEingabe(e.echt) }, 'Korrigieren')));
    }

    function zeigeEingabe(vorgabe) {
      const eingabe = zahlenEingabe({
        vorgabe,
        beschriftung: 'Gezogene Zahlen',
        knopfText: 'Speichern',
        beiSpeichern: (zahlen, superzahl) => echteZahlenSpeichern(datum, zahlen, superzahl),
      });
      karte.replaceChildren(...kopf,
        h('p', { class: 'unterzeile' }, `Die 6 Zahlen der Ziehung vom ${Kalender.formatKurz(datum)} anklicken.`),
        eingabe.feld,
        h('h3', null, 'Superzahl'),
        eingabe.superFeld,
        h('div', { class: 'knopf-zeile' },
          eingabe.speichernKnopf,
          vorgabe ? h('button', { type: 'button', class: 'knopf', onclick: zeigeGespeichert }, 'Abbrechen') : '',
          eingabe.zaehler));
    }

    if (e.echt) zeigeGespeichert();
    else zeigeEingabe(null);
    return karte;
  }

  // ---------- Ansicht: Analyse ----------

  const URTEILE = {
    keine: 'noch keine Daten',
    zuwenig: `ab ${Analyse.MIN_ZIEHUNGEN_FUER_URTEIL} Ziehungen`,
    zufall: 'im Zufallsbereich',
    ueber: 'auffällig über Zufall',
    unter: 'auffällig unter Zufall',
  };

  function ansichtAnalyse() {
    const ziehungen = zustand.daten.ziehungen;
    const mitTipps = Object.keys(ziehungen).filter((d) => ziehungen[d].scheine).sort();
    const fertig = mitTipps.filter((d) => ziehungen[d].echt);
    const halbjahre = Analyse.halbjahre(ziehungen, Kalender.heute());
    const teile = [];

    // Fortschritt im laufenden Halbjahr
    if (halbjahre.length > 0) {
      const aktuell = halbjahre[halbjahre.length - 1];
      const tage = Math.max(0, Kalender.tageZwischen(aktuell.von, Kalender.heute()));
      const wochen = Math.min(Math.floor(tage / 7), WOCHEN_BIS_ANALYSE - 1);
      const woche = `Woche ${wochen + 1} von ${WOCHEN_BIS_ANALYSE}. `;
      const fertige = aktuell.nr - 1;
      teile.push(h('section', { class: 'karte' },
        h('h2', null, fertige === 0 ? 'Vorschau · die ersten sechs Monate laufen noch' : `Das ${aktuell.nr}. Halbjahr läuft`),
        h('p', { class: 'unterzeile' }, fertige === 0
          ? `${woche}Aussagekräftig wird die Analyse ab dem ${Kalender.formatKurz(aktuell.bis)}.`
          : `${woche}${fertige === 1 ? 'Ein Halbjahr ist' : `${fertige} Halbjahre sind`} abgeschlossen, `
            + `das ${aktuell.nr}. endet am ${Kalender.formatKurz(aktuell.letzterTag)}.`),
        h('div', {
          class: 'fortschritt',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': String(WOCHEN_BIS_ANALYSE),
          'aria-valuenow': String(wochen),
          'aria-label': 'Fortschritt im laufenden Halbjahr',
        }, h('div', { style: `width:${(wochen / WOCHEN_BIS_ANALYSE) * 100}%` }))));
    }

    if (fertig.length === 0) {
      teile.push(h('section', { class: 'karte leer' },
        h('h2', null, 'Noch nichts auszuwerten'),
        h('p', null, 'Die Analyse beginnt, sobald für einen Termin Tipps erzeugt und die echten Zahlen eingetragen sind.')));
      return h('div', { class: 'stapel' }, teile);
    }

    // Zeitraum: gilt für alles darunter, außer für den Halbjahres-Vergleich.
    const gewaehlt = halbjahre.find((halbjahr) => `h${halbjahr.nr}` === zustand.analyse.zeitraum) || null;
    if (!gewaehlt) zustand.analyse.zeitraum = 'alle';
    const bereich = gewaehlt ? { von: gewaehlt.von, bis: gewaehlt.bis } : {};
    const imBereich = (datum) => (!bereich.von || datum >= bereich.von) && (!bereich.bis || datum < bereich.bis);

    if (halbjahre.length > 1) {
      teile.push(h('div', { class: 'zeitraum' },
        h('label', null, 'Zeitraum'),
        auswahl('Zeitraum', [
          { id: 'alle', name: 'Gesamt' },
          ...halbjahre.map((halbjahr) => ({ id: `h${halbjahr.nr}`, name: `${halbjahr.nr}. Halbjahr` })),
        ], zustand.analyse.zeitraum, (id) => { zustand.analyse.zeitraum = id; zeichne(); }),
        h('span', { class: 'klein' }, gewaehlt
          ? `${Kalender.formatKurz(gewaehlt.von)} bis ${Kalender.formatKurz(gewaehlt.letzterTag)}`
            + (gewaehlt.laeuft ? ' · läuft noch' : '')
          : `seit dem ${Kalender.formatKurz(halbjahre[0].von)}`)));
    }

    // Kennzahlen
    const gesamt = Analyse.werteAus(ziehungen, { tag: 'alle', strategie: 'zufall', ...bereich });
    const alleTipps = Generator.STRATEGIEN
      .map((s) => Analyse.werteAus(ziehungen, { tag: 'alle', strategie: s.id, ...bereich }).tipps)
      .reduce((a, b) => a + b, 0);
    teile.push(h('div', { class: 'kacheln' },
      kachel(ganz(fertig.filter(imBereich).length), 'ausgewertete Ziehungen'),
      kachel(ganz(alleTipps), 'ausgewertete Tipps'),
      kachel(zahl2(Analyse.ERWARTUNG_PRO_TIPP), 'Richtige pro Tipp bei reinem Zufall'),
      kachel(ganz(gesamt.echteZiehungen), 'eingetragene echte Ziehungen')));

    teile.push(karteVergleich(ziehungen, bereich));
    teile.push(karteHalbjahre(ziehungen, halbjahre));
    teile.push(karteGespielt(ziehungen, bereich));
    teile.push(karteDauerscheine(ziehungen, bereich));
    teile.push(karteDetail(ziehungen, bereich));
    return h('div', { class: 'stapel' }, teile);
  }

  function kachel(wert, name) {
    return h('div', { class: 'kachel' }, h('div', { class: 'kachel-wert' }, wert), h('div', { class: 'kachel-name' }, name));
  }

  // Dieselbe Strategie in jedem Halbjahr nebeneinander. Zeigt, ob ein
  // Vorsprung bleibt oder beim nächsten Mal wieder verschwindet.
  function karteHalbjahre(ziehungen, halbjahre) {
    const mittel = (werte) => (werte.mittel === null ? '–' : zahl2(werte.mittel));
    const filterFuer = (halbjahr, strategie) => ({ tag: 'alle', strategie, von: halbjahr.von, bis: halbjahr.bis });

    const kopf = h('tr', null,
      h('th', { scope: 'col' }, 'Strategie'),
      halbjahre.map((halbjahr) => h('th', { scope: 'col' },
        `${halbjahr.nr}. Halbjahr${halbjahr.laeuft ? ' (läuft)' : ''}`,
        h('span', { class: 'th-zusatz' }, `${Kalender.formatKurz(halbjahr.von)} – ${Kalender.formatKurz(halbjahr.letzterTag)}`))),
      h('th', { scope: 'col' }, 'Gesamt'));

    const zeilen = Generator.STRATEGIEN.map((strategie) => h('tr', null,
      h('td', null, h('span', { class: `punkt ${strategie.id}` }), strategie.name),
      halbjahre.map((halbjahr) => h('td', null, mittel(Analyse.werteAus(ziehungen, filterFuer(halbjahr, strategie.id))))),
      h('td', null, mittel(Analyse.werteAus(ziehungen, { tag: 'alle', strategie: strategie.id })))));

    const anzahl = h('tr', null,
      h('td', null, 'Ausgewertete Ziehungen'),
      halbjahre.map((halbjahr) => h('td', null, ganz(Analyse.werteAus(ziehungen, filterFuer(halbjahr, 'zufall')).ziehungen))),
      h('td', null, ganz(Analyse.werteAus(ziehungen, { tag: 'alle', strategie: 'zufall' }).ziehungen)));

    return h('section', { class: 'karte' },
      h('h2', null, 'Halbjahre im Vergleich'),
      h('p', { class: 'unterzeile' }, `Durchschnittliche Richtige pro Tipp je Halbjahr (26 Wochen). Erwartet: ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)}.`),
      h('div', { class: 'tabelle-rahmen abstand' },
        h('table', null, h('thead', null, kopf), h('tbody', null, zeilen, anzahl))),
      h('p', { class: 'klein abstand' }, halbjahre.length < 2
        ? `Das 2. Halbjahr beginnt am ${Kalender.formatKurz(halbjahre[0].bis)}. Ab dann steht hier der Vergleich.`
        : 'Liegt eine Strategie in jedem Halbjahr vorn, ist das ein Hinweis. Wechselt die Führung von Halbjahr zu Halbjahr, war der Vorsprung Zufall.'));
  }

  // Die Tipps, die als wirklich gespielt markiert wurden.
  function karteGespielt(ziehungen, bereich) {
    const werte = Analyse.werteGespielt(ziehungen, { tag: 'alle', ...bereich });
    const karte = h('section', { class: 'karte' }, h('h2', null, 'Meine gespielten Tipps'));
    const offen = werte.offen > 0
      ? ` ${werte.offen === 1 ? 'Ein markierter Tipp wartet' : `${werte.offen} markierte Tipps warten`} noch auf die Ziehung.`
      : '';

    if (werte.tipps === 0) {
      karte.append(h('p', { class: 'unterzeile' }, 'Hier erscheint, was deine wirklich gespielten Tipps gebracht haben. '
        + `Markiere dazu vor der Ziehung unter „Mittwoch“ oder „Samstag“ einen Tipp mit „Spielen“.${offen}`));
      return karte;
    }

    const erwarteteGewinne = werte.tipps * Analyse.gewinnWahrscheinlichkeit();
    karte.append(
      h('p', { class: 'unterzeile' }, `Je Termin ein Tipp. Bei so wenigen Tipps schwankt das Ergebnis stark.${offen}`),
      h('div', { class: 'kacheln' },
        kachel(ganz(werte.tipps), 'gespielte Tipps, ausgewertet'),
        kachel(zahl2(werte.mittel), `Ø Richtige pro Tipp (erwartet ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)})`),
        kachel(ganz(werte.gewinne), `Tipps mit Gewinn (erwartet ${zahl2(erwarteteGewinne)})`),
        kachel(werte.besteTreffer, 'Richtige beim besten Tipp')));

    const alle = [...werte.liste].reverse();           // neueste zuerst
    const sichtbar = zustand.analyse.alleGespielten ? alle : alle.slice(0, GESPIELTE_IN_KURZLISTE);
    karte.append(h('div', { class: 'tabelle-rahmen abstand' }, h('table', { class: 'spalten-links' },
      h('thead', null, h('tr', null, ['Ziehung', 'Strategie', 'Tipp', 'Richtige', 'Superzahl', 'Ergebnis']
        .map((titel) => h('th', { scope: 'col' }, titel)))),
      h('tbody', null, sichtbar.map((zeile) => {
        const gezogen = new Set(zeile.gezogen);
        return h('tr', null,
          h('td', null, Kalender.formatKurz(zeile.datum)),
          h('td', null, h('span', { class: `punkt ${zeile.strategie}` }), Generator.strategie(zeile.strategie)?.name || zeile.strategie),
          h('td', { class: 'tipp-zahlen' }, zeile.zahlen.map((zahl) => (gezogen.has(zahl)
            ? h('strong', null, zahl) : h('span', null, zahl)))),
          h('td', null, zeile.treffer),
          h('td', null, `${zeile.superzahl} ${zeile.superzahlRichtig ? '· richtig' : '· nein'}`),
          h('td', null, zeile.klasse > 0 ? `Gewinnklasse ${zeile.klasse}` : 'kein Gewinn'));
      })))));

    if (alle.length > GESPIELTE_IN_KURZLISTE) {
      karte.append(h('div', { class: 'knopf-zeile' }, h('button', {
        type: 'button',
        class: 'knopf',
        onclick: () => { zustand.analyse.alleGespielten = !zustand.analyse.alleGespielten; zeichne(); },
      }, zustand.analyse.alleGespielten ? 'Nur die neuesten zeigen' : `Alle ${alle.length} zeigen`)));
    }
    karte.append(h('p', { class: 'klein abstand' }, 'Fett gedruckte Zahlen wurden gezogen.'));
    return karte;
  }

  // Die festen Tipps, Mittwoch und Samstag getrennt, eigene Zahlen extra.
  function karteDauerscheine(ziehungen, bereich) {
    const karte = h('section', { class: 'karte' },
      h('h2', null, 'Dauerscheine und eigene Scheine'),
      h('p', { class: 'unterzeile' }, 'Feste Tipps, die bei jeder Ziehung ihres Wochentags ausgewertet werden. '
        + `Erwartet: ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)} Richtige pro Tipp, wie bei jedem Tipp.`));

    const gruppe = (tag, art) => ({
      name: `${Kalender.TAGE[tag].name} · ${DAUER_ARTEN[art].name}`,
      ds: dauerschein(tag, art),
      werte: Analyse.werteDauerschein(ziehungen, dauerschein(tag, art), tag, bereich),
    });
    const gruppen = ['mi', 'sa'].flatMap((tag) => Object.keys(DAUER_ARTEN).map((art) => gruppe(tag, art)))
      .filter(({ ds }) => ds.tipps.length > 0);

    if (gruppen.length === 0) {
      karte.append(h('p', { class: 'klein abstand' }, 'Noch keine festen Tipps. Übernimm sie unter „Mittwoch“ oder „Samstag“ '
        + 'mit „+ Dauer“ neben einem Tipp, oder trage dort ganz unten eigene Zahlen ein.'));
      return karte;
    }

    const mittel = (wert) => (wert === null ? '–' : zahl2(wert));
    karte.append(h('div', { class: 'tabelle-rahmen abstand' }, h('table', null,
      h('thead', null, h('tr', null, ['Feste Tipps', 'Tipps aktiv', 'Ziehungen', 'Ø Richtige', 'Abweichung', 'Urteil', 'Gewinne', 'erwartet']
        .map((titel) => h('th', { scope: 'col' }, titel)))),
      h('tbody', null, gruppen.map(({ name, ds, werte }) => h('tr', null,
        h('td', null, name),
        h('td', null, ds.tipps.filter((tipp) => !tipp.bis).length),
        h('td', null, ganz(werte.ziehungen)),
        h('td', null, mittel(werte.mittel)),
        h('td', null, werte.abweichung === null ? '–' : (werte.abweichung > 0 ? '+' : '') + zahl2(werte.abweichung)),
        h('td', null, URTEILE[werte.urteil]),
        h('td', null, ganz(werte.gewinne)),
        h('td', null, zahl2(werte.tipps * Analyse.gewinnWahrscheinlichkeit()))))))));

    for (const { name, werte } of gruppen) {
      const zeilen = [...werte.proTipp].sort((a, b) => (a.bis ? 1 : 0) - (b.bis ? 1 : 0) || a.index - b.index);
      karte.append(
        h('h3', null, `${name}: jeder Tipp einzeln`),
        h('div', { class: 'tabelle-rahmen' }, h('table', { class: 'spalten-links' },
          h('thead', null, h('tr', null, ['Tipp', 'Status', 'Ziehungen', 'Ø Richtige', 'Bester', 'Gewinne']
            .map((titel) => h('th', { scope: 'col' }, titel)))),
          h('tbody', null, zeilen.map((zeile) => h('tr', null,
            h('td', { class: 'tipp-zahlen' }, zeile.zahlen.map((zahl) => h('span', null, zahl))),
            h('td', null, zeile.bis
              ? `beendet am ${Kalender.formatKurz(zeile.bis)}`
              : `aktiv seit ${Kalender.formatKurz(zeile.ab)}`),
            h('td', null, ganz(zeile.ziehungen)),
            h('td', null, mittel(zeile.mittel)),
            h('td', null, zeile.ziehungen ? zeile.besteTreffer : '–'),
            h('td', null, ganz(zeile.gewinne))))))));
    }

    karte.append(h('p', { class: 'klein abstand' }, 'Herausgenommene Tipps bleiben mit ihren Ergebnissen stehen. Sonst könnte man '
      + 'schlechte Tipps aussortieren, und die festen Tipps sähen besser aus, als sie waren.'
      + (gruppen.length > 1
        ? ' Je weniger Tipps ein Schein hat, desto stärker schwankt sein Durchschnitt: Ein einzelner Dreier fällt dann viel mehr ins Gewicht.'
        : '')));
    return karte;
  }

  function karteVergleich(ziehungen, bereich) {
    const zeilen = Generator.STRATEGIEN.map((strategie) => {
      const mi = Analyse.werteAus(ziehungen, { tag: 'mi', strategie: strategie.id, ...bereich });
      const sa = Analyse.werteAus(ziehungen, { tag: 'sa', strategie: strategie.id, ...bereich });
      const alle = Analyse.werteAus(ziehungen, { tag: 'alle', strategie: strategie.id, ...bereich });
      const mittel = (werte) => (werte.mittel === null ? '–' : zahl2(werte.mittel));
      return h('tr', null,
        h('td', null, h('span', { class: `punkt ${strategie.id}` }), strategie.name),
        h('td', null, mittel(mi)),
        h('td', null, mittel(sa)),
        h('td', null, mittel(alle)),
        h('td', null, alle.abweichung === null ? '–' : (alle.abweichung > 0 ? '+' : '') + zahl2(alle.abweichung)),
        h('td', null, URTEILE[alle.urteil]),
        h('td', null, alle.tipps ? alle.besteTreffer : '–'),
        h('td', null, ganz(alle.tipps)));
    });

    return h('section', { class: 'karte' },
      h('h2', null, 'Strategien im Vergleich'),
      h('p', { class: 'unterzeile' }, `Durchschnittliche Richtige pro Tipp. Reiner Zufall lässt ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)} erwarten.`),
      h('div', { class: 'tabelle-rahmen abstand' },
        h('table', null,
          h('thead', null, h('tr', null,
            ['Strategie', 'Ø Mittwoch', 'Ø Samstag', 'Ø gesamt', 'Abweichung', 'Urteil', 'Bester Tipp', 'Tipps']
              .map((titel) => h('th', { scope: 'col' }, titel)))),
          h('tbody', null, zeilen))),
      h('p', { class: 'klein abstand' }, 'Abweichung: Abstand zur Erwartung, gemessen an der Schwankung von Ziehung zu Ziehung. '
        + 'Werte zwischen −2 und +2 sind bei reinem Zufall normal.'));
  }

  function karteDetail(ziehungen, bereich) {
    const filter = zustand.analyse;
    const werte = Analyse.werteAus(ziehungen, { tag: filter.tag, strategie: filter.strategie, ...bereich });
    const strategie = Generator.strategie(filter.strategie);

    const filterzeile = h('div', { class: 'filterzeile' },
      h('div', null,
        h('label', null, 'Wochentag'),
        auswahl('Wochentag', [
          { id: 'alle', name: 'Beide' }, { id: 'mi', name: 'Mittwoch' }, { id: 'sa', name: 'Samstag' },
        ], filter.tag, (id) => { filter.tag = id; zeichne(); })),
      h('div', null,
        h('label', null, 'Strategie'),
        auswahl('Strategie', STRATEGIE_OPTIONEN, filter.strategie, (id) => { filter.strategie = id; zeichne(); })));

    const karte = h('section', { class: 'karte' },
      h('h2', null, 'Im Detail'),
      h('p', { class: 'unterzeile' }, 'Die Filter gelten für alle Auswertungen in diesem Abschnitt'
        + (bereich.von ? ', zusätzlich zum gewählten Zeitraum.' : '.')),
      h('div', { class: 'abstand' }, filterzeile));

    if (werte.tipps === 0) {
      karte.append(h('p', { class: 'leer' }, 'Für diese Auswahl gibt es noch keine ausgewertete Ziehung.'));
      return karte;
    }

    karte.append(
      h('h3', null, `Wie viele Richtige hatten die Tipps? · ${strategie.name}`),
      h('div', { class: 'zweispaltig' }, diagrammVerteilung(werte), tabelleVerteilung(werte)),
      h('h3', null, 'Gewinnklassen'),
      tabelleKlassen(werte),
      h('p', { class: 'klein abstand' }, `Superzahl richtig bei ${werte.superzahlTreffer} von ${werte.ziehungen} Scheinen `
        + `(erwartet: ${zahl2(werte.ziehungen * 0.1)}).`),
      h('h3', null, 'Wie oft kam jede Zahl vor?'),
      h('div', { class: 'zweispaltig' },
        waermekarte(`Tipps · ${strategie.name}`, werte.zahlenGenerator, 'in den Tipps'),
        waermekarte('Echte Ziehungen', werte.zahlenEcht, 'gezogen')));
    return karte;
  }

  // Säulen = beobachteter Anteil, Strich = Erwartung bei reinem Zufall.
  function diagrammVerteilung(werte) {
    const erwartet = Analyse.erwarteteVerteilung();
    const beobachtet = werte.verteilung.map((anzahl) => anzahl / werte.tipps);
    const achsenMax = Math.max(0.5, Math.ceil(Math.max(...beobachtet) * 10) / 10);
    const schritt = achsenMax > 0.6 ? 0.2 : 0.1;

    const gitter = [];
    for (let wert = 0; wert <= achsenMax + 1e-9; wert += schritt) {
      gitter.push(h('div', {
        class: `gitter${wert === 0 ? ' grund' : ''}`,
        style: `bottom:${(wert / achsenMax) * 100}%`,
      }, h('span', null, prozent(wert, 0))));
    }

    const saeulen = beobachtet.map((anteil, treffer) => h('div', {
      class: 'saeule',
      tabindex: '0',
      'data-tipp': `${treffer} Richtige: ${ganz(werte.verteilung[treffer])} von ${ganz(werte.tipps)} Tipps `
        + `(${prozent(anteil)}). Erwartet: ${prozentKlein(erwartet[treffer])}.`,
    },
    h('div', { class: 'balken', style: `height:${(anteil / achsenMax) * 100}%` }),
    h('div', { class: 'soll', style: `bottom:${(erwartet[treffer] / achsenMax) * 100}%` })));

    return h('div', null,
      h('div', { class: 'legende' },
        h('span', null, h('i', { class: 'l-balken' }), 'beobachtet'),
        h('span', null, h('i', { class: 'l-soll' }), 'erwartet bei reinem Zufall')),
      h('div', { class: 'diagramm' },
        h('div', { class: 'diagramm-flaeche' }, gitter, h('div', { class: 'saeulen' }, saeulen)),
        h('div', { class: 'diagramm-achse' }, beobachtet.map((_, treffer) => h('span', null, treffer))),
        h('div', { class: 'achsen-titel' }, 'Richtige pro Tipp')));
  }

  function tabelleVerteilung(werte) {
    const erwartet = Analyse.erwarteteVerteilung();
    return h('div', { class: 'tabelle-rahmen' }, h('table', null,
      h('thead', null, h('tr', null, ['Richtige', 'Tipps', 'Anteil', 'erwartet']
        .map((titel) => h('th', { scope: 'col' }, titel)))),
      h('tbody', null, werte.verteilung.map((anzahl, treffer) => h('tr', null,
        h('td', null, treffer),
        h('td', null, ganz(anzahl)),
        h('td', null, prozent(anzahl / werte.tipps)),
        h('td', null, prozentKlein(erwartet[treffer])))))));
  }

  function tabelleKlassen(werte) {
    const erwarteteAnzahl = (klasse) => {
      const wert = werte.tipps * Analyse.klassenWahrscheinlichkeit(klasse);
      return wert < 0.01 ? 'unter 0,01' : zahl2(wert);
    };
    return h('div', { class: 'tabelle-rahmen' }, h('table', { class: 'spalte2-links' },
      h('thead', null, h('tr', null, ['Klasse', 'Bedingung', 'Tipps', 'erwartet']
        .map((titel) => h('th', { scope: 'col' }, titel)))),
      h('tbody', null,
        Analyse.KLASSEN.map((klasse) => h('tr', null,
          h('td', null, klasse.klasse),
          h('td', null, klasse.name),
          h('td', null, ganz(werte.klassen[klasse.klasse])),
          h('td', null, erwarteteAnzahl(klasse)))),
        h('tr', null,
          h('td', null, '–'),
          h('td', null, 'kein Gewinn'),
          h('td', null, ganz(werte.klassen[0])),
          h('td', null, '')))));
  }

  // 7 × 7 Felder wie auf dem Lottoschein. Je kräftiger, desto häufiger.
  // Die Farbskala reicht von der seltensten bis zur häufigsten Zahl, damit
  // Unterschiede sichtbar bleiben, auch wenn alle Zahlen ähnlich oft vorkamen.
  function waermekarte(titel, haeufigkeit, einheit) {
    const werte = haeufigkeit.slice(1);
    const max = Math.max(...werte);
    const min = Math.min(...werte);
    const zellen = [];
    for (let zahl = 1; zahl <= Generator.ZAHLEN_MAX; zahl += 1) {
      const anzahl = haeufigkeit[zahl];
      let staerke = 0;
      if (anzahl > 0) staerke = max > min ? 12 + 88 * ((anzahl - min) / (max - min)) : 60;
      zellen.push(h('div', {
        class: `zelle${staerke > 0 ? ' gefuellt' : ''}${staerke > 50 ? ' dunkel' : ''}`,
        tabindex: '0',
        style: staerke > 0 ? `background:color-mix(in oklab, var(--skala-hoch) ${staerke.toFixed(0)}%, var(--flaeche))` : null,
        'data-tipp': `Zahl ${zahl}: ${ganz(anzahl)}-mal ${einheit}`,
      }, zahl));
    }
    return h('div', null,
      h('p', { class: 'unterzeile' }, titel),
      h('div', { class: 'waermekarte abstand' }, zellen),
      h('div', { class: 'skala' },
        h('span', null, `${ganz(min)}-mal`),
        h('div', { class: 'skala-verlauf' }),
        h('span', null, `${ganz(max)}-mal`)));
  }

  // ---------- Ansicht: Erklärung ----------

  function ansichtErklaerung() {
    const verteilung = Analyse.erwarteteVerteilung();
    return h('div', { class: 'text' },
      h('section', { class: 'karte' },
        h('h2', null, 'So läuft ein Termin ab'),
        h('ol', null,
          h('li', null, 'Vor der Ziehung unter „Mittwoch“ oder „Samstag“ den Termin wählen und „Tipps erzeugen“ anklicken. '
            + 'Jede Strategie füllt einen Schein mit 12 Tipps. Die Tipps werden sofort gespeichert.'),
          h('li', null, 'Spielst du einen der Tipps wirklich, markiere ihn mit „Spielen“ und stelle die Superzahl deines Spielscheins ein '
            + '(die letzte Ziffer der Spielschein-Nummer). Pro Termin geht eine Markierung.'),
          h('li', null, 'Nach der Ziehung die 6 echten Zahlen und die Superzahl eintragen.'),
          h('li', null, 'Ab dann sind die Tipps und die Markierung gesperrt. Das ist Absicht: Wer nach der Ziehung neu würfeln '
            + 'oder den besten Tipp nachträglich als gespielt ausgeben könnte, würde das Ergebnis verfälschen.'),
          h('li', null, 'Unter „Analyse“ wächst die Auswertung mit jeder Ziehung. Nach sechs Monaten ist sie aussagekräftig.'))),

      h('section', { class: 'karte' },
        h('h2', null, 'Halbjahre und gespielte Tipps'),
        h('p', null, 'Die Analyse teilt die Zeit ab deinem ersten Termin in Abschnitte von 26 Wochen. Jedes Halbjahr hat dadurch '
          + 'gleich viele Ziehungen: 26 am Mittwoch und 26 am Samstag. Sobald das zweite Halbjahr begonnen hat, kannst du oben '
          + 'in der Analyse einen Zeitraum wählen.'),
        h('p', null, 'Die Tabelle „Halbjahre im Vergleich“ stellt dieselbe Strategie über alle Halbjahre nebeneinander. '
          + 'So prüfst du eine Vermutung aus dem ersten Halbjahr mit neuen Zahlen aus dem zweiten.'),
        h('p', null, '„Meine gespielten Tipps“ zählt nur die markierten Tipps, also einen pro Termin. Die Strategien werden '
          + 'weiterhin mit allen 12 Tipps je Schein gemessen, denn ein einzelner Tipp pro Ziehung reicht für einen Vergleich nicht aus.')),

      h('section', { class: 'karte' },
        h('h2', null, 'Dauerscheine: immer dieselben Tipps'),
        h('p', null, 'Mittwoch und Samstag haben je einen Dauerschein mit bis zu 12 festen Tipps. Mit „+ Dauer“ neben einem '
          + 'erzeugten Tipp übernimmst du ihn. Ab dann vergleicht das Tool ihn bei jeder Ziehung seines Wochentags mit den echten '
          + 'Zahlen, ohne dass du etwas neu erzeugen musst. Ein Mittwochs-Dauertipp zählt nur mittwochs, ein Samstags-Dauertipp nur samstags.'),
        h('p', null, 'Ein Dauertipp zählt erst ab der nächsten Ziehung, deren Zahlen noch nicht eingetragen sind. So kann niemand einen '
          + 'Tipp übernehmen, dessen Ergebnis schon feststeht. Aus demselben Grund verschwinden herausgenommene Tipps nicht aus der '
          + 'Analyse, sondern bleiben mit ihren bisherigen Ergebnissen stehen.'),
        h('p', null, 'Die Superzahl des Dauerscheins kommt anfangs vom Schein des ersten übernommenen Tipps. Änderst du sie, gilt die '
          + 'neue ab der nächsten offenen Ziehung; frühere Ziehungen behalten die damalige.'),
        h('h3', null, 'Eigene Zahlen'),
        h('p', null, `Zusätzlich hast du je Wochentag zwei eigene Scheine mit Platz für bis zu ${DAUERTIPPS_MAX} Tipps aus selbst `
          + 'gewählten Zahlen. Für sie gelten dieselben Regeln. Jeder Schein hat seine eigene Superzahl und steht in der Analyse '
          + 'in einer eigenen Zeile. So siehst du, ob selbst gewählte Zahlen besser oder schlechter abschneiden als die des Zufallsgenerators. Zu erwarten ist: gleich gut, '
          + 'denn jede Kombination aus 6 Zahlen hat dieselbe Chance.')),

      h('section', { class: 'karte' },
        h('h2', null, 'Der Algorithmus: gewichtetes Ziehen'),
        h('p', null, 'Alle Strategien benutzen dieselbe Ziehung. Jede Zahl von 1 bis 49 bekommt ein Gewicht. '
          + 'Eine Zahl mit doppeltem Gewicht hat die doppelte Chance. Nach jeder gezogenen Zahl kommt sie aus dem Topf, '
          + 'genau wie eine Kugel in der echten Ziehung. Die Strategien unterscheiden sich nur darin, wie sie die Gewichte vergeben.'),
        Generator.STRATEGIEN.map((strategie) => [
          h('h3', null, h('span', { class: `punkt ${strategie.id}` }), strategie.name),
          h('p', null, strategie.erklaerung),
        ]),
        h('p', null, '„Heiß“ und „Kalt“ sehen nur echte Ziehungen desselben Wochentags, die vor dem Tipp-Termin liegen. '
          + 'Mittwoch und Samstag bleiben dadurch vollständig getrennt.'),
        h('p', null, 'Der Programmtext dazu steht in der Datei ', h('code', null, 'js/generator.js'), '.')),

      h('section', { class: 'karte' },
        h('h2', null, 'Was die Analyse rechnet'),
        h('p', null, `Ein Tipp hat 6 Zahlen, gezogen werden 6 von 49. Im Schnitt trifft ein Tipp also 6 × 6 ÷ 49 = ${zahl2(Analyse.ERWARTUNG_PRO_TIPP)} Richtige. `
          + 'Das gilt für jeden Tipp, egal wie er zustande kam.'),
        h('div', { class: 'tabelle-rahmen abstand' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Richtige'), h('th', { scope: 'col' }, 'Wahrscheinlichkeit pro Tipp'))),
          h('tbody', null, verteilung.map((p, treffer) => h('tr', null,
            h('td', null, treffer),
            h('td', null, prozentKlein(p))))))),
        h('p', null, 'Das Urteil vergleicht den Durchschnitt einer Strategie mit dieser Erwartung. Maßstab ist, wie stark die Ergebnisse '
          + 'von Ziehung zu Ziehung schwanken. Liegt die Abweichung zwischen −2 und +2, ist sie mit reinem Zufall gut erklärbar.'),
        h('p', null, 'Zwei Dinge solltest du beim Lesen im Kopf behalten. Sechs Monate sind etwa 52 Ziehungen, das ist für Statistik wenig. '
          + 'Und die Tabelle vergleicht mehrere Strategien: Bei 20 Vergleichen landet im Schnitt einer rein zufällig außerhalb von −2 bis +2.')),

      h('section', { class: 'karte' },
        h('h2', null, 'Was das Ergebnis bedeuten kann'),
        h('p', null, 'Die Lottokugeln haben kein Gedächtnis. Eine Zahl, die oft kam, kommt deshalb weder häufiger noch seltener. '
          + 'Zu erwarten ist, dass alle vier Strategien nah an derselben Erwartung landen. Die Analyse zeigt dir, ob deine Daten das bestätigen.')));
  }

  // ---------- Abgleich zwischen den Geräten ----------

  const uhrzeit = (zeit) => zeit.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function standText() {
    const { art, zeit, text } = Wolke.status();
    const zuletzt = zeit ? ` Zuletzt abgeglichen um ${uhrzeit(zeit)} Uhr.` : '';
    if (!Wolke.angemeldet()) return { kurz: text ? 'neu anmelden' : 'nur dieses Gerät', lang: text || 'Nicht angemeldet. Deine Zahlen liegen nur auf diesem Gerät.', ok: false };
    if (art === 'aktuell') return { kurz: 'abgeglichen', lang: `Alles abgeglichen um ${uhrzeit(zeit)} Uhr.`, ok: true };
    if (art === 'offline') return { kurz: 'offline', lang: `Server nicht erreichbar. Du kannst weiterarbeiten, der Abgleich wird nachgeholt.${zuletzt}`, ok: false };
    if (art === 'wartet') return { kurz: 'wartet', lang: 'Der Abgleich wartet, bis deine angefangene Eingabe gespeichert oder abgebrochen ist.', ok: false };
    if (art === 'fehler') return { kurz: 'Fehler', lang: `Der Abgleich hat nicht geklappt: ${text} Deine Zahlen auf diesem Gerät sind nicht betroffen.`, ok: false };
    return { kurz: 'gleicht ab …', lang: 'Der Abgleich läuft gerade.', ok: true };
  }

  // Ändert nur die Anzeige, nicht die ganze Seite. So geht keine angefangene
  // Eingabe verloren, auch nicht im Anmeldefeld.
  function zeigeStand() {
    const { kurz, lang, ok } = standText();
    const chip = document.getElementById('stand');
    chip.textContent = kurz;
    chip.classList.toggle('ok', ok);
    chip.setAttribute('aria-label', `Abgleich: ${kurz}. Zu den Einstellungen.`);
    const zeile = document.getElementById('stand-lang');
    if (zeile) zeile.textContent = lang;
  }

  function karteGeraete() {
    const karte = h('section', { class: 'karte' }, h('h2', null, 'Auf allen Geräten'));
    const stand = h('p', { id: 'stand-lang', class: 'unterzeile', role: 'status' }, standText().lang);

    if (Wolke.angemeldet()) {
      karte.append(
        h('p', null, 'Angemeldet als ', h('strong', null, Wolke.angemeldetAls()),
          '. Was du hier einträgst, erscheint auf allen Geräten, auf denen du angemeldet bist.'),
        stand,
        h('div', { class: 'knopf-zeile' },
          h('button', { type: 'button', class: 'knopf haupt', onclick: () => Wolke.abgleichen() }, 'Jetzt abgleichen'),
          h('button', {
            type: 'button',
            class: 'knopf',
            onclick: async () => {
              const frage = Wolke.allesGesichert()
                ? 'Auf diesem Gerät abmelden? Deine Zahlen bleiben hier stehen, werden aber nicht mehr abgeglichen.'
                : 'Achtung: Die letzten Änderungen sind noch nicht auf dem Server. Trotzdem abmelden? Sie bleiben auf diesem Gerät stehen.';
              if (!window.confirm(frage)) return;
              await Wolke.abmelden();
              zeichne();
            },
          }, 'Abmelden')));
      return karte;
    }

    const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, id: 'anmelde-email' });
    const passwort = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, id: 'anmelde-passwort' });
    const fehler = h('p', { class: 'unterzeile', role: 'alert' });
    const knopf = h('button', { type: 'submit', class: 'knopf haupt' }, 'Anmelden');
    karte.append(
      h('p', null, 'Melde dich auf jedem Gerät einmal an. Dann siehst du überall dieselben Zahlen. Was hier schon eingetragen ist, '
        + 'wird dabei mit deinem Konto zusammengeführt.'),
      stand,
      h('form', {
        class: 'anmeldung',
        onsubmit: async (ereignis) => {
          ereignis.preventDefault();
          knopf.disabled = true;
          fehler.textContent = 'Einen Moment …';
          const meldung = await Wolke.anmelden(email.value.trim(), passwort.value);
          knopf.disabled = false;
          if (meldung) { fehler.textContent = meldung; return; }
          melde('Angemeldet.');
          zeichne();
        },
      },
      h('label', { for: 'anmelde-email' }, 'E-Mail-Adresse'), email,
      h('label', { for: 'anmelde-passwort' }, 'Passwort'), passwort,
      h('div', { class: 'knopf-zeile' }, knopf, fehler)));
    return karte;
  }

  // ---------- Ansicht: Daten ----------

  function ansichtDaten() {
    const ziehungen = zustand.daten.ziehungen;
    const anzahl = Object.keys(ziehungen).length;
    const letzte = zustand.daten.letzteSicherung
      ? new Date(zustand.daten.letzteSicherung).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })
      : 'noch nie';

    const dateiFeld = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    dateiFeld.addEventListener('change', () => {
      if (dateiFeld.files[0]) sicherungEinlesen(dateiFeld.files[0]);
      dateiFeld.value = '';
    });

    return h('div', { class: 'text' },
      karteGeraete(),

      h('section', { class: 'karte' },
        h('h2', null, 'Sicherung'),
        h('p', null, Wolke.angemeldet()
          ? 'Deine Zahlen liegen auf dem Server und zusätzlich in diesem Browser. Eine Sicherungsdatei schützt dich, falls du einmal '
            + 'versehentlich etwas löschst, denn das gilt dann auf allen Geräten. Es reicht, die neueste Datei aufzuheben.'
          : 'Alle Zahlen liegen nur im Speicher dieses Browsers. Leerst du die Browserdaten oder wechselst den Browser, sind sie weg. '
            + 'Lade deshalb regelmäßig eine Sicherung herunter. Es reicht, die neueste Datei aufzuheben.'),
        h('p', { class: 'unterzeile' }, `Gespeichert: ${anzahl} Termine · Letzte Sicherung: ${letzte}`),
        h('div', { class: 'knopf-zeile' },
          h('button', { type: 'button', class: 'knopf haupt', onclick: sicherungHerunterladen }, 'Sicherung herunterladen'),
          h('button', { type: 'button', class: 'knopf', onclick: () => dateiFeld.click() }, 'Sicherung einlesen'),
          dateiFeld)),

      h('section', { class: 'karte' },
        h('h2', null, 'Neu anfangen'),
        h('p', null, `Löscht alle Tipps und alle echten Zahlen ${Wolke.angemeldet() ? 'auf dem Server und auf allen Geräten' : 'aus diesem Browser'}. `
          + 'Eine heruntergeladene Sicherung bleibt erhalten.'),
        h('div', { class: 'knopf-zeile' },
          h('button', {
            type: 'button',
            class: 'knopf',
            disabled: anzahl === 0,
            onclick: () => {
              if (!window.confirm(`Wirklich alle ${anzahl} Termine${Wolke.angemeldet() ? ' auf allen Geräten' : ''} löschen? Das lässt sich nur mit einer Sicherung rückgängig machen.`)) return;
              zustand.daten = Speicher.leer();
              sichern();
              melde('Alle Daten gelöscht.');
              zeichne();
            },
          }, 'Alle Daten löschen'))));
  }

  // ---------- Zeichnen ----------

  function hinweisSicherung() {
    if (!hatDaten() || zustand.ansicht === 'daten') return null;
    const letzte = zustand.daten.letzteSicherung;
    const tage = letzte ? Kalender.tageZwischen(letzte.slice(0, 10), Kalender.heute()) : null;
    if (tage !== null && tage < SICHERUNG_ERINNERN_NACH_TAGEN) return null;
    // Ohne bisherige Sicherung erst erinnern, wenn schon etwas zu verlieren ist.
    if (tage === null && Object.keys(zustand.daten.ziehungen).length < 2) return null;
    return h('div', { class: 'hinweis' },
      h('span', null, tage === null
        ? 'Es gibt noch keine Sicherung deiner Daten.'
        : `Die letzte Sicherung ist ${tage} Tage alt.`),
      h('button', { type: 'button', class: 'knopf', onclick: sicherungHerunterladen }, 'Jetzt sichern'));
  }

  function zeichne() {
    for (const knopf of document.querySelectorAll('.reiter button')) {
      if (knopf.dataset.ansicht === zustand.ansicht) knopf.setAttribute('aria-current', 'page');
      else knopf.removeAttribute('aria-current');
    }

    let ansicht;
    if (zustand.ansicht === 'analyse') ansicht = ansichtAnalyse();
    else if (zustand.ansicht === 'erklaerung') ansicht = ansichtErklaerung();
    else if (zustand.ansicht === 'daten') ansicht = ansichtDaten();
    else ansicht = ansichtTag(zustand.ansicht);

    tooltip.hidden = true;
    inhalt.replaceChildren(...[hinweisSicherung(), ansicht].filter(Boolean));
    zeigeStand();
  }

  // ---------- Tooltip für Diagramm und Zahlenfelder ----------

  function zeigeTooltip(element, x, y) {
    tooltip.textContent = element.dataset.tipp;
    tooltip.hidden = false;
    const breite = tooltip.offsetWidth;
    const hoehe = tooltip.offsetHeight;
    const links = Math.min(Math.max(8, x - breite / 2), window.innerWidth - breite - 8);
    const oben = y - hoehe - 12 < 8 ? y + 18 : y - hoehe - 12;
    tooltip.style.left = `${links}px`;
    tooltip.style.top = `${oben}px`;
  }

  document.addEventListener('mousemove', (ereignis) => {
    const element = ereignis.target.closest ? ereignis.target.closest('[data-tipp]') : null;
    if (element) zeigeTooltip(element, ereignis.clientX, ereignis.clientY);
    else tooltip.hidden = true;
  });
  document.addEventListener('focusin', (ereignis) => {
    const element = ereignis.target.closest ? ereignis.target.closest('[data-tipp]') : null;
    if (!element) return;
    const rahmen = element.getBoundingClientRect();
    zeigeTooltip(element, rahmen.left + rahmen.width / 2, rahmen.top);
  });
  document.addEventListener('focusout', () => { tooltip.hidden = true; });

  // ---------- Start ----------

  for (const knopf of document.querySelectorAll('.reiter button')) {
    knopf.addEventListener('click', () => {
      zustand.ansicht = knopf.dataset.ansicht;
      zeichne();
      window.scrollTo(0, 0);
    });
  }
  document.getElementById('stand').addEventListener('click', () => {
    zustand.ansicht = 'daten';
    zeichne();
    window.scrollTo(0, 0);
  });

  // Beim Start den Wochentag der nächsten Ziehung zeigen.
  const heute = Kalender.heute();
  zustand.ansicht = Kalender.naechsterTermin('mi', heute) <= Kalender.naechsterTermin('sa', heute) ? 'mi' : 'sa';
  if (window.location.hash === '#daten') zustand.ansicht = 'daten';   // direkt zur Anmeldung
  zeichne();

  Wolke.start({
    lese: () => zustand.daten,
    ersetze: (neu) => {
      zustand.daten = neu;
      Speicher.speichern(neu);
      const stelle = window.scrollY;
      zeichne();
      window.scrollTo(0, stelle);
    },
    // Nicht, solange jemand Zahlen anklickt und noch nicht gespeichert hat
    darfErsetzen: () => !inhalt.querySelector('[data-eingabe] [aria-pressed="true"]'),
    zeigeStatus: zeigeStand,
  }, Speicher.hatteDaten());
})();
