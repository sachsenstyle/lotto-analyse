'use strict';

// Kalender: rechnet mit Ziehungsterminen (Mittwoch und Samstag).
// Ein Datum ist überall im Programm ein Text der Form "2026-11-18".
const Kalender = (() => {
  const TAGE = {
    mi: { wochentag: 3, name: 'Mittwoch' },
    sa: { wochentag: 6, name: 'Samstag' },
  };

  function ausIso(iso) {
    const [jahr, monat, tag] = iso.split('-').map(Number);
    return new Date(jahr, monat - 1, tag);
  }

  function alsIso(datum) {
    const monat = String(datum.getMonth() + 1).padStart(2, '0');
    const tag = String(datum.getDate()).padStart(2, '0');
    return `${datum.getFullYear()}-${monat}-${tag}`;
  }

  function heute() {
    return alsIso(new Date());
  }

  function plusTage(iso, anzahl) {
    const datum = ausIso(iso);
    datum.setDate(datum.getDate() + anzahl);
    return alsIso(datum);
  }

  // 'mi', 'sa' oder null, wenn an dem Tag keine Ziehung ist.
  function tagVon(iso) {
    const wochentag = ausIso(iso).getDay();
    if (wochentag === TAGE.mi.wochentag) return 'mi';
    if (wochentag === TAGE.sa.wochentag) return 'sa';
    return null;
  }

  // Erster Termin des Wochentags am oder nach dem angegebenen Datum.
  function naechsterTermin(tag, abIso) {
    let iso = abIso;
    while (tagVon(iso) !== tag) iso = plusTage(iso, 1);
    return iso;
  }

  // Alle Termine des Wochentags von..bis (beide eingeschlossen), älteste zuerst.
  function termine(tag, vonIso, bisIso) {
    const liste = [];
    let iso = naechsterTermin(tag, vonIso);
    while (iso <= bisIso) {
      liste.push(iso);
      iso = plusTage(iso, 7);
    }
    return liste;
  }

  function tageZwischen(vonIso, bisIso) {
    return Math.round((ausIso(bisIso) - ausIso(vonIso)) / 86400000);
  }

  function formatLang(iso) {
    return ausIso(iso).toLocaleDateString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function formatKurz(iso) {
    return ausIso(iso).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  return {
    TAGE, heute, plusTage, tagVon, naechsterTermin, termine, tageZwischen,
    formatLang, formatKurz,
  };
})();
