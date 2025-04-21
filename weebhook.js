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

// Normalizar el número de teléfono para mantener un formato consistente
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return null;
    return phoneNumber.replace(/[^0-9]/g, ''); // Eliminar todos los caracteres excepto números
};

// Función para buscar contacto por teléfono o IDF en Notion
async function buscarContactoEnNotion(phoneNumber, uuid, source) {
    // Intentar buscar por UUID en el campo IDF primero
    if (uuid) {
        try {
            const idfResponse = await axios.post(
                `https://api.notion.com/v1/databases/${notionDatabaseId}/query`,
                {
                    filter: {
                        property: 'IDF',
                        rich_text: { equals: uuid }
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

            if (idfResponse.data.results.length > 0) {
                console.log(`Contacto encontrado por IDF: ${uuid}`);
                return idfResponse.data.results[0];
            }
        } catch (error) {
            console.error('Error al buscar contacto por IDF:', error.message);
        }
    }

    // Si hay número de teléfono, buscar por Tel ID (campo fórmula)
    if (phoneNumber) {
        const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
        
        try {
            // Obtener todos los registros para comparar con Tel ID
            const response = await axios.post(
                `https://api.notion.com/v1/databases/${notionDatabaseId}/query`,
                {}, // Sin filtro para obtener todos los registros
                {
                    headers: {
                        'Authorization': `Bearer ${notionToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    }
                }
            );

            // Buscar un registro donde Tel ID coincida con el número normalizado
            for (const page of response.data.results) {
                const telIdProperty = page.properties['Tel ID'];
                
                if (telIdProperty && telIdProperty.formula && telIdProperty.formula.string) {
                    const telIdValue = telIdProperty.formula.string;
                    const normalizedTelId = normalizePhoneNumber(telIdValue);
                    
                    if (normalizedTelId === normalizedPhoneNumber) {
                        console.log(`Contacto encontrado por Tel ID normalizado: ${normalizedPhoneNumber}`);
                        return page;
                    }
                }
            }
        } catch (error) {
            console.error('Error al buscar contacto por Tel ID:', error.message);
        }

        // Como respaldo, buscar por el campo Telefono
        try {
            const phoneResponse = await axios.post(
                `https://api.notion.com/v1/databases/${notionDatabaseId}/query`,
                {
                    filter: {
                        property: 'Telefono',
                        phone_number: { equals: phoneNumber }
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

            if (phoneResponse.data.results.length > 0) {
                console.log(`Contacto encontrado por Telefono: ${phoneNumber}`);
                return phoneResponse.data.results[0];
            }
        } catch (error) {
            console.error('Error al buscar contacto por Telefono:', error.message);
        }
    }

    console.log('No se encontró ningún contacto existente');
    return null;
}

// Función para manejar el webhook de Callbell
async function handleWebhook(req, res) {
    // Responder inmediatamente para evitar timeouts
    console.log("Payload recibido:", JSON.stringify(req.body, null, 2));

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
            
            console.log(`Procesando contacto: ${name || 'Sin Nombre'}, Fuente: ${source}, UUID: ${uuid}`);
            if (phoneNumber) {
                const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
                console.log(`Número de teléfono: ${phoneNumber}`);
                console.log(`Número de teléfono normalizado: ${normalizedPhoneNumber}`);
            } else {
                console.log('Sin número de teléfono');
            }

            // Buscar contacto existente
            const existingPage = await buscarContactoEnNotion(phoneNumber, uuid, source);

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
    const { name, phoneNumber, uuid, source, assignedUser } = payload;

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

        if (productInterest && customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]) {
            productInterestTag = customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest];
        }

        if (productsAcquired && customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]) {
            productsAcquiredTag = customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired];
        }
    }

    // Construir las propiedades a actualizar
    const propertiesToUpdate = {
        Nombre: {
            title: [{ text: { content: name || 'Sin Nombre' } }]
        },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } },
        IDF: {
            rich_text: [{ text: { content: uuid || '' } }]
        },
        Fuente: {
            select: { name: source || 'Desconocido' }
        }
    };

    if (phoneNumber) {
        propertiesToUpdate.Telefono = { phone_number: phoneNumber };
    }

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

    // 🟡 NUEVO: Guardar el responsable si llega
    if (assignedUser) {
        propertiesToUpdate["Responsable"] = {
            rich_text: [{ text: { content: assignedUser } }]
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
    const { name, phoneNumber, uuid, source, href, assignedUser } = payload;

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

        if (productInterest && customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest]) {
            productInterestTag = customFieldMap["PI : MF-FOCUS-CUT-MFC"][productInterest];
        }

        if (productsAcquired && customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired]) {
            productsAcquiredTag = customFieldMap["PA : MF-FOCUS-CUT-MFC"][productsAcquired];
        }
    }

    const propertiesToCreate = {
        Nombre: {
            title: [{ text: { content: name || 'Sin Nombre' } }]
        },
        Proyecto: {
            multi_select: [{ name: 'Erick Gomez' }]
        },
        Estado: { select: { name: tags?.[0] || 'Sin Estado' } },
        IDF: {
            rich_text: [{ text: { content: uuid || '' } }]
        },
        Fuente: {
            select: { name: source || 'Desconocido' }
        }
    };

    if (phoneNumber) {
        propertiesToCreate.Telefono = { phone_number: phoneNumber };
    }

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
    // 🟡 NUEVO: Guardar el responsable si llega
    if (assignedUser) {
        propertiesToUpdate["Responsable"] = {
            rich_text: [{ text: { content: assignedUser } }]
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


/*
// Para probar con ambos ejemplos
const testFacebookPayload = {
  "href": "https://dash.callbell.eu/contacts/96ad2ffbd4d14f728517b3f4faadbfff",
  "name": null,
  "tags": [],
  "team": {
    "name": "REDES",
    "uuid": "e85a681de2b9405db19513f78a071049",
    "default": false,
    "members": 2,
    "createdAt": "2024-11-07T19:07:11Z"
  },
  "uuid": "96ad2ffbd4d14f728517b3f4faadbfff",
  "source": "facebook",
  "channel": {
    "main": true,
    "type": "facebook",
    "uuid": "3d426d444181409748f13410731001541",
    "title": "Erick Gomez Academy"
  },
  "closedAt": null,
  "avatarUrl": null,
  "blockedAt": null,
  "createdAt": "2025-03-13T02:34:16Z",
  "phoneNumber": null,
  "assignedUser": null,
  "customFields": {
    "PI : MF-FOCUS-CUT-MFC": "MF"
  },
  "conversationHref": "https://dash.callbell.eu/chat/11bb7026a18e42a5a462881a839ea0bc"
};
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
    
const testWhatsAppPayload = {
    "href": "https://dash.callbell.eu/contacts/223d3f8e4b724a5c9dd9a87cb4071228",
    "name": "Jeffrey💈",
    "tags": [],
    "team": {
      "name": "General",
      "uuid": "91f8b735b6c74c4e80d3c92fae38412c",
      "default": true,
    "blockedAt": null,
    "createdAt": "2025-03-13T03:01:11Z",
    "phoneNumber": "+506 6020 41026666",
    "assignedUser": "iascinahuel@gmail.com",
    "customFields": {
      "PI : MF-FOCUS-CUT-MFC": "FOCUS"
    },
    "conversationHref": "https://dash.callbell.eu/chat/47eae44bb73e43a5b2212f2de6e0f63b"
};

// Simular procesamiento del webhook para pruebas
async function testWebhook() {
  // Probar con contacto de Facebook
  console.log("\n--- PRUEBA CON CONTACTO DE FACEBOOK ---");
  requestQueue.push(testFacebookPayload);
  await processQueue();
  
  // Esperar un poco antes de la siguiente prueba
  await delay(2000);
  
  // Probar con contacto de WhatsApp
  console.log("\n--- PRUEBA CON CONTACTO DE WHATSAPP ---");
  requestQueue.push(testWhatsAppPayload);
  await processQueue();
}

// Ejecutar prueba
testWebhook();
*/


module.exports = { handleWebhook };