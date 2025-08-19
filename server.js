const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// ---------------- CONFIG MYSQL ----------------
const dbConfig = {
  host: process.env.DB_HOST,     // <- ahora viene del .env
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// pool para reusar conexiones
const pool = mysql.createPool(dbConfig);

// ---------------- CONFIG EMAIL ----------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,   // <- ahora viene del .env
    pass: process.env.EMAIL_PASS
  }
});


// ---------------- RUTAS ----------------

// Enviar correo
app.post('/enviar-correo', async (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).json({ error: 'No se proporcionó correo' });
  }

  try {
    await transporter.sendMail({
      from: 'Santana Music <ziriusgothc@gmail.com>',
      to: correo,
      subject: '¡Bienvenido a Santana Music!',
      text: 'Gracias por registrarte. Pronto tendrás acceso a toda nuestra música 🎵.'
    });
    res.status(201).json({
      success: true,
      message: `Correo enviado correctamente a ${correo}.`
    });
  } catch (error) {
    console.error('Error enviando correo:', error);
    res.status(500).json({ error: 'Error enviando correo', detalle: error.message });
  }
});

// Generar QR
app.post('/generar-qr', async (req, res) => {
  const data = req.body;
  try {
    const qrString = JSON.stringify(data);
    const qrCodeBase64 = await QRCode.toDataURL(qrString);
    res.json({ qr: qrCodeBase64 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor', detalle: error.message });
  }
});

// Registrar usuario
app.post('/registrar', async (req, res) => {
  const { Nombre, Apellido, Correo, Contrasena,
    Telefono, Direccion, Pais, Provincia, Canton, activarMFA } = req.body;

  try {
    const connection = await pool.getConnection();
    const hashedPassword = await bcrypt.hash(Contrasena, 10);

    let qrCodeUrl = null;

    if (activarMFA) {
      const mfaSecret = speakeasy.generateSecret({
        name: `SantanaMusic (${Correo})`
      });

      await connection.execute(
        "INSERT INTO usuario (Nombre, Apellido, Correo, Contrasena, Telefono, Direccion, Pais, Provincia, Canton, mfa_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [Nombre, Apellido, Correo, hashedPassword, Telefono, Direccion, Pais, Provincia, Canton, mfaSecret.base32]
      );

      qrCodeUrl = await QRCode.toDataURL(mfaSecret.otpauth_url);
    } else {
      await connection.execute(
        "INSERT INTO usuario (Nombre, Apellido, Correo, Contrasena, Telefono, Direccion, Pais, Provincia, Canton) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [Nombre, Apellido, Correo, hashedPassword, Telefono, Direccion, Pais, Provincia, Canton]
      );
    }

    connection.release();

    // Enviar correo después de registrar
    try {
      await transporter.sendMail({
        from: 'Santana Music <ziriusgothc@gmail.com>',
        to: Correo,
        subject: '¡Bienvenido a Santana Music!',
        text: `Hola ${Nombre}, gracias por registrarte en Santana Music.`
      });
    } catch (emailError) {
      console.error('Error enviando correo:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Usuario registrado correctamente y correo enviado',
      qrCodeUrl
    });
  } catch (err) {
    console.error('Error al registrar:', err);
    res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { Correo, Contrasena, mfa_code } = req.body;

  if (!Correo || !Contrasena) {
    return res.status(400).json({ error: 'Faltan el correo o la contraseña' });
  }

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT * FROM usuario WHERE Correo = ?',
      [Correo]
    );
    connection.release();

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = rows[0];
    const passwordMatch = await bcrypt.compare(Contrasena, usuario.Contrasena);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (usuario.mfa_secret) {
      if (!mfa_code) {
        return res.status(401).json({
          error: 'Se requiere código MFA',
          requiereMFA: true
        });
      }

      const verified = speakeasy.totp.verify({
        secret: usuario.mfa_secret,
        encoding: 'base32',
        token: mfa_code
      });

      if (!verified) {
        return res.status(401).json({ error: 'Código MFA inválido' });
      }
    }

    delete usuario.Contrasena;

    res.status(200).json({
      mensaje: 'Inicio de sesión exitoso',
      usuario
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error del servidor', detalle: err.message });
  }
});

// Obtener usuario
app.get('/usuario/:correo', async (req, res) => {
  const correo = req.params.correo;

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM usuario WHERE Correo = ?', [correo]);
    connection.release();

    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }
  } catch (err) {
    console.error('Error obteniendo usuario:', err);
    res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
  }
});

// Actualizar usuario
app.put('/usuario/:correo', async (req, res) => {
  const correo = req.params.correo;
  const { Nombre, Apellido, Telefono, Direccion, Pais, Provincia, Canton } = req.body;

  try {
    const connection = await pool.getConnection();
    await connection.execute(
      'UPDATE usuario SET Nombre=?, Apellido=?, Telefono=?, Direccion=?, Pais=?, Provincia=?, Canton=? WHERE Correo=?',
      [Nombre, Apellido, Telefono, Direccion, Pais, Provincia, Canton, correo]
    );
    connection.release();

    res.json({ mensaje: 'Actualización exitosa' });
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
  }
});

// Agregar producto al carrito
app.post('/carrito/agregar', async (req, res) => {
  const { id_usuario, id_producto, cantidad } = req.body;

  if (!id_usuario || !id_producto) {
    return res.status(400).json({ error: 'Faltan datos para agregar al carrito' });
  }

  try {
    const connection = await pool.getConnection();
    await connection.execute(
      'CALL sp_AgregarProductoAlCarrito(?, ?, ?)',
      [id_usuario, id_producto, cantidad || 1]
    );
    connection.release();

    res.status(200).json({ success: true, message: 'Producto agregado al carrito' });
  } catch (error) {
    console.error('Error agregando producto al carrito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener carrito
app.get('/carrito/:id_usuario', async (req, res) => {
  const id_usuario = req.params.id_usuario;

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'CALL sp_ObtenerCarritoPorUsuario(?)',
      [id_usuario]
    );
    connection.release();

    const productos = rows[0] || [];
    res.status(200).json({ productos });

  } catch (error) {
    console.error('Error obteniendo productos del carrito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar producto del carrito
app.post('/carrito/eliminar', async (req, res) => {
  const { id_usuario, id_producto } = req.body;

  if (!id_usuario || !id_producto) {
    return res.status(400).json({ error: 'Faltan datos para eliminar del carrito' });
  }

  try {
    const connection = await pool.getConnection();
    await connection.execute(
      'CALL sp_EliminarProductoCarrito(?, ?)',
      [id_usuario, id_producto]
    );
    connection.release();

    res.status(200).json({ message: 'Producto eliminado del carrito' });
  } catch (error) {
    console.error('Error eliminando producto del carrito:', error);
    res.status(500).json({ error: 'Error del servidor', detalle: error.message });
  }
});


app.post('/carrito/finalizar', async (req, res) => {
  const { id_usuario } = req.body;

  if (!id_usuario) {
    return res.status(400).json({ message: 'Falta el id del usuario' });
  }

  try {
    const connection = await pool.getConnection();
    await connection.query('CALL sp_FinalizarCompra(?)', [id_usuario]); // asegúrate que existe
    connection.release();

    res.json({ message: 'Compra finalizada correctamente' });
  } catch (error) {
    console.error('Error al finalizar compra:', error);
    res.status(500).json({ message: 'Error al finalizar la compra' });
  }
});

// Activar MFA
app.post('/mfa/activar', async (req, res) => {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ error: 'Falta correo' });

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM usuario WHERE Correo = ?', [correo]);

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const secret = speakeasy.generateSecret({ name: `Santana Music (${correo})` });

    await connection.execute('UPDATE usuario SET mfa_secret = ? WHERE Correo = ?', [secret.base32, correo]);
    connection.release();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({ qrCodeUrl, mensaje: 'Escanea este QR en Google Authenticator' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error activando MFA' });
  }
});

// Transferencia SINPE
app.post('/sinpe/pago', async (req, res) => {
  const { numeroEmisor, numeroReceptor, monto, detalle } = req.body;

  if (!numeroEmisor || !numeroReceptor || !monto) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [rowsEmisor] = await connection.execute(
      'SELECT * FROM emisor WHERE numeroTelefono = ?',
      [numeroEmisor]
    );
    if (rowsEmisor.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Emisor no encontrado' });
    }
    const emisor = rowsEmisor[0];

    if (emisor.saldo < monto) {
      await connection.rollback();
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const [rowsReceptor] = await connection.execute(
      'SELECT * FROM receptor WHERE numeroTelefono = ?',
      [numeroReceptor]
    );
    if (rowsReceptor.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Receptor no encontrado' });
    }
    const receptor = rowsReceptor[0];

    await connection.execute(
      'UPDATE emisor SET saldo = saldo - ? WHERE idEmisor = ?',
      [monto, emisor.idEmisor]
    );
    await connection.execute(
      'UPDATE receptor SET saldo = saldo + ? WHERE idReceptor = ?',
      [monto, receptor.idReceptor]
    );

    await connection.execute(
      'INSERT INTO transaccion (idEmisor, idReceptor, monto, detalle) VALUES (?, ?, ?, ?)',
      [emisor.idEmisor, receptor.idReceptor, monto, detalle]
    );

    await connection.commit();
    connection.release();

    res.json({
      mensaje: 'Transferencia realizada con éxito',
      emisor: emisor.numeroTelefono,
      receptor: receptor.numeroTelefono,
      monto,
      detalle
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    res.status(500).json({ error: 'Error procesando transferencia', detalle: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// Iniciar servidor
app.listen(3000, () => {
  console.log('API corriendo en http://localhost:3000');
});
