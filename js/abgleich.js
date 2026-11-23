'use strict';

// Abgleich: führt zwei Datenstände zusammen, ohne dass Eingaben verloren gehen.
//
// Es gibt immer drei Stände:
//   basis = der letzte gemeinsame Stand von Gerät und Server
//   lokal = der Stand auf diesem Gerät
//   fern  = der Stand auf dem Server
// Was nur auf einer Seite geändert wurde, gilt. Wurde dasselbe auf beiden
// Seiten verschieden geändert, gilt der Server, denn er war zuerst da.
const Abgleich = (() => {
  // Text mit fester Reihenfolge der Schlüssel. Die Datenbank sortiert sie um,
  // deshalb reicht ein einfacher Textvergleich nicht.
  function stabil(wert) {
    if (Array.isArray(wert)) return `[${wert.map(stabil).join(',')}]`;
    if (wert && typeof wert === 'object') {
      return `{${Object.keys(wert).sort().map((k) => `${JSON.stringify(k)}:${stabil(wert[k])}`).join(',')}}`;
    }
    return JSON.stringify(wert === undefined ? null : wert);
  }

  const gleich = (a, b) => stabil(a) === stabil(b);
  const kopie = (wert) => JSON.parse(JSON.stringify(wert));

  function waehle(basis, lokal, fern) {
    if (gleich(lokal, fern) || gleich(lokal, basis)) return fern;
    if (gleich(fern, basis)) return lokal;
    return fern;
  }

  // Listen, deren Einträge einen eindeutigen Schlüssel haben.
  function listeZusammen(basis, lokal, fern, schluessel) {
    const karte = (liste) => new Map(liste.map((e) => [schluessel(e), e]));
    const [b, l, f] = [karte(basis), karte(lokal), karte(fern)];
    const ergebnis = [];
    for (const k of new Set([...f.keys(), ...l.keys()])) {
      const eintrag = waehle(b.get(k) ?? null, l.get(k) ?? null, f.get(k) ?? null);
      if (eintrag) ergebnis.push(eintrag);
    }
    return ergebnis;
  }

  function dauerscheinZusammen(basis, lokal, fern) {
    return {
      tipps: listeZusammen(basis.tipps, lokal.tipps, fern.tipps, (t) => `${t.zahlen.join('-')}|${t.ab}`),
      superzahlen: listeZusammen(basis.superzahlen, lokal.superzahlen, fern.superzahlen, (s) => s.ab)
        .sort((a, b) => (a.ab < b.ab ? -1 : 1)),
    };
  }

  // Die Tipps eines Termins gehören mit ihrer Markierung „gespielt“ zusammen,
  // die echten Zahlen sind davon unabhängig.
  const tippTeil = (e) => ({
    scheine: e?.scheine ?? null,
    gespielt: e?.gespielt ?? null,
    erstelltAm: e?.erstelltAm ?? null,
    basisZiehungen: e?.basisZiehungen ?? 0,
  });

  function terminZusammen(basis, lokal, fern) {
    const tipps = waehle(tippTeil(basis), tippTeil(lokal), tippTeil(fern));
    const echt = waehle(basis?.echt ?? null, lokal?.echt ?? null, fern?.echt ?? null);
    if (!tipps.scheine && !echt) return null;
    return { ...tipps, echt };
  }

  function zusammenfuehren(basisRoh, lokal, fern) {
    const basis = basisRoh || Speicher.leer();
    const ergebnis = kopie(fern);

    ergebnis.startDatum = lokal.startDatum < fern.startDatum ? lokal.startDatum : fern.startDatum;
    ergebnis.letzteSicherung = [lokal.letzteSicherung, fern.letzteSicherung].filter(Boolean).sort().pop() || null;

    ergebnis.wette = waehle(basis.wette, lokal.wette, fern.wette);

    ergebnis.ziehungen = {};
    for (const datum of [...new Set([...Object.keys(lokal.ziehungen), ...Object.keys(fern.ziehungen)])].sort()) {
      const termin = terminZusammen(basis.ziehungen[datum], lokal.ziehungen[datum], fern.ziehungen[datum]);
      if (termin) ergebnis.ziehungen[datum] = termin;
    }
    for (const feld of Speicher.DAUER_FELDER) {
      for (const tag of ['mi', 'sa']) {
        ergebnis[feld][tag] = dauerscheinZusammen(basis[feld][tag], lokal[feld][tag], fern[feld][tag]);
      }
    }
    return kopie(ergebnis);
  }

  return { stabil, gleich, kopie, zusammenfuehren };
})();
