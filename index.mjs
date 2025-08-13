import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import readline from "readline";
import {
  BOT_NAME,
  PREFIX,
  OWNER_NUMBER,
  OWNER_NAME,
  USE_PAIRING_CODE,
  AUTO_READ,
  AUTO_RECONNECT
} from "./config.mjs";

const logger = pino({ level: "info" });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger,
    browser: [BOT_NAME, "Chrome", "1.0"],
    markOnlineOnConnect: false
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Show QR code if available
    if (qr) {
      console.clear();
      console.log(`\n================= ${BOT_NAME} =================`);
      console.log("Scan this QR with WhatsApp (Linked Devices):\n");
      qrcode.generate(qr, { small: true });
      console.log("\nIf QR expires, a new one will appear.");
    }

    // Show pairing code if enabled
    if (USE_PAIRING_CODE && !sock.authState.creds?.registered) {
      try {
        const code = await sock.requestPairingCode(OWNER_NUMBER);
        console.log(`\n🔢 Your 8-digit pairing code: ${code}\n`);
      } catch (err) {
        console.error("Failed to get pairing code:", err);
      }
    }

    if (connection === "open") {
      console.log(`\n✅ Connected as: ${sock.user?.id}`);
    }

    if (connection === "close") {
      const shouldReconnect = AUTO_RECONNECT && (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log("❌ Connection closed.");
      if (shouldReconnect) {
        console.log("🔁 Reconnecting...");
        start();
      } else {
        console.log("🚪 Logged out. Delete ./auth to pair again.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  const sendText = async (jid, text, quoted) => {
    return sock.sendMessage(jid, { text }, { quoted });
  };

  const maybeRead = async (m) => {
    if (!AUTO_READ) return;
    try { await sock.readMessages([m.key]); } catch {}
  };

  const ownerJid = jidNormalizedUser(`${OWNER_NUMBER}@s.whatsapp.net`);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        if (!m.message) continue;
        const jid = m.key.remoteJid;
        const fromMe = m.key.fromMe === true;

        let body = m.message.conversation || m.message.extendedTextMessage?.text || "";
        if (!body.startsWith(PREFIX)) return;

        await maybeRead(m);

        const args = body.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = (args.shift() || "").toLowerCase();

        switch (cmd) {
          case "ping":
            await sendText(jid, "pong", m);
            break;
          case "help":
            await sendText(jid, `*${BOT_NAME}* Commands:\n• ${PREFIX}ping\n• ${PREFIX}owner\n• ${PREFIX}say <text>\n• ${PREFIX}image`, m);
            break;
          case "owner":
            await sendText(jid, `Owner: *${OWNER_NAME}*\nwa.me/${OWNER_NUMBER}`, m);
            break;
          case "say":
            await sendText(jid, args.join(" ") || "You forgot to write something.", m);
            break;
          case "image":
            await sock.sendMessage(jid, {
              image: { url: "https://picsum.photos/600/400" },
              caption: `${BOT_NAME}: sample image.`
            }, { quoted: m });
            break;
          default:
            await sendText(jid, `Unknown command: ${PREFIX}${cmd}`, m);
        }
      } catch (err) {
        console.error(err);
      }
    }
  });
}

start().catch(e => console.error(e));
