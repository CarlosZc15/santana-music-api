const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configura tu cuenta de Gmail
const remitente = 'ziriusgothc@gmail.com';
const clave = 'ollx fdei cdha efxz';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: remitente,
    pass: clave,
  },
});

app.post('/enviar-correo', async (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).json({ error: 'Correo no proporcionado.' });
  }

  const opcionesCorreo = {
    from: `"Santana Music 🎶" <${remitente}>`,
    to: correo,
    subject: 'Bienvenido a Santana Music 🎶',
    text: 'Su cuenta se ha creado exitosamente.',
  };

  try {
    await transporter.sendMail(opcionesCorreo);
    res.status(200).json({ mensaje: `Correo enviado correctamente a ${correo}` });
  } catch (error) {
    console.error('Error al enviar correo:', error);
    res.status(500).json({ error: 'Error al enviar el correo.' });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`📨 API de correo escuchando en http://localhost:${PORT}`);
});
