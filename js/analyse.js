'use strict';

// Analyse: vergleicht die Tipps des Generators mit den echten Ziehungen
// und stellt daneben, was reiner Zufall erwarten lässt.
const Analyse = (() => {
  // Erwartete Richtige pro Tipp: 6 Zahlen getippt, 6 von 49 gezogen.
  const ERWARTUNG_PRO_TIPP = (6 * 6) / 49;

  // Ab so vielen ausgewerteten Ziehungen gibt es ein Urteil.
  const MIN_ZIEHUNGEN_FUER_URTEIL = 8;

  // Ein „Halbjahr“ sind genau 26 Wochen, damit jedes gleich viele Ziehungen hat.
  const WOCHEN_PRO_HALBJAHR = 26;
  const TAGE_PRO_HALBJAHR = WOCHEN_PRO_HALBJAHR * 7;

  const KLASSEN = [
    { klasse: 1, treffer: 6, superzahl: true, name: '6 Richtige + Superzahl' },
    { klasse: 2, treffer: 6, superzahl: false, name: '6 Richtige' },
    { klasse: 3, treffer: 5, superzahl: true, name: '5 Richtige + Superzahl' },
    { klasse: 4, treffer: 5, superzahl: false, name: '5 Richtige' },
    { klasse: 5, treffer: 4, superzahl: true, name: '4 Richtige + Superzahl' },
    { klasse: 6, treffer: 4, superzahl: false, name: '4 Richtige' },
    { klasse: 7, treffer: 3, superzahl: true, name: '3 Richtige + Superzahl' },
    { klasse: 8, treffer: 3, superzahl: false, name: '3 Richtige' },
    { klasse: 9, treffer: 2, superzahl: true, name: '2 Richtige + Superzahl' },
  ];

  // „n über k“: auf wie viele Arten man k Dinge aus n auswählen kann.
  function ueber(n, k) {
    let ergebnis = 1;
    for (let i = 1; i <= k; i += 1) ergebnis = (ergebnis * (n - k + i)) / i;
    return ergebnis;
  }

  // Wahrscheinlichkeit für genau 0, 1, ... 6 Richtige bei einem Tipp.
  function erwarteteVerteilung() {
    const alle = ueber(49, 6);
    const verteilung = [];
    for (let k = 0; k <= 6; k += 1) {
      verteilung.push((ueber(6, k) * ueber(43, 6 - k)) / alle);
    }
    return verteilung;
  }

  // Wahrscheinlichkeit, mit einem Tipp genau diese Gewinnklasse zu treffen.
  function klassenWahrscheinlichkeit(klasse) {
    const anteilSuperzahl = klasse.superzahl ? 0.1 : 0.9;
    return erwarteteVerteilung()[klasse.treffer] * anteilSuperzahl;
  }

  function zaehleTreffer(tipp, gezogen) {
    const menge = new Set(gezogen);
    return tipp.filter((zahl) => menge.has(zahl)).length;
  }

  // Nummer der Gewinnklasse (1–9) oder 0 für „kein Gewinn“.
  function gewinnklasse(treffer, superzahlRichtig) {
    const gefunden = KLASSEN.find(
      (k) => k.treffer === treffer && k.superzahl === superzahlRichtig,
    );
    if (gefunden) return gefunden.klasse;
    // 3 bis 6 Richtige ohne Superzahl sind oben schon erfasst; übrig bleibt
    // nur „2 Richtige ohne Superzahl“ und weniger: kein Gewinn.
    return 0;
  }

  // Wahrscheinlichkeit, mit einem Tipp irgendeine Gewinnklasse zu treffen.
  function gewinnWahrscheinlichkeit() {
    return KLASSEN.reduce((summe, klasse) => summe + klassenWahrscheinlichkeit(klasse), 0);
  }

  // Passt ein Termin zum Filter?
  //   filter.tag: 'mi', 'sa' oder 'alle'
  //   filter.von: erster Tag des Zeitraums (eingeschlossen), z. B. '2026-11-18'
  //   filter.bis: erster Tag NACH dem Zeitraum (ausgeschlossen)
  function passtZumFilter(datum, filter) {
    if (filter.tag && filter.tag !== 'alle' && Kalender.tagVon(datum) !== filter.tag) return false;
    if (filter.von && datum < filter.von) return false;
    if (filter.bis && datum >= filter.bis) return false;
    return true;
  }

  // Teilt die Zeit ab dem ersten Termin mit Tipps in Abschnitte von 26 Wochen.
  // Jeder Abschnitt enthält 26 Mittwochs- und 26 Samstagsziehungen.
  function halbjahre(ziehungen, heute) {
    const mitTipps = Object.keys(ziehungen).filter((datum) => ziehungen[datum].scheine).sort();
    if (mitTipps.length === 0) return [];
    const ende = heute > mitTipps[0] ? heute : mitTipps[0];
    const liste = [];
    let von = mitTipps[0];
    while (von <= ende) {
      const bis = Kalender.plusTage(von, TAGE_PRO_HALBJAHR);
      liste.push({
        nr: liste.length + 1,
        von,
        bis,                                   // ausgeschlossen
        letzterTag: Kalender.plusTage(bis, -1),
        laeuft: heute < bis,
      });
      von = bis;
    }
    return liste;
  }

  // Wertet nur die Tipps aus, die als wirklich gespielt markiert sind.
  // Die Superzahl kommt hier vom echten Spielschein, nicht vom erzeugten.
  function werteGespielt(ziehungen, filter) {
    const ergebnis = {
      tipps: 0,                     // gespielt UND ausgewertet
      offen: 0,                     // gespielt, Ziehung steht noch aus
      summeTreffer: 0,
      mittel: null,
      gewinne: 0,
      besteTreffer: 0,
      klassen: new Array(10).fill(0),
      liste: [],                    // älteste zuerst
    };

    for (const datum of Object.keys(ziehungen).sort()) {
      if (!passtZumFilter(datum, filter)) continue;
      const eintrag = ziehungen[datum];
      const gespielt = eintrag.gespielt;
      const schein = gespielt && eintrag.scheine && eintrag.scheine[gespielt.strategie];
      const zahlen = schein && schein.tipps[gespielt.tipp];
      if (!zahlen) continue;
      if (!eintrag.echt) {
        ergebnis.offen += 1;
        continue;
      }

      const treffer = zaehleTreffer(zahlen, eintrag.echt.zahlen);
      const superzahlRichtig = gespielt.superzahl === eintrag.echt.superzahl;
      const klasse = gewinnklasse(treffer, superzahlRichtig);
      ergebnis.tipps += 1;
      ergebnis.summeTreffer += treffer;
      ergebnis.klassen[klasse] += 1;
      if (klasse > 0) ergebnis.gewinne += 1;
      ergebnis.besteTreffer = Math.max(ergebnis.besteTreffer, treffer);
      ergebnis.liste.push({
        datum,
        strategie: gespielt.strategie,
        nr: gespielt.tipp + 1,
        zahlen,
        gezogen: eintrag.echt.zahlen,
        treffer,
        superzahl: gespielt.superzahl,
        superzahlRichtig,
        klasse,
      });
    }

    if (ergebnis.tipps > 0) ergebnis.mittel = ergebnis.summeTreffer / ergebnis.tipps;
    return ergebnis;
  }

  // Wertet alle Ziehungen aus, die zum Filter passen.
  //   filter.tag:       'mi', 'sa' oder 'alle'
  //   filter.strategie: Kennung der Strategie, z. B. 'zufall'
  //   filter.von / filter.bis: Zeitraum, siehe passtZumFilter (beide freiwillig)
  function werteAus(ziehungen, filter) {
    const ergebnis = {
      ziehungen: 0,                 // Termine mit Tipps UND echten Zahlen
      echteZiehungen: 0,            // Termine mit echten Zahlen
      tipps: 0,
      summeTreffer: 0,
      verteilung: new Array(7).fill(0),
      klassen: new Array(10).fill(0),
      besteTreffer: 0,
      superzahlTreffer: 0,          // Scheine mit richtiger Superzahl
      zahlenGenerator: new Array(50).fill(0),
      zahlenEcht: new Array(50).fill(0),
      mittel: null,
      abweichung: null,             // in Standardfehlern
      urteil: 'keine',
    };
    const mittelProZiehung = [];

    for (const [datum, eintrag] of Object.entries(ziehungen)) {
      if (!passtZumFilter(datum, filter)) continue;

      if (eintrag.echt) {
        ergebnis.echteZiehungen += 1;
        for (const zahl of eintrag.echt.zahlen) ergebnis.zahlenEcht[zahl] += 1;
      }

      const schein = eintrag.scheine && eintrag.scheine[filter.strategie];
      if (!schein) continue;
      for (const tipp of schein.tipps) {
        for (const zahl of tipp) ergebnis.zahlenGenerator[zahl] += 1;
      }
      if (!eintrag.echt) continue;

      ergebnis.ziehungen += 1;
      const superzahlRichtig = schein.superzahl === eintrag.echt.superzahl;
      if (superzahlRichtig) ergebnis.superzahlTreffer += 1;

      let summe = 0;
      for (const tipp of schein.tipps) {
        const treffer = zaehleTreffer(tipp, eintrag.echt.zahlen);
        summe += treffer;
        ergebnis.verteilung[treffer] += 1;
        ergebnis.klassen[gewinnklasse(treffer, superzahlRichtig)] += 1;
        ergebnis.besteTreffer = Math.max(ergebnis.besteTreffer, treffer);
      }
      ergebnis.tipps += schein.tipps.length;
      ergebnis.summeTreffer += summe;
      mittelProZiehung.push(summe / schein.tipps.length);
    }

    if (ergebnis.tipps > 0) ergebnis.mittel = ergebnis.summeTreffer / ergebnis.tipps;
    Object.assign(ergebnis, urteilAus(mittelProZiehung));
    return ergebnis;
  }

  // Urteil: Liegt der Durchschnitt weiter von der Erwartung weg, als die
  // Schwankung von Ziehung zu Ziehung erklären kann? Gemessen wird in
  // Standardfehlern; ab 2 gilt die Abweichung als auffällig.
  //   mittelProZiehung: durchschnittliche Richtige je ausgewerteter Ziehung
  function urteilAus(mittelProZiehung) {
    const n = mittelProZiehung.length;
    if (n === 0) return { abweichung: null, urteil: 'keine' };
    if (n < MIN_ZIEHUNGEN_FUER_URTEIL) return { abweichung: null, urteil: 'zuwenig' };
    const mittel = mittelProZiehung.reduce((s, m) => s + m, 0) / n;
    const varianz = mittelProZiehung.reduce((s, m) => s + (m - mittel) ** 2, 0) / (n - 1);
    const standardfehler = Math.sqrt(varianz / n);
    if (!(standardfehler > 0)) return { abweichung: null, urteil: 'keine' };
    const abweichung = (mittel - ERWARTUNG_PRO_TIPP) / standardfehler;
    let urteil = 'zufall';
    if (abweichung >= 2) urteil = 'ueber';
    else if (abweichung <= -2) urteil = 'unter';
    return { abweichung, urteil };
  }

  // Zählt ein Dauertipp bei dieser Ziehung? (ab eingeschlossen, bis ausgeschlossen)
  function dauertippAktiv(tipp, datum) {
    return datum >= tipp.ab && (!tipp.bis || datum < tipp.bis);
  }

  // Superzahl des Dauerscheins, die bei dieser Ziehung galt.
  function dauerSuperzahl(dauerschein, datum) {
    let wert = null;
    for (const eintrag of dauerschein.superzahlen) if (eintrag.ab <= datum) wert = eintrag.wert;
    return wert;
  }

  // Wertet einen Dauerschein gegen alle echten Ziehungen seines Wochentags aus.
  //   tag:     'mi' oder 'sa'
  //   bereich: { von, bis } wie bei passtZumFilter (freiwillig)
  function werteDauerschein(ziehungen, dauerschein, tag, bereich = {}) {
    const ergebnis = {
      ziehungen: 0,
      tipps: 0,                     // Tipp-Auswertungen: Tipps × Ziehungen
      summeTreffer: 0,
      mittel: null,
      verteilung: new Array(7).fill(0),
      klassen: new Array(10).fill(0),
      gewinne: 0,
      besteTreffer: 0,
      superzahlTreffer: 0,
      proTipp: dauerschein.tipps.map((tipp, index) => ({
        index, zahlen: tipp.zahlen, ab: tipp.ab, bis: tipp.bis,
        ziehungen: 0, summeTreffer: 0, mittel: null, besteTreffer: 0, gewinne: 0,
      })),
      abweichung: null,
      urteil: 'keine',
    };
    const mittelProZiehung = [];

    for (const datum of Object.keys(ziehungen).sort()) {
      const echt = ziehungen[datum].echt;
      if (!echt || !passtZumFilter(datum, { tag, ...bereich })) continue;
      const aktive = dauerschein.tipps
        .map((tipp, index) => ({ tipp, index }))
        .filter(({ tipp }) => dauertippAktiv(tipp, datum));
      if (aktive.length === 0) continue;

      const superzahlRichtig = dauerSuperzahl(dauerschein, datum) === echt.superzahl;
      if (superzahlRichtig) ergebnis.superzahlTreffer += 1;
      ergebnis.ziehungen += 1;
      let summe = 0;
      for (const { tipp, index } of aktive) {
        const treffer = zaehleTreffer(tipp.zahlen, echt.zahlen);
        const klasse = gewinnklasse(treffer, superzahlRichtig);
        const einzeln = ergebnis.proTipp[index];
        summe += treffer;
        ergebnis.verteilung[treffer] += 1;
        ergebnis.klassen[klasse] += 1;
        ergebnis.besteTreffer = Math.max(ergebnis.besteTreffer, treffer);
        einzeln.ziehungen += 1;
        einzeln.summeTreffer += treffer;
        einzeln.besteTreffer = Math.max(einzeln.besteTreffer, treffer);
        if (klasse > 0) { ergebnis.gewinne += 1; einzeln.gewinne += 1; }
      }
      ergebnis.tipps += aktive.length;
      ergebnis.summeTreffer += summe;
      mittelProZiehung.push(summe / aktive.length);
    }

    for (const einzeln of ergebnis.proTipp) {
      if (einzeln.ziehungen > 0) einzeln.mittel = einzeln.summeTreffer / einzeln.ziehungen;
    }
    if (ergebnis.tipps > 0) ergebnis.mittel = ergebnis.summeTreffer / ergebnis.tipps;
    Object.assign(ergebnis, urteilAus(mittelProZiehung));
    return ergebnis;
  }

  // Wette zwischen zwei Seiten, die jeweils einen oder mehrere feste Scheine haben.
  //   seiten: { links: { mi: [Schein, ...], sa: [...] }, rechts: { ... } }
  // Eine Ziehung zählt nur, wenn an diesem Tag beide Seiten mindestens einen
  // Tipp im Rennen hatten. Es zählen die Tipps, die damals galten, auch wenn sie
  // inzwischen beendet sind. So lässt sich nachträglich nichts schönrechnen.
  function werteWette(ziehungen, seiten) {
    const leereSeite = () => ({ tipps: 0, summe: 0, gewinne: 0, beste: 0, tagessiege: 0, mi: 0, sa: 0, mittel: null });
    const ergebnis = {
      links: leereSeite(), rechts: leereSeite(), liste: [], ziehungen: { mi: 0, sa: 0 },
      abweichung: null, vorn: null,
    };

    const spiele = (scheine, datum, echt) => scheine.flatMap((schein) => {
      const superzahlRichtig = dauerSuperzahl(schein, datum) === echt.superzahl;
      return schein.tipps.filter((tipp) => dauertippAktiv(tipp, datum)).map((tipp) => {
        const treffer = zaehleTreffer(tipp.zahlen, echt.zahlen);
        return { treffer, klasse: gewinnklasse(treffer, superzahlRichtig) };
      });
    });

    const unterschiede = [];
    for (const datum of Object.keys(ziehungen).sort()) {
      const { echt } = ziehungen[datum];
      const tag = Kalender.tagVon(datum);
      if (!echt || !tag) continue;
      const links = spiele(seiten.links[tag], datum, echt);
      const rechts = spiele(seiten.rechts[tag], datum, echt);
      if (links.length === 0 || rechts.length === 0) continue;

      ergebnis.ziehungen[tag] += 1;
      const mittel = {};
      for (const [name, tipps] of [['links', links], ['rechts', rechts]]) {
        const seite = ergebnis[name];
        const summe = tipps.reduce((a, t) => a + t.treffer, 0);
        seite.tipps += tipps.length;
        seite.summe += summe;
        seite[tag] += summe;
        seite.gewinne += tipps.filter((t) => t.klasse > 0).length;
        seite.beste = Math.max(seite.beste, ...tipps.map((t) => t.treffer));
        mittel[name] = summe / tipps.length;
      }
      const besser = vergleiche(mittel.links, mittel.rechts);
      if (besser !== 'gleich') ergebnis[besser].tagessiege += 1;
      unterschiede.push(mittel.links - mittel.rechts);
      ergebnis.liste.push({
        datum, tag, besser,
        links: links.map((t) => t.treffer), rechts: rechts.map((t) => t.treffer),
      });
    }

    const n = unterschiede.length;
    if (n > 0) {
      ergebnis.links.mittel = ergebnis.links.summe / ergebnis.links.tipps;
      ergebnis.rechts.mittel = ergebnis.rechts.summe / ergebnis.rechts.tipps;
      ergebnis.vorn = vergleiche(ergebnis.links.mittel, ergebnis.rechts.mittel);
    }
    if (n >= MIN_ZIEHUNGEN_FUER_URTEIL) {
      const mittel = unterschiede.reduce((a, b) => a + b, 0) / n;
      const varianz = unterschiede.reduce((a, b) => a + (b - mittel) ** 2, 0) / (n - 1);
      if (varianz > 0) ergebnis.abweichung = mittel / Math.sqrt(varianz / n);
      else ergebnis.abweichung = mittel === 0 ? 0 : null;
    }
    return ergebnis;
  }

  // Kleine Rechenungenauigkeiten sollen kein Unentschieden verhindern.
  function vergleiche(links, rechts) {
    if (Math.abs(links - rechts) < 1e-9) return 'gleich';
    return links > rechts ? 'links' : 'rechts';
  }

  return {
    ERWARTUNG_PRO_TIPP, MIN_ZIEHUNGEN_FUER_URTEIL, WOCHEN_PRO_HALBJAHR, KLASSEN,
    erwarteteVerteilung, klassenWahrscheinlichkeit, gewinnWahrscheinlichkeit,
    zaehleTreffer, gewinnklasse, halbjahre, werteGespielt, werteAus,
    dauertippAktiv, dauerSuperzahl, werteDauerschein, werteWette,
  };
})();
