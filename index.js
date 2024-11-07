app.post('/webhook/callbell', async (req, res) => {
    try {
        const { name, phoneNumber } = req.body;

        // Verificar que tenemos los datos requeridos
        if (!phoneNumber) {
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

        res.status(200).send('Datos guardados correctamente en Notion');
    } catch (error) {
        console.error('Error al guardar los datos en Notion:', error);
        res.status(500).send('Error al procesar el webhook');
    }
});
