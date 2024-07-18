import express from "express";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import P from "pino";

const app = express();
const port = 3000;

app.use(express.json());

//Generamos las credenciales
const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
let sock;

const startSock = () => {
  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        "connection closed due to ",
        lastDisconnect.error,
        ", reconnecting ",
        shouldReconnect
      );
      if (shouldReconnect) {
        startSock();
      }
    } else if (connection === "open") {
      console.log("opened connection");
    }
  });
};

startSock();

app.post("/send-message", async (req, res) => {
  console.log("Hola como te va");
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).send({ error: "Número y mensaje son requeridos" });
  }

  try {
    const jid = `${number}@s.whatsapp.net`; // Formato JID para WhatsApp
    await sock.sendMessage(jid, { text: message });
    res.send({ status: "success", message: "Mensaje enviado" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Error al enviar el mensaje" });
  }
});

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
