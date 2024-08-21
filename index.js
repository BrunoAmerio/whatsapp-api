import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import P from "pino";

const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//Generamos las credenciales
const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
let sock;

const startSock = () => {
  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("🚧 Generando QR 🚧");

      const qrPath = path.join(__dirname, "qr.png");
      try {
        QRCode.toFile(qrPath, qr, { type: "png" });
        console.log("💾 QR code saved to", qrPath);
        console.log("Esperando a ser escaneado 🤳🏻");
      } catch (err) {
        console.error("🛑 Error generating QR code:", err);
      }
    }

    if (connection === "close") {
      console.log(lastDisconnect.error?.output.payload);

      startSock();
    }

    if (connection === "open") {
      console.log("Whatsapp conectado satisfactoriamente!");
    }
  });

  const regexNumber = /549(\d+)@s\.whatsapp\.net/;
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    try {
      if (type !== "notify") {
        return;
      }

      const numberPhone = messages[0].key.remoteJid.match(regexNumber)[1];
      const message = messages[0].message.conversation;

      console.log("----");
      console.log("De:", numberPhone);
      console.log("Mensaje:", message);
      console.log("----");

      if (message.toLowerCase() === "cancelar") {
        fetch(`${process.env.BACKEND_URL}/turns/cancel-wpp`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: numberPhone,
          }),
        });
      }
    } catch (error) {
      console.log("Error", error);
      console.log("type", type);
      console.log("messages", messages);
    }
  });
};

app.get("/scan", (req, res) => {
  const qrPath = path.join(__dirname, "qr.png");

  // Verifica si el archivo QR ya existe
  fs.access(qrPath, fs.constants.F_OK)
    .then(() => fs.readFile(qrPath))
    .then((data) => {
      res.contentType("image/png");
      res.send(data);
    })
    .catch(() => {
      res.status(404).send("QR code not found");
    });
});

app.post("/send-message", async (req, res) => {
  const { number, message } = req.body;
  console.log("Enviando mensaje a:", number);

  const validPhone = /^\d{10}$/;

  try {
    if (!number || !message) {
      throw new Error("Número y mensaje son requeridos");
    }

    if (!validPhone.test(number)) {
      throw new Error(
        "El formato del número celular es invalido. Por favor reviselo de nuevo"
      );
    }

    const jid = `549${number}@s.whatsapp.net`; // Formato JID para WhatsApp

    await Promise.race([
      sock.sendMessage(jid, { text: message }),

      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout exceeded")), 20000)
      ),
    ]);

    console.log("Mensaje enviado");
    res.send({ status: "success", message: "Mensaje enviado" });
  } catch (error) {
    console.error("Error al enviar un mensaje:", error);
    res
      .status(500)
      .send({ error: "Error al enviar el mensaje", message: error.message });
  }
});

app.post("/disconnect", async (req, res) => {
  const authInfoPath = path.join(__dirname, "auth_info_baileys");

  try {
    await sock.logout();

    await fs.rm(authInfoPath, { recursive: true, force: true });

    res.send({ status: "success", message: "LogOut" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Error al cerrar sesión" });
  }
});

app.listen(port, () => {
  startSock();
  console.log(`API escuchando en http://localhost:${port}`);
});
