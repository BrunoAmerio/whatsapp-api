import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import P from "pino";

const app = express();
const port = process.env.PORT;

app.use(express.json());

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
      console.log("Generando QR...");

      const qrPath = path.join(__dirname, "qr.png");
      try {
        QRCode.toFile(qrPath, qr, { type: "png" });
        console.log("QR code saved to", qrPath);
      } catch (err) {
        console.error("Error generating QR code:", err);
      }
    }

    if (connection === "close") {
      console.log(lastDisconnect.error?.output.payload);

      startSock();
    }

    if (connection === "open") {
      console.log("opened connection");
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

  if (!number || !message) {
    return res.status(400).send({ error: "Número y mensaje son requeridos" });
  }

  try {
    const jid = `549${number}@s.whatsapp.net`; // Formato JID para WhatsApp
    await Promise.race([
      sock.sendMessage(jid, { text: message }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout exceeded")), 20000)
      ),
    ]);

    res.send({ status: "success", message: "Mensaje enviado" });
  } catch (error) {
    console.error("Error al enviar un mensaje:", error);
    res.status(500).send({ error: "Error al enviar el mensaje" });
  }
});

app.post("/disconnect", async (req, res) => {
  const authInfoPath = path.join(__dirname, "auth_info_baileys");

  try {
    await sock.logout();

    await fs.rm(authInfoPath, { recursive: true, force: true });

    res.send({ status: "success", message: "LogOut" });

    // startSock();
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Error al cerrar sesión" });
  }
});

app.listen(port, () => {
  startSock();
  console.log(`API escuchando en http://localhost:${port}`);
});
