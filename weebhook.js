const axios = require('axios');
const axiosRetry = require('axios-retry').default;

// Configuración de reintentos automáticos para Axios
axiosRetry(axios, { retries: 3, retryDelay: (retryCount) => retryCount * 1000 });

// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Mapeo de customFields
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

// Normalizar el número de teléfono para mantener un formato consistente
const normalizePhoneNumber = (phoneNumber) => {
    return phoneNumber.replace(/[^0-9]/g, ''); // Eliminar todos los caracteres excepto números
};

// Función para manejar el webhook de Callbell
async function handleWebhook(req, res) {
    // Responder inmediatamente para evitar timeouts
    res.status(202).send('Webhook recibido');

    // Procesar los datos asíncronamente
    (async () => {
        try {
            const { payload } = req.body;
            console.log('Datos recibidos del webhook:', JSON.stringify(payload, null, 2));

            if (!payload) {
                console.error('Error: Payload no proporcionado');
                return;
            }

            const { name, phoneNumber, tags, customFields } = payload;

            if (!phoneNumber) {
                console.error('Error: Número de teléfono no proporcionado');
                return;
            }

            // Normalizar el número de teléfono
            const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
            console.log(`Número de teléfono normalizado: ${normalizedPhoneNumber}`);

            console.log('Iniciando búsqueda del contacto en Notion...');

            // Buscar el contacto en la base de datos de Notion por Tel ID
            const searchResponse = await axios.post(
                `https://api.notion.com/v1/databases/${notionDatabaseId}/query`,
                {
                    filter: {
                        property: 'Tel ID',
                        number: { equals: Number(normalizedPhoneNumber) }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${notionToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    }
                }
            );

            const pages = searchResponse.data.results;

            if (pages.length > 0) {
                const pageId = pages[0].id;
                const telId = pages[0].properties['Tel ID']?.formula?.number;

                console.log(`Tel ID recibido: ${telId}`);
                console.log(`Tel ID esperado: ${normalizedPhoneNumber}`);
                console.log(`Coinciden: ${telId === Number(normalizedPhoneNumber)}`);

                console.log(`Contacto encontrado en Notion. Actualizando: ${pageId}`);
                await updateContactInNotion(pageId, payload, tags, customFields);
            } else {
                console.log('No se encontró el contacto, creando un nuevo registro en Notion...');
                const newPageId = await createContactInNotion(payload, tags, customFields);
                console.log(`Nuevo contacto creado con ID: ${newPageId}`);
            }
        } catch (error) {
            console.error('Error al procesar el webhook:', error.message);
            if (error.response) {
                console.error('Detalles del error:', error.response.data);
            }
        }
    })();
}

// Función para actualizar contacto existente en Notion
async function updateContactInNotion(pageId, payload, tags, customFields) {
    const { name, phoneNumber } = payload;
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    let productInterestTag = null;
    let productsAcquiredTag = null;
    let dni = null;
    let email = null;

    // Procesar customFields si están disponibles
    if (customFields) {
        const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
        const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];
        dni = customFields["Dni"];
        email = customFields["Mail"];

        productInterestTag = productInterest
            ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]
            : null;
        productsAcquiredTag = productsAcquired
            ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]
            : null;
    }

    const propertiesToUpdate = {
        Nombre: {
            title: [{ text: { content: name || 'Sin Nombre' } }]
        },
        Telefono: { phone_number: normalizedPhoneNumber },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } }
    };

    // Agregar campos personalizados si existen
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
    if (email) {
        propertiesToUpdate["Email"] = {
            email: email
        };
    }

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
        console.log(`Contacto actualizado correctamente en Notion: ${normalizedPhoneNumber}`);
    } catch (error) {
        console.error('Error al actualizar el contacto en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
    }
}

// Función para crear un nuevo contacto en Notion
async function createContactInNotion(payload, tags, customFields) {
    const { name, phoneNumber } = payload;
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    let productInterestTag = null;
    let productsAcquiredTag = null;
    let dni = null;
    let email = null;

    // Procesar customFields si están disponibles
    if (customFields) {
        const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
        const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];
        dni = customFields["Dni"];
        email = customFields["Mail"];

        productInterestTag = productInterest
            ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]
            : null;
        productsAcquiredTag = productsAcquired
            ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]
            : null;
    }

    const propertiesToCreate = {
        Nombre: {
            title: [{ text: { content: name || 'Sin Nombre' } }]
        },
        Telefono: { phone_number: normalizedPhoneNumber },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } }
    };

    // Agregar campos personalizados si existen
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
    if (dni) {
        propertiesToCreate["Dni"] = {
            number: parseInt(dni, 10)
        };
    }
    if (email) {
        propertiesToCreate["Email"] = {
            email: email
        };
    }

    try {
        const response = await axios.post('https://api.notion.com/v1/pages', {
            parent: { database_id: notionDatabaseId },
            properties: propertiesToCreate
        }, {
            headers: {
                'Authorization': `Bearer ${notionToken}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            }
        });
        console.log(`Datos creados correctamente en Notion: Teléfono: ${normalizedPhoneNumber}, Nombre: ${name || 'Sin Nombre'}`);
        return response.data.id;
    } catch (error) {
        console.error('Error al crear un nuevo registro en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
    }
}

module.exports = { handleWebhook };
