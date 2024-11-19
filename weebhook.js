// Importar paquetes necesarios
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

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

// Caché para contactos recientemente consultados
const contactCache = new Map(); // clave: número de teléfono, valor: { pageId, lastUpdated }
const MAX_CACHE_SIZE = 1000; // Tamaño máximo de la caché

// Normalizar el número de teléfono para mantener un formato consistente
const normalizePhoneNumber = (phoneNumber) => {
    return phoneNumber.replace(/[^0-9]/g, ''); // Eliminar todos los caracteres excepto números
};

// Función para manejar el webhook de Callbell
async function handleWebhook(req, res) {
    // Responder inmediatamente para evitar timeouts
    res.status(202).send('Webhook recibido');

    // Luego de responder, procesar los datos asíncronamente
    (async () => {
        try {
            // Extraer datos del cuerpo de la solicitud
            const { payload } = req.body;
            console.log('Datos recibidos del webhook:', JSON.stringify(payload, null, 2)); // Consola para ver los datos recibidos

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

            // Verificar si la caché ha alcanzado el tamaño máximo y reiniciarla si es necesario
            if (contactCache.size >= MAX_CACHE_SIZE) {
                console.log('El tamaño de la caché ha alcanzado el límite máximo. Reiniciando la caché...');
                contactCache.clear();
            }

            // Verificar si el contacto ya está en la caché
            if (contactCache.has(normalizedPhoneNumber)) {
                const cachedContact = contactCache.get(normalizedPhoneNumber);
                console.log(`Contacto encontrado en caché: ${normalizedPhoneNumber}`);
                // Actualizar el contacto en Notion usando el pageId de la caché
                await updateContactInNotion(cachedContact.pageId, payload, tags, customFields);
                return;
            }

            console.log('Iniciando búsqueda del contacto en Notion...');

            // Buscar el contacto en la base de datos de Notion
            const searchResponse = await axios.post(`https://api.notion.com/v1/databases/${notionDatabaseId}/query`, {
                filter: {
                    property: 'Telefono',
                    phone_number: { equals: normalizedPhoneNumber }
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            });

            const pages = searchResponse.data.results;
            console.log('Resultado de la búsqueda en Notion:', JSON.stringify(pages, null, 2)); // Consola para ver los resultados de búsqueda

            if (pages.length > 0) {
                // Actualizar contacto existente
                const pageId = pages[0].id;
                contactCache.set(normalizedPhoneNumber, { pageId, lastUpdated: new Date() }); // Actualizar la caché

                console.log(`Contacto encontrado en Notion. Actualizando: ${pageId}`);
                await updateContactInNotion(pageId, payload, tags, customFields);
            } else {
                // Crear nuevo contacto si no existe
                console.log('No se encontró el contacto, creando un nuevo registro en Notion...');

                const newPageId = await createContactInNotion(payload, tags, customFields);
                // Almacenar en caché el nuevo contacto
                contactCache.set(normalizedPhoneNumber, { pageId: newPageId, lastUpdated: new Date() });
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
    let mail = null;

    if (customFields) {
        const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
        const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];
        dni = customFields["Dni"];
        mail = customFields["Mail"];

        productInterestTag = productInterest ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest] : null;
        productsAcquiredTag = productsAcquired ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired] : null;
    }

    const selectedTag = Array.isArray(tags) && tags.length > 0 ? tags[tags.length - 1] : "Sin Estado";

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
    let mail = null;

    if (customFields) {
        const productInterest = customFields["PI : MF-FOCUS-CUT-MFC"];
        const productsAcquired = customFields["PA : MF-FOCUS-CUT-MFC"];
        dni = customFields["Dni"];
        mail = customFields["Mail"];

        productInterestTag = productInterest ? customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest] : null;
        productsAcquiredTag = productsAcquired ? customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired] : null;
    }

    const selectedTag = Array.isArray(tags) && tags.length > 0 ? tags[tags.length - 1] : "Sin Estado";

    const propertiesToCreate = {
        Nombre: {
            title: [{ text: { content: name || "Sin Nombre" } }]
        },
        Telefono: { phone_number: normalizedPhoneNumber },
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
        console.log(`Datos creados correctamente en Notion: Teléfono: ${normalizedPhoneNumber}, Nombre: ${name || "Sin Nombre"}`);
        return response.data.id; // Retornar el pageId del nuevo registro
    } catch (error) {
        console.error('Error al crear un nuevo registro en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
    }
}

module.exports = { handleWebhook };
