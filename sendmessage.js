// sendMessages.js
const axios = require('axios');

// Tokens y configuraciones
const notionToken = 'secret_uCBoeC7cnlFtq7VG4Dr58nBYFLFbR6dKzF00fZt2dq';
const databaseId = '01274cd5b0d8407b8b8b12af9463fe73';
const callbellToken = 'V9jzXL9gyqmbsEUQEUmsQyR5uYxizrJf.de4e2811d455e54fc4785a0a46b1210fc399661fccf70d7309643efed8e4dedb';

// Números de teléfono a los que se enviará el mensaje
const phoneNumbers = [
    '5491123965661',
    '5493518781862',
    '5491124652553'
];

// Función para obtener datos desde Notion
async function getSalesData() {
    try {
        const response = await axios.post(
            `https://api.notion.com/v1/databases/${databaseId}/query`,
            {
                filter: {
                    property: 'Creado',
                    date: {
                        equals: new Date().toISOString().split('T')[0], // Obtener solo las ventas de hoy
                    },
                },
            },
            {
                headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );

        const results = response.data.results;

        // Filtrar las propiedades que interesan: 'Última edición', 'Monto' y 'Pais'
        const filteredResults = results.map(page => {
            const lastEditedProperty = page.properties['Creado'];
            const amountProperty = page.properties['Monto'];
            const countryProperty = page.properties['Pais'];

            // Acceder a las fechas correctamente desde la propiedad de tipo fecha de Notion
            const lastEdited = lastEditedProperty && lastEditedProperty.date ? lastEditedProperty.date.start : undefined;
            const amount = amountProperty && amountProperty.number ? amountProperty.number : 0;
            const country = countryProperty && countryProperty.formula ? countryProperty.formula.string : 'Desconocido';

            return {
                id: page.id,
                lastEdited,
                amount,
                country
            };
        });

        // Procesar datos
        const salesCount = filteredResults.length;
        const totalAmount = filteredResults.reduce((sum, page) => sum + page.amount, 0);

        // Calcular el país con más compras
        const countrySales = {};
        filteredResults.forEach(page => {
            const country = page.country;
            if (!countrySales[country]) {
                countrySales[country] = 0;
            }
            countrySales[country] += page.amount;
        });

        // Encontrar el país con más compras
        let topCountry = 'Desconocido';
        let maxSales = 0;

        for (const country in countrySales) {
            if (countrySales[country] > maxSales) {
                topCountry = country;
                maxSales = countrySales[country];
            }
        }

        return { salesCount, totalAmount, topCountry, maxSales };
    } catch (error) {
        console.error('Error al obtener datos de Notion:', error.message);
        throw new Error('Error al obtener datos de Notion');
    }
}

// Función para enviar mensaje a través de Callbell
async function sendMessage(phoneNumber, message) {
    try {
        const response = await axios.post('https://api.callbell.eu/v1/messages/send', {
            to: phoneNumber,
            from: 'whatsapp',
            type: 'text',
            content: {
                text: message
            }
        }, {
            headers: {
                'Authorization': `Bearer ${callbellToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 segundos
        });
        console.log(`Mensaje enviado con éxito a ${phoneNumber}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(`Error al enviar el mensaje a ${phoneNumber}:`, error.message);
        throw new Error('Error al enviar el mensaje');
    }
}

// Función principal para enviar los mensajes
async function sendMessages() {
    try {
        // Obtener datos de Notion
        const { salesCount, totalAmount, topCountry, maxSales } = await getSalesData();

        // Mensaje base
        const baseMessage = 'Erick Gomez Academy: Resultados de ventas del día anterior.';

        // Enriquecer mensaje con datos de Notion
        const enrichedMessage = `${baseMessage}\n\nVentas del día anterior: ${salesCount}\nMonto total: $${totalAmount}\nPaís con más compras: ${topCountry} ($${maxSales})`;

        // Enviar mensajes a todos los números
        for (const phoneNumber of phoneNumbers) {
            await sendMessage(phoneNumber, enrichedMessage);
        }

        console.log('Todos los mensajes han sido enviados con éxito.');
    } catch (error) {
        console.error('Error en el proceso de envío de mensajes:', error.message);
    }
}

// Exportar la función para usarla en otros archivos
module.exports = { sendMessages };

// Ejecutar el envío de mensajes directamente al correr el archivo
if (require.main === module) {
    sendMessages();
}
