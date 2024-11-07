const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');  // Añadir el paquete de CORS

// Inicializar el servidor
const app = express();
const PORT = 3000;


// Middleware para manejar CORS
app.use(cors());  // Permitir todas las solicitudes de cualquier origen

// Middleware para manejar datos en formato JSON
app.use(bodyParser.json());


// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Ruta para recibir los webhooks de Callbell
app.post('/webhook/callbell', async (req, res) => {
    try {
        const { sender_name, sender_phone } = req.body;

        // Verificar que tenemos los datos requeridos
        if (!sender_phone) {
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
                                content: sender_name || "Sin Nombre"
                            }
                        }
                    ]
                },
                Telefono: {
                    phone_number: sender_phone
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

        res.status(200).send('Datos guardados correctamente en Notion');
    } catch (error) {
        console.error('Error al guardar los datos en Notion:', error);
        res.status(500).send('Error al procesar el webhook');
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
