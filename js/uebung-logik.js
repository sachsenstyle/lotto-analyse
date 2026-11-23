'use strict';

// Übung: lost ausgedachte Ziehungen aus und wertet fünf Spieler aus.
// Rechnet nur im Arbeitsspeicher. Nichts davon wird gespeichert.
const Uebung = (() => {
  const TIPPS_PRO_ZIEHUNG = 2;
  const ZIEHUNGEN_MAX = 10000;
  const ZIEHUNGEN_PRO_JAHR = 104.36;   // zwei pro Woche

  const zufallsTipp = () => Generator.zieheGewichtet(() => 1);

  const SPIELER = [
    ...Generator.STRATEGIEN.map(({ id, name }) => ({ id, name })),
    { id: 'fest', name: 'Feste Tipps' },
  ];

  function neueFesteTipps() {
    const tipps = [];
    while (tipps.length < TIPPS_PRO_ZIEHUNG) {
      const tipp = zufallsTipp();
      if (!tipps.some((anderer) => anderer.join() === tipp.join())) tipps.push(tipp);
    }
    return { tipps, superzahl: Generator.zufallsGanzzahl(10) };
  }

  // Ein neuer Durchlauf. fest = { tipps, superzahl }
  function neu(fest) {
    return {
      fest: { tipps: fest.tipps.map((tipp) => [...tipp]), superzahl: fest.superzahl },
      anzahl: 0,
      haeufigkeit: new Array(Generator.ZAHLEN_MAX + 1).fill(0),
      letzte: null,
      fuehrend: null,
      wechsel: 0,
      spieler: SPIELER.map((s) => ({
        ...s, tipps: 0, summe: 0, gewinne: 0, beste: 0,
        verteilung: new Array(7).fill(0),
        summeMittel: 0, summeQuadrat: 0,   // für die Schwankung von Ziehung zu Ziehung
        verlauf: [],                       // Ø Richtige nach jeder Ziehung
      })),
    };
  }

  // Tippen kommt vor dem Ziehen: Kein Spieler kennt die Zahlen, die gleich
  // kommen. „Heiß“ und „Kalt“ sehen nur die Ziehungen davor.
  function tippe(lauf, id) {
    if (id === 'fest') return lauf.fest;
    const kontext = { haeufigkeit: lauf.haeufigkeit, anzahlZiehungen: lauf.anzahl };
    const strategie = Generator.strategie(id);
    const tipps = [];
    for (let i = 0; i < TIPPS_PRO_ZIEHUNG; i += 1) tipps.push(strategie.erzeugeTipp(kontext));
    return { tipps, superzahl: Generator.zufallsGanzzahl(10) };
  }

  // gezogen ist nur für Prüfungen da; sonst lost die Übung selbst aus.
  function ziehe(lauf, gezogen = null) {
    if (lauf.anzahl >= ZIEHUNGEN_MAX) return false;
    const scheine = lauf.spieler.map((s) => tippe(lauf, s.id));
    const echt = gezogen || { zahlen: zufallsTipp(), superzahl: Generator.zufallsGanzzahl(10) };
    lauf.anzahl += 1;

    lauf.spieler.forEach((s, i) => {
      const superzahlRichtig = scheine[i].superzahl === echt.superzahl;
      let summe = 0;
      for (const tipp of scheine[i].tipps) {
        const treffer = Analyse.zaehleTreffer(tipp, echt.zahlen);
        summe += treffer;
        s.verteilung[treffer] += 1;
        s.beste = Math.max(s.beste, treffer);
        if (Analyse.gewinnklasse(treffer, superzahlRichtig) > 0) s.gewinne += 1;
      }
      s.tipps += scheine[i].tipps.length;
      s.summe += summe;
      const mittel = summe / scheine[i].tipps.length;
      s.summeMittel += mittel;
      s.summeQuadrat += mittel * mittel;
      s.verlauf.push(s.summe / s.tipps);
    });
    for (const zahl of echt.zahlen) lauf.haeufigkeit[zahl] += 1;
    lauf.letzte = { echt, scheine };

    // Wer liegt allein vorn? Bei Gleichstand bleibt der bisherige Führende.
    const bestes = Math.max(...lauf.spieler.map((s) => s.summe));
    const vorn = lauf.spieler.filter((s) => s.summe === bestes);
    if (vorn.length === 1 && vorn[0].id !== lauf.fuehrend) {
      if (lauf.fuehrend !== null) lauf.wechsel += 1;
      lauf.fuehrend = vorn[0].id;
    }
    return true;
  }

  // Abstand zur Erwartung, gemessen an der Schwankung. Zwischen −2 und +2 ist
  // das bei reinem Zufall normal.
  function abweichung(lauf, s) {
    const n = lauf.anzahl;
    if (n < Analyse.MIN_ZIEHUNGEN_FUER_URTEIL) return null;
    const mittel = s.summeMittel / n;
    const varianz = (s.summeQuadrat - n * mittel * mittel) / (n - 1);
    return varianz > 1e-12 ? (mittel - Analyse.ERWARTUNG_PRO_TIPP) / Math.sqrt(varianz / n) : null;
  }

  return {
    TIPPS_PRO_ZIEHUNG, ZIEHUNGEN_MAX, ZIEHUNGEN_PRO_JAHR, SPIELER,
    neueFesteTipps, neu, ziehe, abweichung,
  };
})();
