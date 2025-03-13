const axios = require('axios');

// Token de Notion y ID de la base de datos
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const notionDatabaseId = 'e1c86c0d490c4ccdb7b3d92007dea981';

// Definición de customFieldMap
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

// Cola de solicitudes pendientes
const requestQueue = [];

// Procesando la cola
let isProcessingQueue = false;

// Tiempo de espera entre cada solicitud (en milisegundos)
const PROCESSING_INTERVAL = 1000;

// Función para buscar contacto por teléfono o IDF en Notion
async function buscarContactoEnNotion(phoneNumber, uuid) {
    let filter;
    
    if (uuid) {
        // Buscar primero por UUID en el campo IDF
        filter = {
            property: 'IDF',
            rich_text: { equals: uuid }
        };
    } else if (phoneNumber) {
        // Si no hay UUID, buscar por teléfono
        filter = {
            property: 'Telefono',
            phone_number: { equals: phoneNumber }
        };
    } else {
        console.log('No hay identificador para buscar (ni UUID ni teléfono)');
        return null;
    }

    try {
        const response = await axios.post(
            `https://api.notion.com/v1/databases/${notionDatabaseId}/query`,
            { filter },
            {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );

        return response.data.results[0] || null;

    } catch (error) {
        console.error('Error al buscar contacto en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
        return null;
    }
}

// Normalizar el número de teléfono para mantener un formato consistente
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return null;
    return phoneNumber.replace(/[^0-9]/g, ''); // Eliminar todos los caracteres excepto números
};

// Función para manejar el webhook de Callbell
async function handleWebhook(req, res) {
    // Responder inmediatamente para evitar timeouts
    res.status(202).send('Webhook recibido');

    // Añadir la solicitud a la cola
    const { payload } = req.body;
    if (payload) {
        requestQueue.push(payload);
        processQueue();
    }
}

// Función para procesar la cola
async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (requestQueue.length > 0) {
        const payload = requestQueue.shift();

        try {
            const { name, phoneNumber, tags, customFields, uuid, source } = payload;

            const normalizedPhoneNumber = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
            
            console.log(`Procesando contacto: ${name || 'Sin Nombre'}, Fuente: ${source}, UUID: ${uuid}`);
            if (normalizedPhoneNumber) {
                console.log(`Número de teléfono normalizado: ${normalizedPhoneNumber}`);
            } else {
                console.log('Sin número de teléfono');
            }

            // Buscar contacto existente usando el UUID en IDF
            const existingPage = await buscarContactoEnNotion(normalizedPhoneNumber, uuid);

            if (existingPage) {
                console.log(`Contacto existente encontrado, actualizando...`);
                await updateContactInNotion(existingPage.id, payload, tags, customFields);
            } else {
                console.log(`Contacto nuevo, creando en Notion...`);
                await createContactInNotion(payload, tags, customFields);
            }

        } catch (error) {
            console.error('Error:', error.message, error.response?.data);
        }

        await delay(PROCESSING_INTERVAL);
    }

    isProcessingQueue = false;
}

// Función de retardo
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para actualizar contacto existente en Notion
async function updateContactInNotion(pageId, payload, tags, customFields) {
    const { name, phoneNumber, uuid, source } = payload;
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

    // Construir las propiedades a actualizar
    const propertiesToUpdate = {
        Nombre: {
            title: [{ text: { content: name || 'Sin Nombre' } }] // Actualiza siempre el nombre con el valor proporcionado
        },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } }, // `select` para un único valor
        "IDF": {
            rich_text: [{ text: { content: uuid || '' } }]
        }
    };

    // Añadir teléfono solo si existe
    if (normalizedPhoneNumber) {
        propertiesToUpdate.Telefono = { phone_number: normalizedPhoneNumber };
    }

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
        console.log(`Contacto actualizado correctamente en Notion: ${uuid}`);
    } catch (error) {
        console.error('Error al actualizar el contacto en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
    }
}

// Función para crear un nuevo contacto en Notion
async function createContactInNotion(payload, tags, customFields) {
    const { name, phoneNumber, uuid, source, href } = payload;
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
        Proyecto: {
            multi_select: [{ name: 'Erick Gomez' }]
        },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } }, // `select` para un único valor
        "IDF": {
            rich_text: [{ text: { content: uuid || '' } }]
        },
        "Fuente": {
            select: { name: source || 'Desconocido' }
        }
    };

    // Añadir teléfono solo si existe
    if (normalizedPhoneNumber) {
        propertiesToCreate.Telefono = { phone_number: normalizedPhoneNumber };
    }

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
        console.log(`Contacto creado correctamente en Notion: ${uuid}`);
        return response.data.id;
    } catch (error) {
        console.error('Error al crear un nuevo registro en Notion:', error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
    }
}

/* // Para probar con el ejemplo de WhatsApp con número de teléfono
const testPayload = {
    "href": "https://dash.callbell.eu/contacts/223d3f8e4b724a5c9dd9a87cb4071228",
    "name": "Jeffrey test 2💈",
    "tags": [],
    "team": {
      "name": "General",
      "uuid": "91f8b735b6c74c4e80d3c92fae38412c",
      "default": true,
      "members": 2,
      "createdAt": "2024-11-07T19:02:44Z"
    },
    "uuid": "223d3f8e4b724a5c9dd9a87cb4071228",
    "source": "whatsapp",
    "channel": {
      "main": true,
      "type": "whatsapp",
      "uuid": "ad3c0461d1e54d52b72900b20003f4a9",
      "title": "WhatsappErick"
    },
    "closedAt": null,
    "avatarUrl": null,
    "blockedAt": null,
    "createdAt": "2025-03-13T03:01:11Z",
    "phoneNumber": "+506 6020 4102",
    "assignedUser": "iascinahuel@gmail.com",
    "customFields": {},
    "conversationHref": "https://dash.callbell.eu/chat/47eae44bb73e43a5b2212f2de6e0f63b"
};


async function testWebhook() {
  console.log("Probando con contacto de WhatsApp con número de teléfono:");
  requestQueue.push(testPayload);
  await processQueue();
}

// Ejecutar prueba
 testWebhook(); */

module.exports = { handleWebhook };