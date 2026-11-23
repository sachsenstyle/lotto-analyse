'use strict';

// Generator: erzeugt die Tipps. Jede Strategie ist nur eine andere Art,
// den Zahlen 1–49 Gewichte zu geben oder gezogene Tipps zu prüfen.
const Generator = (() => {
  const ZAHLEN_MAX = 49;
  const ZAHLEN_PRO_TIPP = 6;
  const TIPPS_PRO_SCHEIN = 12;

  // ---------- Zufall ----------

  // Ganze Zahl von 0 bis grenze-1, jede gleich wahrscheinlich.
  // Werte oberhalb von "limit" werden verworfen, damit keine Zahl bevorzugt wird.
  function zufallsGanzzahl(grenze) {
    const puffer = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / grenze) * grenze;
    let wert;
    do {
      crypto.getRandomValues(puffer);
      wert = puffer[0];
    } while (wert >= limit);
    return wert % grenze;
  }

  // Kommazahl von 0 (eingeschlossen) bis 1 (ausgeschlossen).
  function zufallsAnteil() {
    const puffer = new Uint32Array(1);
    crypto.getRandomValues(puffer);
    return puffer[0] / 0x100000000;
  }

  // Zieht 6 verschiedene Zahlen. gewichtFuer(zahl) bestimmt die Chance jeder
  // Zahl: doppeltes Gewicht = doppelte Chance. Eine gezogene Zahl kommt aus
  // dem Topf, genau wie eine Kugel in der echten Ziehung.
  function zieheGewichtet(gewichtFuer) {
    const topf = [];
    for (let zahl = 1; zahl <= ZAHLEN_MAX; zahl += 1) {
      let gewicht = Number(gewichtFuer(zahl));
      if (!Number.isFinite(gewicht) || gewicht < 0) gewicht = 0;
      topf.push({ zahl, gewicht });
    }

    const gezogen = [];
    while (gezogen.length < ZAHLEN_PRO_TIPP) {
      const summe = topf.reduce((s, kugel) => s + kugel.gewicht, 0);
      let index;
      if (summe > 0) {
        let ziel = zufallsAnteil() * summe;
        index = topf.findIndex((kugel) => {
          ziel -= kugel.gewicht;
          return ziel < 0;
        });
        if (index < 0) index = topf.length - 1;
      } else {
        // Alle Gewichte sind 0: dann entscheidet der reine Zufall.
        index = zufallsGanzzahl(topf.length);
      }
      gezogen.push(topf[index].zahl);
      topf.splice(index, 1);
    }
    return gezogen.sort((a, b) => a - b);
  }

  // ---------- Grundlage für „Heiß“ und „Kalt“ ----------

  // echteZiehungen: Liste von Zahlenreihen, z. B. [[3, 11, 17, 24, 38, 45], ...]
  function kontextAus(echteZiehungen) {
    const haeufigkeit = new Array(ZAHLEN_MAX + 1).fill(0);
    for (const zahlen of echteZiehungen) {
      for (const zahl of zahlen) haeufigkeit[zahl] += 1;
    }
    return { haeufigkeit, anzahlZiehungen: echteZiehungen.length };
  }

  // Gewicht einer Zahl für die Strategie „Kalte Zahlen“.
  // Je seltener eine Zahl bisher kam, desto größer ihr Gewicht:
  //   0-mal gezogen -> 1,   1-mal -> 1/2,   2-mal -> 1/3,   3-mal -> 1/4
  function gewichtKalt(anzahlGezogen, anzahlZiehungen) {
    return 1 / (1 + anzahlGezogen);
  }

  // Gewicht einer Zahl für die Strategie „Heiße Zahlen“.
  //   anzahlGezogen:   wie oft diese Zahl bisher in echten Ziehungen vorkam
  //   anzahlZiehungen: wie viele echte Ziehungen bisher eingetragen sind
  // Rückgabe: ein Gewicht größer als 0. Doppeltes Gewicht = doppelte Chance.
  // Das Spiegelbild von gewichtKalt:
  //   0-mal gezogen -> 1,   1-mal -> 2,   2-mal -> 3,   3-mal -> 4
  // Die 1 am Anfang sorgt dafür, dass auch eine nie gezogene Zahl eine
  // Chance behält. Stärker wird die Strategie z. B. mit (1 + anzahlGezogen) ** 2.
  function gewichtHeiss(anzahlGezogen, anzahlZiehungen) {
    return 1 + anzahlGezogen;
  }

  // ---------- Regeln für „Ausgewogen“ ----------

  function istAusgewogen(tipp) {
    const gerade = tipp.filter((zahl) => zahl % 2 === 0).length;
    const summe = tipp.reduce((s, zahl) => s + zahl, 0);
    let laengsteFolge = 1;
    let folge = 1;
    for (let i = 1; i < tipp.length; i += 1) {
      folge = tipp[i] === tipp[i - 1] + 1 ? folge + 1 : 1;
      laengsteFolge = Math.max(laengsteFolge, folge);
    }
    return gerade >= 2 && gerade <= 4        // weder fast nur gerade noch fast nur ungerade
      && summe >= 100 && summe <= 200        // nicht nur kleine oder nur große Zahlen
      && laengsteFolge <= 2                  // höchstens zwei Nachbarzahlen
      && tipp.some((zahl) => zahl > 31);     // nicht nur „Geburtstagszahlen“
  }

  // ---------- Die Strategien ----------

  const STRATEGIEN = [
    {
      id: 'zufall',
      name: 'Reiner Zufall',
      kurz: 'Jede Zahl hat dieselbe Chance.',
      erklaerung: 'Alle 49 Zahlen bekommen das Gewicht 1. Das entspricht einer '
        + 'fairen Ziehung und ist die Messlatte für alle anderen Strategien.',
      brauchtHistorie: false,
      erzeugeTipp: () => zieheGewichtet(() => 1),
    },
    {
      id: 'heiss',
      name: 'Heiße Zahlen',
      kurz: 'Bevorzugt Zahlen, die bisher oft gezogen wurden.',
      erklaerung: 'Zählt, wie oft jede Zahl in den bisher eingetragenen echten '
        + 'Ziehungen desselben Wochentags vorkam. Häufige Zahlen bekommen ein '
        + 'höheres Gewicht: Gewicht = 1 + Anzahl der bisherigen Ziehungen der '
        + 'Zahl. Eine dreimal gezogene Zahl hat also die vierfache Chance einer '
        + 'nie gezogenen.',
      brauchtHistorie: true,
      erzeugeTipp: (kontext) => zieheGewichtet(
        (zahl) => gewichtHeiss(kontext.haeufigkeit[zahl], kontext.anzahlZiehungen),
      ),
    },
    {
      id: 'kalt',
      name: 'Kalte Zahlen',
      kurz: 'Bevorzugt Zahlen, die bisher selten gezogen wurden.',
      erklaerung: 'Das Gegenstück zu den heißen Zahlen: Gewicht = 1 / (1 + Anzahl '
        + 'der bisherigen Ziehungen der Zahl). Eine nie gezogene Zahl hat also '
        + 'die doppelte Chance einer einmal gezogenen.',
      brauchtHistorie: true,
      erzeugeTipp: (kontext) => zieheGewichtet(
        (zahl) => gewichtKalt(kontext.haeufigkeit[zahl], kontext.anzahlZiehungen),
      ),
    },
    {
      id: 'ausgewogen',
      name: 'Ausgewogen',
      kurz: 'Zufall, aber nur Tipps, die feste Regeln erfüllen.',
      erklaerung: 'Zieht rein zufällig und verwirft den Tipp, bis er vier Regeln '
        + 'erfüllt: 2 bis 4 gerade Zahlen, Summe zwischen 100 und 200, höchstens '
        + 'zwei Nachbarzahlen, mindestens eine Zahl über 31.',
      brauchtHistorie: false,
      erzeugeTipp: () => {
        let tipp;
        do {
          tipp = zieheGewichtet(() => 1);
        } while (!istAusgewogen(tipp));
        return tipp;
      },
    },
  ];

  function strategie(id) {
    return STRATEGIEN.find((s) => s.id === id) || null;
  }

  // Ein Schein: 12 Tipps und eine Superzahl (0–9), wie auf dem Lottoschein.
  function erzeugeSchein(strategieId, kontext) {
    const gewaehlt = strategie(strategieId);
    const tipps = [];
    for (let i = 0; i < TIPPS_PRO_SCHEIN; i += 1) {
      tipps.push(gewaehlt.erzeugeTipp(kontext));
    }
    return { tipps, superzahl: zufallsGanzzahl(10) };
  }

  return {
    ZAHLEN_MAX, ZAHLEN_PRO_TIPP, TIPPS_PRO_SCHEIN, STRATEGIEN,
    strategie, kontextAus, erzeugeSchein, istAusgewogen,
    gewichtHeiss, gewichtKalt, zieheGewichtet, zufallsGanzzahl,
  };
})();
