// Wysyłka e-maili przez SMTP (TLS, port 465) — czysty Node, bez zależności.
// Wydzielone z main.cjs, by dało się testować na żywo (bez Electrona).
const tls = require("tls");

function smtpSend({ host, port, user, pass, to, subject, body, tlsOptions }) {
  return new Promise((resolve) => {
    const HOST = String(host || "smtp.gmail.com");
    const PORT = Number(port) || 465;
    let settled = false;
    const done = (msg) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(msg);
    };
    const socket = tls.connect(PORT, HOST, { servername: HOST, ...(tlsOptions || {}) }, () => {});
    socket.setTimeout(20000, () => done("err:Przekroczono czas połączenia z serwerem poczty."));
    socket.on("error", (e) => done(`err:${e.message || e}`));

    const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");
    // Temat i treść w UTF-8 (polskie znaki) — temat jako encoded-word, treść base64.
    const bodyB64 = b64(body).replace(/(.{76})/g, "$1\r\n");
    const data = [
      `From: <${user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      bodyB64,
      ".",
    ].join("\r\n");

    // Prosty automat SMTP: każdy krok czeka na kod odpowiedzi i wysyła kolejną komendę.
    const steps = [
      { expect: /^220/, send: () => `EHLO jarvis.local` },
      { expect: /^250/, send: () => `AUTH LOGIN` },
      { expect: /^334/, send: () => b64(user) },
      { expect: /^334/, send: () => b64(pass) },
      { expect: /^235/, send: () => `MAIL FROM:<${user}>`, errMsg: "Logowanie odrzucone — sprawdź adres i HASŁO APLIKACJI (nie zwykłe hasło Gmaila)." },
      { expect: /^250/, send: () => `RCPT TO:<${to}>` },
      { expect: /^250/, send: () => `DATA` },
      { expect: /^354/, send: () => data },
      { expect: /^250/, send: () => `QUIT`, thenOk: true },
    ];
    let step = 0;
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // Czekaj na finalną linię odpowiedzi ("250 ..." — kod + spacja, nie "250-").
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return;
      const s = steps[step];
      buf = "";
      if (!s) return done("ok");
      if (!s.expect.test(last)) return done(`err:${s.errMsg || `Serwer odpowiedział: ${last.slice(0, 120)}`}`);
      // Krok "logowanie odrzucone": błąd wykrywamy na odpowiedzi NA hasło — czyli
      // gdy expect /^235/ nie pasuje. errMsg żyje przy kroku z expect.
      socket.write(s.send() + "\r\n");
      if (s.thenOk) return done("ok");
      step++;
    });
  });
}

module.exports = { smtpSend };
