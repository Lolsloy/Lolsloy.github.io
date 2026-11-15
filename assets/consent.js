/* SetHub – Cookie-Einwilligung (alle Seiten)
   Speichert die Auswahl im Browser (localStorage "sethub_consent").
   API:  SetHubConsent.get()            -> {necessary:true, comfort:bool, ts} | null
         SetHubConsent.has('comfort')   -> bool
         SetHubConsent.open()           -> Einstellungen öffnen
         SetHubConsent.grant('comfort') -> Kategorie erlauben
   Event: window 'sethub:consent' (detail = aktuelle Auswahl)
   Jedes Element mit [data-cookie-settings] öffnet die Einstellungen. */
(function () {
  var KEY = 'sethub_consent', VERSION = 1, MAX_AGE = 365 * 24 * 3600 * 1000

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (!c || c.v !== VERSION || !c.ts || Date.now() - c.ts > MAX_AGE) return null
      return c
    } catch (e) { return null }
  }
  function write(comfort) {
    var c = { v: VERSION, necessary: true, comfort: !!comfort, ts: Date.now() }
    try { localStorage.setItem(KEY, JSON.stringify(c)) } catch (e) {}
    if (!c.comfort) cleanupComfort()
    hideBanner(); closeModal()
    window.dispatchEvent(new CustomEvent('sethub:consent', { detail: c }))
    return c
  }
  function cleanupComfort() {
    try { localStorage.removeItem('sethub_user') } catch (e) {}
  }

  var COOKIE = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5 3.2 3.2 0 0 1-3.9-3.4A3.4 3.4 0 0 1 13.3 4.9 3 3 0 0 1 12 2.5Z" fill="#FFC21A"/><circle cx="8.3" cy="9.2" r="1.4" fill="#7A4A12"/><circle cx="14.6" cy="13.4" r="1.2" fill="#7A4A12"/><circle cx="9.6" cy="15.6" r="1.3" fill="#7A4A12"/><circle cx="18.6" cy="5.2" r="1" fill="#FF5EA0"/><circle cx="20.8" cy="8.6" r=".8" fill="#04D5EB"/></svg>'
  var X = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'

  var banner, modal, lastFocus

  function build() {
    banner = document.createElement('div')
    banner.className = 'cc-banner'
    banner.setAttribute('role', 'region')
    banner.setAttribute('aria-label', 'Cookie-Hinweis')
    banner.innerHTML =
      '<div class="cc-card">' +
        '<div class="cc-top"><span class="cc-ic" aria-hidden="true">' + COOKIE + '</span>' +
        '<div><h3>Cookies? Nur mit deinem OK.</h3>' +
        '<p>Wir nutzen technisch notwendige Speicherungen, damit SetHub funktioniert. Mit deiner Zustimmung aktivieren wir zusätzlich Komfort-Funktionen wie die Anmeldung mit Google. Mehr dazu in der <a href="/datenschutz.html#cookies">Datenschutzerklärung</a>.</p></div></div>' +
        '<div class="cc-actions">' +
          '<button type="button" class="cc-btn" data-cc="necessary">Nur notwendige</button>' +
          '<button type="button" class="cc-btn primary" data-cc="all">Alle akzeptieren</button>' +
          '<button type="button" class="cc-btn link" data-cc="settings">Einstellungen</button>' +
        '</div>' +
      '</div>'

    modal = document.createElement('div')
    modal.className = 'cc-modal'
    modal.setAttribute('aria-hidden', 'true')
    modal.innerHTML =
      '<div class="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="ccTitle">' +
        '<div class="cc-dhead"><div><h3 id="ccTitle">Cookie-Einstellungen</h3>' +
        '<p>Entscheide selbst, was wir speichern dürfen. Du kannst deine Auswahl jederzeit über „Cookie-Einstellungen“ im Footer ändern.</p></div>' +
        '<button type="button" class="cc-x" data-cc="close" aria-label="Schließen">' + X + '</button></div>' +
        '<div class="cc-cats">' +
          '<div class="cc-cat"><div class="cc-cat-top"><h4>Notwendig</h4><span class="cc-tag">Immer aktiv</span></div>' +
          '<p>Speichert deine Cookie-Auswahl und ob du das Willkommens-Fenster schon gesehen hast. Ohne diese Daten funktioniert die Seite nicht richtig.</p></div>' +
          '<div class="cc-cat"><div class="cc-cat-top"><h4>Komfort</h4>' +
          '<label class="cc-switch"><input type="checkbox" id="ccComfort" aria-label="Komfort-Funktionen erlauben"><span></span></label></div>' +
          '<p>Ermöglicht die Anmeldung mit Google (Google Ireland Ltd.) und merkt sich deinen Login auf diesem Gerät. Dabei kann Google Cookies setzen.</p></div>' +
        '</div>' +
        '<div class="cc-dfoot">' +
          '<button type="button" class="cc-btn" data-cc="necessary">Nur notwendige</button>' +
          '<button type="button" class="cc-btn" data-cc="save">Auswahl speichern</button>' +
          '<button type="button" class="cc-btn primary" data-cc="all">Alle akzeptieren</button>' +
        '</div>' +
        '<div class="cc-dlinks"><a href="/datenschutz.html">Datenschutz</a> · <a href="/impressum.html">Impressum</a></div>' +
      '</div>'

    document.body.appendChild(banner)
    document.body.appendChild(modal)

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cc]')
      if (t) {
        var a = t.getAttribute('data-cc')
        if (a === 'all') write(true)
        else if (a === 'necessary') write(false)
        else if (a === 'save') write(document.getElementById('ccComfort').checked)
        else if (a === 'settings') openModal()
        else if (a === 'close') closeModal()
        return
      }
      var s = e.target.closest('[data-cookie-settings]')
      if (s) { e.preventDefault(); openModal() }
    })
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal() })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('show')) closeModal()
    })
  }

  function showBanner() { banner.classList.add('show') }
  function hideBanner() { banner && banner.classList.remove('show') }
  function openModal() {
    var c = read()
    document.getElementById('ccComfort').checked = c ? !!c.comfort : false
    lastFocus = document.activeElement
    modal.classList.add('show')
    modal.setAttribute('aria-hidden', 'false')
    hideBanner()
    setTimeout(function () { modal.querySelector('.cc-x').focus() }, 50)
  }
  function closeModal() {
    if (!modal || !modal.classList.contains('show')) return
    modal.classList.remove('show')
    modal.setAttribute('aria-hidden', 'true')
    if (!read()) setTimeout(showBanner, 200)
    if (lastFocus && lastFocus.focus) try { lastFocus.focus() } catch (e) {}
  }

  window.SetHubConsent = {
    get: read,
    has: function (cat) { var c = read(); return !!(c && c[cat]) },
    open: function () { openModal() },
    grant: function (cat) { if (cat === 'comfort') return write(true) }
  }

  function init() {
    build()
    if (!read()) setTimeout(showBanner, 600)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
