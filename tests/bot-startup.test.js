const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "whatsapp-web.js") {
    return {
      Client: class {
        constructor() {
          this.listeners = new Map();
        }

        on(event, handler) {
          this.listeners.set(event, handler);
        }

        initialize() {
          throw new Error("init failed");
        }
      },
      LocalAuth: class {},
    };
  }

  if (request === "qrcode-terminal") {
    return { generate() {} };
  }

  return originalLoad.apply(this, arguments);
};

try {
  const bot = require("../src/bot");
  const client = bot.startClient();
  assert.ok(client, "startClient() should return a client object");
  console.log("bot startup test passed");
} finally {
  Module._load = originalLoad;
}
