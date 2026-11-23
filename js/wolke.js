'use strict';

// Wolke: meldet beim Server an und hält die Daten auf allen Geräten gleich.
// Die Daten bleiben zusätzlich im Browser. Ohne Internet läuft alles weiter,
// der Abgleich wird dann später nachgeholt.
const Wolke = (() => {
  // Der Schlüssel darf öffentlich sein: Er sagt nur, welches Projekt gemeint
  // ist. An Daten kommt man damit erst nach der Anmeldung, und nur an eigene.
  const SERVER = 'https://jjhphvoipkggtmzzmhfe.supabase.co';
  const OEFFENTLICHER_SCHLUESSEL = 'sb_publishable_tlKTPQjbrvjN38SymoGh4g_5iB3erMp';

  const SITZUNG = 'lottoAnalyse.sitzung';
  const BASIS = 'lottoAnalyse.basis';
  const WARTEN_NACH_AENDERUNG = 1200;
  const NACHSEHEN_ALLE = 60000;

  let app = null;                // { lese, ersetze, darfErsetzen, zeigeStatus }
  let basis = null;              // { konto, version, daten }: letzter gemeinsamer Stand
  let status = { art: 'abgemeldet', zeit: null, text: '' };
  let laeuft = null;
  let nochmal = false;
  let uhr = null;

  class NetzFehler extends Error {}
  class AnmeldeFehler extends Error {}

  // ---------- Ablage im Browser ----------

  function lies(schluessel) {
    try { return JSON.parse(localStorage.getItem(schluessel)); } catch (_) { return null; }
  }

  function lege(schluessel, wert) {
    try {
      if (wert === null) localStorage.removeItem(schluessel);
      else localStorage.setItem(schluessel, JSON.stringify(wert));
    } catch (_) { /* Speicher voll oder gesperrt: Abgleich geht trotzdem */ }
  }

  const sitzung = () => {
    const s = lies(SITZUNG);
    return s && typeof s.zugang === 'string' && typeof s.erneuern === 'string' && typeof s.konto === 'string' ? s : null;
  };

  function setzeStatus(art, text = '') {
    status = { art, text, zeit: art === 'aktuell' ? new Date() : status.zeit };
    if (app) app.zeigeStatus();
  }

  // ---------- Verbindung ----------

  async function anfrage(pfad, { methode = 'GET', inhalt, zugang, kopf = {} } = {}) {
    const abbruch = new AbortController();
    const frist = setTimeout(() => abbruch.abort(), 20000);
    let antwort;
    try {
      antwort = await fetch(SERVER + pfad, {
        method: methode,
        signal: abbruch.signal,
        cache: 'no-store',
        headers: {
          apikey: OEFFENTLICHER_SCHLUESSEL,
          ...(zugang ? { Authorization: `Bearer ${zugang}` } : {}),
          ...(inhalt === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...kopf,
        },
        body: inhalt === undefined ? undefined : JSON.stringify(inhalt),
      });
      const text = await antwort.text();
      let koerper = null;
      try { koerper = text ? JSON.parse(text) : null; } catch (_) { /* keine JSON-Antwort */ }
      return { ok: antwort.ok, code: antwort.status, koerper };
    } catch (fehler) {
      throw new NetzFehler('Server nicht erreichbar');
    } finally {
      clearTimeout(frist);
    }
  }

  function merkeSitzung(k) {
    lege(SITZUNG, {
      zugang: k.access_token,
      erneuern: k.refresh_token,
      ablauf: Date.now() + (Number(k.expires_in) || 3600) * 1000,
      konto: k.user.id,
      email: k.user.email || '',
    });
  }

  // Der Zugang gilt etwa eine Stunde und wird dann still erneuert. Mehrere
  // offene Fenster wechseln sich dabei ab.
  async function gueltigerZugang(erzwingen = false) {
    const alt = sitzung();
    if (!alt) throw new AnmeldeFehler();
    if (!erzwingen && alt.ablauf - Date.now() > 60000) return alt;

    const erneuere = async () => {
      const jetzt = sitzung();
      if (!jetzt) throw new AnmeldeFehler();
      if (jetzt.zugang !== alt.zugang) return jetzt;      // anderes Fenster war schneller
      const r = await anfrage('/auth/v1/token?grant_type=refresh_token', {
        methode: 'POST', inhalt: { refresh_token: jetzt.erneuern },
      });
      if (r.ok && r.koerper?.access_token) {
        merkeSitzung(r.koerper);
        return sitzung();
      }
      if (r.code === 400 || r.code === 401 || r.code === 403) {
        lege(SITZUNG, null);
        throw new AnmeldeFehler();
      }
      throw new NetzFehler();
    };
    if (!navigator.locks || window.location.protocol === 'file:') return erneuere();
    return navigator.locks.request('lottoAnalyse.sitzung', erneuere);
  }

  async function daten(pfad, optionen = {}) {
    let s = await gueltigerZugang();
    let r = await anfrage(pfad, { ...optionen, zugang: s.zugang });
    if (r.code === 401) {
      s = await gueltigerZugang(true);
      r = await anfrage(pfad, { ...optionen, zugang: s.zugang });
    }
    if (r.code === 401) {
      lege(SITZUNG, null);
      throw new AnmeldeFehler();
    }
    if (r.code >= 500 || r.code === 429) throw new NetzFehler();
    if (!r.ok && r.code !== 409) throw new Error(`Der Server meldet Fehler ${r.code}.`);
    return r;
  }

  const TABELLE = '/rest/v1/lotto_stand';
  const GIB_ZURUECK = { Prefer: 'return=representation' };

  async function holeVersion() {
    const r = await daten(`${TABELLE}?select=version`);
    return r.koerper?.[0]?.version ?? null;
  }

  async function holeStand() {
    const r = await daten(`${TABELLE}?select=version,daten`);
    const zeile = r.koerper?.[0];
    if (!zeile) return null;
    // Auch Daten vom Server werden geprüft, bevor sie ins Tool kommen.
    return { version: zeile.version, daten: Speicher.bereinige(zeile.daten) };
  }

  // Speichert nur, wenn der Server noch die erwartete Version hat.
  // Ergebnis: neue Version, oder null, wenn ein anderes Gerät schneller war.
  async function schreibe(stand, erwarteteVersion) {
    const r = erwarteteVersion === null
      ? await daten(`${TABELLE}?select=version`, { methode: 'POST', inhalt: { daten: stand }, kopf: GIB_ZURUECK })
      : await daten(`${TABELLE}?version=eq.${erwarteteVersion}&select=version`, {
        methode: 'PATCH', inhalt: { daten: stand }, kopf: GIB_ZURUECK,
      });
    return r.ok ? r.koerper?.[0]?.version ?? null : null;
  }

  // ---------- Abgleich ----------

  function merkeBasis(konto, version, stand) {
    basis = { konto, version, daten: Abgleich.kopie(stand) };
    lege(BASIS, basis);
  }

  // Übernimmt einen Stand ins Tool. Was seit dem Beginn des Abgleichs hier
  // eingegeben wurde, bleibt erhalten.
  function uebernimm(stand, anfang) {
    const jetzt = app.lese();
    const neu = Abgleich.gleich(jetzt, anfang) ? stand : Abgleich.zusammenfuehren(anfang, jetzt, stand);
    if (!Abgleich.gleich(neu, jetzt)) app.ersetze(Abgleich.kopie(neu));
    if (!Abgleich.gleich(neu, stand)) nochmal = true;
  }

  async function einDurchgang() {
    const { konto } = await gueltigerZugang();
    if (basis && basis.konto !== konto) basis = null;

    const lokalGeaendert = !basis || !Abgleich.gleich(app.lese(), basis.daten);
    const version = await holeVersion();
    if (basis && version === basis.version && !lokalGeaendert) return 'fertig';

    let fern = null;
    if (version !== null) {
      fern = basis && version === basis.version ? { version, daten: basis.daten } : await holeStand();
    }
    const anfang = Abgleich.kopie(app.lese());

    if (!fern) {
      const neueVersion = await schreibe(anfang, null);
      if (neueVersion === null) return 'nochmal';
      merkeBasis(konto, neueVersion, anfang);
      uebernimm(anfang, anfang);
      return 'fertig';
    }

    const ziel = Abgleich.zusammenfuehren(basis ? basis.daten : null, anfang, fern.daten);
    // Wer gerade Zahlen anklickt, soll nicht unterbrochen werden.
    if (!Abgleich.gleich(ziel, anfang) && !app.darfErsetzen()) return 'spaeter';

    let { version: stand } = fern;
    if (!Abgleich.gleich(ziel, fern.daten)) {
      stand = await schreibe(ziel, fern.version);
      if (stand === null) return 'nochmal';
      // Während des Speicherns kann eine Eingabe begonnen haben. Dann bleibt
      // der alte gemeinsame Stand gültig, und der nächste Durchgang holt nach.
      if (!Abgleich.gleich(ziel, anfang) && !app.darfErsetzen()) return 'spaeter';
    }
    merkeBasis(konto, stand, ziel);
    uebernimm(ziel, anfang);
    return 'fertig';
  }

  async function durchfuehren() {
    // Nur anzeigen, wenn es spürbar dauert. Sonst flackert die Anzeige.
    const anzeige = setTimeout(() => setzeStatus('laeuft'), 700);
    try {
      for (let versuch = 0; versuch < 5; versuch += 1) {
        nochmal = false;
        const ergebnis = await einDurchgang();
        if (ergebnis === 'spaeter') {
          plane(5000);
          setzeStatus('wartet');
          return;
        }
        if (ergebnis === 'fertig' && !nochmal) {
          setzeStatus('aktuell');
          return;
        }
      }
      plane(5000);
      setzeStatus('wartet');
    } catch (fehler) {
      if (fehler instanceof AnmeldeFehler) setzeStatus('abgemeldet', 'Bitte melde dich neu an.');
      else if (fehler instanceof NetzFehler) setzeStatus('offline');
      else setzeStatus('fehler', fehler.message || 'Unbekannter Fehler');
    } finally {
      clearTimeout(anzeige);
    }
  }

  function abgleichen() {
    if (!app || !sitzung()) return Promise.resolve();
    if (laeuft) {
      nochmal = true;
      return laeuft;
    }
    clearTimeout(uhr);
    laeuft = durchfuehren().finally(() => {
      laeuft = null;
      // Eine Änderung, die erst ganz am Ende dazukam
      if (nochmal && sitzung()) { nochmal = false; plane(); }
    });
    return laeuft;
  }

  function plane(wartezeit = WARTEN_NACH_AENDERUNG) {
    if (!app || !sitzung()) return;
    clearTimeout(uhr);
    uhr = setTimeout(abgleichen, wartezeit);
  }

  // Nach jeder Eingabe: den gemeinsamen Stand zusammen mit den Daten ablegen,
  // damit beides auch bei mehreren Fenstern zueinander passt.
  function geaendert() {
    if (basis) lege(BASIS, basis);
    plane();
  }

  // ---------- Anmeldung ----------

  async function anmelden(email, passwort) {
    let r;
    try {
      r = await anfrage('/auth/v1/token?grant_type=password', { methode: 'POST', inhalt: { email, password: passwort } });
    } catch (_) {
      return 'Der Server ist gerade nicht erreichbar. Prüfe deine Internetverbindung.';
    }
    if (r.ok && r.koerper?.access_token && r.koerper?.user?.id) {
      merkeSitzung(r.koerper);
      await abgleichen();
      return null;
    }
    if (r.code === 400 || r.code === 401) return 'E-Mail-Adresse oder Passwort stimmt nicht.';
    if (r.code === 429) return 'Zu viele Versuche. Warte ein paar Minuten.';
    return 'Die Anmeldung hat nicht geklappt. Versuche es später noch einmal.';
  }

  async function abmelden() {
    const s = sitzung();
    lege(SITZUNG, null);
    clearTimeout(uhr);
    setzeStatus('abgemeldet');
    // Nur dieses Gerät abmelden, andere bleiben angemeldet.
    if (s) { try { await anfrage('/auth/v1/logout?scope=local', { methode: 'POST', zugang: s.zugang }); } catch (_) { /* offline */ } }
  }

  // hatteDaten: false, wenn im Browser keine lesbaren Daten lagen. Dann darf
  // der alte gemeinsame Stand nicht gelten, sonst sähe das wie „alles
  // gelöscht“ aus und würde auf die anderen Geräte übertragen.
  function start(anschluss, hatteDaten) {
    app = anschluss;
    const b = lies(BASIS);
    if (hatteDaten && b && typeof b.konto === 'string' && Number.isInteger(b.version)) {
      try { basis = { konto: b.konto, version: b.version, daten: Speicher.bereinige(b.daten) }; } catch (_) { basis = null; }
    }
    document.addEventListener('visibilitychange', () => abgleichen());
    window.addEventListener('online', () => abgleichen());
    setInterval(() => { if (document.visibilityState === 'visible') abgleichen(); }, NACHSEHEN_ALLE);
    abgleichen();
  }

  return {
    start, geaendert, abgleichen, anmelden, abmelden,
    angemeldetAls: () => sitzung()?.email ?? null,
    angemeldet: () => Boolean(sitzung()),
    status: () => status,
    allesGesichert: () => Boolean(app && basis && Abgleich.gleich(app.lese(), basis.daten)),
  };
})();
