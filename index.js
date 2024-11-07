const express = require('express');
const axios = require('axios');
const cors = require('cors');  // Añadir el paquete de CORS

// Inicializar el servidor
const app = express();
const PORT = 3000;

// Middleware para manejar CORS
app.use(cors());  // Permitir todas las solicitudes de cualquier origen

// Middleware para manejar datos en formato JSON
app.use(express.json());  // Cambiado a express.json()

// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Ruta para recibir los webhooks de Callbell
app.post('/webhook/callbell', async (req, res) => {
    try {
        // Log para ver el cuerpo completo de la solicitud que llega del front
        console.log('Datos recibidos del Frontend:', req.body);

        // Extraer el objeto payload
        const { payload } = req.body;

        // Verificar si el payload existe
        if (!payload) {
            return res.status(400).send('Payload no proporcionado');
        }

        // Extraer las propiedades del payload
        const { name, phoneNumber } = payload;

        // Log para verificar las propiedades que se están extrayendo del payload
        console.log('Propiedades extraídas:');
        console.log('Nombre:', name);
        console.log('Número de Teléfono:', phoneNumber);

        // Verificar que tenemos los datos requeridos
        if (!phoneNumber) {
            console.error('Error: Número de teléfono no proporcionado');
            return res.status(400).send('Número de teléfono no proporcionado');
        }

        // Enviar los datos a la base de datos de Notion
        await axios.post('https://api.notion.com/v1/pages', {
            parent: { database_id: notionDatabaseId },
            properties: {
                Nombre: {
                    title: [
                        {
                            text: {
                                content: name || "Sin Nombre"
                            }
                        }
                    ]
                },
                Telefono: {
                    phone_number: phoneNumber
                },
                Estado: {
                    select: {
                        name: "Prospecto"
                    }
                },
                Proyecto: {
                    multi_select: [
                        {
                            name: "Erick Gomez"
                        }
                    ]
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${notionToken}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            }
        });

        // Log de éxito si los datos fueron guardados correctamente
        console.log('Datos guardados correctamente en Notion');

        res.status(200).send('Datos guardados correctamente en Notion');
    } catch (error) {
        // Log de error para ver la información detallada del problema
        console.error('Error al guardar los datos en Notion:', error.response ? error.response.data : error.message);
        res.status(500).send('Error al procesar el webhook');
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
