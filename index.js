const express = require('express');
const axios = require('axios');
const cors = require('cors');  // Añadir el paquete de CORS
const axiosRetry = require('axios-retry').default;  // Ajustar la importación de axios-retry

// Inicializar el servidor
const app = express();
const PORT = 3000;

// Middleware para manejar CORS
app.use(cors());  // Permitir todas las solicitudes de cualquier origen

// Middleware para manejar datos en formato JSON
app.use(express.json());

// Configuración de reintentos automáticos para Axios
axiosRetry(axios, { retries: 3, retryDelay: (retryCount) => retryCount * 1000 });

// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Ruta para recibir los webhooks de Callbell
app.post('/webhook/callbell', (req, res) => {
    // Responder inmediatamente para evitar timeouts
    res.status(202).send('Webhook recibido');

    // Luego de responder, procesar los datos asíncronamente
    (async () => {
        try {
            // Log para ver el cuerpo completo de la solicitud que llega del front
            console.log('Datos recibidos del Frontend:', req.body);

            // Extraer el objeto payload
            const { payload } = req.body;

            // Verificar si el payload existe
            if (!payload) {
                console.error('Error: Payload no proporcionado');
                return;
            }

            // Extraer las propiedades del payload
            const { name, phoneNumber, tags } = payload;

            // Log para verificar las propiedades que se están extrayendo del payload
            console.log('Propiedades extraídas:');
            console.log('Nombre:', name);
            console.log('Número de Teléfono:', phoneNumber);
            console.log('Etiquetas:', tags);

            // Verificar que tenemos los datos requeridos
            if (!phoneNumber) {
                console.error('Error: Número de teléfono no proporcionado');
                return;
            }

            // Seleccionar la etiqueta adecuada: si hay una sola, usarla; si hay varias, usar la última
            const selectedTag = Array.isArray(tags) && tags.length > 0 ? tags[tags.length - 1] : "Sin Estado";

            // Definir una función para realizar la búsqueda con paginación
            let pages = [];
            let hasMore = true;
            let startCursor = undefined;
            let contactsChecked = 0; // Contador para los contactos verificados

            while (hasMore) {
                const searchPayload = {
                    filter: {
                        property: 'Telefono',
                        phone_number: {
                            equals: phoneNumber
                        }
                    }
                };

                // Agregar start_cursor solo si no es undefined
                if (startCursor) {
                    searchPayload.start_cursor = startCursor;
                }

                const searchResponse = await axios.post('https://api.notion.com/v1/databases/' + notionDatabaseId + '/query', searchPayload, {
                    headers: {
                        'Authorization': `Bearer ${notionToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    }
                });

                pages = pages.concat(searchResponse.data.results);
                contactsChecked += searchResponse.data.results.length;
                hasMore = searchResponse.data.has_more;
                startCursor = searchResponse.data.next_cursor;
            }

            console.log(`Cantidad de contactos verificados: ${contactsChecked}`);

            if (pages.length > 0) {
                // Si el contacto existe, actualizar la propiedad Estado con la etiqueta seleccionada
                const pageId = pages[0].id;
                await axios.patch(`https://api.notion.com/v1/pages/${pageId}`, {
                    properties: {
                        Estado: {
                            select: {
                                name: selectedTag
                            }
                        }
                    }
                }, {
                    headers: {
                        'Authorization': `Bearer ${notionToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    }
                });

                console.log('Contacto actualizado correctamente en Notion');
            } else {
                // Si el contacto no existe, crear un nuevo registro en Notion
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
                                name: selectedTag
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

                console.log('Datos guardados correctamente en Notion');
            }
        } catch (error) {
            // Log de error para ver la información detallada del problema
            const errorData = {
                message: error.message,
                responseData: error.response ? error.response.data : null,
                payload: req.body,
                timestamp: new Date()
            };
            console.error('Error al guardar los datos en Notion:', errorData);

            // Podrías guardar este errorData en un archivo o base de datos para una revisión posterior
            // Ejemplo: fs.writeFileSync('error_log.json', JSON.stringify(errorData), { flag: 'a' });
        }
    })();
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
