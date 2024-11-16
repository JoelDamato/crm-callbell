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
            if (!payload) throw new Error('Payload no proporcionado');

            const { name, phoneNumber, tags, createdAt, customFields } = payload;

            if (!phoneNumber) throw new Error('Número de teléfono no proporcionado');

            // Verificar que el webhook fue recibido hoy para proceder
            const receivedDate = new Date();
            const createdDate = new Date(createdAt);

            if (
                createdDate.getDate() !== receivedDate.getDate() ||
                createdDate.getMonth() !== receivedDate.getMonth() ||
                createdDate.getFullYear() !== receivedDate.getFullYear()
            ) {
                console.log('El webhook recibido no es del día de hoy, se ignora');
                return;
            }

            // Extraer valores de `customFields` para actualizar propiedades de Notion
            const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
            const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];

            // Determinar etiquetas para los selects de Notion
            const productInterestTag = productInterest
                ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]
                : null;
            const productsAcquiredTag = productsAcquired
                ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]
                : null;

            // Seleccionar la etiqueta adecuada para Estado
            const selectedTag = Array.isArray(tags) && tags.length > 0 ? tags[tags.length - 1] : "Sin Estado";

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
                // Actualizar contacto existente solo si el webhook se recibió hoy
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
                await axios.patch(`https://api.notion.com/v1/pages/${pageId}`, {
                    properties: propertiesToUpdate
                }, {
                    headers: {
                        'Authorization': `Bearer ${notionToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    }
                });

                console.log('Contacto actualizado correctamente en Notion');
            } else {
                // Crear nuevo contacto solo si se recibe un webhook creado hoy
                if (
                    createdDate.getDate() === receivedDate.getDate() &&
                    createdDate.getMonth() === receivedDate.getMonth() &&
                    createdDate.getFullYear() === receivedDate.getFullYear()
                ) {
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
                        propertiesToCreate["Productos Adquiridos"] = {
                            multi_select: [{ name: productsAcquiredTag }]
                        };
                    }
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

                    console.log('Datos guardados correctamente en Notion');
                } else {
                    console.log('No se crea un nuevo contacto ya que no fue creado hoy');
                }
            }
        } catch (error) {
            console.error('Error al procesar el webhook:', error.message);
        }
    })();
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
