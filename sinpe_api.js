const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// Conexión a la base de datos
const dbConfig = {
  host: '127.0.0.2',
  user: 'root',
  password: 'carm123',
  database: 'bd_sinpe',
};

let db;
(async () => {
  db = await mysql.createConnection(dbConfig);
  console.log(' Conectado a MySQL');
})();


// MÉTODO 1: Registrar usuario con SINPE Móvil

app.post('/sinpe/registrar', async (req, res) => {
  const { nombre, telefono, saldoInicial } = req.body;

  if (!nombre || !telefono || saldoInicial == null) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    await db.execute(
      'INSERT INTO Usuarios (Nombre, Telefono, Saldo) VALUES (?, ?, ?)',
      [nombre, telefono, saldoInicial]
    );
    res.json({ mensaje: 'Usuario registrado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});




// MÉTODO 2: Consultar saldo por número SINPE

app.get('/sinpe/saldo/:telefono', async (req, res) => {
  const telefono = req.params.telefono;

  try {
    const [rows] = await db.execute(
      'SELECT Nombre, Saldo FROM Usuarios WHERE Telefono = ?',
      [telefono]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar saldo' });
  }
});




// MÉTODO 3: Realizar transferencia SINPE

app.post('/sinpe/transferir', async (req, res) => {
  const { emisorTel, receptorTel, monto } = req.body;

  if (!emisorTel || !receptorTel || monto == null || monto <= 0) {
    return res.status(400).json({ error: 'Datos inválidos para transferencia' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [emisor] = await conn.execute('SELECT ID, Saldo FROM Usuarios WHERE Telefono = ?', [emisorTel]);
    const [receptor] = await conn.execute('SELECT ID FROM Usuarios WHERE Telefono = ?', [receptorTel]);

    if (emisor.length === 0 || receptor.length === 0) {
      throw new Error('Emisor o receptor no encontrado');
    }

    if (emisor[0].Saldo < monto) {
      throw new Error('Fondos insuficientes');
    }

    await conn.execute('UPDATE Usuarios SET Saldo = Saldo - ? WHERE Telefono = ?', [monto, emisorTel]);
    await conn.execute('UPDATE Usuarios SET Saldo = Saldo + ? WHERE Telefono = ?', [monto, receptorTel]);

    await conn.execute(
      'INSERT INTO Transferencias (EmisorID, ReceptorID, Monto, Fecha) VALUES (?, ?, ?, NOW())',
      [emisor[0].ID, receptor[0].ID, monto]
    );

    await conn.commit();
    res.json({ mensaje: 'Transferencia completada exitosamente' });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});




// MÉTODO 4: Historial de transferencias por número

app.get('/sinpe/historial/:telefono', async (req, res) => {
  const telefono = req.params.telefono;

  try {
    const [usuario] = await db.execute('SELECT ID FROM Usuarios WHERE Telefono = ?', [telefono]);
    if (usuario.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuarioID = usuario[0].ID;

    const [historial] = await db.execute(`
      SELECT
        t.Monto,
        t.Fecha,
        u1.Nombre AS Emisor,
        u2.Nombre AS Receptor
      FROM Transferencias t
      JOIN Usuarios u1 ON t.EmisorID = u1.ID
      JOIN Usuarios u2 ON t.ReceptorID = u2.ID
      WHERE t.EmisorID = ? OR t.ReceptorID = ?
      ORDER BY t.Fecha DESC
    `, [usuarioID, usuarioID]);

    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});
// ==========================================================


// Servidor
app.listen(3000, () => {
  console.log('Servidor SINPE Móvil corriendo en http://localhost:3000');
});
