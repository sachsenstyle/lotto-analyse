'use strict';

// Speicher: hält alle Daten im Browser (localStorage) und kümmert sich um
// Sicherung und Wiederherstellung als Datei.
const Speicher = (() => {
  const SCHLUESSEL = 'lottoAnalyse.v1';
  const DAUER_FELDER = ['dauerscheine', 'eigeneScheine', 'eigeneScheine2'];
  let gefunden = false;

  // Ein Dauerschein hält bis zu 12 feste Tipps eines Wochentags.
  //   tipps:       [{ zahlen, ab, bis, herkunft }]
  //                ab  = erste Ziehung, für die der Tipp zählt
  //                bis = erste Ziehung, für die er NICHT mehr zählt (null = aktiv)
  //   superzahlen: [{ ab, wert }]  die jeweils gültige Superzahl ab einer Ziehung
  function leererDauerschein() {
    return { tipps: [], superzahlen: [] };
  }

  function leer() {
    return {
      version: 1,
      startDatum: Kalender.heute(),
      ziehungen: {},
      dauerscheine: { mi: leererDauerschein(), sa: leererDauerschein() },
      // Zwei Scheine mit selbst gewählten Dauertipps. Gleicher Aufbau wie ein
      // Dauerschein, jeder mit eigener Superzahl. Der erste heißt aus
      // Rücksicht auf ältere Daten weiter „eigeneScheine“.
      eigeneScheine: { mi: leererDauerschein(), sa: leererDauerschein() },
      eigeneScheine2: { mi: leererDauerschein(), sa: leererDauerschein() },
      letzteSicherung: null,
    };
  }

  // Liest einen Dauerschein. Unpassende Einträge fallen einzeln weg,
  // damit ein Fehler darin nie die ganze Sicherung unbrauchbar macht.
  function bereinigeDauerschein(roh, tag) {
    const sauber = leererDauerschein();
    if (!roh || typeof roh !== 'object') return sauber;
    const istTermin = (wert) => istDatum(wert) && Kalender.tagVon(wert) === tag;

    for (const tipp of Array.isArray(roh.tipps) ? roh.tipps : []) {
      if (!tipp || !istZahlenreihe(tipp.zahlen) || !istTermin(tipp.ab)) continue;
      const bis = istTermin(tipp.bis) && tipp.bis > tipp.ab ? tipp.bis : null;
      const h = tipp.herkunft;
      sauber.tipps.push({
        zahlen: [...tipp.zahlen].sort((a, b) => a - b),
        ab: tipp.ab,
        bis,
        herkunft: h && istDatum(h.datum) && typeof h.strategie === 'string' && Number.isInteger(h.nr)
          ? { datum: h.datum, strategie: h.strategie, nr: h.nr } : null,
      });
    }
    for (const eintrag of Array.isArray(roh.superzahlen) ? roh.superzahlen : []) {
      if (eintrag && istTermin(eintrag.ab) && istSuperzahl(eintrag.wert)) {
        sauber.superzahlen.push({ ab: eintrag.ab, wert: eintrag.wert });
      }
    }
    sauber.superzahlen.sort((a, b) => (a.ab < b.ab ? -1 : 1));
    return sauber;
  }

  function istZahlenreihe(wert) {
    return Array.isArray(wert)
      && wert.length === 6
      && wert.every((z) => Number.isInteger(z) && z >= 1 && z <= 49)
      && new Set(wert).size === 6;
  }

  function istSuperzahl(wert) {
    return Number.isInteger(wert) && wert >= 0 && wert <= 9;
  }

  function istDatum(wert) {
    return typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert);
  }

  // Baut aus fremden Daten (Datei oder Browserspeicher) ein sauberes Objekt.
  // Wirft einen Fehler mit verständlichem Text, wenn etwas nicht stimmt.
  function bereinige(roh) {
    if (!roh || typeof roh !== 'object' || roh.version !== 1) {
      throw new Error('Das ist keine Sicherung der Lotto-Analyse.');
    }
    if (!roh.ziehungen || typeof roh.ziehungen !== 'object') {
      throw new Error('In der Datei fehlen die Ziehungen.');
    }

    const sauber = leer();
    if (istDatum(roh.startDatum)) sauber.startDatum = roh.startDatum;
    if (typeof roh.letzteSicherung === 'string') sauber.letzteSicherung = roh.letzteSicherung;
    for (const feld of DAUER_FELDER) {
      const dauer = roh[feld] && typeof roh[feld] === 'object' ? roh[feld] : {};
      sauber[feld] = { mi: bereinigeDauerschein(dauer.mi, 'mi'), sa: bereinigeDauerschein(dauer.sa, 'sa') };
    }

    for (const [datum, eintrag] of Object.entries(roh.ziehungen)) {
      if (!istDatum(datum) || !Kalender.tagVon(datum)) {
        throw new Error(`„${datum}“ ist kein Mittwoch oder Samstag.`);
      }
      const neu = {
        scheine: null,
        echt: null,
        gespielt: null,
        erstelltAm: typeof eintrag.erstelltAm === 'string' ? eintrag.erstelltAm : null,
        basisZiehungen: Number.isInteger(eintrag.basisZiehungen) ? eintrag.basisZiehungen : 0,
      };

      if (eintrag.scheine) {
        neu.scheine = {};
        for (const [strategie, schein] of Object.entries(eintrag.scheine)) {
          const tippsGueltig = /^[a-z]+$/.test(strategie)
            && schein
            && Array.isArray(schein.tipps)
            && schein.tipps.length > 0
            && schein.tipps.length <= 50
            && schein.tipps.every(istZahlenreihe)
            && istSuperzahl(schein.superzahl);
          if (!tippsGueltig) {
            throw new Error(`Die Tipps vom ${Kalender.formatKurz(datum)} sind beschädigt.`);
          }
          neu.scheine[strategie] = {
            tipps: schein.tipps.map((tipp) => [...tipp].sort((a, b) => a - b)),
            superzahl: schein.superzahl,
          };
        }
      }

      if (eintrag.echt) {
        if (!istZahlenreihe(eintrag.echt.zahlen) || !istSuperzahl(eintrag.echt.superzahl)) {
          throw new Error(`Die echten Zahlen vom ${Kalender.formatKurz(datum)} sind beschädigt.`);
        }
        neu.echt = {
          zahlen: [...eintrag.echt.zahlen].sort((a, b) => a - b),
          superzahl: eintrag.echt.superzahl,
        };
      }

      // Der wirklich gespielte Tipp ist eine Zusatzangabe. Passt sie nicht zu
      // den Scheinen, fällt nur die Markierung weg; alles andere bleibt.
      const g = eintrag.gespielt;
      const scheinGespielt = g && neu.scheine && typeof g.strategie === 'string'
        && Object.prototype.hasOwnProperty.call(neu.scheine, g.strategie)
        ? neu.scheine[g.strategie] : null;
      if (scheinGespielt && Number.isInteger(g.tipp) && g.tipp >= 0 && g.tipp < scheinGespielt.tipps.length) {
        neu.gespielt = {
          strategie: g.strategie,
          tipp: g.tipp,
          superzahl: istSuperzahl(g.superzahl) ? g.superzahl : scheinGespielt.superzahl,
        };
      }

      sauber.ziehungen[datum] = neu;
    }
    return sauber;
  }

  function laden() {
    let roh = null;
    try {
      roh = localStorage.getItem(SCHLUESSEL);
      if (!roh) return leer();
      const daten = bereinige(JSON.parse(roh));
      gefunden = true;
      return daten;
    } catch (fehler) {
      // Unlesbare Daten nicht einfach überschreiben, sondern beiseitelegen.
      try {
        if (roh) localStorage.setItem(`${SCHLUESSEL}.defekt`, roh);
      } catch (_) { /* Speicher nicht verfügbar */ }
      return leer();
    }
  }

  // true, wenn das Speichern geklappt hat.
  function speichern(daten) {
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify(daten));
      return true;
    } catch (fehler) {
      return false;
    }
  }

  function alsDateiText(daten) {
    return JSON.stringify(daten, null, 2);
  }

  function ausDateiText(text) {
    let roh;
    try {
      roh = JSON.parse(text);
    } catch (fehler) {
      throw new Error('Die Datei lässt sich nicht lesen.');
    }
    return bereinige(roh);
  }

  return {
    DAUER_FELDER, bereinige, hatteDaten: () => gefunden,
    leer, leererDauerschein, laden, speichern, alsDateiText, ausDateiText, istZahlenreihe, istSuperzahl,
  };
})();
