/** Local sign-in page. The Google URL is JSON-encoded so it cannot break out of the script. */
export function loginPageHtml(verificationUrl: string): string {
  const target = JSON.stringify(verificationUrl).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in to Puck</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3e6dc; color: #3c241c; font: 17px/1.4 ui-sans-serif, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 48px)); }
    p.kicker { margin: 0 0 8px; color: #8a4524; font-size: 15px; font-weight: 700; letter-spacing: 0.4px; }
    h1 { margin: 0 0 8px; font-size: 36px; }
    p { margin: 0 0 20px; }
    button { width: 100%; border: 0; border-radius: 14px; background: #2a1814; color: #fff9f5; font: inherit; font-weight: 700; padding: 16px; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Puck</p>
    <h1>Sign in</h1>
    <p>Continue with the Google account that should receive alerts.</p>
    <button type="button" id="google">Continue with Google</button>
  </main>
  <script type="application/json" id="target">${target}</script>
  <script>
    document.getElementById("google").addEventListener("click", function () {
      var url = JSON.parse(document.getElementById("target").textContent);
      window.location.href = url;
    });
  </script>
</body>
</html>
`;
}

export function signedInPageHtml(email: string): string {
  const safe = email.replace(/[&<>"]/gu, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signed in to Puck</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3e6dc; color: #3c241c; font: 17px/1.4 ui-sans-serif, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 48px)); }
    p.kicker { margin: 0 0 8px; color: #8a4524; font-weight: 700; }
    h1 { margin: 0 0 8px; font-size: 36px; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Puck</p>
    <h1>Signed in</h1>
    <p>${safe}</p>
    <p>You can close this window.</p>
  </main>
</body>
</html>
`;
}

/** Reads the full return address, including a hash the server never sees, and posts it back. */
export function callbackBridgeHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signing in to Puck</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3e6dc; color: #3c241c; font: 17px/1.4 ui-sans-serif, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 48px)); }
    h1 { margin: 0 0 8px; font-size: 36px; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in</h1>
    <p>Finishing sign-in…</p>
  </main>
  <script>
    fetch("/callback", { method: "POST", headers: { "content-type": "text/plain" }, body: location.href })
      .then(function (response) { return response.text(); })
      .then(function (html) { document.open(); document.write(html); document.close(); })
      .catch(function () {
        var line = document.querySelector("p");
        if (line) line.textContent = "the sign-in did not finish";
      });
  </script>
</body>
</html>
`;
}

export function signInFailedPageHtml(message: string): string {
  const safe = message.replace(/[&<>"]/gu, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Puck sign-in</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3e6dc; color: #3c241c; font: 17px/1.4 ui-sans-serif, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 48px)); }
    h1 { margin: 0 0 8px; font-size: 36px; }
    p { color: #8a2f24; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in</h1>
    <p>${safe}</p>
  </main>
</body>
</html>
`;
}
