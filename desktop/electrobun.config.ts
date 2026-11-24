import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Puck",
    identifier: "in.puckit.desktop",
    version: "0.1.0",
  },
  build: {
    bun: { entrypoint: "src/main/index.ts" },
    views: {
      inbox: { entrypoint: "src/views/inbox/index.ts" },
      card: { entrypoint: "src/views/card/index.ts" },
    },
    copy: {
      "src/views/inbox/index.html": "views/inbox/index.html",
      "src/views/card/index.html": "views/card/index.html",
      "src/views/activity.css": "views/shared/activity.css",
      "src/views/puck.css": "views/shared/puck.css",
      "../app/modules/puck-full-screen/android/src/main/assets/puck-fonts/Nunito_700Bold.ttf": "views/shared/Nunito_700Bold.ttf",
      "../app/modules/puck-full-screen/android/src/main/assets/puck-fonts/Nunito_800ExtraBold.ttf": "views/shared/Nunito_800ExtraBold.ttf",
      "../app/modules/puck-full-screen/android/src/main/assets/puck-fonts/Nunito_900Black.ttf": "views/shared/Nunito_900Black.ttf",
      "../app/modules/puck-full-screen/android/src/main/assets/puck-fonts/OFL.txt": "views/OFL.txt",
    },
    mac: { bundleCEF: false },
  },
  scripts: { preBuild: "scripts/icon.ts" },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
