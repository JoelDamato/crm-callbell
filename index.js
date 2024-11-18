// Importar paquetes necesarios
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const axiosRetry = require('axios-retry').default;

// Inicializar el servidor
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de reintentos automáticos para Axios
axiosRetry(axios, { retries: 3, retryDelay: (retryCount) => retryCount * 1000 });

// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Mapear valores de `customFields` a las propiedades de Notion
const customFieldMap = {
    "PI : MF-FOCUS-CUT-MFC": {
        "MF": "Master Fade 2.0",
        "FOCUS": "Focus",
        "CUT": "Cutting Mastery",
        "MFC": "Master fade 2.0 + Cutting Mastery"
    },
    "PA : MF-FOCUS-CUT-MFC": {
        "MF": "Master Fade 2.0",
        "FOCUS": "Focus",
        "CUT": "Cutting Mastery",
        "MFC": "Master fade 2.0 + Cutting Mastery"
    }
};

// Ruta para recibir los webhooks de Callbell
app.post('/webhook/callbell', (req, res) => {
    // Responder inmediatamente para evitar timeouts
    res.status(202).send('Webhook recibido');

    // Luego de responder, procesar los datos asíncronamente
    (async () => {
        try {
            // Extraer datos del cuerpo de la solicitud
            const { payload } = req.body;
            if (!payload) {
                console.error('Error: Payload no proporcionado');
                return;
            }

            const { name, phoneNumber, tags, customFields } = payload;

            if (!phoneNumber) {
                console.error('Error: Número de teléfono no proporcionado');
                return;
            }

            // Verificar si el webhook fue recibido hoy
            const receivedDate = new Date();
            const today = new Date();

            if (
                receivedDate.getDate() !== today.getDate() ||
                receivedDate.getMonth() !== today.getMonth() ||
                receivedDate.getFullYear() !== today.getFullYear()
            ) {
                console.log('El webhook no fue recibido hoy, se ignora');
                return;
            }

            // Verificar si customFields está presente y extraer los valores correspondientes
            let productInterestTag = null;
            let productsAcquiredTag = null;
            let dni = null;
            let mail = null;

            if (customFields) {
                const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
                const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];
                dni = customFields["Dni"];
                mail = customFields["Mail"];

                // Determinar etiquetas para los selects de Notion si customFields contiene esos valores
                productInterestTag = productInterest
                    ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]
                    : null;
                productsAcquiredTag = productsAcquired
                    ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]
                    : null;
            }

            // Seleccionar la etiqueta adecuada para Estado
            const selectedTag = Array.isArray(tags) && tags.length > 0 ? tags[tags.length - 1] : "Sin Estado";

            console.log('Iniciando búsqueda del contacto en Notion...');

            // Buscar el contacto en la base de datos de Notion
            const searchResponse = await axios.post(`https://api.notion.com/v1/databases/${notionDatabaseId}/query`, {
                filter: {
                    property: 'Telefono',
                    phone_number: { equals: phoneNumber }
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            });

            const pages = searchResponse.data.results;

            if (pages.length > 0) {
                // Actualizar contacto existente ya que el webhook se recibió hoy
                const pageId = pages[0].id;
                const propertiesToUpdate = {
                    Estado: {
                        select: { name: selectedTag }
                    }
                };
                if (productInterestTag) {
                    propertiesToUpdate["Producto de interes"] = {
                        multi_select: [{ name: productInterestTag }]
                    };
                }
                if (productsAcquiredTag) {
                    propertiesToUpdate["Productos Adquiridos"] = {
                        multi_select: [{ name: productsAcquiredTag }]
                    };
                }
                if (dni) {
                    propertiesToUpdate["Dni"] = {
                        number: parseInt(dni, 10)
                    };
                }
                if (mail) {
                    propertiesToUpdate["Email"] = {
                        email: mail
                    };
                }

                console.log('Actualizando contacto existente en Notion...');

                // Intentar actualizar el contacto con varios reintentos en caso de error 502
                const updateContactInNotion = async (pageId, propertiesToUpdate, retries = 3) => {
                    for (let attempt = 1; attempt <= retries; attempt++) {
                        try {
                            await axios.patch(`https://api.notion.com/v1/pages/${pageId}`, {
                                properties: propertiesToUpdate
                            }, {
                                headers: {
                                    'Authorization': `Bearer ${notionToken}`,
                                    'Content-Type': 'application/json',
                                    'Notion-Version': '2022-06-28'
                                }
                            });
                            console.log(`Contacto actualizado correctamente en Notion en intento #${attempt}`);
                            return; // Salir si la actualización fue exitosa
                        } catch (error) {
                            if (error.response && error.response.status === 502) {
                                console.warn(`Error 502 Bad Gateway, intento #${attempt} de ${retries}`);
                                if (attempt === retries) {
                                    console.error('Máximo número de intentos alcanzado. No se pudo actualizar el contacto en Notion.');
                                    return;
                                }
                                await new Promise(resolve => setTimeout(resolve, attempt * 1000)); // Esperar antes de reintentar
                            } else {
                                console.error('Error al actualizar el contacto en Notion:', error.message);
                                if (error.response) {
                                    console.error('Detalles del error:', error.response.data);
                                }
                                return; // Salir si el error no es 502
                            }
                        }
                    }
                };

                // Llamar a la función para actualizar el contacto existente
                await updateContactInNotion(pageId, propertiesToUpdate);
            } else {
                // Crear nuevo contacto si no existe y el webhook fue recibido hoy
                console.log('No se encontró el contacto, creando un nuevo registro en Notion...');

                const propertiesToCreate = {
                    Nombre: {
                        title: [{ text: { content: name || "Sin Nombre" } }]
                    },
                    Telefono: { phone_number: phoneNumber },
                    Estado: { select: { name: selectedTag } },
                    Proyecto: { multi_select: [{ name: "Erick Gomez" }] }
                };
                if (productInterestTag) {
                    propertiesToCreate["Producto de interes"] = {
                        multi_select: [{ name: productInterestTag }]
                    };
                }
                if (productsAcquiredTag) {
                    propertiesToCreate["Productos Adqueridos"] = {
                        multi_select: [{ name: productsAcquiredTag }]
                    };
                }
                if (dni) {
                    propertiesToCreate["Dni"] = {
                        number: parseInt(dni, 10)
                    };
                }
                if (mail) {
                    propertiesToCreate["Email"] = {
                        email: mail
                    };
                }

                try {
                    await axios.post('https://api.notion.com/v1/pages', {
                        parent: { database_id: notionDatabaseId },
                        properties: propertiesToCreate
                    }, {
                        headers: {
                            'Authorization': `Bearer ${notionToken}`,
                            'Content-Type': 'application/json',
                            'Notion-Version': '2022-06-28'
                        }
                    });
                    console.log(`Datos creados correctamente en Notion: Fecha: ${receivedDate}, Teléfono: ${phoneNumber}, Nombre: ${name || "Sin Nombre"}`);
                } catch (error) {
                    console.error('Error al crear un nuevo registro en Notion:', error.message);
                    if (error.response) {
                        console.error('Detalles del error:', error.response.data);
                    }
                }
            }
        } catch (error) {
            console.error('Error al procesar el webhook:', error.message);
            if (error.response) {
                console.error('Detalles del error:', error.response.data);
            }
        }
    })();
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
