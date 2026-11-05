/* global require, URL, localStorage, console, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ui-qa-'));
async function open() {
  const context = await chromium.launchPersistentContext(tmp, {executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-dev-shm-usage'],viewport:{width:1100,height:820},timeout:15000});
  await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  return context;
}
(async () => {
 let context = await open(); let page = context.pages()[0] || await context.newPage();
 await page.goto('http://127.0.0.1:5190/', {waitUntil:'domcontentloaded',timeout:20000});
 await page.evaluate(() => localStorage.setItem('jarvis.onboarded.v1','1'));
 await page.reload({waitUntil:'domcontentloaded'});
 const group = page.getByRole('group',{name:'Interfejs'}).first();
 await group.waitFor({timeout:20000});
 await page.locator('.boot').waitFor({state:'hidden',timeout:8000});
 const classic=group.getByRole('button',{name:'Klasyczny'}); const modern=group.getByRole('button',{name:'Nowy'});
 if (await classic.getAttribute('aria-pressed') !== 'true') throw Error('Brak klasycznego domyślnie');
 await modern.click();
 if (await modern.getAttribute('aria-pressed') !== 'true' || await page.locator('.app.interface-modern').count() !== 1) throw Error('Nie włączono nowego');
 const ta=page.getByPlaceholder('Wydaj polecenie JARVIS-owi…');
 await ta.fill('Włącz klasyczny interfejs'); await ta.press('Enter');
 await page.getByText('Włączyłem klasyczny interfejs.').waitFor({timeout:5000});
 if (await classic.getAttribute('aria-pressed') !== 'true') throw Error('Komenda nie przełączyła');
 await ta.fill('Zmień mi interfejs na nowy'); await ta.press('Enter');
 await page.getByText('Włączyłem nowy interfejs.').waitFor({timeout:5000});
 if (await modern.getAttribute('aria-pressed') !== 'true') throw Error('Komenda nie przełączyła nowego');
 await page.screenshot({path:'/tmp/jarvis-qa-modern.png'});
 await context.close();
 context=await open(); page=context.pages()[0]||await context.newPage();
 await page.goto('http://127.0.0.1:5190/',{waitUntil:'domcontentloaded'});
 await page.locator('.app.interface-modern').waitFor({timeout:20000});
 await page.locator('.boot').waitFor({state:'hidden',timeout:8000});
 await page.getByText('Zmień mi interfejs na nowy',{exact:true}).waitFor({timeout:6000});
 await page.getByText('Włączyłem nowy interfejs.').waitFor({timeout:6000});
 console.log('PASS realny Chromium: ustawienie domyślne, przełączenie UI, komendy bez modelu, pełne zamknięcie/otwarcie profilu, zachowanie wyglądu i czatu');
 await page.setViewportSize({width:390,height:844});
 const dims = await page.getByRole('group',{name:'Interfejs'}).first().boundingBox();
 if (!dims || dims.x < 0 || dims.x + dims.width > 390) throw Error('Przełącznik poza oknem 390px');
 await page.screenshot({path:'/tmp/jarvis-qa-mobile.png'});
 console.log('PASS przełącznik mieści się w oknie 390x844 (pozostałe moduły niezweryfikowane)');
 await context.close(); fs.rmSync(tmp,{recursive:true,force:true});
})().catch(e=>{console.error(e.stack);process.exitCode=1});
