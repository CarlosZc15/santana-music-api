const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: 'cr1504',
      database: 'TiendaSantana',
    });
    console.log('Conectado correctamente');
    await connection.end();
  } catch (error) {
    console.error('Error de conexión:', error);
  }
}

testConnection();

